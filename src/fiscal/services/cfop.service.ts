import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  isNull,
  or,
  type SQL,
} from 'drizzle-orm';
import type { PaginationParams } from '../../common/types';
import { DatabaseService } from '../../database/database.service';
import { cfopEquivalencias, cfops, clientes } from '../../database/schema';
import {
  FiscalRuleEngineService,
  type DestinacaoMercadoria,
} from './fiscal-rule-engine.service';

export type TipoOperacaoEscriturada = 'ENTRADA' | 'SAIDA';
export type TipoEquivalencia = 'SAIDA_PARA_ENTRADA' | 'ENTRADA_PARA_SAIDA';
export type AbrangenciaCfop = 'ESTADUAL' | 'INTERESTADUAL' | 'EXTERIOR';

export interface CfopResolvido {
  cfop: string;
  revisaoNecessaria: boolean;
  origemResolucao:
    | 'MANTIDO'
    | 'CLIENTE'
    | 'GLOBAL'
    | 'ALGORITMO'
    | 'FALLBACK'
    | 'REGRA_CLIENTE'
    | 'REGRA_GLOBAL'
    | 'DESTINACAO_NCM';
  motivoRevisao?: 'CFOP_NAO_CADASTRADO' | 'CFOP_DESTINO_NAO_CADASTRADO';
  cfopSugerido?: string;
  // Efeitos tributários resolvidos pelo motor de regras (opcionais para
  // compatibilidade com chamadas legadas que só resolvem o código).
  apropriaCreditoIcms?: boolean;
  apropriaCreditoIpi?: boolean;
  exigeCiap?: boolean;
  exigeDifalEntrada?: boolean;
  regraAplicadaId?: string;
}

export interface CfopItemRevisao {
  numeroItem: number;
  descricao: string | null;
  cfopXml: string;
  cfopAplicado: string;
  cfopSugerido: string;
  motivo: NonNullable<CfopResolvido['motivoRevisao']>;
}

interface CfopMutation {
  codigo: string;
  descricao: string;
  tipoOperacao: TipoOperacaoEscriturada;
  abrangencia: AbrangenciaCfop;
  grupo?: string | null;
  descricaoDetalhada?: string | null;
  ativo?: boolean;
}

interface EquivalenciaMutation {
  clienteId?: string | null;
  cfopOrigem: string;
  cfopDestino: string;
  tipoOperacao: TipoEquivalencia;
  descricao?: string | null;
  ativo?: boolean;
}

@Injectable()
export class CfopService {
  constructor(
    private readonly database: DatabaseService,
    private readonly ruleEngine: FiscalRuleEngineService,
  ) {}

  determinarTipoOperacaoEscriturada(
    clienteCnpjCpf: string,
    emitenteCnpjCpf: string,
    tpNfXml: string,
  ): TipoOperacaoEscriturada {
    const cliente = normalizeTaxId(clienteCnpjCpf);
    const emitente = normalizeTaxId(emitenteCnpjCpf);
    if (!cliente || !emitente || emitente !== cliente) return 'ENTRADA';
    return tpNfXml === '0' ? 'ENTRADA' : 'SAIDA';
  }

  async prepararItensEscrituracao<
    T extends { cfop: string; numeroItem?: number; descricao?: string },
  >(params: {
    clienteId: string;
    clienteCnpjCpf: string;
    emitenteCnpjCpf: string;
    tpNfXml: string;
    itens: T[];
  }) {
    const tipoOperacaoEscriturada = this.determinarTipoOperacaoEscriturada(
      params.clienteCnpjCpf,
      params.emitenteCnpjCpf,
      params.tpNfXml,
    );
    const resolvidos = new Map<string, CfopResolvido>();
    for (const cfopXml of new Set(params.itens.map((item) => item.cfop))) {
      resolvidos.set(
        cfopXml,
        await this.resolverCfopEquivalenteDetalhado({
          clienteId: params.clienteId,
          cfopXml,
          tipoOperacaoEscriturada,
        }),
      );
    }

    const revisoes: CfopItemRevisao[] = [];
    const itens = params.itens.map((item, index) => {
      const resolvido = resolvidos.get(item.cfop);
      if (!resolvido) {
        throw new Error(`CFOP ${item.cfop} não foi resolvido.`);
      }
      if (
        resolvido.revisaoNecessaria &&
        resolvido.motivoRevisao &&
        resolvido.cfopSugerido
      ) {
        revisoes.push({
          numeroItem: item.numeroItem ?? index + 1,
          descricao: item.descricao ?? null,
          cfopXml: item.cfop,
          cfopAplicado: resolvido.cfop,
          cfopSugerido: resolvido.cfopSugerido,
          motivo: resolvido.motivoRevisao,
        });
      }
      return {
        ...item,
        cfopXml: item.cfop,
        cfop: resolvido.cfop,
        tipoOperacaoEscriturada,
        cfopRevisaoNecessaria: resolvido.revisaoNecessaria,
      };
    });

    return {
      tipoOperacaoEscriturada,
      itens,
      revisoes,
    };
  }

