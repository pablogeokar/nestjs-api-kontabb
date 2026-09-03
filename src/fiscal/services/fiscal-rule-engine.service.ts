import { Injectable } from '@nestjs/common';
import { and, asc, eq, isNull, or, type SQL } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service';
import { cfops, regrasFiscais } from '../../database/schema';
import type { AbrangenciaCfop, TipoOperacaoEscriturada } from './cfop.service';

export type DestinacaoMercadoria =
  'REVENDA' | 'INDUSTRIALIZACAO' | 'USO_CONSUMO' | 'ATIVO_IMOBILIZADO';

export type CategoriaFiscalCfop =
  | 'COMPRA_REVENDA'
  | 'COMPRA_INSUMO'
  | 'USO_CONSUMO'
  | 'ATIVO_IMOBILIZADO'
  | 'DEVOLUCAO'
  | 'TRANSFERENCIA'
  | 'REMESSA_RETORNO'
  | 'PRESTACAO_SERVICO'
  | 'OUTRAS';

export type OrigemResolucaoRegra =
  | 'REGRA_CLIENTE'
  | 'REGRA_GLOBAL'
  | 'DESTINACAO_NCM'
  | 'MANTIDO'
  | 'EQUIVALENCIA'
  | 'ALGORITMO'
  | 'PENDENTE_CLASSIFICACAO';

export interface RuleEvaluationInput {
  clienteId: string;
  tipoOperacaoEscriturada: TipoOperacaoEscriturada;
  cfopXml: string;
  ncm?: string | null;
  destinacaoMercadoria?: DestinacaoMercadoria | null;
  emitenteCnpjCpf?: string | null;
  emitenteUf?: string | null;
  cstIcmsXml?: string | null;
  csosnXml?: string | null;
  valorIcmsXml?: string | null;
  valorIpiXml?: string | null;
}

export interface RuleEvaluationResult {
  cfopEscriturado: string;
  cstIcmsEscriturado?: string | null;
  csosnEscriturado?: string | null;
  apropriaCreditoIcms: boolean;
  apropriaCreditoIpi: boolean;
  exigeCiap: boolean;
  exigeDifalEntrada: boolean;
  pendenteClassificacao: boolean;
  origemResolucao: OrigemResolucaoRegra;
  motivoResolucao: string;
  regraAplicadaId?: string;
  cfopSugerido?: string;
}

type CfopRow = typeof cfops.$inferSelect;
type RegraRow = typeof regrasFiscais.$inferSelect;

/**
 * Motor de regras fiscais. Substitui a conversão linear de CFOP (troca do 1º
 * dígito) por uma resolução contextual em cascata:
 *
 *   1. Regra específica do cliente (regras_fiscais.cliente_id = X)
 *   2. Regra global (regras_fiscais.cliente_id = NULL)
 *   3. Destinação econômica + NCM (mapa canônico por categoria)
 *   4. CFOP já no sentido correto (MANTIDO)
 *   5. Algoritmo de troca de dígito quando o destino existe no catálogo
 *   6. Alerta assistido / PENDENTE_CLASSIFICACAO (não altera cegamente)
 *
 * O direito a crédito de ICMS/IPI é derivado da categoria fiscal do CFOP
 * escriturado (uso/consumo e ST-substituído NÃO geram crédito — LC 87/96
 * art. 33, I e Convênio ICMS 142/18), salvo sobrescrita explícita por regra.
 */
@Injectable()
export class FiscalRuleEngineService {
  constructor(private readonly database: DatabaseService) {}

  async evaluate(input: RuleEvaluationInput): Promise<RuleEvaluationResult> {
    const cfopXml = normalizeCfop(input.cfopXml);

    // 1 + 2. Regras cadastradas (cliente tem prioridade sobre global).
    const regra = await this.findMatchingRule(input, cfopXml);
    if (regra) {
      const destino = await this.getCfop(regra.cfopDestino);
      return this.buildFromRule(regra, destino);
    }

    // 3. Destinação econômica declarada pelo usuário.
    if (input.destinacaoMercadoria) {
      const porDestinacao = await this.resolvePorDestinacao(
        cfopXml,
        input.tipoOperacaoEscriturada,
        input.destinacaoMercadoria,
      );
      if (porDestinacao) return porDestinacao;
    }

    // 4. CFOP já está no sentido correto e ativo.
    if (
      tipoOperacaoFromCodigo(cfopXml) === input.tipoOperacaoEscriturada &&
      (await this.isCfopAtivo(cfopXml))
    ) {
      const row = await this.getCfop(cfopXml);
      return this.buildFromCatalog(
        cfopXml,
        row,
        'MANTIDO',
        'CFOP já compatível com o sentido da operação.',
      );
    }

    // 5. Algoritmo de troca de direção quando o destino existir no catálogo.
    const convertido = convertDirection(cfopXml, input.tipoOperacaoEscriturada);
    if (convertido !== cfopXml && (await this.isCfopAtivo(convertido))) {
      const row = await this.getCfop(convertido);
      return this.buildFromCatalog(
        convertido,
        row,
        'ALGORITMO',
        `CFOP convertido de ${cfopXml} por equivalência de direção.`,
      );
    }

    // 6. Sem correspondência segura: marca para revisão, sem alterar cegamente.
    return {
      cfopEscriturado: fallbackCfop(cfopXml[0], input.tipoOperacaoEscriturada),
      apropriaCreditoIcms: false,
      apropriaCreditoIpi: false,
      exigeCiap: false,
      exigeDifalEntrada: false,
      pendenteClassificacao: true,
      origemResolucao: 'PENDENTE_CLASSIFICACAO',
      motivoResolucao:
        'Nenhuma regra ou equivalência encontrada. Item requer classificação manual.',
      cfopSugerido: convertido !== cfopXml ? convertido : undefined,
    };
  }

