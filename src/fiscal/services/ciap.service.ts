import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service';
import {
  ciapApropriacoes,
  ciapAtivoPermanente,
  ciapCompetenciasApropriadas,
  ciapMovimentos,
  clientes,
  documentosFiscais,
  documentosFiscaisItens,
  fiscalCatalogosVersoes,
  spedAjustesApuracao,
} from '../../database/schema';
import {
  fromScaledInteger,
  positive,
  toScaledInteger,
} from '../sped/sped-decimal';
import {
  monthsBetweenCompetencias,
  parseCompetenciaMensal,
} from '../fiscal-date.util';

// Handle de transação do drizzle, derivado do callback de `db.transaction`.
// Usado pelos helpers que operam dentro de uma transação (regravação do E111).
type CiapTx = Parameters<
  Parameters<DatabaseService['db']['transaction']>[0]
>[0];

// CFOPs de entrada de bem para o ativo imobilizado (aquisição).
const CFOPS_ATIVO_ENTRADA = new Set(['1551', '2551', '3551']);

// Escala usada para o coeficiente de saídas tributadas (4 casas decimais).
const COEFICIENTE_SCALE = 4;

// REGRA EXPLÍCITA PARA O CASO "SEM SAÍDAS" (R2.4).
//
// Quando NÃO há saídas no período (denominador = 0), o coeficiente de
// participação `numerador / denominador` é indefinido. A versão anterior
// retornava `1.0000` silenciosamente — presumindo que 100% da parcela era
// admitida como crédito, sem qualquer saída que fundamentasse esse rateio.
// Isso viola R2.4 ("NÃO DEVE assumir coeficiente 1 silenciosamente; DEVE
// aplicar regra explícita") e a diretriz de não presumir 100% sem fundamento.
//
// POLÍTICA ADOTADA (deliberada, não acidental): coeficiente `0.0000`. Num
// período sem nenhuma saída NÃO há base para presumir crédito admitido; o
// crédito deliberadamente NÃO é apropriado. É a escolha conservadora e
// auditável, coerente com a postura bloqueante da fase (uma pré-condição
// fiscal ainda não decidida — a regra estadual de coeficiente para "sem
// saídas" — não pode produzir crédito silenciosamente; vide requirements,
// "Pré-condições fiscais"). O `fonte: 'sem_saidas'` + `sem_saidas: true` já
// permitem ao chamador DISTINGUIR o caso (p.ex. para diagnóstico/revisão
// fiscal) em vez de tratá-lo como um `0.0000` qualquer.
//
// Nota de calendário: como o número da parcela em `apropriarCompetencia` deriva
// do calendário (não de um contador), uma parcela que caia num período sem
// saídas é apropriada com crédito admitido 0 (parcela integralmente vedada
// nessa competência) — nunca com crédito presumido. A regra é um PARÂMETRO
// explícito e versionável; se a definição fiscal estadual determinar outro
// tratamento (carry-forward, revisão manual), este é o único ponto a mudar.
const COEFICIENTE_SEM_SAIDAS = '0.0000';

// Identidade de uma EXPORTAÇÃO na saída: CFOP cujo primeiro dígito é 7 (operação
// com o exterior). A LC 87/1996 (art. 32, I e art. 3º, II) assegura a imunidade
// das exportações SEM anular o direito ao crédito do ativo; por isso a saída de
// exportação NÃO tem ICMS destacado (`valorIcms = 0`) mas DEVE compor o
// numerador do coeficiente como se tributada fosse (R2.3). Confiar em
// `valorIcms > 0` as classificaria incorretamente como não tributadas.
const CFOP_EXPORTACAO_PREFIXO = '7';

// CSTs de ICMS de saída EQUIPARADAS a tributadas para fins do coeficiente do
// CIAP (R2.3): operações sem débito de ICMS que, por disposição legal, mantêm o
// direito ao crédito (equiparadas à exportação / não incidência com manutenção
// de crédito). Como as exceções estaduais ainda dependem de definição fiscal
// (pré-condição bloqueante da fase), o conjunto federal padrão cobre a saída com
// fim específico de exportação (CST 41/50/51 conforme destinação). O conjunto é
// um PARÂMETRO explícito e versionável — nunca uma presunção silenciosa.
const CSTS_SAIDA_EQUIPARADA = new Set(['41', '50', '51']);

// Limite legal de parcelas de apropriação do CIAP (1/48). Espelha as
// restrições do RegistrarBemCiapDto para valer também fora do HTTP (R6.4).
const PARCELAS_MIN = 1;
const PARCELAS_MAX = 48;

// Tipo do catálogo de códigos de ajuste (R2.6): identifica, em
// `fiscal_catalogos_versoes`, as linhas do código estadual de ajuste E111 de
// crédito do CIAP. É o único consumidor hoje; a Fase 4 pode adicionar outros
// tipos sem nova tabela.
const CATALOGO_TIPO_E111_CIAP = 'E111_CIAP';

/**
 * Cenário de cálculo do coeficiente de participação do CIAP (R2.3).
 *
 * Encapsula o cliente e a janela de competência sobre a qual o rateio de saídas
 * é apurado. É o único insumo de {@link CiapService.calcularCoeficiente}, para
 * que preview (`apurarCompetencia`), efetivação (`apropriarCompetencia`) e
 * builder possam derivar o MESMO coeficiente a partir do mesmo cenário.
 */
export interface CoeficienteCenario {
  clienteId: string;
  inicio: Date;
  fim: Date;
}

/**
 * Resultado FUNDAMENTADO do coeficiente de participação do CIAP (R2.3).
 *
 * Expõe numerador e denominador decompostos (strings decimais) para que a
 * composição seja auditável e testável — não apenas o número final. O
 * `coeficiente` é `numerador / denominador` com 4 casas; `fonte` descreve a
 * regra aplicada.
 *
 *   numerador  = saídas tributadas + exportações + saídas equiparadas
 *   denominador = total de saídas no período
 */
export interface CoeficienteResultado {
  coeficiente: string;
  fonte: string;
  numerador: string;
  denominador: string;
  componentes: {
    saidas_tributadas: string;
    exportacoes: string;
    saidas_equiparadas: string;
    total_saidas: string;
  };
  // Verdadeiro quando NÃO houve saídas no período. Permite ao chamador
  // DISTINGUIR o caso "sem saídas" (R2.4) de um coeficiente 0 derivado de
  // saídas sem direito a crédito — ainda que ambos resultem em crédito não
  // apropriado, a origem é diferente (p.ex. para diagnóstico/revisão fiscal).
  // A política explícita aplicada ao coeficiente nesse caso é
  // {@link COEFICIENTE_SEM_SAIDAS}.
  sem_saidas: boolean;
}

export interface RegistroBemCiapInput {
  clienteId: string;
  documentoFiscalId?: string | null;
  documentoFiscalItemId?: string | null;
  codigoBem: string;
  identificacaoBem: string;
  dataEntrada: string; // 'YYYY-MM-DD'
  valorIcmsTotal: string;
  valorIcmsFrete?: string;
  valorIcmsDifal?: string;
  quantidadeParcelas?: number;
}

interface CiapRow {
  ciap: typeof ciapAtivoPermanente.$inferSelect;
}

@Injectable()
export class CiapService {
  constructor(private readonly database: DatabaseService) { }