  async resolverCfopEquivalente(params: {
    clienteId: string;
    cfopXml: string;
    tipoOperacaoEscriturada: TipoOperacaoEscriturada;
  }): Promise<string> {
    return (await this.resolverCfopEquivalenteDetalhado(params)).cfop;
  }

  async resolverCfopEquivalenteDetalhado(params: {
    clienteId: string;
    cfopXml: string;
    tipoOperacaoEscriturada: TipoOperacaoEscriturada;
    // Contexto opcional para o motor de regras. Quando presente, a resolução
    // usa regras cadastradas + destinação econômica antes do algoritmo linear.
    ncm?: string | null;
    destinacaoMercadoria?: DestinacaoMercadoria | null;
    emitenteCnpjCpf?: string | null;
    emitenteUf?: string | null;
    cstIcmsXml?: string | null;
    csosnXml?: string | null;
  }): Promise<CfopResolvido> {
    // Nova esteira: consulta o motor de regras (regras do cliente/global +
    // destinação econômica). Só recorre à cascata legada quando o motor não
    // encontra correspondência segura.
    const avaliacao = await this.ruleEngine.evaluate({
      clienteId: params.clienteId,
      tipoOperacaoEscriturada: params.tipoOperacaoEscriturada,
      cfopXml: params.cfopXml,
      ncm: params.ncm,
      destinacaoMercadoria: params.destinacaoMercadoria,
      emitenteCnpjCpf: params.emitenteCnpjCpf,
      emitenteUf: params.emitenteUf,
      cstIcmsXml: params.cstIcmsXml,
      csosnXml: params.csosnXml,
    });

    if (
      avaliacao.origemResolucao === 'REGRA_CLIENTE' ||
      avaliacao.origemResolucao === 'REGRA_GLOBAL' ||
      avaliacao.origemResolucao === 'DESTINACAO_NCM'
    ) {
      return {
        cfop: avaliacao.cfopEscriturado,
        revisaoNecessaria: false,
        origemResolucao: avaliacao.origemResolucao,
        apropriaCreditoIcms: avaliacao.apropriaCreditoIcms,
        apropriaCreditoIpi: avaliacao.apropriaCreditoIpi,
        exigeCiap: avaliacao.exigeCiap,
        exigeDifalEntrada: avaliacao.exigeDifalEntrada,
        regraAplicadaId: avaliacao.regraAplicadaId,
      };
    }

    return this.resolverCascataLegada(params);
  }

  private async resolverCascataLegada(params: {
    clienteId: string;
    cfopXml: string;
    tipoOperacaoEscriturada: TipoOperacaoEscriturada;
  }): Promise<CfopResolvido> {
    const cfopXml = normalizeCfop(params.cfopXml);
    const primeiroDigito = cfopXml[0];
    const jaTemSentidoCorreto = this.isDirectionCompatible(
      cfopXml,
      params.tipoOperacaoEscriturada,
    );

    if (jaTemSentidoCorreto && (await this.isCfopAtivo(cfopXml))) {
      return {
        cfop: cfopXml,
        revisaoNecessaria: false,
        origemResolucao: 'MANTIDO',
      };
    }

    const tipoEquivalencia: TipoEquivalencia =
      params.tipoOperacaoEscriturada === 'ENTRADA'
        ? 'SAIDA_PARA_ENTRADA'
        : 'ENTRADA_PARA_SAIDA';
    const customizada = await this.findEquivalencia({
      clienteId: params.clienteId,
      cfopOrigem: cfopXml,
      tipoOperacao: tipoEquivalencia,
    });
    if (customizada && (await this.isCfopAtivo(customizada))) {
      return {
        cfop: customizada,
        revisaoNecessaria: false,
        origemResolucao: 'CLIENTE',
      };
    }

    const global = await this.findEquivalencia({
      clienteId: null,
      cfopOrigem: cfopXml,
      tipoOperacao: tipoEquivalencia,
    });
    if (global && (await this.isCfopAtivo(global))) {
      return {
        cfop: global,
        revisaoNecessaria: false,
        origemResolucao: 'GLOBAL',
      };
    }

    const convertido = convertDirection(
      cfopXml,
      params.tipoOperacaoEscriturada,
    );
    if (convertido !== cfopXml && (await this.isCfopAtivo(convertido))) {
      return {
        cfop: convertido,
        revisaoNecessaria: false,
        origemResolucao: 'ALGORITMO',
      };
    }

    return {
      cfop: fallbackCfop(primeiroDigito, params.tipoOperacaoEscriturada),
      revisaoNecessaria: true,
      origemResolucao: 'FALLBACK',
      motivoRevisao:
        convertido === cfopXml
          ? 'CFOP_NAO_CADASTRADO'
          : 'CFOP_DESTINO_NAO_CADASTRADO',
      cfopSugerido: convertido,
    };
  }

