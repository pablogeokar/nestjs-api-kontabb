import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service';
import {
  clientes,
  documentosFiscais,
  documentosFiscaisItens,
} from '../../database/schema';
import { fromScaledInteger, toScaledInteger } from '../sped/sped-decimal';
import { parseCompetenciaMensal } from '../fiscal-date.util';
import {
  classificarDifalHipotese,
  type DifalHipotese,
} from './difal-hipotese';
import {
  calcularDifalHipotese,
  type DifalRegra,
  type DifalResponsavel,
  type DifalCalculoStatus,
} from './difal-calculador';
import { comporBaseDifal, type DifalBaseRegra } from './difal-base';
import { FiscalNormativeCatalogService } from './fiscal-normative-catalog.service';

// CFOPs de ENTRADA interestadual de uso/consumo e ativo SEM ST. São os que
// geram, de fato, DIFAL de entrada do CONTRIBUINTE (a diferença de alíquota que
// o próprio adquirente recolhe). 2551 = ativo imobilizado; 2556 = uso/consumo.
const CFOPS_DIFAL_ENTRADA_CONTRIBUINTE = ['2556', '2551'] as const;

// RESPONSÁVEL pelo recolhimento por hipótese (tarefa 2.6 — R1.5). Eixo de
// responsabilidade exigido no resultado: entrada-contribuinte e antecipação são
// do próprio ADQUIRENTE; saída a não contribuinte é do REMETENTE (LC 190/2022,
// N10); sob ST o imposto é de responsabilidade de TERCEIRO (o substituto), e a
// não-duplicidade (tarefa 2.5) garante que o adquirente não recolha de novo.
const RESPONSAVEL_POR_HIPOTESE: Record<DifalHipotese, DifalResponsavel> = {
  DIFAL_ENTRADA_CONTRIBUINTE: 'ADQUIRENTE',
  ANTECIPACAO: 'ADQUIRENTE',
  DIFAL_SAIDA_NAO_CONTRIBUINTE: 'REMETENTE',
  ST: 'TERCEIRO',
};

// CFOPs de ENTRADA interestadual sob SUBSTITUIÇÃO TRIBUTÁRIA (substituído):
// 2406 = ativo adquirido de substituído; 2407 = uso/consumo de substituído.
//
// DECISÃO 2.5 (design §DIFAL: "não incluir CFOPs 2406/2407 sem analisar
// recolhimento anterior/responsabilidade"): eles PERMANECEM no conjunto de busca
// — porém NUNCA como candidatos a DIFAL próprio. Mantê-los visíveis é o que torna
// a NÃO-DUPLICIDADE AUDITÁVEL: cada 2406/2407 aparece no resultado explicitamente
// roteado para a hipótese `ST`, com `recolhimento_proprio: 'NAO'` e o motivo
// (ICMS retido pelo substituto). A alternativa — removê-los da busca — esconderia
// a operação do relatório e tornaria o escopo honesto INVISÍVEL; o adquirente não
// saberia que o item foi analisado e deliberadamente NÃO recolhido. Por isso
// buscamos, classificamos como ST e provamos a ausência de recolhimento próprio,
// em vez de simplesmente omitir. (R1.4.)
const CFOPS_DIFAL_ENTRADA_ST = ['2406', '2407'] as const;

// Conjunto de busca: candidatos a DIFAL próprio (2551/2556) MAIS os CFOPs de ST
// (2406/2407), estes últimos retidos apenas para a auditoria da não-duplicidade.
const CFOPS_DIFAL_ENTRADA = new Set<string>([
  ...CFOPS_DIFAL_ENTRADA_CONTRIBUINTE,
  ...CFOPS_DIFAL_ENTRADA_ST,
]);

// REFERÊNCIA LEGADA IDENTIFICADA (tarefa 2.2 — design §DIFAL "Tabela estática
// legada: manter apenas como referência identificada; nunca como fonte de
// verdade"). Esta tabela modal NÃO é mais a fonte do cálculo: a alíquota interna
// passa a vir do CATÁLOGO versionado (`FiscalNormativeCatalogService`), por
// hipótese/UF/vigência. Ela permanece SÓ como referência auditável para quando
// não há regra homologada — e, nesse caso, o resultado é PENDÊNCIA/SIMULAÇÃO
// (R1.2), nunca guia. Mantida para rastreabilidade da migração, não para cálculo.
const ALIQUOTA_INTERNA_REFERENCIA_LEGADA: Record<string, string> = {
  AC: '19',
  AL: '20',
  AM: '20',
  AP: '18',
  BA: '20.5',
  CE: '20',
  DF: '20',
  ES: '17',
  GO: '19',
  MA: '23',
  MG: '18',
  MS: '17',
  MT: '17',
  PA: '19',
  PB: '20',
  PE: '20.5',
  PI: '22.5',
  PR: '19.5',
  RJ: '22',
  RN: '20',
  RO: '19.5',
  RR: '20',
  RS: '17',
  SC: '17',
  SE: '19',
  SP: '18',
  TO: '20',
};

