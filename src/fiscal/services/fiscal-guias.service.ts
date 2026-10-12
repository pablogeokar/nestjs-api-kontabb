import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, ne, sql, type SQL } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service';
import {
  clientes,
  fiscalApuracoesGuias,
  fiscalFechamentos,
  fiscalPagamentosEventos,
  fiscalSimplesApuracoes,
  guias,
} from '../../database/schema';
import { deriveDocumentStatus } from '../../common/document-status';
import { fromScaledInteger, toScaledInteger } from '../sped/sped-decimal';
import { parseCompetenciaMensal } from '../fiscal-date.util';
import {
  difalMotivoInelegibilidadeGuia,
  difalPodeGerarGuia,
  type DifalCalculoStatus,
} from './difal-calculador';
import { projetarResultadoApuracao } from './resultado-apuracao.projector';
import type { FechamentoSnapshots } from './resultado-apuracao.projector';
import { compararGuiaComObrigacao } from './fiscal-guias-divergencia';
import {
  projetarSaldoObrigacao,
  sinalDoEvento,
  type EventoPagamentoTrilha,
  type TipoEventoPagamento,
} from './fiscal-pagamentos-trilha';

/** Origem do evento de pagamento/estorno (espelha o domínio do banco). */
export type OrigemPagamento = 'MANUAL' | 'IMPORTACAO' | 'CONCILIACAO';

/**
 * Entrada para registrar um EVENTO de pagamento/estorno na trilha de uma guia
 * (R1.3). Nunca sobrescreve: cada chamada acrescenta uma linha imutável em
 * `fiscal_pagamentos_eventos`. O saldo da obrigação é sempre reconstruído da
 * trilha (ver `fiscal-pagamentos-trilha.ts`), nunca de um status mutável.
 */
export interface RegistrarEventoPagamentoInput {
  clienteId: string;
  guiaId: string;
  /** PAGAMENTO (total), PAGAMENTO_PARCIAL ou ESTORNO. */
  tipo: TipoEventoPagamento;
  /** Magnitude decimal não-negativa do evento (nunca `Number`). */
  valor: string;
  /** Data em que o pagamento/estorno de fato ocorreu ('YYYY-MM-DD'). */
  dataEvento: string;
  /** Origem do lançamento. Default MANUAL. */
  origem?: OrigemPagamento;
  /** Evidência: key do comprovante no storage (nunca URL — SKILL). */
  comprovanteKey?: string;
  /** Indicação explícita de declaração manual (R1.5), sem comprovante anexo. */
  declaracaoManual?: boolean;
  /** Identificador externo do evento (autenticação bancária, nº comprovante). */
  documentoExterno?: string;
  /** Obrigatório para ESTORNO: o evento de pagamento que este reverte. */
  eventoEstornadoId?: string;
  observacao?: string;
}

/** Entrada do cancelamento LÓGICO de uma guia (R1.4), em vez de delete físico. */
export interface CancelarGuiaInput {
  clienteId: string;
  guiaId: string;
  /** Motivo opcional do cancelamento — rastro mínimo. */
  motivo?: string;
}

export type TributoGuia =
  | 'ICMS_PROPRIO'
  | 'ICMS_ST'
  | 'DIFAL_ENTRADA'
  | 'DIFAL_SAIDA'
  | 'FCP'
  | 'IPI'
  | 'PIS'
  | 'COFINS'
  | 'DAS_SIMPLES';

export type TipoGuia = 'DAE' | 'GNRE' | 'DARF' | 'DAS';

/**
 * Origem da guia (R1.1 / Fase 5 tarefa 1.2): de onde a guia emitida veio.
 * - `APURACAO`: calculada a partir de uma versão de apuração (fechamento da
 *   Fase 3). EXIGE `fechamentoId` — é o vínculo guia ↔ apuração do R1.7.
 * - `MANUAL`: lançada manualmente pelo responsável, sem fechamento associado.
 */
export type OrigemGuia = 'APURACAO' | 'MANUAL';

export interface CriarGuiaInput {
  clienteId: string;
  competencia: string; // 'YYYY-MM'
  tributo: TributoGuia;
  ufFavorecida: string;
  tipoGuia: TipoGuia;
  codigoReceita: string;
  dataVencimento: string; // 'YYYY-MM-DD'
  valorPrincipal: string;
  valorMulta?: string;
  valorJuros?: string;
  /**
   * Origem da guia (R1.1). Default `MANUAL` quando omitido. Guia de origem
   * `APURACAO` precisa de `fechamentoId` (vínculo com a versão de apuração).
   */
  origem?: OrigemGuia;
  /**
   * Versão de apuração (fechamento da Fase 3) que originou a obrigação
   * calculada. OBRIGATÓRIO quando `origem = 'APURACAO'` (R1.7); ignorado para
   * guia `MANUAL`. O fechamento referenciado DEVE existir e pertencer ao mesmo
   * cliente — amarra a guia à versão de apuração para a conciliação.
   */
  fechamentoId?: string;
  /**
   * Chave de idempotência fornecida pelo chamador, POR REQUISIÇÃO (R1.6).
   * Opcional. Quando presente, deduplica a criação por RETRY: uma segunda
   * chamada que carrega a MESMA chave (mesmo cliente) NÃO cria uma guia nova —
   * `criarGuia` retorna a guia já criada. É a FRONTEIRA de deduplicação, NUNCA
   * uma unicidade por tributo/período/UF: múltiplas obrigações legítimas do
   * mesmo tributo/período/UF continuam permitidas (chaves distintas, ou sem
   * chave). Omitir a chave preserva o comportamento legado (sem deduplicação).
   */
  idempotencyKey?: string;
  /**
   * Estado do cálculo do DIFAL (R1.2 / tarefa 2.3), quando a guia tem origem no
   * calculador parametrizado de DIFAL. Obrigatório na prática para os tributos
   * `DIFAL_ENTRADA`/`DIFAL_SAIDA`: só um resultado `CALCULADO` (regra homologada
   * e vigente) pode virar guia. `SIMULACAO`/`PENDENTE` são bloqueados aqui para
   * que um item simulado/pendente NUNCA gere guia de recolhimento. Para tributos
   * não-DIFAL o campo é ignorado.
   */
  difalStatus?: DifalCalculoStatus;
}