  /**
   * Registra manualmente um bem do ativo permanente no CIAP.
   * O saldo credor inicial = ICMS total + frete + DIFAL (base de apropriação).
   */
  async registrarBem(input: RegistroBemCiapInput) {
    const parcelas = input.quantidadeParcelas ?? PARCELAS_MAX;
    // R6.4: as mesmas invariantes que o RegistrarBemCiapDto impõe na fronteira
    // HTTP são reforçadas aqui, para que um chamador que NÃO passe pelo
    // ValidationPipe (cron, fila, outro serviço, importarBensDoPeriodo) não as
    // burle. Parcelas devem ser inteiras dentro de 1..48.
    if (!Number.isInteger(parcelas)) {
      throw new BadRequestException(
        'Quantidade de parcelas deve ser um número inteiro.',
      );
    }
    if (parcelas < PARCELAS_MIN || parcelas > PARCELAS_MAX) {
      throw new BadRequestException(
        `Quantidade de parcelas deve estar entre ${PARCELAS_MIN} e ${PARCELAS_MAX}.`,
      );
    }
    // R6.4/R6.3: valores de ICMS (total, frete, DIFAL) não podem ser negativos.
    // Sem isso, um chamador não-HTTP poderia gravar uma base de apropriação
    // negativa (corrompendo o saldo credor do CIAP).
    this.assertValorNaoNegativo(input.valorIcmsTotal, 'ICMS total');
    this.assertValorNaoNegativo(input.valorIcmsFrete ?? '0', 'ICMS do frete');
    this.assertValorNaoNegativo(input.valorIcmsDifal ?? '0', 'DIFAL');

    // R6.2: quando o registro referencia um documento fiscal (ou um item de
    // documento) de outro cliente, a operação é rejeitada. A checagem de
    // propriedade é feita no serviço — não confiamos apenas na FK por UUID —
    // impedindo que um bem CIAP seja atrelado ao documento de outro cliente.
    await this.assertDocumentoDoCliente(
      input.clienteId,
      input.documentoFiscalId,
      input.documentoFiscalItemId,
    );
    const saldoInicial = fromScaledInteger(
      toScaledInteger(input.valorIcmsTotal) +
      toScaledInteger(input.valorIcmsFrete ?? '0') +
      toScaledInteger(input.valorIcmsDifal ?? '0'),
    );

    const rows = await this.database.db
      .insert(ciapAtivoPermanente)
      .values({
        clienteId: input.clienteId,
        documentoFiscalId: input.documentoFiscalId ?? null,
        documentoFiscalItemId: input.documentoFiscalItemId ?? null,
        codigoBem: input.codigoBem,
        identificacaoBem: input.identificacaoBem,
        dataEntrada: input.dataEntrada,
        valorIcmsTotal: input.valorIcmsTotal,
        valorIcmsFrete: input.valorIcmsFrete ?? '0',
        valorIcmsDifal: input.valorIcmsDifal ?? '0',
        quantidadeParcelas: parcelas,
        parcelasApropriadas: 0,
        saldoCredorRestante: saldoInicial,
        status: 'ATIVO',
      })
      .onConflictDoUpdate({
        target: [ciapAtivoPermanente.clienteId, ciapAtivoPermanente.codigoBem],
        set: {
          identificacaoBem: input.identificacaoBem,
          documentoFiscalId: input.documentoFiscalId ?? null,
          documentoFiscalItemId: input.documentoFiscalItemId ?? null,
          dataEntrada: input.dataEntrada,
          valorIcmsTotal: input.valorIcmsTotal,
          valorIcmsFrete: input.valorIcmsFrete ?? '0',
          valorIcmsDifal: input.valorIcmsDifal ?? '0',
          atualizadoEm: new Date(),
        },
      })
      .returning();
    return this.toBemResponse(rows[0]);
  }

  /**
   * Importa automaticamente para o CIAP os itens de compra de ativo
   * imobilizado (CFOP 1551/2551) escriturados no período informado que ainda
   * não possuem ficha CIAP. Idempotente por (clienteId, codigoBem).
   */
  async importarBensDoPeriodo(input: {
    clienteId: string;
    competencia: string;
  }) {
    const { inicio, fim } = this.competenciaRange(input.competencia);
    const itens = await this.database.db
      .select({
        documentoFiscalId: documentosFiscaisItens.documentoFiscalId,
        documentoFiscalItemId: documentosFiscaisItens.id,
        codigoProduto: documentosFiscaisItens.codigoProduto,
        descricao: documentosFiscaisItens.descricao,
        cfop: documentosFiscaisItens.cfop,
        valorIcms: documentosFiscaisItens.valorIcms,
        dataEmissao: documentosFiscais.dataEmissao,
      })
      .from(documentosFiscaisItens)
      .innerJoin(
        documentosFiscais,
        eq(documentosFiscais.id, documentosFiscaisItens.documentoFiscalId),
      )
      .where(
        and(
          eq(documentosFiscaisItens.clienteId, input.clienteId),
          eq(documentosFiscaisItens.tipoOperacaoEscriturada, 'ENTRADA'),
          eq(documentosFiscais.situacao, 'AUTORIZADA'),
          eq(documentosFiscais.escriturado, true),
          gte(documentosFiscais.dataEmissao, inicio),
          lte(documentosFiscais.dataEmissao, fim),
        ),
      );

    const ativos = itens.filter((item) => CFOPS_ATIVO_ENTRADA.has(item.cfop));
    let importados = 0;
    for (const item of ativos) {
      // Código do bem estável: produto do documento/item. Se não houver
      // código de produto, usa o id do item para garantir unicidade.
      const codigoBem = (
        item.codigoProduto ?? item.documentoFiscalItemId
      ).slice(0, 60);
      const dataEntrada = item.dataEmissao.toISOString().slice(0, 10);
      const jaExiste = await this.database.db
        .select({ id: ciapAtivoPermanente.id })
        .from(ciapAtivoPermanente)
        .where(
          and(
            eq(ciapAtivoPermanente.clienteId, input.clienteId),
            eq(ciapAtivoPermanente.codigoBem, codigoBem),
          ),
        )
        .limit(1);
      if (jaExiste[0]) continue;

      await this.registrarBem({
        clienteId: input.clienteId,
        documentoFiscalId: item.documentoFiscalId,
        documentoFiscalItemId: item.documentoFiscalItemId,
        codigoBem,
        identificacaoBem: item.descricao ?? codigoBem,
        dataEntrada,
        valorIcmsTotal: item.valorIcms ?? '0',
      });
      importados += 1;
    }
    return { importados, elegiveis: ativos.length };
  }

  /**
   * Calcula a parcela CIAP de uma competência para todos os bens ativos:
   *   parcela = (valor_icms_total_do_bem / quantidade_parcelas)
   *   credito_apropriado = parcela * coeficiente
   * onde coeficiente = saídas tributadas / saídas totais no período.
   * Não persiste; apenas projeta os valores (preview do Bloco G / E111).
   */
  async apurarCompetencia(input: { clienteId: string; competencia: string }) {
    const { competencia, inicio, fim } = this.competenciaRange(
      input.competencia,
    );
    const { coeficiente } = await this.calcularCoeficiente({
      clienteId: input.clienteId,
      inicio,
      fim,
    });
    const coefScaled = toScaledInteger(coeficiente, COEFICIENTE_SCALE);

    const bens = await this.database.db
      .select()
      .from(ciapAtivoPermanente)
      .where(
        and(
          eq(ciapAtivoPermanente.clienteId, input.clienteId),
          eq(ciapAtivoPermanente.status, 'ATIVO'),
        ),
      )
      .orderBy(asc(ciapAtivoPermanente.dataEntrada));

    let totalParcela = 0n;
    let totalCredito = 0n;
    const detalhes = bens.map((bem) => {
      const baseScaled =
        toScaledInteger(bem.valorIcmsTotal) +
        toScaledInteger(bem.valorIcmsFrete) +
        toScaledInteger(bem.valorIcmsDifal);
      const parcela = baseScaled / BigInt(bem.quantidadeParcelas);
      // credito = parcela * coeficiente (coeficiente tem escala 4).
      const credito = (parcela * coefScaled) / 10n ** BigInt(COEFICIENTE_SCALE);
      totalParcela += parcela;
      totalCredito += credito;
      return {
        id: bem.id,
        codigo_bem: bem.codigoBem,
        identificacao_bem: bem.identificacaoBem,
        parcelas_apropriadas: bem.parcelasApropriadas,
        quantidade_parcelas: bem.quantidadeParcelas,
        valor_parcela: fromScaledInteger(parcela),
        credito_apropriado: fromScaledInteger(credito),
        saldo_credor_restante: bem.saldoCredorRestante,
      };
    });

    return {
      competencia,
      coeficiente_saidas_tributadas: coeficiente,
      total_parcela: fromScaledInteger(totalParcela),
      total_credito_apropriado: fromScaledInteger(totalCredito),
      quantidade_bens: bens.length,
      bens: detalhes,
    };
  }