@Injectable()
export class DifalEntradaService {
  constructor(
    private readonly database: DatabaseService,
    private readonly catalogo: FiscalNormativeCatalogService,
  ) { }

  /**
   * Apura o DIFAL de entrada da competência consumindo o CATÁLOGO normativo
   * versionado (tarefa 2.2 — R1.1/R1.3). Para cada item interestadual de
   * uso/consumo ou ativo:
   *   1. classifica a hipótese (tarefa 2.1);
   *   2. resolve a REGRA de DIFAL da hipótese/UF/competência no catálogo
   *      (`FiscalNormativeCatalogService`), em vez da tabela modal fixa;
   *   3. calcula pela regra (`calcularDifalHipotese`), com memória auditável.
   *
   * Sem regra homologada → PENDÊNCIA/SIMULAÇÃO (R1.2), nunca guia. A tabela
   * legada permanece apenas como referência identificada no resultado, não como
   * fonte do valor.
   */
  async apurarCompetencia(input: { clienteId: string; competencia: string }) {
    const { competencia, competenciaMensal, inicio, fim } = this.competenciaRange(
      input.competencia,
    );
    const cliente = await this.getCliente(input.clienteId);
    const uf = (cliente.uf ?? '').trim().toUpperCase();
    const aliquotaInternaReferencia =
      ALIQUOTA_INTERNA_REFERENCIA_LEGADA[uf] ?? null;
    // REGIME do adquirente (tarefa 2.7 — R1.6). O Simples Nacional recolhe o
    // ICMS próprio no DAS, mas o DIFAL de ENTRADA (uso/consumo e ativo) é
    // obrigação estadual devida POR FORA do DAS (N09 — LC 123/2006). Ou seja,
    // o DIFAL de entrada NÃO é suprimido para o Simples; é calculado como para
    // qualquer contribuinte e sinalizado como recolhido fora do DAS, para que a
    // obrigação fique auditável e não se confunda com o imposto do DAS.
    const regimeAdquirente = (cliente.regimeTributario ?? '').trim() || null;
    const adquirenteSimples = regimeAdquirente === 'SIMPLES_NACIONAL';

    // Resolve a REGRA de DIFAL de entrada-contribuinte vigente para a UF do
    // adquirente na competência. Fonte do cálculo (R1.1/R1.3), não a tabela
    // fixa. `null` quando não há regra vigente → os itens caem em PENDÊNCIA.
    const regraVersao = uf
      ? await this.catalogo.resolverRegraVigente({
        tipo: 'DIFAL',
        uf,
        competencia: competenciaMensal,
        chave: 'DIFAL_ENTRADA_CONTRIBUINTE',
      })
      : null;
    const regra = this.regraDoConteudo(regraVersao?.conteudo);
    // Parâmetros de COMPOSIÇÃO DA BASE (tarefa 2.4) extraídos do mesmo `conteudo`
    // da regra: por dentro, redução, benefício, FCP. Decimais permanecem strings.
    const baseRegra = this.baseRegraDoConteudo(regraVersao?.conteudo);
    const regraAprovada = regraVersao?.escopoAprovado ?? false;

    const cfops = [...CFOPS_DIFAL_ENTRADA];
    const itens = await this.database.db
      .select({
        documentoFiscalId: documentosFiscaisItens.documentoFiscalId,
        itemId: documentosFiscaisItens.id,
        cfop: documentosFiscaisItens.cfop,
        // UF de ORIGEM (remetente): extraída do emitente do documento. É a UF de
        // onde a mercadoria saiu, exposta por item ao lado da UF de destino (do
        // adquirente) para que o resultado mostre a operação interestadual
        // completa (tarefa 2.6 — R1.5). Normalizada em maiúsculas; null quando
        // o emitente não traz a UF.
        emitenteUf: sql<string | null>`NULLIF(UPPER(BTRIM(${documentosFiscais.emitenteDados} ->> 'uf')), '')`,
        valorBcIcms: documentosFiscaisItens.valorBcIcms,
        valorBrutoProduto: documentosFiscaisItens.valorBrutoProduto,
        aliquotaIcms: documentosFiscaisItens.aliquotaIcms,
        // Parcelas e marcadores que a COMPOSIÇÃO DA BASE (tarefa 2.4) consome:
        // frete/seguro/outras/desconto (base bruta quando não há BC), origem
        // (importada → interestadual 4%), redução de BC, e sinais de retenção/ST.
        valorFrete: documentosFiscaisItens.valorFrete,
        valorSeguro: documentosFiscaisItens.valorSeguro,
        valorOutrasDespesas: documentosFiscaisItens.valorOutrasDespesas,
        valorDesconto: documentosFiscaisItens.valorDesconto,
        origemMercadoria: documentosFiscaisItens.origemMercadoria,
        percentualReducaoBcIcms: documentosFiscaisItens.percentualReducaoBcIcms,
        valorIcmsSt: documentosFiscaisItens.valorIcmsSt,
        valorIcmsStRetido: documentosFiscaisItens.valorIcmsStRetido,
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
          sql`${documentosFiscaisItens.cfop} = ANY(${cfops})`,
        ),
      );

    let totalDifal = 0n;
    let totalBase = 0n;
    // Contagem por hipótese (R1.1): a separação precisa ser visível no
    // resultado, não só interna. ST aparece aqui mas NÃO entra no total a
    // recolher de entrada-contribuinte (não recolher em duplicidade).
    const porHipotese: Record<DifalHipotese, number> = {
      DIFAL_ENTRADA_CONTRIBUINTE: 0,
      DIFAL_SAIDA_NAO_CONTRIBUINTE: 0,
      ANTECIPACAO: 0,
      ST: 0,
    };
    // Contagem por estado do cálculo (R1.2): quantos itens entraram como guia
    // definitiva, simulação (regra vigente não aprovada) ou pendência (sem
    // regra). Torna explícito o escopo honesto no resultado.
    const porStatus: Record<DifalCalculoStatus, number> = {
      CALCULADO: 0,
      SIMULACAO: 0,
      PENDENTE: 0,
    };
    // NÃO-DUPLICIDADE AUDITÁVEL (tarefa 2.5 — R1.4): conta os itens em que há
    // retenção/responsabilidade de terceiro e que, por isso, NÃO geram DIFAL
    // próprio (sem guia, base zero). Torna a garantia visível no resultado, não
    // apenas implícita na ausência de valor.
    let itensSemRecolhimentoProprio = 0;

    const detalhes = itens.map((item) => {
      // SEPARAÇÃO POR HIPÓTESE (tarefa 2.1, R1.1): cada item é enquadrado em
      // uma das quatro hipóteses antes de qualquer cálculo. Itens sob ST
      // (2406/2407 ou com ICMS-ST retido) são roteados para `ST` e NÃO geram
      // DIFAL de entrada-contribuinte, evitando duplicidade.
      // Sinais de ST do próprio item (R1.4): ICMS-ST retido anteriormente ou
      // ICMS-ST destacado caracterizam substituição tributária, roteando o item
      // para a hipótese `ST` mesmo quando o CFOP (ex.: 2556) sozinho sugeriria
      // entrada-contribuinte. Sem isso, recolheríamos DIFAL em duplicidade.
      const stRetidaAnteriormente =
        toScaledInteger(item.valorIcmsStRetido ?? '0') > 0n;
      const possuiSt = toScaledInteger(item.valorIcmsSt ?? '0') > 0n;
      const classificacao = classificarDifalHipotese({
        tipoOperacaoEscriturada: 'ENTRADA',
        cfop: item.cfop ?? '',
        possuiSt,
        stRetidaAnteriormente,
      });
      if (classificacao.hipotese) {
        porHipotese[classificacao.hipotese] += 1;
      }
      const calcularEntradaContribuinte =
        classificacao.hipotese === 'DIFAL_ENTRADA_CONTRIBUINTE';

      // COMPOSIÇÃO DA BASE (tarefa 2.4 — R1.3/R1.5): base por dentro, redução,
      // benefício, FCP, origem importada (interestadual 4%) e retenção, com
      // memória de arredondamento auditável. Substitui a apuração simplificada
      // anterior (BC ou valor bruto). A peça pura é `comporBaseDifal`.
      const baseComposta = comporBaseDifal(
        {
          valorBcIcms: item.valorBcIcms,
          valorBrutoProduto: item.valorBrutoProduto,
          valorFrete: item.valorFrete,
          valorSeguro: item.valorSeguro,
          valorOutrasDespesas: item.valorOutrasDespesas,
          valorDesconto: item.valorDesconto,
          origemMercadoria: item.origemMercadoria,
          percentualReducaoBcIcms: item.percentualReducaoBcIcms,
          aliquotaIcms: item.aliquotaIcms,
          valorIcmsSt: item.valorIcmsSt,
          valorIcmsStRetido: item.valorIcmsStRetido,
          stRetida: classificacao.stRetida,
        },
        baseRegra,
      );
      const baseStr = baseComposta.baseCalculo;
      // Alíquota interestadual EFETIVA apurada na composição: 4% quando a
      // mercadoria é importada (Res. SF 13/2012), senão a destacada no item.
      // Repassada ao calculador para uso quando a regra não fixa a interestadual;
      // nunca se presume 12% silenciosamente como a tabela legada fazia.
      const aliquotaInterItemStr = baseComposta.aliquotaInterestadualEfetiva;

      // CÁLCULO PARAMETRIZADO (tarefa 2.2): o valor da hipótese entrada-
      // contribuinte vem da REGRA do catálogo via `calcularDifalHipotese`. Sem
      // regra homologada, o resultado é PENDÊNCIA/SIMULAÇÃO (R1.2), não guia.
      // As demais hipóteses são separadas aqui e calculadas pelas tarefas 2.5+.
      const calc = calcularEntradaContribuinte
        ? calcularDifalHipotese(
          {
            hipotese: 'DIFAL_ENTRADA_CONTRIBUINTE',
            ufDestino: uf,
            competencia: competenciaMensal,
            responsavel: 'ADQUIRENTE' as DifalResponsavel,
            baseCalculo: baseStr,
            aliquotaInterestadualItem: aliquotaInterItemStr,
            baseComposta,
          },
          regra,
          { aprovada: regraAprovada },
        )
        : null;

      if (calc) {
        porStatus[calc.status] += 1;
      }

      // NÃO-DUPLICIDADE (tarefa 2.5 — R1.4): o item NÃO recolhe DIFAL próprio
      // quando há retenção/responsabilidade de terceiro — seja porque a hipótese
      // é ST (imposto do substituto), seja porque a composição zerou a base por
      // retenção. Nesses casos o resultado é explícito: `recolhimento_proprio` =
      // 'NAO' com o motivo, e o item NUNCA entra no total a recolher. Isto é o
      // que impede o recolhimento em duplicidade e o deixa AUDITÁVEL.
      const sobRetencaoOuSt =
        classificacao.hipotese === 'ST' || baseComposta.retido;
      const recolhimentoProprio: 'SIM' | 'NAO' = sobRetencaoOuSt ? 'NAO' : 'SIM';
      const motivoNaoRecolhimento = sobRetencaoOuSt
        ? classificacao.hipotese === 'ST'
          ? 'Operação sob substituição tributária (ICMS retido/responsabilidade ' +
          'do substituto): não há DIFAL de entrada próprio a recolher — ' +
          'recolher aqui duplicaria o imposto já retido (R1.4).'
          : 'ICMS-ST retido/responsabilidade de terceiro no item: base de DIFAL ' +
          'próprio zerada; nenhum valor a recolher para evitar duplicidade (R1.4).'
        : null;
      if (sobRetencaoOuSt) itensSemRecolhimentoProprio += 1;

      // SIMPLES NACIONAL — DIFAL de entrada FORA do DAS (tarefa 2.7 — R1.6):
      // quando o adquirente é Simples e o item é entrada-contribuinte que, de
      // fato, recolhe DIFAL próprio (CALCULADO, sem retenção/ST), o imposto é
      // devido POR FORA do DAS (N09 — LC 123/2006). O valor é o mesmo; o flag
      // torna explícito que esta é uma obrigação estadual própria do Simples,
      // não suprimida nem confundida com o ICMS recolhido no DAS. Para itens
      // sob ST/retenção (recolhimento_proprio = 'NAO') nada é devido, então o
      // flag é `false` mesmo para o Simples (não há recolhimento a situar).

      // RESPONSÁVEL pelo recolhimento (tarefa 2.6 — R1.5), derivado da hipótese:
      // em entrada-contribuinte o próprio ADQUIRENTE recolhe; em saída a não
      // contribuinte o REMETENTE (N10); sob ST o imposto é de TERCEIRO (o
      // substituto). Antecipação, assim como entrada-contribuinte, é do
      // adquirente. Null quando a hipótese não foi classificada.
      const responsavel: DifalResponsavel | null = classificacao.hipotese
        ? RESPONSAVEL_POR_HIPOTESE[classificacao.hipotese]
        : null;

      // Só compõe o TOTAL A RECOLHER quando é guia definitiva (CALCULADO) E não
      // há retenção/ST. A segunda condição é redundante (ST não é calculada e a
      // base retida é zero), mas EXPLÍCITA: garante, de forma defensiva, que
      // nenhum caminho futuro recolha sobre item com imposto já retido (R1.4).
      const recolheDifalProprio =
        calc?.status === 'CALCULADO' && recolhimentoProprio === 'SIM';
      if (recolheDifalProprio) {
        totalDifal += toScaledInteger(calc!.valorDifal);
        totalBase += toScaledInteger(baseStr);
      }

      // Verdadeiro quando o DIFAL próprio efetivamente devido é recolhido FORA
      // do DAS: só ocorre para o adquirente Simples Nacional e apenas quando há
      // DIFAL de entrada a recolher (CALCULADO + recolhimento próprio). Para
      // Lucro Presumido/Real o DIFAL de entrada corre pela apuração normal, não
      // "fora do DAS"; para itens sob ST/retenção nada é devido (R1.6/R1.4).
      const recolhidoForaDoDas = adquirenteSimples && recolheDifalProprio;

      return {
        documento_fiscal_id: item.documentoFiscalId,
        item_id: item.itemId,
        cfop: item.cfop,
        hipotese: classificacao.hipotese,
        motivo_hipotese: classificacao.motivo,
        // UF ORIGEM/DESTINO da operação (tarefa 2.6 — R1.5): origem = UF do
        // remetente (emitente); destino = UF do adquirente (contribuinte que
        // recolhe o DIFAL de entrada). Expõe a operação interestadual completa.
        uf_origem: item.emitenteUf,
        uf_destino: uf || null,
        // RESPONSÁVEL pelo recolhimento (ADQUIRENTE/REMETENTE/TERCEIRO), por
        // hipótese (R1.5). Torna explícito de quem é a obrigação em cada item.
        responsavel,
        // SIMPLES NACIONAL — recolhimento FORA do DAS (tarefa 2.7 — R1.6):
        // `true` apenas quando o adquirente é Simples e há DIFAL de entrada
        // próprio a recolher. Prova que o DIFAL do Simples é obrigação estadual
        // devida por fora do DAS (N09 — LC 123/2006), não suprimida.
        recolhido_fora_do_das: recolhidoForaDoDas,
        st_retida: classificacao.stRetida,
        base_calculo: baseStr,
        // Estado do cálculo (R1.2): CALCULADO/SIMULACAO/PENDENTE, ou null para
        // hipóteses não calculadas aqui (ST, saída, antecipação).
        status_calculo: calc?.status ?? null,
        pendente: calc?.pendente ?? null,
        // Alíquotas EFETIVAMENTE aplicadas pela regra do catálogo (não a tabela
        // fixa). Null quando pendente ou hipótese não calculada aqui.
        aliquota_interna: calc?.aliquotaInterna ?? null,
        aliquota_interestadual: calc?.aliquotaInterestadual ?? null,
        aliquota_fcp: calc?.aliquotaFcp ?? null,
        valor_difal: calc?.valorDifal ?? fromScaledInteger(0n),
        valor_fcp: calc?.valorFcp ?? fromScaledInteger(0n),
        memoria_calculo: calc?.memoria ?? null,
        // Memória de ARREDONDAMENTO da composição da base (R1.5, tarefa 2.4):
        // disponível mesmo para hipóteses não calculadas aqui (a composição é
        // pura e independe do cálculo do diferencial).
        memoria_arredondamento: baseComposta.memoriaArredondamento,
        // Origem importada e retenção explícitas no detalhe (R1.3/R1.5).
        origem_importada: baseComposta.origemImportada,
        retido: baseComposta.retido,
        // Base BRUTA antes dos abatimentos e os BENEFÍCIOS/REDUÇÕES aplicados
        // (tarefa 2.6 — R1.5): percentual e valor de base abatido, separados por
        // redução ordinária x benefício fiscal, para auditoria do valor final.
        base_bruta: baseComposta.baseBruta,
        beneficios: {
          percentual_reducao: baseComposta.beneficios.percentualReducao,
          valor_reducao: baseComposta.beneficios.valorReducao,
          percentual_beneficio: baseComposta.beneficios.percentualBeneficio,
          valor_beneficio: baseComposta.beneficios.valorBeneficio,
        },
        // IMPOSTO JÁ PAGO/RETIDO pelo substituto (tarefa 2.6 — R1.4/R1.5): o
        // ICMS-ST retido/destacado no item. É o imposto que a responsabilidade
        // de terceiro já recolheu; exposto ao lado de recolhimento_proprio para
        // mostrar "quanto já foi pago" e provar a não-duplicidade (R1.4).
        imposto_ja_pago: baseComposta.impostoJaPago,
        // NÃO-DUPLICIDADE AUDITÁVEL (tarefa 2.5 — R1.4): verdita, por item, se há
        // recolhimento de DIFAL próprio ('SIM'/'NAO') e, quando 'NAO', o motivo.
        // Prova que item sob ST/retenção foi analisado e deliberadamente NÃO
        // recolhido (não omitido), impedindo recolher sobre imposto já retido.
        recolhimento_proprio: recolhimentoProprio,
        motivo_nao_recolhimento: motivoNaoRecolhimento,
      };
    });

    // Itens cujo DIFAL de entrada é recolhido FORA do DAS por ser o adquirente
    // Simples Nacional (tarefa 2.7 — R1.6). Resume no cabeçalho a obrigação
    // própria do Simples que corre por fora do DAS, tornando-a auditável.
    const itensRecolhidosForaDoDas = detalhes.filter(
      (d) => d.recolhido_fora_do_das,
    ).length;

    return {
      competencia,
      uf_adquirente: cliente.uf,
      // REGIME do adquirente (R1.6): eixo que decide o tratamento do DIFAL de
      // entrada do Simples (recolhido fora do DAS). Null quando não informado.
      regime_adquirente: regimeAdquirente,
      // Fonte do cálculo: catálogo versionado quando há regra; estado explícito.
      origem_regra: regraVersao
        ? {
          catalogo_versao_id: regraVersao.catalogoVersaoId,
          regra_versao_id: regraVersao.id,
          chave: regraVersao.chave,
          revisao: regraVersao.revisao,
          fonte: regraVersao.fonte,
          escopo_aprovado: regraVersao.escopoAprovado,
          vigencia_inicio: regraVersao.vigenciaInicio,
          vigencia_fim: regraVersao.vigenciaFim,
        }
        : null,
      // Referência legada apenas identificada (nunca fonte de verdade); null
      // quando a UF não consta da tabela de referência.
      aliquota_interna_referencia_legada: aliquotaInternaReferencia,
      quantidade_itens: itens.length,
      // Quantidade de itens separada por hipótese (R1.1): torna explícito que o
      // DIFAL deixou de ser um cálculo único e passou a ser separado.
      itens_por_hipotese: porHipotese,
      // Quantidade de itens por estado do cálculo (R1.2).
      itens_por_status: porStatus,
      // NÃO-DUPLICIDADE (tarefa 2.5 — R1.4): quantidade de itens em que há
      // retenção/responsabilidade de terceiro e que, por isso, NÃO geraram DIFAL
      // próprio. Resume no cabeçalho a garantia detalhada por item.
      itens_sem_recolhimento_proprio: itensSemRecolhimentoProprio,
      // SIMPLES NACIONAL (tarefa 2.7 — R1.6): quantidade de itens cujo DIFAL de
      // entrada é devido e recolhido FORA do DAS por ser o adquirente Simples.
      itens_recolhidos_fora_do_das: itensRecolhidosForaDoDas,
      total_base_calculo: fromScaledInteger(totalBase),
      // Total a recolher refere-se APENAS à hipótese entrada-contribuinte COM
      // regra homologada (CALCULADO) e SEM retenção/ST. ST, saída-não-
      // contribuinte, antecipação, itens pendentes/simulados e qualquer item com
      // imposto já retido NÃO compõem o valor a recolher (não-duplicidade, R1.4).
      total_difal_recolher: fromScaledInteger(totalDifal),
      itens: detalhes,
    };
  }