  async listCfops(input: {
    q?: string;
    tipoOperacao?: TipoOperacaoEscriturada;
    abrangencia?: AbrangenciaCfop;
    ativo?: boolean;
    pagination: PaginationParams;
  }) {
    const conditions: SQL[] = [];
    const search = input.q?.trim();
    if (search) {
      conditions.push(
        or(
          ilike(cfops.codigo, `%${search}%`),
          ilike(cfops.descricao, `%${search}%`),
        )!,
      );
    }
    if (input.tipoOperacao) {
      conditions.push(eq(cfops.tipoOperacao, input.tipoOperacao));
    }
    if (input.abrangencia) {
      conditions.push(eq(cfops.abrangencia, input.abrangencia));
    }
    if (input.ativo !== undefined)
      conditions.push(eq(cfops.ativo, input.ativo));
    const where = conditions.length ? and(...conditions) : undefined;

    const [totalRows, rows] = await Promise.all([
      this.database.db.select({ count: count() }).from(cfops).where(where),
      this.database.db
        .select()
        .from(cfops)
        .where(where)
        .orderBy(asc(cfops.codigo))
        .limit(input.pagination.limit)
        .offset(input.pagination.offset),
    ]);
    return { data: rows.map(toCfopResponse), total: totalRows[0]?.count ?? 0 };
  }

  async getCfop(codigo: string) {
    const normalized = normalizeCfop(codigo);
    const rows = await this.database.db
      .select()
      .from(cfops)
      .where(eq(cfops.codigo, normalized))
      .limit(1);
    if (!rows[0]) throw new NotFoundException('CFOP não encontrado.');
    return toCfopResponse(rows[0]);
  }

