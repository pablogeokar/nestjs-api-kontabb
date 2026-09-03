import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, isNull, or, type SQL } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service';
import {
  clientes,
  documentosFiscais,
  documentosFiscaisItens,
  regrasFiscais,
} from '../../database/schema';
import { CfopService } from './cfop.service';
import {
  FiscalRuleEngineService,
  type DestinacaoMercadoria,
} from './fiscal-rule-engine.service';

type RegraRow = typeof regrasFiscais.$inferSelect;

interface RegraMutation {
  clienteId: string | null;
  nomeRegra: string;
  prioridade?: number;
  tipoOperacaoOrigem?: string | null;
  cfopOrigem?: string | null;
  ncm?: string | null;
  fornecedorCnpjCpf?: string | null;
  ufOrigem?: string | null;
  destinacaoMercadoria?: string | null;
  cfopDestino: string;
  apropriaCreditoIcms?: boolean;
  apropriaCreditoIpi?: boolean;
  exigeCiap?: boolean;
  exigeDifalEntrada?: boolean;
  observacaoFiscal?: string | null;
  ativo?: boolean;
}

@Injectable()
export class RegrasFiscaisService {
  constructor(
    private readonly database: DatabaseService,
    private readonly ruleEngine: FiscalRuleEngineService,
    private readonly cfopService: CfopService,
  ) {}

  /**
   * Simula a resolução de CFOP do motor de regras sem persistir nada.
   * Base do simulador em tempo real do painel de regras.
   */
  async simular(input: {
    clienteId: string;
    tipoOperacaoEscriturada: 'ENTRADA' | 'SAIDA';
    cfopXml: string;
    ncm?: string | null;
    destinacaoMercadoria?: DestinacaoMercadoria | null;
    emitenteCnpjCpf?: string | null;
    emitenteUf?: string | null;
    cstIcmsXml?: string | null;
    csosnXml?: string | null;
  }) {
    return this.ruleEngine.evaluate(input);
  }

  async listar(input: { clienteId: string; includeGlobal?: boolean }) {
    const escopo: SQL = input.includeGlobal
      ? or(
          eq(regrasFiscais.clienteId, input.clienteId),
          isNull(regrasFiscais.clienteId),
        )!
      : eq(regrasFiscais.clienteId, input.clienteId);
    const rows = await this.database.db
      .select()
      .from(regrasFiscais)
      .where(escopo)
      .orderBy(asc(regrasFiscais.prioridade), asc(regrasFiscais.nomeRegra));
    return { data: rows.map((row) => this.toResponse(row)) };
  }

  async listarGlobais() {
    const rows = await this.database.db
      .select()
      .from(regrasFiscais)
      .where(isNull(regrasFiscais.clienteId))
      .orderBy(asc(regrasFiscais.prioridade), asc(regrasFiscais.nomeRegra));
    return { data: rows.map((row) => this.toResponse(row)) };
  }

  async criar(input: RegraMutation) {
    await this.validar(input);
    const rows = await this.database.db
      .insert(regrasFiscais)
      .values({
        clienteId: input.clienteId,
        nomeRegra: input.nomeRegra,
        prioridade: input.prioridade ?? 100,
        tipoOperacaoOrigem: input.tipoOperacaoOrigem ?? null,
        cfopOrigem: input.cfopOrigem ?? null,
        ncm: input.ncm ?? null,
        fornecedorCnpjCpf: input.fornecedorCnpjCpf ?? null,
        ufOrigem: input.ufOrigem?.toUpperCase() ?? null,
        destinacaoMercadoria: input.destinacaoMercadoria ?? null,
        cfopDestino: input.cfopDestino,
        apropriaCreditoIcms: input.apropriaCreditoIcms ?? false,
        apropriaCreditoIpi: input.apropriaCreditoIpi ?? false,
        exigeCiap: input.exigeCiap ?? false,
        exigeDifalEntrada: input.exigeDifalEntrada ?? false,
        observacaoFiscal: input.observacaoFiscal ?? null,
        ativo: input.ativo ?? true,
      })
      .returning();
    return this.toResponse(rows[0]);
  }

  async atualizar(input: {
    id: string;
    clienteId: string | null;
    patch: Partial<Omit<RegraMutation, 'clienteId'>>;
  }) {
    const atual = await this.buscarRegra(input.id, input.clienteId);
    if (input.patch.cfopDestino) {
      await this.assertCfopAtivo(input.patch.cfopDestino);
    }
    const rows = await this.database.db
      .update(regrasFiscais)
      .set({
        ...this.sanitizePatch(input.patch),
        atualizadoEm: new Date(),
      })
      .where(eq(regrasFiscais.id, atual.id))
      .returning();
    return this.toResponse(rows[0]);
  }

  async remover(input: { id: string; clienteId: string | null }) {
    const atual = await this.buscarRegra(input.id, input.clienteId);
    await this.database.db
      .delete(regrasFiscais)
      .where(eq(regrasFiscais.id, atual.id));
  }