  private async findMatchingRule(
    input: RuleEvaluationInput,
    cfopXml: string,
  ): Promise<RegraRow | null> {
    // Busca candidatas do cliente e globais; ordena por escopo (cliente antes
    // de global) e prioridade (menor número = maior prioridade).
    const escopo: SQL = or(
      eq(regrasFiscais.clienteId, input.clienteId),
      isNull(regrasFiscais.clienteId),
    )!;

    const candidatas = await this.database.db
      .select()
      .from(regrasFiscais)
      .where(and(escopo, eq(regrasFiscais.ativo, true)))
      .orderBy(asc(regrasFiscais.prioridade));

    const cliente = candidatas
      .filter((r) => r.clienteId === input.clienteId)
      .sort((a, b) => a.prioridade - b.prioridade);
    const global = candidatas
      .filter((r) => r.clienteId === null)
      .sort((a, b) => a.prioridade - b.prioridade);

    for (const regra of [...cliente, ...global]) {
      if (this.ruleMatches(regra, input, cfopXml)) return regra;
    }
    return null;
  }

  private ruleMatches(
    regra: RegraRow,
    input: RuleEvaluationInput,
    cfopXml: string,
  ): boolean {
    if (
      regra.tipoOperacaoOrigem &&
      regra.tipoOperacaoOrigem !== input.tipoOperacaoEscriturada
    ) {
      return false;
    }
    if (regra.cfopOrigem && normalizeCfop(regra.cfopOrigem) !== cfopXml) {
      return false;
    }
    if (regra.ncm && normalizeNcm(regra.ncm) !== normalizeNcm(input.ncm)) {
      return false;
    }
    if (
      regra.cstIcmsOrigem &&
      regra.cstIcmsOrigem !== normalizeCst(input.cstIcmsXml)
    ) {
      return false;
    }
    if (
      regra.csosnOrigem &&
      regra.csosnOrigem !== normalizeCst(input.csosnXml)
    ) {
      return false;
    }
    if (
      regra.fornecedorCnpjCpf &&
      normalizeTaxId(regra.fornecedorCnpjCpf) !==
        normalizeTaxId(input.emitenteCnpjCpf)
    ) {
      return false;
    }
    if (
      regra.ufOrigem &&
      regra.ufOrigem.toUpperCase() !== (input.emitenteUf ?? '').toUpperCase()
    ) {
      return false;
    }
    if (
      regra.destinacaoMercadoria &&
      regra.destinacaoMercadoria !== input.destinacaoMercadoria
    ) {
      return false;
    }
    return true;
  }

  private buildFromRule(
    regra: RegraRow,
    destino: CfopRow | null,
  ): RuleEvaluationResult {
    // A regra pode sobrescrever explicitamente o crédito; se não, usa a
    // categoria do CFOP de destino como fonte de verdade.
    const creditoIcms = regra.apropriaCreditoIcms;
    return {
      cfopEscriturado: regra.cfopDestino,
      cstIcmsEscriturado: regra.cstIcmsDestino,
      csosnEscriturado: regra.csosnDestino,
      apropriaCreditoIcms:
        creditoIcms && (destino ? destino.geraCreditoIcmsPadrao : true),
      apropriaCreditoIpi: regra.apropriaCreditoIpi,
      exigeCiap: regra.exigeCiap,
      exigeDifalEntrada: regra.exigeDifalEntrada,
      pendenteClassificacao: false,
      origemResolucao: regra.clienteId ? 'REGRA_CLIENTE' : 'REGRA_GLOBAL',
      motivoResolucao: `Regra "${regra.nomeRegra}" aplicada.`,
      regraAplicadaId: regra.id,
    };
  }