  async createCfop(input: CfopMutation) {
    this.validateCfopClassification(input);
    try {
      const rows = await this.database.db
        .insert(cfops)
        .values(input)
        .returning();
      return toCfopResponse(rows[0]);
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Já existe um CFOP com este código.');
      }
      throw error;
    }
  }

  async updateCfop(
    codigo: string,
    input: Partial<Omit<CfopMutation, 'codigo'>>,
  ) {
    const normalized = normalizeCfop(codigo);
    const current = await this.getCfop(normalized);
    this.validateCfopClassification({
      codigo: normalized,
      descricao: input.descricao ?? current.descricao,
      tipoOperacao: input.tipoOperacao ?? current.tipo_operacao,
      abrangencia: input.abrangencia ?? current.abrangencia,
    });
    const rows = await this.database.db
      .update(cfops)
      .set({ ...input, atualizadoEm: new Date() })
      .where(eq(cfops.codigo, normalized))
      .returning();
    return toCfopResponse(rows[0]);
  }

  async listEquivalencias(input: {
    clienteId?: string;
    includeGlobal?: boolean;
    ativo?: boolean;
    pagination: PaginationParams;
  }) {
    const conditions: SQL[] = [];
    if (input.clienteId) {
      conditions.push(
        input.includeGlobal
          ? or(
              eq(cfopEquivalencias.clienteId, input.clienteId),
              isNull(cfopEquivalencias.clienteId),
            )!
          : eq(cfopEquivalencias.clienteId, input.clienteId),
      );
    }
    if (input.ativo !== undefined) {
      conditions.push(eq(cfopEquivalencias.ativo, input.ativo));
    }
    const where = conditions.length ? and(...conditions) : undefined;
    const [totalRows, rows] = await Promise.all([
      this.database.db
        .select({ count: count() })
        .from(cfopEquivalencias)
        .where(where),
      this.database.db
        .select({
          id: cfopEquivalencias.id,
          clienteId: cfopEquivalencias.clienteId,
          clienteNome: clientes.razaoSocial,
          cfopOrigem: cfopEquivalencias.cfopOrigem,
          cfopDestino: cfopEquivalencias.cfopDestino,
          tipoOperacao: cfopEquivalencias.tipoOperacao,
          descricao: cfopEquivalencias.descricao,
          ativo: cfopEquivalencias.ativo,
          criadoEm: cfopEquivalencias.criadoEm,
          atualizadoEm: cfopEquivalencias.atualizadoEm,
        })
        .from(cfopEquivalencias)
        .leftJoin(clientes, eq(clientes.id, cfopEquivalencias.clienteId))
        .where(where)
        .orderBy(
          desc(cfopEquivalencias.clienteId),
          asc(cfopEquivalencias.cfopOrigem),
        )
        .limit(input.pagination.limit)
        .offset(input.pagination.offset),
    ]);
    return {
      data: rows.map((row) => ({
        id: row.id,
        cliente_id: row.clienteId,
        cliente_nome: row.clienteNome,
        escopo: row.clienteId ? 'CLIENTE' : 'GLOBAL',
        cfop_origem: row.cfopOrigem,
        cfop_destino: row.cfopDestino,
        tipo_operacao: row.tipoOperacao,
        descricao: row.descricao,
        ativo: row.ativo,
        criado_em: row.criadoEm.toISOString(),
        atualizado_em: row.atualizadoEm.toISOString(),
      })),
      total: totalRows[0]?.count ?? 0,
    };
  }

  async createEquivalencia(input: EquivalenciaMutation) {
    await this.validateEquivalencia(input);
    try {
      const rows = await this.database.db
        .insert(cfopEquivalencias)
        .values({ ...input, clienteId: input.clienteId ?? null })
        .returning();
      return rows[0];
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          'Já existe uma equivalência para este CFOP e escopo.',
        );
      }
      throw error;
    }
  }

  async updateEquivalencia(id: string, input: Partial<EquivalenciaMutation>) {
    const currentRows = await this.database.db
      .select()
      .from(cfopEquivalencias)
      .where(eq(cfopEquivalencias.id, id))
      .limit(1);
    const current = currentRows[0];
    if (!current) throw new NotFoundException('Equivalência não encontrada.');
    const merged: EquivalenciaMutation = {
      clienteId:
        input.clienteId === undefined ? current.clienteId : input.clienteId,
      cfopOrigem: input.cfopOrigem ?? current.cfopOrigem,
      cfopDestino: input.cfopDestino ?? current.cfopDestino,
      tipoOperacao:
        input.tipoOperacao ?? (current.tipoOperacao as TipoEquivalencia),
      descricao:
        input.descricao === undefined ? current.descricao : input.descricao,
      ativo: input.ativo ?? current.ativo,
    };
    await this.validateEquivalencia(merged);
    try {
      const rows = await this.database.db
        .update(cfopEquivalencias)
        .set({ ...merged, atualizadoEm: new Date() })
        .where(eq(cfopEquivalencias.id, id))
        .returning();
      return rows[0];
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          'Já existe uma equivalência para este CFOP e escopo.',
        );
      }
      throw error;
    }
  }

  async deleteEquivalencia(id: string) {
    const rows = await this.database.db
      .delete(cfopEquivalencias)
      .where(eq(cfopEquivalencias.id, id))
      .returning({ id: cfopEquivalencias.id });
    if (!rows[0]) throw new NotFoundException('Equivalência não encontrada.');
  }

  private async findEquivalencia(input: {
    clienteId: string | null;
    cfopOrigem: string;
    tipoOperacao: TipoEquivalencia;
  }) {
    const scopeCondition = input.clienteId
      ? eq(cfopEquivalencias.clienteId, input.clienteId)
      : isNull(cfopEquivalencias.clienteId);
    const rows = await this.database.db
      .select({ cfopDestino: cfopEquivalencias.cfopDestino })
      .from(cfopEquivalencias)
      .where(
        and(
          scopeCondition,
          eq(cfopEquivalencias.cfopOrigem, input.cfopOrigem),
          eq(cfopEquivalencias.tipoOperacao, input.tipoOperacao),
          eq(cfopEquivalencias.ativo, true),
        ),
      )
      .limit(1);
    return rows[0]?.cfopDestino ?? null;
  }

  private async isCfopAtivo(codigo: string) {
    const rows = await this.database.db
      .select({ codigo: cfops.codigo })
      .from(cfops)
      .where(and(eq(cfops.codigo, codigo), eq(cfops.ativo, true)))
      .limit(1);
    return Boolean(rows[0]);
  }

  private isDirectionCompatible(
    codigo: string,
    tipoOperacao: TipoOperacaoEscriturada,
  ) {
    return tipoOperacao === tipoOperacaoFromCodigo(codigo);
  }

  private validateCfopClassification(input: CfopMutation) {
    const codigo = normalizeCfop(input.codigo);
    if (tipoOperacaoFromCodigo(codigo) !== input.tipoOperacao) {
      throw new BadRequestException(
        'O tipo da operação não corresponde ao primeiro dígito do CFOP.',
      );
    }
    if (abrangenciaFromCodigo(codigo) !== input.abrangencia) {
      throw new BadRequestException(
        'A abrangência não corresponde ao primeiro dígito do CFOP.',
      );
    }
  }

  private async validateEquivalencia(input: EquivalenciaMutation) {
    const origem = normalizeCfop(input.cfopOrigem);
    const destino = normalizeCfop(input.cfopDestino);
    if (origem === destino) {
      throw new BadRequestException(
        'Os CFOPs de origem e destino devem diferir.',
      );
    }
    const rows = await this.database.db
      .select({ codigo: cfops.codigo, tipoOperacao: cfops.tipoOperacao })
      .from(cfops)
      .where(or(eq(cfops.codigo, origem), eq(cfops.codigo, destino)))
      .orderBy(asc(cfops.codigo));
    const origemRow = rows.find((row) => row.codigo === origem);
    const destinoRow = rows.find((row) => row.codigo === destino);
    if (!origemRow || !destinoRow) {
      throw new BadRequestException(
        'Os CFOPs de origem e destino devem existir na tabela canônica.',
      );
    }
    const expected =
      input.tipoOperacao === 'SAIDA_PARA_ENTRADA'
        ? ['SAIDA', 'ENTRADA']
        : ['ENTRADA', 'SAIDA'];
    if (
      origemRow.tipoOperacao !== expected[0] ||
      destinoRow.tipoOperacao !== expected[1]
    ) {
      throw new BadRequestException(
        'A direção dos CFOPs é incompatível com o tipo da equivalência.',
      );
    }
    if (input.clienteId) {
      const clienteRows = await this.database.db
        .select({ id: clientes.id })
        .from(clientes)
        .where(eq(clientes.id, input.clienteId))
        .limit(1);
      if (!clienteRows[0])
        throw new BadRequestException('Empresa não encontrada.');
    }
  }
}