// Tributos cuja guia tem origem no cálculo parametrizado de DIFAL (tarefa 2.3).
// Para eles, a criação de guia exige um estado `CALCULADO`; simulação/pendência
// são barradas (R1.2 — "sem regra homologada, nunca guia").
const TRIBUTOS_DIFAL: ReadonlySet<TributoGuia> = new Set<TributoGuia>([
  'DIFAL_ENTRADA',
  'DIFAL_SAIDA',
]);

@Injectable()
export class FiscalGuiasService {
  constructor(private readonly database: DatabaseService) {}

  async criarGuia(input: CriarGuiaInput) {
    await this.assertCliente(input.clienteId);
    const { competencia } = this.competenciaRange(input.competencia);

    // R1.6 (Fase 5, tarefa 1.6): DEDUPLICAÇÃO POR CHAVE DE IDEMPOTÊNCIA. Quando o
    // chamador fornece uma chave, um RETRY com a MESMA chave (mesmo cliente) NÃO
    // cria uma guia nova — retornamos a já criada. A chave é a FRONTEIRA de
    // deduplicação, não uma unicidade por tributo/período/UF: duas obrigações
    // legítimas do mesmo tributo/período/UF (chaves distintas, ou sem chave)
    // seguem permitidas. O lookup aqui resolve o caso comum do retry sequencial;
    // o índice único parcial no banco é a última linha de defesa contra a corrida
    // de duas requisições simultâneas com a mesma chave.
    const idempotencyKey = this.normalizarIdempotencyKey(input.idempotencyKey);
    if (idempotencyKey != null) {
      const existente = await this.buscarPorIdempotencyKey(
        input.clienteId,
        idempotencyKey,
      );
      if (existente) return this.toGuiaResponse(existente);
    }

    // R1.1 / R1.7 (Fase 5, tarefa 1.2): separa obrigação calculada, guia
    // emitida, pagamento e conciliação. Esta chamada CRIA apenas a GUIA EMITIDA
    // — o PAGAMENTO é registrado à parte, como evento em
    // `fiscal_pagamentos_eventos` (tarefa 1.1), nunca como efeito colateral
    // daqui. Resolve a origem e, quando a guia vem da apuração, EXIGE e valida o
    // vínculo com a versão de apuração (fechamento) antes de persistir.
    const origem: OrigemGuia = input.origem ?? 'MANUAL';
    const vinculo = await this.resolverVinculoApuracao(
      input.clienteId,
      origem,
      input.fechamentoId,
    );

    // R1.2 / tarefa 2.3: um DIFAL em SIMULAÇÃO/PENDÊNCIA NUNCA vira guia. Este é
    // o ponto do fluxo em que o estado do cálculo precisa barrar a emissão —
    // sem este guard, um chamador poderia criar uma guia DIFAL a partir de um
    // item simulado/pendente. A decisão delega a `difalPodeGerarGuia` (fonte
    // única da regra); a referência legada jamais é fonte de verdade para guia.
    this.assertDifalElegivel(input);

    // R6.4/R6.3: reforça as invariantes do CriarGuiaDto no serviço para que um
    // chamador fora do HTTP (sem ValidationPipe) não as burle. Cada componente
    // (principal, multa, juros) deve ser um decimal NÃO NEGATIVO — checado
    // individualmente para que um principal negativo não seja compensado por
    // uma multa positiva a fim de passar apenas na validação do total.
    const principal = this.parseValorNaoNegativo(
      input.valorPrincipal,
      'principal',
    );
    const multa = this.parseValorNaoNegativo(input.valorMulta ?? '0', 'multa');
    const juros = this.parseValorNaoNegativo(input.valorJuros ?? '0', 'juros');

    const valorTotal = fromScaledInteger(principal + multa + juros);
    if (toScaledInteger(valorTotal) <= 0n) {
      throw new BadRequestException(
        'O valor total da guia deve ser maior que zero.',
      );
    }

    // R1.2 (tarefa 1.3): sinaliza quando a guia diverge da obrigação apurada.
    // Só se aplica à guia de origem APURAÇÃO (há obrigação por trás); a guia
    // MANUAL não tem do que divergir. A comparação é contra o total da obrigação
    // projetado do fechamento (`vinculo.valorObrigacao`) — mesmo valor da
    // conciliação, nunca um recálculo. Sinal informativo: não bloqueia a emissão,
    // apenas marca a divergência e congela o valor comparado para auditoria.
    const sinal =
      vinculo.valorObrigacao != null
        ? compararGuiaComObrigacao(valorTotal, vinculo.valorObrigacao)
        : null;

    const values = {
      clienteId: input.clienteId,
      competencia,
      tributo: input.tributo,
      ufFavorecida: input.ufFavorecida.toUpperCase(),
      tipoGuia: input.tipoGuia,
      codigoReceita: input.codigoReceita,
      dataVencimento: input.dataVencimento,
      valorPrincipal: input.valorPrincipal,
      valorMulta: input.valorMulta ?? '0',
      valorJuros: input.valorJuros ?? '0',
      valorTotal,
      origem,
      fechamentoId: vinculo.fechamentoId,
      divergenteObrigacao: sinal?.divergente ?? false,
      valorObrigacao: sinal?.valorObrigacao ?? null,
      statusPagamento: 'PENDENTE' as const,
      // R1.6: só persiste a chave quando fornecida; sem chave a guia fica fora
      // do índice único parcial (preserva o comportamento legado/sem dedupe).
      idempotencyKey,
    };

    try {
      const rows = await this.database.db
        .insert(fiscalApuracoesGuias)
        .values(values)
        .returning();
      return this.toGuiaResponse(rows[0]);
    } catch (error) {
      // R1.6: CORRIDA. Duas requisições simultâneas com a MESMA chave: uma vence
      // o insert, a outra colide com o índice único parcial do banco. Em vez de
      // propagar o erro, resolvemos como retry — relemos e devolvemos a guia que
      // de fato foi criada. Nunca "cria duplicata": o índice é a última linha de
      // defesa, e a semântica continua idempotente mesmo sob concorrência.
      if (idempotencyKey != null && this.isUniqueViolation(error)) {
        const existente = await this.buscarPorIdempotencyKey(
          input.clienteId,
          idempotencyKey,
        );
        if (existente) return this.toGuiaResponse(existente);
      }
      throw error;
    }
  }