  private async resolvePorDestinacao(
    cfopXml: string,
    tipoOperacao: TipoOperacaoEscriturada,
    destinacao: DestinacaoMercadoria,
  ): Promise<RuleEvaluationResult | null> {
    // Só aplicamos a destinação em ENTRADAS (compras). Em saídas, a destinação
    // do adquirente não é do emitente e não deve reescrever o CFOP.
    if (tipoOperacao !== 'ENTRADA') return null;

    const abrangencia = abrangenciaFromCodigo(cfopXml);
    const alvo = destinacaoParaCfop(destinacao, abrangencia);
    if (!alvo) return null;
    if (!(await this.isCfopAtivo(alvo))) return null;

    const row = await this.getCfop(alvo);
    return this.buildFromCatalog(
      alvo,
      row,
      'DESTINACAO_NCM',
      `Destinação ${destinacao} → CFOP ${alvo}.`,
    );
  }

  private buildFromCatalog(
    codigo: string,
    row: CfopRow | null,
    origem: OrigemResolucaoRegra,
    motivo: string,
  ): RuleEvaluationResult {
    const categoria = (row?.categoriaFiscal ?? 'OUTRAS') as CategoriaFiscalCfop;
    const creditoIcms = row?.geraCreditoIcmsPadrao ?? false;
    return {
      cfopEscriturado: codigo,
      apropriaCreditoIcms: creditoIcms,
      // IPI: crédito nas entradas de insumo/revenda (RIPI). Uso/consumo e ativo
      // não geram crédito de IPI para não-industrial; deixamos conservador.
      apropriaCreditoIpi:
        tipoOperacaoFromCodigo(codigo) === 'ENTRADA' &&
        (categoria === 'COMPRA_INSUMO' || categoria === 'COMPRA_REVENDA'),
      exigeCiap:
        tipoOperacaoFromCodigo(codigo) === 'ENTRADA' &&
        categoria === 'ATIVO_IMOBILIZADO',
      exigeDifalEntrada:
        abrangenciaFromCodigo(codigo) === 'INTERESTADUAL' &&
        (categoria === 'USO_CONSUMO' || categoria === 'ATIVO_IMOBILIZADO'),
      pendenteClassificacao: false,
      origemResolucao: origem,
      motivoResolucao: motivo,
    };
  }

  private async getCfop(codigo: string): Promise<CfopRow | null> {
    const rows = await this.database.db
      .select()
      .from(cfops)
      .where(eq(cfops.codigo, normalizeCfop(codigo)))
      .limit(1);
    return rows[0] ?? null;
  }

  private async isCfopAtivo(codigo: string): Promise<boolean> {
    const rows = await this.database.db
      .select({ codigo: cfops.codigo })
      .from(cfops)
      .where(and(eq(cfops.codigo, codigo), eq(cfops.ativo, true)))
      .limit(1);
    return Boolean(rows[0]);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mapa canônico: destinação econômica → CFOP de entrada por abrangência.
// ─────────────────────────────────────────────────────────────────────────────

function destinacaoParaCfop(
  destinacao: DestinacaoMercadoria,
  abrangencia: AbrangenciaCfop,
): string | null {
  const prefixo =
    abrangencia === 'ESTADUAL'
      ? '1'
      : abrangencia === 'INTERESTADUAL'
        ? '2'
        : '3';
  const finais: Record<DestinacaoMercadoria, string> = {
    REVENDA: '102',
    INDUSTRIALIZACAO: '101',
    USO_CONSUMO: '556',
    ATIVO_IMOBILIZADO: '551',
  };
  // Não há 3556/3551 padrão? Existem (importação). Mantemos.
  return `${prefixo}${finais[destinacao]}`;
}

function normalizeCfop(value: string): string {
  const codigo = (value ?? '').replace(/\D/g, '');
  return codigo;
}

function normalizeNcm(value?: string | null): string {
  return (value ?? '').replace(/\D/g, '');
}

function normalizeCst(value?: string | null): string {
  return (value ?? '').replace(/\D/g, '');
}

function normalizeTaxId(value?: string | null): string {
  return (value ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
}

function tipoOperacaoFromCodigo(codigo: string): TipoOperacaoEscriturada {
  return ['1', '2', '3'].includes(codigo[0]) ? 'ENTRADA' : 'SAIDA';
}

function abrangenciaFromCodigo(codigo: string): AbrangenciaCfop {
  if (['1', '5'].includes(codigo[0])) return 'ESTADUAL';
  if (['2', '6'].includes(codigo[0])) return 'INTERESTADUAL';
  return 'EXTERIOR';
}

function convertDirection(
  cfop: string,
  tipoOperacao: TipoOperacaoEscriturada,
): string {
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
): string {
  if (tipoOperacao === 'ENTRADA') {
    if (sourcePrefix === '6') return '2949';
    if (sourcePrefix === '7') return '3949';
    return '1949';
  }
  if (sourcePrefix === '2') return '6949';
  if (sourcePrefix === '3') return '7949';
  return '5949';
}