  /**
   * Define (ou limpa, com 'AUTOMATICA') a destinação de um item e re-resolve o
   * CFOP escriturado via motor de regras. Retorna o item atualizado.
   */
  async definirDestinacaoItem(input: {
    clienteId: string;
    itemId: string;
    destinacao: DestinacaoMercadoria | 'AUTOMATICA';
  }) {
    const itens = await this.database.db
      .select({
        item: documentosFiscaisItens,
        emitenteCnpjCpf: documentosFiscais.emitenteCnpjCpf,
      })
      .from(documentosFiscaisItens)
      .innerJoin(
        documentosFiscais,
        eq(documentosFiscais.id, documentosFiscaisItens.documentoFiscalId),
      )
      .where(
        and(
          eq(documentosFiscaisItens.id, input.itemId),
          eq(documentosFiscaisItens.clienteId, input.clienteId),
        ),
      )
      .limit(1);
    const registro = itens[0];
    if (!registro) throw new NotFoundException('Item fiscal não encontrado.');
    const item = registro.item;

    const destinacao =
      input.destinacao === 'AUTOMATICA' ? null : input.destinacao;
    const cfopXml = item.cfopXml ?? item.cfop;

    const resolvido = await this.cfopService.resolverCfopEquivalenteDetalhado({
      clienteId: input.clienteId,
      cfopXml,
      tipoOperacaoEscriturada: item.tipoOperacaoEscriturada as
        'ENTRADA' | 'SAIDA',
      ncm: item.ncm,
      destinacaoMercadoria: destinacao,
      emitenteCnpjCpf: registro.emitenteCnpjCpf,
      cstIcmsXml: item.cstIcms,
      csosnXml: item.csosnIcms,
    });

    const rows = await this.database.db
      .update(documentosFiscaisItens)
      .set({
        destinacaoMercadoria: destinacao,
        cfop: resolvido.cfop,
        cfopRevisaoNecessaria: resolvido.revisaoNecessaria,
        atualizadoEm: new Date(),
      })
      .where(eq(documentosFiscaisItens.id, item.id))
      .returning();

    return {
      id: rows[0].id,
      cfop: rows[0].cfop,
      cfop_xml: rows[0].cfopXml,
      destinacao_mercadoria: rows[0].destinacaoMercadoria,
      cfop_revisao_necessaria: rows[0].cfopRevisaoNecessaria,
      origem_resolucao: resolvido.origemResolucao,
      apropria_credito_icms: resolvido.apropriaCreditoIcms ?? null,
      apropria_credito_ipi: resolvido.apropriaCreditoIpi ?? null,
      exige_ciap: resolvido.exigeCiap ?? null,
      exige_difal_entrada: resolvido.exigeDifalEntrada ?? null,
    };
  }

  private async buscarRegra(
    id: string,
    clienteId: string | null,
  ): Promise<RegraRow> {
    const rows = await this.database.db
      .select()
      .from(regrasFiscais)
      .where(eq(regrasFiscais.id, id))
      .limit(1);
    const regra = rows[0];
    if (!regra) throw new NotFoundException('Regra fiscal não encontrada.');
    // Cliente só administra as próprias regras; admin (clienteId null) só as
    // globais quando o escopo assim exigir.
    if (clienteId !== null && regra.clienteId !== clienteId) {
      throw new NotFoundException('Regra fiscal não encontrada.');
    }
    if (clienteId === null && regra.clienteId !== null) {
      throw new NotFoundException('Regra fiscal não encontrada.');
    }
    return regra;
  }

  private async validar(input: RegraMutation) {
    await this.assertCfopAtivo(input.cfopDestino);
    if (input.clienteId) {
      const rows = await this.database.db
        .select({ id: clientes.id })
        .from(clientes)
        .where(eq(clientes.id, input.clienteId))
        .limit(1);
      if (!rows[0]) throw new BadRequestException('Empresa não encontrada.');
    }
  }

  private async assertCfopAtivo(codigo: string) {
    // getCfop lança NotFound quando o CFOP não existe.
    await this.cfopService.getCfop(codigo);
  }

  private sanitizePatch(patch: Partial<Omit<RegraMutation, 'clienteId'>>) {
    const clean: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      clean[key] =
        key === 'ufOrigem' && typeof value === 'string'
          ? value.toUpperCase()
          : value;
    }
    return clean;
  }

  private toResponse(row: RegraRow) {
    return {
      id: row.id,
      cliente_id: row.clienteId,
      escopo: row.clienteId ? ('CLIENTE' as const) : ('GLOBAL' as const),
      prioridade: row.prioridade,
      nome_regra: row.nomeRegra,
      tipo_operacao_origem: row.tipoOperacaoOrigem,
      cfop_origem: row.cfopOrigem,
      ncm: row.ncm,
      cst_icms_origem: row.cstIcmsOrigem,
      csosn_origem: row.csosnOrigem,
      fornecedor_cnpj_cpf: row.fornecedorCnpjCpf,
      uf_origem: row.ufOrigem,
      destinacao_mercadoria: row.destinacaoMercadoria,
      cfop_destino: row.cfopDestino,
      apropria_credito_icms: row.apropriaCreditoIcms,
      apropria_credito_ipi: row.apropriaCreditoIpi,
      exige_ciap: row.exigeCiap,
      exige_difal_entrada: row.exigeDifalEntrada,
      observacao_fiscal: row.observacaoFiscal,
      ativo: row.ativo,
      criado_em: row.criadoEm.toISOString(),
      atualizado_em: row.atualizadoEm.toISOString(),
    };
  }
}