function normalizeTaxId(value: string) {
  return value.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
}

function normalizeCfop(value: string) {
  const codigo = value.replace(/\D/g, '');
  if (!/^[123567]\d{3}$/.test(codigo)) {
    throw new BadRequestException('CFOP deve conter quatro dígitos válidos.');
  }
  return codigo;
}

function tipoOperacaoFromCodigo(codigo: string): TipoOperacaoEscriturada {
  return ['1', '2', '3'].includes(codigo[0]) ? 'ENTRADA' : 'SAIDA';
}

function abrangenciaFromCodigo(codigo: string): AbrangenciaCfop {
  if (['1', '5'].includes(codigo[0])) return 'ESTADUAL';
  if (['2', '6'].includes(codigo[0])) return 'INTERESTADUAL';
  return 'EXTERIOR';
}

function convertDirection(cfop: string, tipoOperacao: TipoOperacaoEscriturada) {
  const mappings =
    tipoOperacao === 'ENTRADA'
      ? { '5': '1', '6': '2', '7': '3' }
      : { '1': '5', '2': '6', '3': '7' };
  const prefix = mappings[cfop[0] as keyof typeof mappings];
  return prefix ? `${prefix}${cfop.slice(1)}` : cfop;
}

function fallbackCfop(
  sourcePrefix: string,
  tipoOperacao: TipoOperacaoEscriturada,
) {
  if (tipoOperacao === 'ENTRADA') {
    if (sourcePrefix === '6') return '2949';
    if (sourcePrefix === '7') return '3949';
    return '1949';
  }
  if (sourcePrefix === '2') return '6949';
  if (sourcePrefix === '3') return '7949';
  return '5949';
}

function toCfopResponse(row: typeof cfops.$inferSelect) {
  return {
    codigo: row.codigo,
    descricao: row.descricao,
    tipo_operacao: row.tipoOperacao as TipoOperacaoEscriturada,
    abrangencia: row.abrangencia as AbrangenciaCfop,
    grupo: row.grupo,
    descricao_detalhada: row.descricaoDetalhada,
    ativo: row.ativo,
    criado_em: row.criadoEm.toISOString(),
    atualizado_em: row.atualizadoEm.toISOString(),
  };
}

function isUniqueViolation(error: unknown) {
  const candidate = error as {
    code?: string;
    cause?: { code?: string };
  } | null;
  return candidate?.code === '23505' || candidate?.cause?.code === '23505';
}