  /**
   * R1.6 (tarefa 1.6): normaliza a chave de idempotência. Trata vazio/whitespace
   * como ausência de chave (sem dedupe) — uma string em branco não é uma chave
   * válida e não deve participar do índice único. `undefined`/`null` → `null`.
   */
  private normalizarIdempotencyKey(
    idempotencyKey: string | undefined,
  ): string | null {
    if (idempotencyKey == null) return null;
    const trimmed = idempotencyKey.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  /**
   * R1.6 (tarefa 1.6): busca uma guia já criada pela chave de idempotência,
   * escopada por (clienteId, idempotencyKey) — o MESMO escopo do índice único
   * parcial. É a fonte da deduplicação por retry: existindo, `criarGuia` devolve
   * esta guia em vez de criar uma nova.
   */
  private async buscarPorIdempotencyKey(
    clienteId: string,
    idempotencyKey: string,
  ): Promise<typeof fiscalApuracoesGuias.$inferSelect | undefined> {
    const rows = await this.database.db
      .select()
      .from(fiscalApuracoesGuias)
      .where(
        and(
          eq(fiscalApuracoesGuias.clienteId, clienteId),
          eq(fiscalApuracoesGuias.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    return rows[0];
  }

  /**
   * Detecta a violação de UNICIDADE do PostgreSQL (SQLSTATE 23505). O driver
   * `postgres` expõe o `code` no erro; não dependemos da mensagem (locale).
   */
  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === '23505'
    );
  }

  async listarGuias(input: {
    clienteId: string;
    competencia?: string;
    tributo?: TributoGuia;
    statusPagamento?: 'PENDENTE' | 'PAGO' | 'VENCIDO';
  }) {
    const conditions: SQL[] = [
      eq(fiscalApuracoesGuias.clienteId, input.clienteId),
    ];
    if (input.competencia) {
      conditions.push(
        eq(
          fiscalApuracoesGuias.competencia,
          this.competenciaRange(input.competencia).competencia,
        ),
      );
    }
    if (input.tributo) {
      conditions.push(eq(fiscalApuracoesGuias.tributo, input.tributo));
    }
    if (input.statusPagamento) {
      conditions.push(
        eq(fiscalApuracoesGuias.statusPagamento, input.statusPagamento),
      );
    }
    const rows = await this.database.db
      .select()
      .from(fiscalApuracoesGuias)
      .where(and(...conditions))
      .orderBy(
        asc(fiscalApuracoesGuias.competencia),
        asc(fiscalApuracoesGuias.tributo),
      );
    return { data: rows.map((row) => this.toGuiaResponse(row)) };
  }

  /**
   * Visão operacional única da obrigação calculada e do PDF enviado. Pares
   * vinculados são uma única linha; uploads legados sem vínculo continuam
   * visíveis para conferência, sem inferir uma conciliação a cada leitura.
   */
  async listarCentral(input: { clienteId: string; competencia: string }) {
    await this.assertCliente(input.clienteId);
    const { competencia } = this.competenciaRange(input.competencia);
    const periodo = `${input.competencia.slice(5, 7)}/${input.competencia.slice(0, 4)}`;

    const [guiasFiscais, uploads, apuracoes] = await Promise.all([
      this.database.db
        .select({
          id: fiscalApuracoesGuias.id,
          tributo: fiscalApuracoesGuias.tributo,
          tipoGuia: fiscalApuracoesGuias.tipoGuia,
          dataVencimento: fiscalApuracoesGuias.dataVencimento,
          valorTotal: fiscalApuracoesGuias.valorTotal,
          statusPagamento: fiscalApuracoesGuias.statusPagamento,
          origem: fiscalApuracoesGuias.origem,
          fechamentoId: fiscalApuracoesGuias.fechamentoId,
          divergenteObrigacao: fiscalApuracoesGuias.divergenteObrigacao,
          valorObrigacao: fiscalApuracoesGuias.valorObrigacao,
          emitidaOrgao: fiscalApuracoesGuias.emitidaOrgao,
          arquivoGuiaKey: fiscalApuracoesGuias.arquivoGuiaKey,
          guiaUploadId: fiscalApuracoesGuias.guiaUploadId,
          guiaUploadDiferenca: fiscalApuracoesGuias.guiaUploadDiferenca,
          guiaUploadVinculadaEm: fiscalApuracoesGuias.guiaUploadVinculadaEm,
          arquivoNome: guias.arquivoNome,
          uploadStatus: guias.status,
          criadoEm: fiscalApuracoesGuias.criadoEm,
        })
        .from(fiscalApuracoesGuias)
        .leftJoin(guias, eq(fiscalApuracoesGuias.guiaUploadId, guias.id))
        .where(
          and(
            eq(fiscalApuracoesGuias.clienteId, input.clienteId),
            eq(fiscalApuracoesGuias.competencia, competencia),
            eq(fiscalApuracoesGuias.cancelada, false),
          ),
        )
        .orderBy(asc(fiscalApuracoesGuias.dataVencimento)),
      this.database.db
        .select({
          id: guias.id,
          tipo: guias.tipo,
          periodo: guias.periodo,
          vencimento: guias.vencimento,
          valor: guias.valor,
          status: guias.status,
          arquivoNome: guias.arquivoNome,
          criadoEm: guias.criadoEm,
        })
        .from(guias)
        .where(
          and(
            eq(guias.clienteId, input.clienteId),
            eq(guias.periodo, periodo),
            ne(guias.tipo, 'FOLHA-PAGAMENTO'),
          ),
        )
        .orderBy(desc(guias.criadoEm)),
      this.database.db
        .select({
          status: fiscalSimplesApuracoes.status,
          valorTotalDas: fiscalSimplesApuracoes.valorTotalDas,
          guiaId: fiscalSimplesApuracoes.guiaId,
          versao: fiscalSimplesApuracoes.versao,
        })
        .from(fiscalSimplesApuracoes)
        .where(
          and(
            eq(fiscalSimplesApuracoes.clienteId, input.clienteId),
            eq(fiscalSimplesApuracoes.competencia, competencia),
          ),
        )
        .orderBy(desc(fiscalSimplesApuracoes.versao))
        .limit(1),
    ]);

    const uploadsVinculados = new Set(
      guiasFiscais.flatMap((guia) =>
        guia.guiaUploadId ? [guia.guiaUploadId] : [],
      ),
    );
    const linhasFiscais = guiasFiscais.map((guia) => ({
      id: guia.id,
      origem: 'APURACAO' as const,
      tipo: guia.tipoGuia,
      tributo: guia.tributo,
      competencia: input.competencia,
      vencimento: guia.dataVencimento,
      valor: guia.valorTotal,
      status: deriveDocumentStatus(
        guia.uploadStatus === 'PAGO' ? 'PAGO' : guia.statusPagamento,
        guia.dataVencimento,
      ),
      arquivo_nome: guia.arquivoNome,
      tem_arquivo: Boolean(guia.arquivoGuiaKey),
      download_id: guia.guiaUploadId,
      vinculo_status: guia.guiaUploadId
        ? ('CONCILIADA' as const)
        : ('AGUARDANDO_UPLOAD' as const),
      vinculo_diferenca: guia.guiaUploadDiferenca,
      vinculado_em: guia.guiaUploadVinculadaEm?.toISOString() ?? null,
      fechamento_id: guia.fechamentoId,
      divergente_obrigacao: guia.divergenteObrigacao,
      valor_obrigacao: guia.valorObrigacao,
      emitida_orgao: guia.emitidaOrgao,
      criado_em: guia.criadoEm.toISOString(),
    }));
    const linhasUploads = uploads
      .filter((guia) => !uploadsVinculados.has(guia.id))
      .map((guia) => ({
        id: guia.id,
        origem: 'UPLOAD' as const,
        tipo: guia.tipo,
        tributo: null,
        competencia: input.competencia,
        vencimento: guia.vencimento,
        valor: guia.valor,
        status: deriveDocumentStatus(guia.status, guia.vencimento),
        arquivo_nome: guia.arquivoNome,
        tem_arquivo: true,
        download_id: guia.id,
        vinculo_status:
          guia.tipo === 'DAS'
            ? ('SEM_VINCULO' as const)
            : ('NAO_APLICAVEL' as const),
        vinculo_diferenca: null,
        vinculado_em: null,
        fechamento_id: null,
        divergente_obrigacao: false,
        valor_obrigacao: null,
        emitida_orgao: true,
        criado_em: guia.criadoEm.toISOString(),
      }));
    const itens = [...linhasFiscais, ...linhasUploads];
    const total = itens.reduce(
      (soma, item) =>
        item.valor == null ? soma : soma + toScaledInteger(item.valor),
      0n,
    );
    const apuracao = apuracoes[0] ?? null;

    return {
      competencia: input.competencia,
      status_apuracao: apuracao?.status ?? null,
      valor_apurado: apuracao?.valorTotalDas ?? null,
      lifecycle: {
        a_gerar: apuracao && !apuracao.guiaId ? 1 : 0,
        emitidas: itens.filter((item) => item.tem_arquivo).length,
        pagas: itens.filter((item) => item.status === 'PAGO').length,
        conciliadas: linhasFiscais.filter(
          (item) => item.vinculo_status === 'CONCILIADA',
        ).length,
      },
      resumo: {
        quantidade: itens.length,
        valor_total: fromScaledInteger(total),
        pendentes_vinculo: itens.filter(
          (item) => item.vinculo_status === 'SEM_VINCULO',
        ).length,
      },
      guias: itens,
    };
  }

  /**
   * R1.5 (Fase 5, tarefa 1.5): atualiza o `status_pagamento` da guia, MAS "PAGO"
   * NUNCA é uma sobrescrita livre de status. Marcar uma guia como paga exige que
   * a trilha de pagamentos (`fiscal_pagamentos_eventos`) a RESPALDE: tem de haver
   * pelo menos um evento de pagamento e o saldo reconstruído da trilha precisa
   * estar quitado. Como todo evento de pagamento (não-estorno) já exige evidência
   * OU declaração manual explícita (R1.5, reforçado em `registrarEventoPagamento`
   * e no banco), um "PAGO" só é possível quando há de fato comprovante/declaração
   * por trás — fechando o caminho que permitia marcar PAGO sem respaldo.
   *
   * `PENDENTE`/`VENCIDO` não exigem respaldo (não afirmam quitação). O
   * cancelamento lógico (R1.4) permanece intacto: guia cancelada não muda status.
   */
  async marcarPagamento(input: {
    clienteId: string;
    guiaId: string;
    statusPagamento: 'PENDENTE' | 'PAGO' | 'VENCIDO';
  }) {
    const guia = await this.carregarGuiaDoCliente(
      input.clienteId,
      input.guiaId,
    );

    if (input.statusPagamento === 'PAGO') {
      if (guia.cancelada) {
        throw new BadRequestException(
          'Guia cancelada não pode ser marcada como PAGO (R1.4 congela a ' +
            'obrigação).',
        );
      }
      // Respaldo pela trilha: o saldo é reconstruído dos eventos preservados
      // (nunca de um status mutável). "PAGO" só quando há pagamento registrado
      // e o saldo está quitado — e todo pagamento já carrega evidência OU
      // declaração manual por construção (R1.5).
      const saldo = await this.projetarSaldoDaTrilha(
        input.guiaId,
        guia.valorTotal,
      );
      if (saldo.quantidadeEventos === 0 || !saldo.quitada) {
        throw new BadRequestException(
          'Marcar a guia como PAGO exige um pagamento respaldado por evidência ' +
            'ou declaração manual na trilha, com o saldo quitado (R1.5). ' +
            'Registre o pagamento em /guias/:id/eventos; registrar a guia não ' +
            'significa que ela foi paga.',
        );
      }
    }

    const rows = await this.database.db
      .update(fiscalApuracoesGuias)
      .set({
        statusPagamento: input.statusPagamento,
        atualizadoEm: new Date(),
      })
      .where(
        and(
          eq(fiscalApuracoesGuias.id, input.guiaId),
          eq(fiscalApuracoesGuias.clienteId, input.clienteId),
        ),
      )
      .returning();
    if (!rows[0]) throw new NotFoundException('Guia não encontrada.');
    return this.toGuiaResponse(rows[0]);
  }

  /**
   * R1.5 (tarefa 1.5): REGISTRAR uma guia ≠ EMITIDA no órgão arrecadador.
   * Marca a guia como de fato emitida/transmitida no órgão (DAE/GNRE/DARF/DAS
   * gerada no portal correspondente), registrando QUANDO. Enquanto este fato não
   * ocorre, a guia permanece apenas REGISTRADA no sistema (`emitida_orgao =
   * false`). Fato distinto do pagamento: emitir no órgão não quita a guia.
   * Escopado por (id, clienteId) e idempotente (não "desemite").
   */
  async marcarEmitidaNoOrgao(input: {
    clienteId: string;
    guiaId: string;
    emitidaOrgaoEm?: Date;
  }) {
    const guia = await this.carregarGuiaDoCliente(
      input.clienteId,
      input.guiaId,
    );
    if (guia.cancelada) {
      throw new BadRequestException(
        'Guia cancelada não pode ser emitida no órgão (R1.4 congela a guia).',
      );
    }
    const rows = await this.database.db
      .update(fiscalApuracoesGuias)
      .set({
        emitidaOrgao: true,
        emitidaOrgaoEm: input.emitidaOrgaoEm ?? new Date(),
        atualizadoEm: new Date(),
      })
      .where(
        and(
          eq(fiscalApuracoesGuias.id, input.guiaId),
          eq(fiscalApuracoesGuias.clienteId, input.clienteId),
        ),
      )
      .returning();
    if (!rows[0]) throw new NotFoundException('Guia não encontrada.');
    return this.toGuiaResponse(rows[0]);
  }

  /**
   * Projeta o SALDO de uma guia a partir da trilha preservada de eventos
   * (`fiscal_pagamentos_eventos`), reusando a MESMA projeção pura de
   * `trilhaPagamentos` (R1.3). O saldo nunca é lido de um campo mutável.
   */
  private async projetarSaldoDaTrilha(guiaId: string, valorTotal: string) {
    const eventos = await this.database.db
      .select()
      .from(fiscalPagamentosEventos)
      .where(eq(fiscalPagamentosEventos.guiaId, guiaId))
      .orderBy(
        asc(fiscalPagamentosEventos.dataEvento),
        asc(fiscalPagamentosEventos.criadoEm),
      );
    const trilha: EventoPagamentoTrilha[] = eventos.map((evento) => ({
      tipo: evento.tipo as TipoEventoPagamento,
      valor: evento.valor,
      sinal: evento.sinal === -1 ? -1 : 1,
    }));
    return projetarSaldoObrigacao(valorTotal, trilha);
  }

  /**
   * R1.3 (Fase 5, tarefa 1.4): registra um EVENTO de pagamento/estorno na trilha
   * da guia (`fiscal_pagamentos_eventos`). NUNCA sobrescreve: cada chamada
   * ACRESCENTA uma linha imutável, de modo que pagamento parcial, pagamento
   * total e estorno coexistem na trilha e o saldo da obrigação é sempre
   * reconstruível (`saldo = valorTotal − Σ(sinal · valor)`), preservado por
   * construção. Não há "marcar pago" que apaga o estado anterior.
   *
   * Antes de persistir, o serviço reforça as invariantes do banco (última linha
   * de defesa fora do HTTP): guia existe e é do cliente e não está cancelada;
   * valor é decimal estritamente positivo (magnitude); ESTORNO referencia o
   * pagamento revertido e esse pagamento é da MESMA guia; pagamento (não estorno)
   * exige evidência OU declaração manual (R1.5).
   */
  async registrarEventoPagamento(input: RegistrarEventoPagamentoInput) {
    const guia = await this.carregarGuiaDoCliente(
      input.clienteId,
      input.guiaId,
    );
    if (guia.cancelada) {
      throw new BadRequestException(
        'Guia cancelada não aceita novos eventos de pagamento/estorno. O ' +
          'cancelamento preserva a trilha, mas congela a obrigação (R1.4).',
      );
    }

    let valor: bigint;
    try {
      valor = toScaledInteger(input.valor);
    } catch {
      throw new BadRequestException(
        `Valor do evento inválido: "${input.valor}".`,
      );
    }
    if (valor <= 0n) {
      throw new BadRequestException(
        'O valor do evento de pagamento/estorno deve ser maior que zero. O ' +
          'efeito no saldo (somar/subtrair) vem do tipo, não do sinal do valor.',
      );
    }

    const origem: OrigemPagamento = input.origem ?? 'MANUAL';
    const sinal = sinalDoEvento(input.tipo);

    if (input.tipo === 'ESTORNO') {
      // Estorno DEVE referenciar o pagamento que reverte, e esse pagamento tem
      // de ser da MESMA guia — preserva o par original/reversão sem sobrescrever
      // o evento revertido (R1.3/R1.4).
      if (input.eventoEstornadoId == null) {
        throw new BadRequestException(
          'Estorno exige a referência ao evento de pagamento revertido ' +
            '(eventoEstornadoId), para manter o par original/reversão explícito.',
        );
      }
      await this.assertEventoDaGuia(input.guiaId, input.eventoEstornadoId);
    } else {
      // "PAGO" exige evidência OU declaração manual explícita (R1.5): registrar
      // um pagamento sem comprovante e sem a marcação deliberada é bloqueado.
      if (input.eventoEstornadoId != null) {
        throw new BadRequestException(
          'Somente eventos de ESTORNO referenciam um pagamento revertido.',
        );
      }
      if (input.comprovanteKey == null && input.declaracaoManual !== true) {
        throw new BadRequestException(
          'Pagamento exige evidência (comprovante) OU indicação explícita de ' +
            'declaração manual (R1.5). Registrar guia ≠ pagamento comprovado.',
        );
      }
    }

    const rows = await this.database.db
      .insert(fiscalPagamentosEventos)
      .values({
        clienteId: input.clienteId,
        guiaId: input.guiaId,
        fechamentoId: guia.fechamentoId,
        tipo: input.tipo,
        origem,
        valor: fromScaledInteger(valor),
        sinal,
        dataEvento: input.dataEvento,
        comprovanteKey: input.comprovanteKey ?? null,
        declaracaoManual: input.declaracaoManual ?? false,
        documentoExterno: input.documentoExterno ?? null,
        eventoEstornadoId: input.eventoEstornadoId ?? null,
        observacao: input.observacao ?? null,
      })
      .returning();
    return this.toEventoResponse(rows[0]);
  }

  /**
   * R1.3 (tarefa 1.4): projeta a TRILHA de pagamentos/estornos de uma guia em
   * ordem cronológica e o SALDO reconstruído da obrigação. O saldo nunca é lido
   * de um campo mutável — é derivado da trilha (`valorTotal − Σ(sinal·valor)`),
   * de modo que a conciliação sempre reflete todos os eventos preservados.
   */
  async trilhaPagamentos(input: { clienteId: string; guiaId: string }) {
    const guia = await this.carregarGuiaDoCliente(
      input.clienteId,
      input.guiaId,
    );
    const eventos = await this.database.db
      .select()
      .from(fiscalPagamentosEventos)
      .where(eq(fiscalPagamentosEventos.guiaId, input.guiaId))
      .orderBy(
        asc(fiscalPagamentosEventos.dataEvento),
        asc(fiscalPagamentosEventos.criadoEm),
      );
    const trilha: EventoPagamentoTrilha[] = eventos.map((evento) => ({
      tipo: evento.tipo as TipoEventoPagamento,
      valor: evento.valor,
      sinal: evento.sinal === -1 ? -1 : 1,
    }));
    const saldo = projetarSaldoObrigacao(guia.valorTotal, trilha);
    return {
      guia_id: input.guiaId,
      cancelada: guia.cancelada,
      emitida_orgao: guia.emitidaOrgao,
      saldo,
      eventos: eventos.map((evento) => this.toEventoResponse(evento)),
    };
  }

  /**
   * R1.4 (tarefa 1.4): CANCELAMENTO LÓGICO em vez de delete físico. "Remover"
   * uma guia NUNCA apaga a linha nem a trilha de pagamentos/estornos vinculada —
   * marca a guia como cancelada, com data e motivo, preservando todo o histórico
   * relevante. Escopado por (id, clienteId): guia de outro cliente não casa o
   * WHERE e é tratada como não encontrada. Idempotente para guia já cancelada.
   */
  async cancelarGuia(input: CancelarGuiaInput) {
    const rows = await this.database.db
      .update(fiscalApuracoesGuias)
      .set({
        cancelada: true,
        canceladaEm: new Date(),
        motivoCancelamento: input.motivo ?? null,
        atualizadoEm: new Date(),
      })
      .where(
        and(
          eq(fiscalApuracoesGuias.id, input.guiaId),
          eq(fiscalApuracoesGuias.clienteId, input.clienteId),
        ),
      )
      .returning();
    if (!rows[0]) throw new NotFoundException('Guia não encontrada.');
    return this.toGuiaResponse(rows[0]);
  }

  /**
   * Carrega a guia escopada por (id, clienteId). Guia de outro cliente ou
   * inexistente é indistinguível — ambas resultam em NotFound (R6.2).
   */
  private async carregarGuiaDoCliente(clienteId: string, guiaId: string) {
    const rows = await this.database.db
      .select()
      .from(fiscalApuracoesGuias)
      .where(
        and(
          eq(fiscalApuracoesGuias.id, guiaId),
          eq(fiscalApuracoesGuias.clienteId, clienteId),
        ),
      )
      .limit(1);
    if (!rows[0]) throw new NotFoundException('Guia não encontrada.');
    return rows[0];
  }

  /**
   * Garante que o evento referenciado por um ESTORNO existe e é da MESMA guia —
   * um estorno não pode reverter um pagamento de outra guia.
   */
  private async assertEventoDaGuia(guiaId: string, eventoId: string) {
    const rows = await this.database.db
      .select({ id: fiscalPagamentosEventos.id })
      .from(fiscalPagamentosEventos)
      .where(
        and(
          eq(fiscalPagamentosEventos.id, eventoId),
          eq(fiscalPagamentosEventos.guiaId, guiaId),
        ),
      )
      .limit(1);
    if (!rows[0]) {
      throw new NotFoundException(
        'Evento de pagamento a estornar não encontrado para esta guia.',
      );
    }
  }

  /**
   * Resumo consolidado de guias por competência: total por tributo e por
   * status de pagamento. Base para o cockpit fiscal.
   */
  async resumoCompetencia(input: { clienteId: string; competencia: string }) {
    const { competencia } = this.competenciaRange(input.competencia);
    const rows = await this.database.db
      .select({
        tributo: fiscalApuracoesGuias.tributo,
        status_pagamento: fiscalApuracoesGuias.statusPagamento,
        total: sql<string>`COALESCE(SUM(${fiscalApuracoesGuias.valorTotal}), 0)`,
        quantidade: sql<number>`COUNT(*)::int`,
      })
      .from(fiscalApuracoesGuias)
      .where(
        and(
          eq(fiscalApuracoesGuias.clienteId, input.clienteId),
          eq(fiscalApuracoesGuias.competencia, competencia),
        ),
      )
      .groupBy(
        fiscalApuracoesGuias.tributo,
        fiscalApuracoesGuias.statusPagamento,
      );
    const totalGeral = rows.reduce(
      (sum, row) => sum + toScaledInteger(row.total),
      0n,
    );
    return {
      competencia,
      total_geral: fromScaledInteger(totalGeral),
      por_tributo_status: rows,
    };
  }

  /**
   * R1.1 / R1.7 (Fase 5, tarefa 1.2): resolve o vínculo da GUIA EMITIDA com a
   * versão de apuração (fechamento da Fase 3), de acordo com a origem.
   *
   * - `MANUAL`: não há obrigação calculada por trás; não exige fechamento. Se
   *   um `fechamentoId` vier por engano, é rejeitado para não registrar um
   *   vínculo de apuração em algo que não nasceu de apuração.
   * - `APURACAO`: a guia foi calculada a partir de um fechamento. O
   *   `fechamentoId` é OBRIGATÓRIO (R1.7) e o fechamento referenciado DEVE
   *   existir e pertencer ao mesmo cliente — isso amarra a guia à versão exata
   *   da apuração, base da conciliação guia ↔ apuração.
   *
   * Retorna o `fechamentoId` validado (ou `null` para guia manual) e o total da
   * OBRIGAÇÃO APURADA projetado do fechamento (`valorObrigacao`, `null` para guia
   * manual) — este último é o valor contra o qual a guia é comparada para
   * sinalizar divergência (R1.2, tarefa 1.3).
   */
  private async resolverVinculoApuracao(
    clienteId: string,
    origem: OrigemGuia,
    fechamentoId: string | undefined,
  ): Promise<{ fechamentoId: string | null; valorObrigacao: string | null }> {
    if (origem === 'MANUAL') {
      if (fechamentoId != null) {
        throw new BadRequestException(
          'Guia de origem MANUAL não deve referenciar uma versão de apuração ' +
            '(fechamento). Informe origem APURACAO para vincular à apuração (R1.1).',
        );
      }
      // Guia manual não tem obrigação apurada por trás: nada do que divergir.
      return { fechamentoId: null, valorObrigacao: null };
    }

    // origem === 'APURACAO'
    if (fechamentoId == null) {
      throw new BadRequestException(
        'Guia de origem APURACAO exige vínculo com a versão de apuração ' +
          '(fechamentoId). Sem ele, a guia calculada ficaria sem rastro da ' +
          'apuração que a originou (R1.7).',
      );
    }

    // Carrega a VERSÃO DE APURAÇÃO completa: além de validar o vínculo (R1.7),
    // os snapshots congelados (`saldos`/`documentos`/`parametros`) são a fonte do
    // total da obrigação a comparar com a guia (R1.2). Escopado por cliente para
    // que uma guia só se vincule a um fechamento do próprio cliente.
    const rows = await this.database.db
      .select()
      .from(fiscalFechamentos)
      .where(
        and(
          eq(fiscalFechamentos.id, fechamentoId),
          eq(fiscalFechamentos.clienteId, clienteId),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw new NotFoundException(
        'Versão de apuração (fechamento) não encontrada para esta empresa. A ' +
          'guia calculada só pode vincular-se a um fechamento do próprio cliente ' +
          '(R1.7).',
      );
    }
    return {
      fechamentoId: row.id,
      valorObrigacao: this.obrigacaoApurada(row),
    };
  }

  /**
   * R1.2 (tarefa 1.3): projeta o total da OBRIGAÇÃO APURADA do snapshot congelado
   * do fechamento, reusando a MESMA projeção do contrato que livros/painéis/SPED
   * consomem (`projetarResultadoApuracao` → `saldoDevedorApurado`). NÃO recomputa
   * nada: o valor sai dos `saldos` congelados da versão de apuração. É o total
   * contra o qual a guia é comparada para sinalizar divergência.
   */
  private obrigacaoApurada(row: typeof fiscalFechamentos.$inferSelect): string {
    const snapshots: FechamentoSnapshots = {
      documentos: row.documentos,
      saldos: row.saldos,
      parametros: row.parametros,
    };
    const apuracao = projetarResultadoApuracao(
      {
        id: row.id,
        clienteId: row.clienteId,
        obrigacao: row.obrigacao as never,
        competencia: row.competencia,
        versao: row.versao,
        estado: row.estado as never,
        corrente: row.corrente,
        motorVersao: row.motorVersao,
        hashEntradas: row.hashEntradas,
        aprovadoPor: row.aprovadoPor,
        fechadoEm: row.fechadoEm,
      },
      snapshots,
    );
    return apuracao.saldoDevedorApurado.valor;
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
   * R1.2 / tarefa 2.3: garante que uma guia de DIFAL (`DIFAL_ENTRADA`/
   * `DIFAL_SAIDA`) só seja criada a partir de um resultado `CALCULADO`.
   *
   * - Para tributos não-DIFAL, não há nada a validar aqui.
   * - Para tributos DIFAL, o `difalStatus` é OBRIGATÓRIO: criar uma guia de
   *   DIFAL sem o estado do cálculo abriria a porta para emitir guia de um item
   *   cujo escopo não foi verificado. Ausência do estado é rejeitada.
   * - Com estado presente, só `CALCULADO` passa; `SIMULACAO`/`PENDENTE` são
   *   barrados com o motivo auditável (nunca guia a partir de simulação/pendência).
   */
  private assertDifalElegivel(input: CriarGuiaInput) {
    if (!TRIBUTOS_DIFAL.has(input.tributo)) return;

    if (input.difalStatus == null) {
      throw new BadRequestException(
        `Guia de ${input.tributo} exige o estado do cálculo do DIFAL ` +
          '(CALCULADO/SIMULACAO/PENDENTE). Sem ele, a emissão é bloqueada ' +
          'para não gerar guia de um item cujo escopo não foi verificado (R1.2).',
      );
    }

    if (!difalPodeGerarGuia(input.difalStatus)) {
      throw new BadRequestException(
        difalMotivoInelegibilidadeGuia(input.difalStatus) ??
          `DIFAL em estado ${input.difalStatus} não pode gerar guia (R1.2).`,
      );
    }
  }

  /**
   * R6.4/R6.3: converte um componente monetário em inteiro escalado, exigindo
   * que seja um decimal não negativo, independentemente do ValidationPipe.
   */
  private parseValorNaoNegativo(valor: string, rotulo: string): bigint {
    let escalado: bigint;
    try {
      escalado = toScaledInteger(valor);
    } catch {
      throw new BadRequestException(`Valor ${rotulo} inválido: "${valor}".`);
    }
    if (escalado < 0n) {
      throw new BadRequestException(
        `O valor ${rotulo} da guia não pode ser negativo.`,
      );
    }
    return escalado;
  }

  private async assertCliente(clienteId: string) {
    const rows = await this.database.db
      .select({ id: clientes.id })
      .from(clientes)
      .where(eq(clientes.id, clienteId))
      .limit(1);
    if (!rows[0]) throw new NotFoundException('Empresa não encontrada.');
  }

  private toGuiaResponse(row: typeof fiscalApuracoesGuias.$inferSelect) {
    return {
      id: row.id,
      cliente_id: row.clienteId,
      competencia: row.competencia,
      tributo: row.tributo,
      uf_favorecida: row.ufFavorecida,
      tipo_guia: row.tipoGuia,
      codigo_receita: row.codigoReceita,
      data_vencimento: row.dataVencimento,
      valor_principal: row.valorPrincipal,
      valor_multa: row.valorMulta,
      valor_juros: row.valorJuros,
      valor_total: row.valorTotal,
      codigo_barras: row.codigoBarras,
      linha_digitavel: row.linhaDigitavel,
      status_pagamento: row.statusPagamento,
      arquivo_guia_key: row.arquivoGuiaKey,
      origem: row.origem,
      fechamento_id: row.fechamentoId,
      divergente_obrigacao: row.divergenteObrigacao,
      valor_obrigacao: row.valorObrigacao,
      cancelada: row.cancelada,
      cancelada_em: row.canceladaEm ? row.canceladaEm.toISOString() : null,
      motivo_cancelamento: row.motivoCancelamento,
      emitida_orgao: row.emitidaOrgao,
      emitida_orgao_em: row.emitidaOrgaoEm
        ? row.emitidaOrgaoEm.toISOString()
        : null,
      idempotency_key: row.idempotencyKey,
      criado_em: row.criadoEm.toISOString(),
      atualizado_em: row.atualizadoEm.toISOString(),
    };
  }

  private toEventoResponse(row: typeof fiscalPagamentosEventos.$inferSelect) {
    return {
      id: row.id,
      cliente_id: row.clienteId,
      guia_id: row.guiaId,
      fechamento_id: row.fechamentoId,
      tipo: row.tipo,
      origem: row.origem,
      valor: row.valor,
      sinal: row.sinal,
      data_evento: row.dataEvento,
      comprovante_key: row.comprovanteKey,
      declaracao_manual: row.declaracaoManual,
      documento_externo: row.documentoExterno,
      evento_estornado_id: row.eventoEstornadoId,
      observacao: row.observacao,
      criado_em: row.criadoEm.toISOString(),
      atualizado_em: row.atualizadoEm.toISOString(),
    };
  }
}