  // Interpreta o `conteudo` jsonb da regra de catálogo como parâmetros de DIFAL.
  // Decimais permanecem strings; campos ausentes viram `undefined`/`null` e o
  // calculador trata a ausência (ex.: sem alíquota interna → não calcula).
  private regraDoConteudo(
    conteudo: Record<string, unknown> | undefined,
  ): DifalRegra | null {
    if (!conteudo) return null;
    const aliquotaInterna = this.comoDecimalString(
      conteudo.aliquota_interna ?? conteudo.aliquotaInterna,
    );
    if (aliquotaInterna == null) return null;
    return {
      aliquotaInterna,
      aliquotaInterestadual: this.comoDecimalString(
        conteudo.aliquota_interestadual ?? conteudo.aliquotaInterestadual,
      ),
      aliquotaFcp: this.comoDecimalString(
        conteudo.aliquota_fcp ?? conteudo.aliquotaFcp,
      ),
    };
  }

  // Interpreta o `conteudo` jsonb como parâmetros de COMPOSIÇÃO DA BASE (tarefa
  // 2.4): por dentro, redução, benefício e FCP. Independe de `regraDoConteudo`
  // (que trata o cálculo do diferencial): a composição é aplicada mesmo sem
  // alíquota interna, pois redução/benefício/retenção/origem não dependem dela.
  // Decimais permanecem strings; `base_por_dentro` é um booleano do conteúdo.
  private baseRegraDoConteudo(
    conteudo: Record<string, unknown> | undefined,
  ): DifalBaseRegra | null {
    if (!conteudo) return null;
    const basePorDentro =
      conteudo.base_por_dentro ?? conteudo.basePorDentro;
    return {
      aliquotaInterna: this.comoDecimalString(
        conteudo.aliquota_interna ?? conteudo.aliquotaInterna,
      ),
      percentualReducao: this.comoDecimalString(
        conteudo.percentual_reducao ?? conteudo.percentualReducao,
      ),
      percentualBeneficio: this.comoDecimalString(
        conteudo.percentual_beneficio ?? conteudo.percentualBeneficio,
      ),
      basePorDentro: basePorDentro === true,
      aliquotaFcp: this.comoDecimalString(
        conteudo.aliquota_fcp ?? conteudo.aliquotaFcp,
      ),
    };
  }