  /**
   * Efetiva a apropriação de uma competência (motor temporal/idempotente, F06).
   *
   * Reescrita da Fase 2 (tarefa 2.1 / R1.1–R1.4). As três mudanças de fundo em
   * relação à versão da Fase 0 são:
   *
   *  1. ELEGIBILIDADE POR DATA DE ENTRADA (R1.3): só participam da competência
   *     os bens `ATIVO` cuja `dataEntrada` é anterior ou igual ao FIM da
   *     competência. Um bem adquirido depois do período NÃO entra numa
   *     competência anterior à sua entrada — o filtro é por data do fato, não
   *     por quando a apropriação é executada.
   *
   *  2. NÚMERO DA PARCELA PELO CALENDÁRIO (R1.4): a parcela de um bem numa
   *     competência é `mesesDesdeEntrada + 1` (mês de entrada = parcela 1),
   *     derivada do calendário validado — NUNCA de `parcelasApropriadas + 1`
   *     nem da contagem de chamadas. Isso torna a parcela determinística e
   *     imune a retries: a mesma competência sempre mapeia para a mesma parcela.
   *     Quando a parcela de calendário excede `quantidadeParcelas`, o bem já
   *     esgotou o cronograma e não é apropriado nessa competência.
   *
   *  3. IDEMPOTÊNCIA PELA RAZÃO VERSIONADA (R1.1, R1.5): a existência de uma
   *     apropriação ATIVA em `ciap_apropriacoes` para (bem, competência) torna
   *     a reexecução um no-op — a mesma versão é devolvida, nunca uma segunda
   *     parcela. O unique parcial `uidx_ciap_aprop_bem_competencia_ativa`
   *     reforça isso no banco; combinado ao `pg_advisory_xact_lock` por
   *     cliente/competência, retries e chamadas concorrentes (R1.2) convergem
   *     para exatamente uma apropriação.
   *
   * Retorna o crédito total apropriado nesta execução (para o E111/Bloco G).
   */
  async apropriarCompetencia(input: {
    clienteId: string;
    competencia: string;
  }) {
    const { competencia, inicio, fim } = this.competenciaRange(
      input.competencia,
    );
    const { coeficiente, fonte: coeficienteFonte } =
      await this.calcularCoeficiente({
        clienteId: input.clienteId,
        inicio,
        fim,
      });
    const coefScaled = toScaledInteger(coeficiente, COEFICIENTE_SCALE);
    const uf = await this.getUfCliente(input.clienteId);
    const fimCompetencia = fim.toISOString().slice(0, 10);

    return this.database.db.transaction(async (tx) => {
      // R1.2: serializa apropriações concorrentes do mesmo cliente/competência,
      // impedindo que duas execuções simultâneas consumam duas parcelas. O lock
      // é liberado no commit/rollback da transação (xact).
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`ciap-apropriacao:${input.clienteId}:${competencia}`}, 0))`,
      );

      // R1.3/R1.7: elegibilidade POR DATA DO FATO (entrada E baixa), não pelo
      // flag de status corrente. Um bem participa de uma competência quando:
      //
      //  - `dataEntrada <= fim da competência` — não entra em competências
      //    anteriores à sua entrada (R1.3, bem futuro fica de fora); E
      //  - NÃO estava baixado AO FIM da competência — ou seja, `dataBaixa` é
      //    nula (nunca baixado) OU `dataBaixa > fim da competência` (a baixa é
      //    um fato POSTERIOR a esta competência).
      //
      // A chave é usar a DATA DA BAIXA, não o status atual: um bem baixado em,
      // p.ex., mai/2026 deixa de ser elegível de mai/2026 em diante, MAS
      // continua elegível para competências ANTERIORES (jan–abr/2026) num
      // reprocesso retroativo — a baixa respeita a data do fato (R1.7). Filtrar
      // por `status='ATIVO'` quebraria isso: a baixa removeria o bem de TODAS
      // as competências, inclusive as que o antecedem. Bens CONCLUIDO continuam
      // selecionáveis; o filtro de calendário (parcela > quantidadeParcelas)
      // abaixo já os descarta quando o cronograma se esgotou.
      const bens = await tx
        .select()
        .from(ciapAtivoPermanente)
        .where(
          and(
            eq(ciapAtivoPermanente.clienteId, input.clienteId),
            lte(ciapAtivoPermanente.dataEntrada, fimCompetencia),
            or(
              isNull(ciapAtivoPermanente.dataBaixa),
              gt(ciapAtivoPermanente.dataBaixa, fimCompetencia),
            ),
          ),
        );

      // R1.1/R1.5: razão versionada — bens que JÁ têm apropriação ATIVA nesta
      // competência não são apropriados de novo (idempotência por bem/
      // competência). O reprocesso devolve a mesma versão, sem segunda parcela.
      const jaApropriados = await tx
        .select({ bemId: ciapApropriacoes.bemId })
        .from(ciapApropriacoes)
        .where(
          and(
            eq(ciapApropriacoes.clienteId, input.clienteId),
            eq(ciapApropriacoes.competencia, competencia),
            eq(ciapApropriacoes.ativa, true),
          ),
        );
      const bensJaApropriados = new Set(jaApropriados.map((r) => r.bemId));

      let totalCredito = 0n;
      let bensApropriados = 0;
      for (const bem of bens) {
        // R1.1/R1.5: no-op idempotente — competência já apropriada para o bem.
        if (bensJaApropriados.has(bem.id)) continue;

        // R1.4: número da parcela DERIVADO DO CALENDÁRIO. Mês de entrada =
        // parcela 1; competência atual = mesesDesdeEntrada + 1. Independe de
        // quantas vezes a apropriação foi chamada ou do contador armazenado.
        const mesesDesdeEntrada = monthsBetweenCompetencias(
          bem.dataEntrada,
          competencia,
        );
        const numeroParcela = mesesDesdeEntrada + 1;
        // Fora da janela do calendário: antes da entrada (defensivo; o filtro
        // por dataEntrada já exclui) ou além do cronograma de parcelas.
        if (numeroParcela < 1 || numeroParcela > bem.quantidadeParcelas) {
          continue;
        }

        const baseScaled =
          toScaledInteger(bem.valorIcmsTotal) +
          toScaledInteger(bem.valorIcmsFrete) +
          toScaledInteger(bem.valorIcmsDifal);
        // R2.2: parcela passível (base ÷ nº de parcelas), parcela admitida
        // (passível × coeficiente) e parcela vedada (passível − admitida).
        const parcelaPassivel = baseScaled / BigInt(bem.quantidadeParcelas);
        const parcelaAdmitida =
          (parcelaPassivel * coefScaled) / 10n ** BigInt(COEFICIENTE_SCALE);
        const parcelaVedada = parcelaPassivel - parcelaAdmitida;
        const credito = parcelaAdmitida;
        const novoSaldo = positive(
          toScaledInteger(bem.saldoCredorRestante) - parcelaPassivel,
        );
        // R1.4: a conclusão do bem (término) é determinada pela parcela de
        // CALENDÁRIO (chegou à última parcela relativa à entrada), não por um
        // contador acumulado — o término respeita a data do fato (entrada +
        // cronograma), não a data de processamento.
        const concluido = numeroParcela >= bem.quantidadeParcelas;
        // R1.7: um bem BAIXADO que é apropriado numa competência ANTERIOR à
        // baixa (reprocesso retroativo) NÃO deve ter o status sobrescrito — a
        // baixa é um fato posterior e permanece. Só mexemos no status para
        // marcar o término (CONCLUIDO) de um bem ainda ATIVO.
        const novoStatus =
          bem.status === 'BAIXADO'
            ? 'BAIXADO'
            : concluido
              ? 'CONCLUIDO'
              : 'ATIVO';

        await tx
          .update(ciapAtivoPermanente)
          .set({
            // `parcelasApropriadas` passa a refletir a parcela de calendário
            // corrente (determinística), coerente com a razão versionada.
            parcelasApropriadas: numeroParcela,
            saldoCredorRestante: fromScaledInteger(novoSaldo),
            status: novoStatus,
            atualizadoEm: new Date(),
          })
          .where(eq(ciapAtivoPermanente.id, bem.id));

        // R1.1/R1.4/R1.5: grava a apropriação versionada (versão 1 ativa). O
        // unique parcial (bem, competência, ativa) rejeita uma segunda parcela
        // ativa — retries/concorrência não conseguem inserir em duplicidade.
        await tx.insert(ciapApropriacoes).values({
          clienteId: input.clienteId,
          bemId: bem.id,
          competencia,
          versao: 1,
          ativa: true,
          numeroParcela,
          baseControle: fromScaledInteger(baseScaled),
          parcelaPassivel: fromScaledInteger(parcelaPassivel),
          coeficiente,
          coeficienteFonte,
          parcelaAdmitida: fromScaledInteger(parcelaAdmitida),
          parcelaVedada: fromScaledInteger(parcelaVedada),
        });

        // Transição aditiva (design §Modelo de dados): mantém o marcador da
        // Fase 0 em sincronia enquanto `ciap_competencias_apropriadas` não é
        // removida. O unique (clienteId, competencia, bemId) impede duplicata.
        await tx.insert(ciapCompetenciasApropriadas).values({
          clienteId: input.clienteId,
          bemId: bem.id,
          competencia,
        });

        totalCredito += credito;
        bensApropriados += 1;
      }

      // R1.5/R2.6: REGRAVAÇÃO DO E111 A PARTIR DA RAZÃO (não incremental).
      //
      // O ajuste E111 de crédito do CIAP não é mutado incrementalmente a partir
      // do delta desta execução; ele é RECALCULADO como a soma das parcelas
      // ADMITIDAS de TODAS as apropriações ATIVAS da competência em
      // `ciap_apropriacoes` (a razão). Isso torna o ajuste determinístico e
      // idempotente: reprocessar a competência (R1.5) sempre reproduz o mesmo
      // valor, pois ele deriva do estado da razão — não de quantos bens foram
      // apropriados neste run nem de um valor acumulado em passagens anteriores.
      //
      // Consequência: o valor do E111 de uma competência é SEMPRE igual à soma
      // das apropriações ativas naquela competência. Uma correção retroativa
      // que desative/substitua uma versão (R1.6) é refletida automaticamente na
      // regravação (vide corrigirApropriacao), sem estorno manual do ajuste.
      const { creditoRazao, codigoAjuste } = await this.regravarAjusteE111(
        tx,
        input.clienteId,
        competencia,
        uf,
      );

      return {
        competencia,
        coeficiente_saidas_tributadas: coeficiente,
        bens_apropriados: bensApropriados,
        total_credito_apropriado: fromScaledInteger(totalCredito),
        // Valor do E111 regravado a partir da razão (soma das apropriações
        // ativas da competência). Pode diferir do crédito deste run quando a
        // competência já tinha apropriações de execuções anteriores.
        total_credito_razao: fromScaledInteger(creditoRazao),
        ajuste_e111_gerado: creditoRazao > 0n ? codigoAjuste : null,
      };
    });
  }

  /**
   * REGRAVAÇÃO DO E111 DE CRÉDITO DO CIAP A PARTIR DA RAZÃO (R1.5/R2.6).
   *
   * Fonte única da verdade: o ajuste E111 da competência é SEMPRE recalculado
   * como a soma das parcelas ADMITIDAS de TODAS as apropriações ATIVAS da
   * competência em `ciap_apropriacoes` — nunca mutado incrementalmente. Como só
   * UMA versão por (bem, competência) fica ativa, uma correção retroativa que
   * desative a versão antiga e ative a nova (R1.6) é refletida AUTOMATICAMENTE
   * aqui: a soma passa a considerar a parcela admitida corrigida, sem estorno
   * manual do ajuste.
   *
   * O delete sempre roda antes do insert, de modo que se a razão zerar (todas
   * as versões desativadas) o ajuste fantasma não fique para trás. Só reinsere
   * quando há crédito a lançar.
   *
   * CÓDIGO ESTADUAL VALIDADO POR CATÁLOGO + VIGÊNCIA (R2.6, tarefa 3.4): o
   * código do ajuste NÃO é mais fabricado em código (`${uf}02CIAP`). Ele é
   * RESOLVIDO de `fiscal_catalogos_versoes` por {@link resolverCodigoAjusteE111},
   * que exige uma linha de catálogo da UF do cliente VIGENTE na competência.
   * Quando não existe código catalogado válido para a UF/competência, a
   * regravação é BLOQUEADA com uma inconsistência clara — nunca emite um código
   * fabricado só para passar no check (postura bloqueante da fase). O código
   * catalogado respeita o leiaute do E111 (natureza 2 = crédito → indicador
   * CREDITO), coerente com `chk_sped_ajuste_coerencia`.
   *
   * Compartilhado por `apropriarCompetencia` (tarefa 2.2) e
   * `corrigirApropriacao` (tarefa 2.3) para que ambos derivem o E111 do MESMO
   * estado da razão.
   */
  private async regravarAjusteE111(
    tx: CiapTx,
    clienteId: string,
    competencia: string,
    uf: string,
  ): Promise<{ creditoRazao: bigint; codigoAjuste: string }> {
    // R2.6: resolve o código ESTADUAL OFICIAL do catálogo, validando que ele
    // existe para a UF e está VIGENTE na competência. Lança inconsistência
    // clara (BadRequest) quando não há código válido — nunca fabrica um código.
    const codigoAjuste = await this.resolverCodigoAjusteE111(
      tx,
      uf,
      competencia,
    );

    // Soma, DA RAZÃO, as parcelas admitidas ativas da competência.
    const razao = await tx
      .select({
        total: sql<string>`COALESCE(SUM(${ciapApropriacoes.parcelaAdmitida}), 0)`,
      })
      .from(ciapApropriacoes)
      .where(
        and(
          eq(ciapApropriacoes.clienteId, clienteId),
          eq(ciapApropriacoes.competencia, competencia),
          eq(ciapApropriacoes.ativa, true),
        ),
      );
    const creditoRazao = toScaledInteger(razao[0]?.total ?? '0');

    await tx
      .delete(spedAjustesApuracao)
      .where(
        and(
          eq(spedAjustesApuracao.clienteId, clienteId),
          eq(spedAjustesApuracao.competencia, competencia),
          eq(spedAjustesApuracao.registro, 'E111'),
          eq(spedAjustesApuracao.codigoAjuste, codigoAjuste),
        ),
      );

    if (creditoRazao > 0n) {
      await tx.insert(spedAjustesApuracao).values({
        clienteId,
        competencia,
        registro: 'E111',
        codigoAjuste,
        descricao:
          'Crédito de ICMS do ativo permanente (CIAP - 1/48) apropriado no período.',
        valor: fromScaledInteger(creditoRazao),
        indicador: 'CREDITO',
        uf: null,
        numeroDocumento: null,
      });
    }

    return { creditoRazao, codigoAjuste };
  }

  /**
   * RESOLVE O CÓDIGO ESTADUAL DE AJUSTE E111 DO CIAP A PARTIR DO CATÁLOGO,
   * VALIDANDO CÓDIGO + VIGÊNCIA (Fase 2, tarefa 3.4 / R2.6).
   *
   * R2.6 exige que o ajuste de crédito use um "código estadual oficial validado
   * (código e vigência), não um valor fabricado só para passar no check". Em vez
   * do antigo `${uf}02CIAP` montado em código, o código vem de
   * `fiscal_catalogos_versoes` (`tipo = 'E111_CIAP'`), exigindo DUAS validações:
   *
   *  1. CÓDIGO EXISTE PARA A UF: há uma linha ATIVA do catálogo para a UF da
   *     empresa (`uf = <uf do cliente>`).
   *  2. VIGÊNCIA COBRE A COMPETÊNCIA: a competência cai dentro da janela de
   *     vigência da linha — `vigenciaInicio <= competencia` E
   *     (`vigenciaFim IS NULL` OU `vigenciaFim >= competencia`). A comparação é
   *     feita contra o primeiro dia da competência ('YYYY-MM-01'), o mesmo valor
   *     persistido nas colunas `date` do SPED.
   *
   * Quando NENHUMA linha satisfaz as duas condições, a geração do ajuste é
   * BLOQUEADA com um erro/inconsistência CLARO (BadRequest) — jamais se emite um
   * código fabricado. Isso é coerente com a postura bloqueante da fase: uma
   * pré-condição fiscal ainda não cadastrada (o código estadual oficial da UF
   * para a competência) produz diagnóstico, não arquivo/ajuste inválido.
   *
   * Entre vigências sobrepostas (não deveria ocorrer, dado o unique por
   * tipo/uf/início), escolhe-se a de início MAIS RECENTE que ainda cobre a
   * competência (a vigência "mais nova" aplicável), de forma determinística.
   */
  private async resolverCodigoAjusteE111(
    tx: CiapTx,
    uf: string,
    competencia: string,
  ): Promise<string> {
    const rows = await tx
      .select({
        codigo: fiscalCatalogosVersoes.codigo,
        fonte: fiscalCatalogosVersoes.fonte,
      })
      .from(fiscalCatalogosVersoes)
      .where(
        and(
          eq(fiscalCatalogosVersoes.tipo, CATALOGO_TIPO_E111_CIAP),
          eq(fiscalCatalogosVersoes.uf, uf),
          eq(fiscalCatalogosVersoes.ativo, true),
          // Vigência inicia até a competência (inclusive).
          lte(fiscalCatalogosVersoes.vigenciaInicio, competencia),
          // Vigência em aberto OU encerra na competência ou depois.
          or(
            isNull(fiscalCatalogosVersoes.vigenciaFim),
            gte(fiscalCatalogosVersoes.vigenciaFim, competencia),
          ),
        ),
      )
      .orderBy(desc(fiscalCatalogosVersoes.vigenciaInicio))
      .limit(1);

    const codigo = rows[0]?.codigo;
    if (!codigo) {
      // R2.6: inconsistência clara — sem código catalogado válido não se emite
      // o ajuste. A mensagem orienta o cadastro da pré-condição fiscal.
      throw new BadRequestException(
        `Não há código estadual de ajuste E111 do CIAP catalogado e vigente para a UF ${uf} na competência ${competencia}. ` +
        'Cadastre o código oficial em fiscal_catalogos_versoes (tipo E111_CIAP) antes de gerar o ajuste.',
      );
    }
    return codigo;
  }

  /**
   * CORREÇÃO RETROATIVA DE UMA APROPRIAÇÃO CIAP (Fase 2, tarefa 2.3 / R1.6, R1.7).
   *
   * Corrige a parcela admitida de um bem numa competência JÁ apropriada, sem
   * sobrescrever silenciosamente a entrega anterior. A operação é AUDITÁVEL e
   * reversível pela razão:
   *
   *  1. VERSIONAMENTO, NÃO SOBRESCRITA (R1.6): a versão ATIVA corrente de
   *     (bem, competência) é DESATIVADA (`ativa = false`) — nunca apagada nem
   *     alterada no lugar — e uma NOVA versão (`versao = anterior + 1`,
   *     `ativa = true`) é inserida com os valores corrigidos. O unique parcial
   *     `uidx_ciap_aprop_bem_competencia_ativa` garante que só uma versão fica
   *     ativa; o histórico completo de versões permanece legível.
   *
   *  2. FATO PATRIMONIAL DE CORREÇÃO (R1.6/R1.7): registra em `ciap_movimentos`
   *     um movimento `tipo = 'correcao'` cujo `movimentoAnteriorId` aponta para
   *     o fato substituído (quando houver) e cujo `valorIcmsPassivel` é o DELTA
   *     da parcela admitida (admitida_nova − admitida_anterior) — o estorno/
   *     complemento do crédito. É o cancelamento residual separado do saldo
   *     passível de controle (R1.7).
   *
   *  3. E111 REFLETE A NOVA VERSÃO AUTOMATICAMENTE (R1.6): a regravação do E111
   *     (tarefa 2.2) soma as parcelas admitidas ATIVAS da competência. Como a
   *     versão antiga foi desativada e a nova ativada na MESMA transação, a
   *     próxima regravação — executada aqui ao final — já reflete o valor
   *     corrigido, sem nenhum estorno manual do ajuste.
   *
   * Serializada pelo mesmo `pg_advisory_xact_lock` por cliente/competência que
   * a apropriação, para não competir com apropriações concorrentes (R1.2).
   */
  async corrigirApropriacao(input: {
    clienteId: string;
    bemId: string;
    competencia: string;
    coeficiente: string;
    coeficienteFonte: string;
    motivo?: string;
    dataCorrecao?: string;
  }) {
    const { competencia } = this.competenciaRange(input.competencia);
    const coefCorrigido = this.parseCoeficiente(input.coeficiente);
    const coefScaled = toScaledInteger(coefCorrigido, COEFICIENTE_SCALE);
    const uf = await this.getUfCliente(input.clienteId);

    return this.database.db.transaction(async (tx) => {
      // R1.2: serializa com apropriações/correções concorrentes do mesmo
      // cliente/competência (mesma chave de lock da apropriação).
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`ciap-apropriacao:${input.clienteId}:${competencia}`}, 0))`,
      );

      // Versão ATIVA corrente de (bem, competência). Correção pressupõe uma
      // apropriação existente — sem ela não há o que corrigir.
      const ativas = await tx
        .select()
        .from(ciapApropriacoes)
        .where(
          and(
            eq(ciapApropriacoes.clienteId, input.clienteId),
            eq(ciapApropriacoes.bemId, input.bemId),
            eq(ciapApropriacoes.competencia, competencia),
            eq(ciapApropriacoes.ativa, true),
          ),
        );
      const atual = ativas[0];
      if (!atual) {
        throw new NotFoundException(
          'Não há apropriação ativa para corrigir nesta competência.',
        );
      }

      // Recalcula a decomposição (passível → admitida/vedada) com o coeficiente
      // corrigido, preservando a base e a parcela passível originais (a
      // correção é do rateio/cenário, não da base de controle).
      const parcelaPassivelScaled = toScaledInteger(atual.parcelaPassivel);
      const parcelaAdmitidaScaled =
        (parcelaPassivelScaled * coefScaled) / 10n ** BigInt(COEFICIENTE_SCALE);
      const parcelaVedadaScaled = parcelaPassivelScaled - parcelaAdmitidaScaled;
      const admitidaAnteriorScaled = toScaledInteger(atual.parcelaAdmitida);
      // Delta do crédito admitido = estorno/complemento desta correção (R1.7).
      const deltaAdmitidaScaled =
        parcelaAdmitidaScaled - admitidaAnteriorScaled;

      // R1.6: registra o FATO de correção em `ciap_movimentos`, apontando para
      // o movimento substituído (quando a apropriação corrigida tinha lastro em
      // um movimento). `tipo = 'correcao'` e `movimentoAnteriorId` satisfazem o
      // check `chk_ciap_mov_correcao`.
      const dataCorrecao =
        input.dataCorrecao ?? new Date().toISOString().slice(0, 10);
      const movimentoRows = await tx
        .insert(ciapMovimentos)
        .values({
          clienteId: input.clienteId,
          bemId: input.bemId,
          tipo: 'correcao',
          dataMovimento: dataCorrecao,
          valorIcmsPassivel: fromScaledInteger(deltaAdmitidaScaled),
          movimentoAnteriorId: atual.movimentoId ?? null,
          observacao:
            input.motivo ??
            `Correção retroativa da apropriação CIAP ${competencia} (v${atual.versao} → v${atual.versao + 1}).`,
        })
        .returning({ id: ciapMovimentos.id });
      const movimentoCorrecaoId = movimentoRows[0]?.id ?? null;

      // R1.6: DESATIVA a versão corrente (não sobrescreve). O histórico da
      // versão anterior permanece intacto na razão.
      await tx
        .update(ciapApropriacoes)
        .set({ ativa: false, atualizadoEm: new Date() })
        .where(eq(ciapApropriacoes.id, atual.id));

      // R1.6: INSERE a nova versão ativa com os valores corrigidos. O unique
      // parcial (bem, competência, ativa) agora admite esta linha porque a
      // anterior foi desativada acima.
      const novaVersao = atual.versao + 1;
      await tx.insert(ciapApropriacoes).values({
        clienteId: input.clienteId,
        bemId: input.bemId,
        competencia,
        versao: novaVersao,
        ativa: true,
        numeroParcela: atual.numeroParcela,
        baseControle: atual.baseControle,
        parcelaPassivel: atual.parcelaPassivel,
        coeficiente: coefCorrigido,
        coeficienteFonte: input.coeficienteFonte,
        parcelaAdmitida: fromScaledInteger(parcelaAdmitidaScaled),
        parcelaVedada: fromScaledInteger(parcelaVedadaScaled),
        movimentoId: movimentoCorrecaoId,
      });

      // R1.6: regrava o E111 a partir da razão — já reflete a NOVA versão ativa
      // (a antiga foi desativada nesta transação), sem estorno manual.
      const { creditoRazao, codigoAjuste } = await this.regravarAjusteE111(
        tx,
        input.clienteId,
        competencia,
        uf,
      );

      return {
        competencia,
        bem_id: input.bemId,
        versao_anterior: atual.versao,
        versao_nova: novaVersao,
        movimento_correcao_id: movimentoCorrecaoId,
        movimento_anterior_id: atual.movimentoId ?? null,
        coeficiente_anterior: atual.coeficiente,
        coeficiente_corrigido: coefCorrigido,
        parcela_admitida_anterior: fromScaledInteger(admitidaAnteriorScaled),
        parcela_admitida_corrigida: fromScaledInteger(parcelaAdmitidaScaled),
        // Estorno/complemento do crédito desta correção (pode ser negativo).
        delta_credito: fromScaledInteger(deltaAdmitidaScaled),
        total_credito_razao: fromScaledInteger(creditoRazao),
        ajuste_e111_gerado: creditoRazao > 0n ? codigoAjuste : null,
      };
    });
  }

  /**
   * Normaliza/valida um coeficiente informado (0..1, 4 casas). Reaproveita o
   * mesmo intervalo do check `chk_ciap_aprop_coeficiente` para rejeitar valores
   * fora de [0, 1] antes de chegar ao banco.
   */
  private parseCoeficiente(valor: string): string {
    let escalado: bigint;
    try {
      escalado = toScaledInteger(valor, COEFICIENTE_SCALE);
    } catch {
      throw new BadRequestException(`Coeficiente inválido: "${valor}".`);
    }
    const umScaled = 10n ** BigInt(COEFICIENTE_SCALE);
    if (escalado < 0n || escalado > umScaled) {
      throw new BadRequestException(
        'O coeficiente deve estar entre 0 e 1 (ex.: "0.6000").',
      );
    }
    return fromScaledInteger(escalado, COEFICIENTE_SCALE);
  }

  private async getUfCliente(clienteId: string): Promise<string> {
    const rows = await this.database.db
      .select({ uf: clientes.uf })
      .from(clientes)
      .where(eq(clientes.id, clienteId))
      .limit(1);
    const uf = (rows[0]?.uf ?? '').toUpperCase();
    if (!/^[A-Z]{2}$/.test(uf)) {
      throw new BadRequestException(
        'A UF da empresa é obrigatória para gerar o ajuste E111 do CIAP.',
      );
    }
    return uf;
  }

  /**
   * Baixa um bem do CIAP (venda, transferência ou outra baixa). O saldo credor
   * remanescente deixa de ser apropriado A PARTIR DA DATA DO FATO.
   *
   * Fase 2 / tarefa 2.4 (R1.3, R1.7). A baixa respeita a DATA DO FATO, não a
   * data de processamento:
   *
   *  1. REGISTRA O FATO EM `ciap_movimentos` (R1.7): grava um movimento
   *     `tipo = 'baixa'` com `dataMovimento = dataBaixa` (a data do fato) e o
   *     `motivoBaixa` (01/02/03). O `valorIcmsPassivel` é o SALDO CREDOR
   *     RESIDUAL cancelado pela baixa — o "cancelamento residual" que a razão
   *     separa do saldo passível de controle (R1.7), registrado como negativo.
   *     O fato fica auditável no histórico patrimonial, com data e motivo.
   *
   *  2. ELEGIBILIDADE PASSA A SER POR DATA (R1.3): `apropriarCompetencia` usa
   *     `dataBaixa` (não o status) para decidir se o bem participa de uma
   *     competência. Após esta baixa com `dataBaixa`, o bem deixa de ser
   *     elegível em competências cujo fim é >= `dataBaixa`, mas CONTINUA
   *     elegível em competências anteriores (reprocesso retroativo). A baixa
   *     não apaga a história de crédito já apropriada antes do fato.
   *
   * Tudo numa transação: o update do bem e o registro do movimento são
   * atômicos — não há baixa sem fato de baixa, nem fato órfão.
   */
  async baixarBem(input: {
    clienteId: string;
    bemId: string;
    dataBaixa: string;
    motivoBaixa: '01' | '02' | '03';
  }) {
    return this.database.db.transaction(async (tx) => {
      const rows = await tx
        .update(ciapAtivoPermanente)
        .set({
          status: 'BAIXADO',
          dataBaixa: input.dataBaixa,
          motivoBaixa: input.motivoBaixa,
          atualizadoEm: new Date(),
        })
        .where(
          and(
            eq(ciapAtivoPermanente.id, input.bemId),
            eq(ciapAtivoPermanente.clienteId, input.clienteId),
          ),
        )
        .returning();
      const bem = rows[0];
      if (!bem) throw new NotFoundException('Bem do CIAP não encontrado.');

      // R1.7: o fato de baixa é o cancelamento residual do saldo passível de
      // controle. Registra-se como `valorIcmsPassivel` NEGATIVO (saída de saldo
      // da razão) na data do fato, com o motivo. Zero quando não há saldo
      // residual (bem já apropriado por completo).
      const saldoResidualScaled = toScaledInteger(bem.saldoCredorRestante);
      const cancelamentoResidual =
        saldoResidualScaled > 0n ? -saldoResidualScaled : 0n;
      await tx.insert(ciapMovimentos).values({
        clienteId: input.clienteId,
        bemId: input.bemId,
        tipo: 'baixa',
        dataMovimento: input.dataBaixa,
        valorIcmsPassivel: fromScaledInteger(cancelamentoResidual),
        motivoBaixa: input.motivoBaixa,
        observacao: `Baixa do bem CIAP em ${input.dataBaixa} (motivo ${input.motivoBaixa}).`,
      });

      return this.toBemResponse(bem);
    });
  }

  async listarBens(input: {
    clienteId: string;
    status?: 'ATIVO' | 'BAIXADO' | 'CONCLUIDO';
  }) {
    const conditions: SQL[] = [
      eq(ciapAtivoPermanente.clienteId, input.clienteId),
    ];
    if (input.status) {
      conditions.push(eq(ciapAtivoPermanente.status, input.status));
    }
    const rows = await this.database.db
      .select()
      .from(ciapAtivoPermanente)
      .where(and(...conditions))
      .orderBy(asc(ciapAtivoPermanente.dataEntrada));
    return { data: rows.map((row) => this.toBemResponse(row)) };
  }

  /**
   * Diagnóstico READ-ONLY das fichas CIAP existentes (Fase 2, tarefa 1.1).
   *
   * Precede a migração aditiva da identidade patrimonial (plano §7): antes de
   * aplicar unique/checks/FKs compostas, é preciso saber o que a identidade
   * atual `(clienteId, codigoBem)` encobre. Este método NÃO altera dado algum;
   * apenas lê `ciap_ativo_permanente` e cruza com os itens escriturados para
   * produzir um relatório de risco.
   *
   * R2.1 — Identidade por SKU encobre aquisições distintas: hoje o `codigoBem`
   * é derivado do `codigoProduto`, então duas compras do mesmo SKU colidem no
   * unique `(clienteId, codigoBem)` e são tratadas como UM bem. O diagnóstico
   * sinaliza cada SKU com mais de uma aquisição escriturada (documento/item),
   * que a nova identidade por aquisição deverá separar.
   *
   * R2.5 — Reemissão após baixa não deve mudar o resultado: fichas BAIXADO/
   * CONCLUIDO cujo `codigoBem` poderia ser reimportado colidiriam no unique e
   * seriam sobrescritas pelo `onConflictDoUpdate` do import, "ressuscitando" um
   * bem baixado. O diagnóstico lista essas fichas como risco de colisão.
   *
   * Nenhuma ficha é corrigida aqui; a classificação de "reconstruída/não
   * comprovada" e o saneamento assistido ocorrem na migração/backfill (1.4).
   */
  async diagnosticarFichas(input: { clienteId: string }) {
    await this.assertCliente(input.clienteId);

    const fichas = await this.database.db
      .select()
      .from(ciapAtivoPermanente)
      .where(eq(ciapAtivoPermanente.clienteId, input.clienteId))
      .orderBy(asc(ciapAtivoPermanente.dataEntrada));

    // Aquisições escrituradas de ativo (CFOP 1551/2551/3551) agrupadas por
    // código de produto (SKU). Se um SKU aparece em mais de um documento/item,
    // a identidade atual por SKU não distingue as aquisições (R2.1).
    const itensAtivo = await this.database.db
      .select({
        documentoFiscalId: documentosFiscaisItens.documentoFiscalId,
        documentoFiscalItemId: documentosFiscaisItens.id,
        codigoProduto: documentosFiscaisItens.codigoProduto,
        cfop: documentosFiscaisItens.cfop,
      })
      .from(documentosFiscaisItens)
      .innerJoin(
        documentosFiscais,
        eq(documentosFiscais.id, documentosFiscaisItens.documentoFiscalId),
      )
      .where(
        and(
          eq(documentosFiscaisItens.clienteId, input.clienteId),
          eq(documentosFiscaisItens.tipoOperacaoEscriturada, 'ENTRADA'),
          eq(documentosFiscais.situacao, 'AUTORIZADA'),
          eq(documentosFiscais.escriturado, true),
        ),
      );

    // Nº de aquisições (itens de documento distintos) escrituradas por SKU.
    // O `codigoBem` importado é o `codigoProduto` truncado em 60 chars; usamos
    // a mesma transformação para casar com a ficha.
    const aquisicoesPorSku = new Map<string, Set<string>>();
    for (const item of itensAtivo) {
      if (!CFOPS_ATIVO_ENTRADA.has(item.cfop)) continue;
      const codigoBem = item.codigoProduto.slice(0, 60);
      const set = aquisicoesPorSku.get(codigoBem) ?? new Set<string>();
      set.add(item.documentoFiscalItemId);
      aquisicoesPorSku.set(codigoBem, set);
    }

    // R2.1: fichas cujo SKU corresponde a mais de uma aquisição escriturada.
    const skuMultiplasAquisicoes: Array<{
      id: string;
      codigo_bem: string;
      identificacao_bem: string;
      aquisicoes_escrituradas: number;
      parcelas_apropriadas: number;
    }> = [];

    // R2.5: fichas já baixadas/concluídas que colidiriam no unique
    // `(clienteId, codigoBem)` se o SKU fosse reimportado (reemissão).
    const riscoReemissaoAposBaixa: Array<{
      id: string;
      codigo_bem: string;
      identificacao_bem: string;
      status: string;
      data_baixa: string | null;
      motivo_baixa: string | null;
    }> = [];

    for (const ficha of fichas) {
      const aquisicoes = aquisicoesPorSku.get(ficha.codigoBem)?.size ?? 0;
      if (aquisicoes > 1) {
        skuMultiplasAquisicoes.push({
          id: ficha.id,
          codigo_bem: ficha.codigoBem,
          identificacao_bem: ficha.identificacaoBem,
          aquisicoes_escrituradas: aquisicoes,
          parcelas_apropriadas: ficha.parcelasApropriadas,
        });
      }
      if (ficha.status === 'BAIXADO' || ficha.status === 'CONCLUIDO') {
        riscoReemissaoAposBaixa.push({
          id: ficha.id,
          codigo_bem: ficha.codigoBem,
          identificacao_bem: ficha.identificacaoBem,
          status: ficha.status,
          data_baixa: ficha.dataBaixa,
          motivo_baixa: ficha.motivoBaixa,
        });
      }
    }

    return {
      cliente_id: input.clienteId,
      total_fichas: fichas.length,
      // R2.1
      skus_com_multiplas_aquisicoes: skuMultiplasAquisicoes.length,
      fichas_sku_multiplas_aquisicoes: skuMultiplasAquisicoes,
      // R2.5
      fichas_baixadas_ou_concluidas: riscoReemissaoAposBaixa.length,
      fichas_risco_reemissao_apos_baixa: riscoReemissaoAposBaixa,
      // Resumo por status (visão geral da base).
      por_status: this.contarPorStatus(fichas),
    };
  }

  /**
   * Migração/backfill ASSISTIDO da identidade patrimonial por aquisição
   * (Fase 2, tarefa 1.4 / R2.1, R2.2).
   *
   * Hoje a identidade do bem é o `codigoBem` derivado do SKU (`codigoProduto`),
   * e o unique `(clienteId, codigoBem)` funde duas compras do mesmo SKU num
   * único bem. Esta rotina reconstrói a identidade POR AQUISIÇÃO preenchendo as
   * colunas aditivas `chaveAquisicao`/`origemIdentidade`/`saneamentoPendente`,
   * SEM destruir dado algum: `codigoBem`, valores de ICMS, parcelas e status
   * permanecem intactos. É idempotente — só toca fichas cuja `chaveAquisicao`
   * ainda é nula (não migradas).
   *
   * A rotina é INFORMADA pelo diagnóstico read-only (tarefa 1.1,
   * {@link diagnosticarFichas}): os SKUs com mais de uma aquisição escriturada
   * apontados pelo diagnóstico são justamente os que ficam marcados para
   * saneamento assistido.
   *
   * Classificação de cada ficha (espelha o backfill da migração 0014):
   *  - COMPROVADA (`origemIdentidade = 'aquisicao'`): a ficha tem lastro em um
   *    item escriturado (`documentoFiscalId` + `documentoFiscalItemId`); a chave
   *    é `${documentoFiscalId}:${documentoFiscalItemId}`. Duas aquisições do
   *    mesmo SKU, por virem de itens distintos, recebem chaves distintas e
   *    passam a ser DUAS identidades patrimoniais (R2.1).
   *  - NÃO COMPROVADA (`origemIdentidade = 'reconstruido_nao_comprovado'`):
   *    ficha legada sem item escriturado; a chave é o próprio UUID da ficha. O
   *    backfill NÃO inventa documento nem competência (design: "backfill não
   *    pode inventar histórico").
   *  - SANEAMENTO PENDENTE (`saneamentoPendente = true`): fichas cujo SKU
   *    corresponde a mais de uma aquisição escriturada — a divisão em bens
   *    distintos exige decisão humana (rollout, Fase 5/13).
   */
  async migrarIdentidadePorAquisicao(input: { clienteId: string }) {
    await this.assertCliente(input.clienteId);

    // Reaproveita o diagnóstico read-only (tarefa 1.1) para saber quais
    // `codigoBem` (SKU) encobrem mais de uma aquisição escriturada: essas
    // fichas ficam marcadas para saneamento assistido.
    const diagnostico = await this.diagnosticarFichas({
      clienteId: input.clienteId,
    });
    const codigosParaSaneamento = new Set(
      diagnostico.fichas_sku_multiplas_aquisicoes.map((f) => f.codigo_bem),
    );

    // Apenas fichas AINDA NÃO migradas (chave nula). Idempotência: reexecutar
    // não altera fichas já identificadas.
    const pendentes = await this.database.db
      .select()
      .from(ciapAtivoPermanente)
      .where(
        and(
          eq(ciapAtivoPermanente.clienteId, input.clienteId),
          isNull(ciapAtivoPermanente.chaveAquisicao),
        ),
      )
      .orderBy(asc(ciapAtivoPermanente.dataEntrada));

    let comprovadas = 0;
    let naoComprovadas = 0;
    let marcadasSaneamento = 0;

    for (const ficha of pendentes) {
      const temLastro =
        ficha.documentoFiscalId != null && ficha.documentoFiscalItemId != null;
      const chaveAquisicao = temLastro
        ? `${ficha.documentoFiscalId}:${ficha.documentoFiscalItemId}`
        : ficha.id;
      const origemIdentidade = temLastro
        ? 'aquisicao'
        : 'reconstruido_nao_comprovado';
      const saneamentoPendente = codigosParaSaneamento.has(ficha.codigoBem);

      await this.database.db
        .update(ciapAtivoPermanente)
        .set({
          chaveAquisicao,
          origemIdentidade,
          saneamentoPendente,
          atualizadoEm: new Date(),
        })
        .where(eq(ciapAtivoPermanente.id, ficha.id));

      if (temLastro) comprovadas += 1;
      else naoComprovadas += 1;
      if (saneamentoPendente) marcadasSaneamento += 1;
    }

    return {
      cliente_id: input.clienteId,
      fichas_migradas: pendentes.length,
      identidades_comprovadas: comprovadas,
      identidades_reconstruidas_nao_comprovadas: naoComprovadas,
      fichas_marcadas_saneamento: marcadasSaneamento,
    };
  }

  private contarPorStatus(
    fichas: Array<typeof ciapAtivoPermanente.$inferSelect>,
  ): Record<string, number> {
    const contagem: Record<string, number> = {};
    for (const ficha of fichas) {
      contagem[ficha.status] = (contagem[ficha.status] ?? 0) + 1;
    }
    return contagem;
  }

  /**
   * COEFICIENTE DE PARTICIPAÇÃO DO CIAP, FUNDAMENTADO POR CENÁRIO (Fase 2,
   * tarefa 3.1 / R2.3).
   *
   * Função ÚNICA que apura o índice de participação de saídas tributadas sobre
   * o total de saídas de um período — o fator que reduz a parcela 1/48 à parte
   * admitida do crédito. Substitui a antiga `coeficienteSaidasTributadas`, cuja
   * regra ad hoc (`valorIcms > 0`) classificava mal os cenários legais em que
   * NÃO há débito de ICMS mas o crédito do ativo é mantido.
   *
   * COMPOSIÇÃO (R2.3), documentada e devolvida decomposta para auditoria/teste:
   *
   *   numerador   = saídas tributadas + exportações + saídas equiparadas
   *   denominador = total de saídas no período
   *   coeficiente = numerador / denominador   (4 casas, 0.0000–1.0000)
   *
   *  - SAÍDAS TRIBUTADAS: itens de saída com ICMS destacado (`valorIcms > 0`).
   *  - EXPORTAÇÕES (R2.3): saídas com CFOP de exterior (1º dígito 7). A
   *    exportação é imune ao ICMS (não há débito, `valorIcms = 0`) mas a LC
   *    87/1996 preserva o crédito do ativo — logo entra no numerador COMO
   *    tributada. Classificá-la por `valorIcms > 0` a excluiria indevidamente.
   *  - SAÍDAS EQUIPARADAS (R2.3): operações sem débito que, por lei, mantêm o
   *    crédito (equiparadas a tributadas), identificadas pelo CST de ICMS em
   *    {@link CSTS_SAIDA_EQUIPARADA}. O conjunto é um parâmetro explícito, não
   *    uma presunção — as exceções estaduais dependem de definição fiscal
   *    (pré-condição bloqueante da fase).
   *
   * As três categorias são MUTUAMENTE EXCLUSIVAS na soma do numerador (uma
   * exportação não é contada também como tributada), evitando dupla contagem:
   * cada item cai em no máximo um dos ramos (tributada → senão exportação →
   * senão equiparada).
   *
   * CASO "SEM SAÍDAS" (R2.4): aplica a regra EXPLÍCITA
   * {@link COEFICIENTE_SEM_SAIDAS} (= `0.0000`) — NÃO presume mais `1.0000`
   * silenciosamente. Num período sem saídas não há base para presumir crédito
   * admitido, logo o crédito deliberadamente não é apropriado. O resultado é
   * sinalizado com `fonte: 'sem_saidas'` e `sem_saidas: true` para que o
   * chamador distinga esse caso (política documentada, não um 0 acidental).
   *
   * NÃO persiste nada; apenas lê a escrituração do período. A unificação dos
   * três chamadores (preview/efetivação/builder) nesta função é a tarefa 3.3.
   */
  async calcularCoeficiente(
    cenario: CoeficienteCenario,
  ): Promise<CoeficienteResultado> {
    // Valor da operação do item = bruto do produto líquido de desconto.
    const valorOperacao = sql`COALESCE(${documentosFiscaisItens.valorBrutoProduto}, 0) - COALESCE(${documentosFiscaisItens.valorDesconto}, 0)`;
    // Predicados dos ramos do numerador (ordem = prioridade; exclusivos entre si).
    const ehTributada = sql`COALESCE(${documentosFiscaisItens.valorIcms}, 0) > 0`;
    const ehExportacao = sql`LEFT(${documentosFiscaisItens.cfop}, 1) = ${CFOP_EXPORTACAO_PREFIXO}`;
    const ehEquiparada = sql`${documentosFiscaisItens.cstIcms} IN (${sql.join(
      [...CSTS_SAIDA_EQUIPARADA].map((cst) => sql`${cst}`),
      sql`, `,
    )})`;

    const rows = await this.database.db
      .select({
        total_saidas: sql<string>`COALESCE(SUM(${valorOperacao}), 0)`,
        saidas_tributadas: sql<string>`COALESCE(SUM(CASE WHEN ${ehTributada} THEN ${valorOperacao} ELSE 0 END), 0)`,
        // Exportação só conta quando NÃO já tributada (exclusividade).
        exportacoes: sql<string>`COALESCE(SUM(CASE WHEN NOT (${ehTributada}) AND ${ehExportacao} THEN ${valorOperacao} ELSE 0 END), 0)`,
        // Equiparada só conta quando NÃO tributada E NÃO exportação.
        saidas_equiparadas: sql<string>`COALESCE(SUM(CASE WHEN NOT (${ehTributada}) AND NOT (${ehExportacao}) AND ${ehEquiparada} THEN ${valorOperacao} ELSE 0 END), 0)`,
      })
      .from(documentosFiscaisItens)
      .innerJoin(
        documentosFiscais,
        eq(documentosFiscais.id, documentosFiscaisItens.documentoFiscalId),
      )
      .where(
        and(
          eq(documentosFiscaisItens.clienteId, cenario.clienteId),
          eq(documentosFiscaisItens.tipoOperacaoEscriturada, 'SAIDA'),
          eq(documentosFiscais.situacao, 'AUTORIZADA'),
          eq(documentosFiscais.escriturado, true),
          gte(documentosFiscais.dataEmissao, cenario.inicio),
          lte(documentosFiscais.dataEmissao, cenario.fim),
        ),
      );

    const totalScaled = toScaledInteger(rows[0]?.total_saidas ?? '0');
    const tributadasScaled = toScaledInteger(rows[0]?.saidas_tributadas ?? '0');
    const exportacoesScaled = toScaledInteger(rows[0]?.exportacoes ?? '0');
    const equiparadasScaled = toScaledInteger(
      rows[0]?.saidas_equiparadas ?? '0',
    );
    const numeradorScaled =
      tributadasScaled + exportacoesScaled + equiparadasScaled;

    const componentes = {
      saidas_tributadas: fromScaledInteger(tributadasScaled),
      exportacoes: fromScaledInteger(exportacoesScaled),
      saidas_equiparadas: fromScaledInteger(equiparadasScaled),
      total_saidas: fromScaledInteger(totalScaled),
    };

    // CASO "SEM SAÍDAS" (R2.4): regra EXPLÍCITA — coeficiente
    // COEFICIENTE_SEM_SAIDAS (0.0000), nunca 1.0000 silencioso. Vide a
    // justificativa documentada em COEFICIENTE_SEM_SAIDAS.
    if (totalScaled === 0n) {
      return {
        coeficiente: COEFICIENTE_SEM_SAIDAS,
        fonte: 'sem_saidas',
        numerador: fromScaledInteger(numeradorScaled),
        denominador: fromScaledInteger(totalScaled),
        componentes,
        sem_saidas: true,
      };
    }

    // Coeficiente = numerador / denominador, escalado em 4 casas (truncado, em
    // inteiros — sem `Number`, respeitando a restrição de decimais da fase).
    const escala = 10n ** BigInt(COEFICIENTE_SCALE);
    const coefScaled = (numeradorScaled * escala) / totalScaled;

    return {
      coeficiente: fromScaledInteger(coefScaled, COEFICIENTE_SCALE),
      fonte: 'saidas_tributadas',
      numerador: fromScaledInteger(numeradorScaled),
      denominador: fromScaledInteger(totalScaled),
      componentes,
      sem_saidas: false,
    };
  }

  private competenciaRange(competencia: string) {
    try {
      return parseCompetenciaMensal(competencia);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Competência inválida.',
      );
    }
  }

  /**
   * R6.4: garante que um valor monetário é um decimal não negativo,
   * independentemente do ValidationPipe do HTTP. `toScaledInteger` também
   * rejeita strings não numéricas (TypeError), aqui convertidas em
   * BadRequestException com mensagem estável.
   */
  private assertValorNaoNegativo(valor: string, rotulo: string): void {
    let escalado: bigint;
    try {
      escalado = toScaledInteger(valor);
    } catch {
      throw new BadRequestException(`Valor de ${rotulo} inválido: "${valor}".`);
    }
    if (escalado < 0n) {
      throw new BadRequestException(
        `O valor de ${rotulo} não pode ser negativo.`,
      );
    }
  }

  async assertCliente(clienteId: string) {
    const rows = await this.database.db
      .select({ id: clientes.id })
      .from(clientes)
      .where(eq(clientes.id, clienteId))
      .limit(1);
    if (!rows[0]) throw new NotFoundException('Empresa não encontrada.');
  }

  /**
   * R6.2: verifica que o documento fiscal e/ou o item referenciados pertencem
   * ao cliente informado. Segue a convenção do código para acesso cruzado
   * (WHERE por clienteId + ausência de linha → NotFound): um objeto de outro
   * cliente é indistinguível de um objeto inexistente e resulta em rejeição.
   */
  private async assertDocumentoDoCliente(
    clienteId: string,
    documentoFiscalId?: string | null,
    documentoFiscalItemId?: string | null,
  ): Promise<void> {
    if (documentoFiscalId) {
      const rows = await this.database.db
        .select({ id: documentosFiscais.id })
        .from(documentosFiscais)
        .where(
          and(
            eq(documentosFiscais.id, documentoFiscalId),
            eq(documentosFiscais.clienteId, clienteId),
          ),
        )
        .limit(1);
      if (!rows[0]) {
        throw new NotFoundException('Documento fiscal não encontrado.');
      }
    }

    if (documentoFiscalItemId) {
      const rows = await this.database.db
        .select({
          id: documentosFiscaisItens.id,
          documentoFiscalId: documentosFiscaisItens.documentoFiscalId,
        })
        .from(documentosFiscaisItens)
        .where(
          and(
            eq(documentosFiscaisItens.id, documentoFiscalItemId),
            eq(documentosFiscaisItens.clienteId, clienteId),
          ),
        )
        .limit(1);
      const item = rows[0];
      if (!item) {
        throw new NotFoundException('Item do documento fiscal não encontrado.');
      }
      // Coerência: se ambos foram informados, o item deve pertencer ao mesmo
      // documento fiscal referenciado (evita cruzar item/documento do próprio
      // cliente de forma inconsistente).
      if (documentoFiscalId && item.documentoFiscalId !== documentoFiscalId) {
        throw new BadRequestException(
          'O item informado não pertence ao documento fiscal informado.',
        );
      }
    }
  }

  private toBemResponse(row: CiapRow['ciap']) {
    return {
      id: row.id,
      cliente_id: row.clienteId,
      documento_fiscal_id: row.documentoFiscalId,
      documento_fiscal_item_id: row.documentoFiscalItemId,
      codigo_bem: row.codigoBem,
      identificacao_bem: row.identificacaoBem,
      data_entrada: row.dataEntrada,
      valor_icms_total: row.valorIcmsTotal,
      valor_icms_frete: row.valorIcmsFrete,
      valor_icms_difal: row.valorIcmsDifal,
      quantidade_parcelas: row.quantidadeParcelas,
      parcelas_apropriadas: row.parcelasApropriadas,
      saldo_credor_restante: row.saldoCredorRestante,
      status: row.status,
      data_baixa: row.dataBaixa,
      motivo_baixa: row.motivoBaixa,
      criado_em: row.criadoEm.toISOString(),
      atualizado_em: row.atualizadoEm.toISOString(),
    };
  }
}