  // Aceita apenas strings decimais (restrição da fase: nunca `Number`). Qualquer
  // outro tipo (inclusive `number` vindo de um jsonb mal cadastrado) é rejeitado
  // como ausente, para não introduzir aritmética de ponto flutuante.
  private comoDecimalString(valor: unknown): string | null {
    if (typeof valor !== 'string') return null;
    const t = valor.trim();
    return t === '' ? null : t;
  }

  private competenciaRange(competencia: string) {
    try {
      const range = parseCompetenciaMensal(competencia);
      // `competenciaMensal` ('YYYY-MM') é o formato que o catálogo consome; o
      // `competencia` do range é 'YYYY-MM-01' (datas SPED). Devolvemos ambos.
      return { ...range, competenciaMensal: competencia };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Competência inválida.',
      );
    }
  }

  private async getCliente(clienteId: string) {
    const rows = await this.database.db
      .select({
        id: clientes.id,
        uf: clientes.uf,
        // REGIME TRIBUTÁRIO do adquirente (tarefa 2.7 — R1.6): necessário para
        // tratar o DIFAL de entrada do Simples Nacional. Diferente do ICMS
        // próprio (recolhido no DAS, por fora da conta gráfica), o DIFAL de
        // entrada do Simples é obrigação ESTADUAL recolhida FORA do DAS (N09 —
        // LC 123/2006; LC 190/2022 — N10). O valor é calculado igual; o regime
        // é exposto para que o resultado prove que é obrigação própria do
        // Simples, não um imposto do DAS.
        regimeTributario: clientes.regimeTributario,
      })
      .from(clientes)
      .where(eq(clientes.id, clienteId))
      .limit(1);
    if (!rows[0]) throw new NotFoundException('Empresa não encontrada.');
    return rows[0];
  }
}
