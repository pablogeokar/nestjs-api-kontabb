import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, lte, or, sql, type SQL } from 'drizzle-orm';
import type { PaginationParams } from '../../common/types';
import { DatabaseService } from '../../database/database.service';
import {
  clientes,
  documentosFiscais,
  documentosFiscaisItens,
} from '../../database/schema';
import {
  simplesNacionalSemApuracaoIcms,
  type RegimeTributario,
} from '../../clientes/clientes.types';
import { FiscalCteService } from './fiscal-cte.service';

const SIMPLES_SEM_APURACAO_OBSERVACAO =
  'Cliente optante pelo Simples Nacional — ICMS recolhido via DAS. Apuração de débito/crédito não aplicável.';

const SIMPLES_C190_OBSERVACAO =
  'Empresa optante pelo Simples Nacional — valores de ICMS apresentados apenas para conferência, sem geração de débitos/créditos.';

interface ItemFilters {
  clienteId?: string;
  documentoId?: string;
  cfop?: string;
  cfopXml?: string;
  tipoOperacao?: 'ENTRADA' | 'SAIDA';
  cst?: string;
  cstIcms?: string;
  csosnIcms?: string;
  cstPis?: string;
  cstCofins?: string;
  ncm?: string;
  codigoProduto?: string;
  dataInicio?: Date;
  dataFim?: Date;
}

@Injectable()
export class FiscalItensService {
  constructor(
    private readonly database: DatabaseService,
    private readonly fiscalCteService?: FiscalCteService,
  ) {}

  async listItens(input: ItemFilters & { pagination: PaginationParams }) {
    const where = this.buildWhere(input);
    const [countRows, rows] = await Promise.all([
      this.database.db
        .select({ count: sql<number>`count(*)` })
        .from(documentosFiscaisItens)
        .innerJoin(
          documentosFiscais,
          eq(documentosFiscais.id, documentosFiscaisItens.documentoFiscalId),
        )
        .where(where),
      this.database.db
        .select({
          item: documentosFiscaisItens,
          dataEmissao: documentosFiscais.dataEmissao,
          chaveAcesso: documentosFiscais.chaveAcesso,
          modelo: documentosFiscais.modelo,
        })
        .from(documentosFiscaisItens)
        .innerJoin(
          documentosFiscais,
          eq(documentosFiscais.id, documentosFiscaisItens.documentoFiscalId),
        )
        .where(where)
        .orderBy(
          desc(documentosFiscais.dataEmissao),
          asc(documentosFiscaisItens.numeroItem),
        )
        .limit(input.pagination.limit)
        .offset(input.pagination.offset),
    ]);

    return {
      total: Number(countRows[0]?.count ?? 0),
      data: rows.map((row) => this.toItemResponse(row)),
    };
  }

  async getC190(input: ItemFilters) {
    const fiscalConfig = await this.getClienteFiscalConfig(input.clienteId);
    const where = this.buildWhere(input, true);
    const cst = sql<string>`CASE WHEN ${documentosFiscaisItens.cstIcms} IS NOT NULL THEN COALESCE(${documentosFiscaisItens.origemMercadoria}, '0') || ${documentosFiscaisItens.cstIcms} ELSE COALESCE(${documentosFiscaisItens.csosnIcms}, '') END`;
    const operacao = sql`COALESCE(${documentosFiscaisItens.valorBrutoProduto}, 0) + COALESCE(${documentosFiscaisItens.valorFrete}, 0) + COALESCE(${documentosFiscaisItens.valorSeguro}, 0) + COALESCE(${documentosFiscaisItens.valorOutrasDespesas}, 0) + COALESCE(${documentosFiscaisItens.valorIcmsSt}, 0) + COALESCE(${documentosFiscaisItens.valorFcpSt}, 0) + COALESCE(${documentosFiscaisItens.valorIpi}, 0) - COALESCE(${documentosFiscaisItens.valorDesconto}, 0)`;

    const rows = await this.database.db
      .select({
        tipo_operacao: documentosFiscaisItens.tipoOperacaoEscriturada,
        documento_fiscal_id: documentosFiscaisItens.documentoFiscalId,
        cst_icms_csosn: cst,
        cfop: documentosFiscaisItens.cfop,
        cfops_xml: sql<
          string[]
        >`array_remove(array_agg(DISTINCT ${documentosFiscaisItens.cfopXml}), NULL)`,
        aliquota_icms: documentosFiscaisItens.aliquotaIcms,
        vl_opr: sql<string>`COALESCE(SUM(${operacao}), 0)`,
        vl_bc_icms: sql<string>`COALESCE(SUM(${documentosFiscaisItens.valorBcIcms}), 0)`,
        vl_icms: sql<string>`COALESCE(SUM(${documentosFiscaisItens.valorIcms}), 0)`,
        vl_bc_icms_st: sql<string>`COALESCE(SUM(${documentosFiscaisItens.valorBcIcmsSt}), 0)`,
        vl_icms_st: sql<string>`COALESCE(SUM(${documentosFiscaisItens.valorIcmsSt}), 0)`,
        vl_red_bc: sql<string>`COALESCE(SUM(GREATEST(COALESCE(${documentosFiscaisItens.valorBrutoProduto}, 0) - COALESCE(${documentosFiscaisItens.valorDesconto}, 0) - COALESCE(${documentosFiscaisItens.valorBcIcms}, 0), 0)), 0)`,
        vl_ipi: sql<string>`COALESCE(SUM(${documentosFiscaisItens.valorIpi}), 0)`,
      })
      .from(documentosFiscaisItens)
      .innerJoin(
        documentosFiscais,
        eq(documentosFiscais.id, documentosFiscaisItens.documentoFiscalId),
      )
      .where(where)
      .groupBy(
        documentosFiscaisItens.documentoFiscalId,
        documentosFiscaisItens.tipoOperacaoEscriturada,
        cst,
        documentosFiscaisItens.cfop,
        documentosFiscaisItens.aliquotaIcms,
      )
      .orderBy(
        documentosFiscaisItens.documentoFiscalId,
        documentosFiscaisItens.tipoOperacaoEscriturada,
        documentosFiscaisItens.cfop,
        documentosFiscaisItens.aliquotaIcms,
      );

    const icmsCompoeApuracao = fiscalConfig
      ? !simplesNacionalSemApuracaoIcms(fiscalConfig)
      : true;
    return {
      data: rows,
      icms_compoe_apuracao: icmsCompoeApuracao,
      observacao: icmsCompoeApuracao ? null : SIMPLES_C190_OBSERVACAO,
    };
  }

  async getProdutos0200(input: ItemFilters) {
    const where = this.buildWhere(input, true);
    const rows = await this.database.db
      .selectDistinctOn(
        [
          documentosFiscaisItens.clienteId,
          documentosFiscais.emitenteCnpjCpf,
          documentosFiscaisItens.codigoProduto,
        ],
        {
          cliente_id: documentosFiscaisItens.clienteId,
          participante_origem: documentosFiscais.emitenteCnpjCpf,
          codigo_produto: documentosFiscaisItens.codigoProduto,
          descricao: documentosFiscaisItens.descricao,
          ncm: documentosFiscaisItens.ncm,
          cest: documentosFiscaisItens.cest,
          unidade_padrao: documentosFiscaisItens.unidadeComercial,
          codigo_ean: documentosFiscaisItens.codigoEan,
          ultima_emissao: documentosFiscais.dataEmissao,
        },
      )
      .from(documentosFiscaisItens)
      .innerJoin(
        documentosFiscais,
        eq(documentosFiscais.id, documentosFiscaisItens.documentoFiscalId),
      )
      .where(where)
      .orderBy(
        documentosFiscaisItens.clienteId,
        documentosFiscais.emitenteCnpjCpf,
        documentosFiscaisItens.codigoProduto,
        desc(documentosFiscais.dataEmissao),
        desc(documentosFiscaisItens.criadoEm),
      );

    return rows.map((row) => ({
      ...row,
      ultima_emissao: row.ultima_emissao.toISOString(),
    }));
  }

  async getResumoLivros(input: ItemFilters) {
    const fiscalConfig = await this.getClienteFiscalConfig(input.clienteId);
    const where = this.buildWhere(input, true);
    const creditoPermitido = sql`(${documentosFiscaisItens.cstIcms} IN ('00', '10', '20', '70') OR ${documentosFiscaisItens.csosnIcms} IN ('101', '201'))`;
    const valorOperacao = sql`COALESCE(${documentosFiscaisItens.valorBrutoProduto}, 0) + COALESCE(${documentosFiscaisItens.valorFrete}, 0) + COALESCE(${documentosFiscaisItens.valorSeguro}, 0) + COALESCE(${documentosFiscaisItens.valorOutrasDespesas}, 0) - COALESCE(${documentosFiscaisItens.valorDesconto}, 0)`;
    const valorSemTributacao = sql`GREATEST(${valorOperacao} - COALESCE(${documentosFiscaisItens.valorBcIcms}, 0), 0)`;
    const isentaOuNaoTributada = sql`(RIGHT(COALESCE(${documentosFiscaisItens.cstIcms}, ''), 2) IN ('40', '41') OR ${documentosFiscaisItens.csosnIcms} IN ('103', '300', '400'))`;

    const rows = await this.database.db
      .select({
        tipo_operacao: documentosFiscaisItens.tipoOperacaoEscriturada,
        cfop: documentosFiscaisItens.cfop,
        aliquota_icms: documentosFiscaisItens.aliquotaIcms,
        valor_contabil: sql<string>`COALESCE(SUM(${valorOperacao}), 0)`,
        valor_produtos: sql<string>`COALESCE(SUM(${documentosFiscaisItens.valorBrutoProduto}), 0)`,
        base_icms: sql<string>`COALESCE(SUM(${documentosFiscaisItens.valorBcIcms}), 0)`,
        icms_creditado_debitado: sql<string>`COALESCE(SUM(CASE WHEN ${documentosFiscaisItens.tipoOperacaoEscriturada} = 'SAIDA' THEN COALESCE(${documentosFiscaisItens.valorIcms}, 0) WHEN ${documentosFiscaisItens.tipoOperacaoEscriturada} = 'ENTRADA' AND ${documentosFiscaisItens.csosnIcms} IN ('101', '201') THEN COALESCE(${documentosFiscaisItens.valorCreditoIcmsSn}, 0) WHEN ${documentosFiscaisItens.tipoOperacaoEscriturada} = 'ENTRADA' AND ${creditoPermitido} THEN COALESCE(${documentosFiscaisItens.valorIcms}, 0) ELSE 0 END), 0)`,
        credito_icms: sql<string>`COALESCE(SUM(CASE WHEN ${documentosFiscaisItens.tipoOperacaoEscriturada} = 'ENTRADA' AND ${documentosFiscaisItens.csosnIcms} IN ('101', '201') THEN COALESCE(${documentosFiscaisItens.valorCreditoIcmsSn}, 0) WHEN ${documentosFiscaisItens.tipoOperacaoEscriturada} = 'ENTRADA' AND ${creditoPermitido} THEN COALESCE(${documentosFiscaisItens.valorIcms}, 0) ELSE 0 END), 0)`,
        debito_icms: sql<string>`COALESCE(SUM(CASE WHEN ${documentosFiscaisItens.tipoOperacaoEscriturada} = 'SAIDA' THEN COALESCE(${documentosFiscaisItens.valorIcms}, 0) ELSE 0 END), 0)`,
        isentas_nao_tributadas: sql<string>`COALESCE(SUM(CASE WHEN ${isentaOuNaoTributada} THEN ${valorSemTributacao} ELSE 0 END), 0)`,
        outras: sql<string>`COALESCE(SUM(CASE WHEN NOT ${isentaOuNaoTributada} THEN ${valorSemTributacao} ELSE 0 END), 0)`,
        base_icms_st: sql<string>`COALESCE(SUM(${documentosFiscaisItens.valorBcIcmsSt}), 0)`,
        icms_st: sql<string>`COALESCE(SUM(${documentosFiscaisItens.valorIcmsSt}), 0)`,
        ipi: sql<string>`COALESCE(SUM(${documentosFiscaisItens.valorIpi}), 0)`,
      })
      .from(documentosFiscaisItens)
      .innerJoin(
        documentosFiscais,
        eq(documentosFiscais.id, documentosFiscaisItens.documentoFiscalId),
      )
      .where(where)
      .groupBy(
        documentosFiscaisItens.tipoOperacaoEscriturada,
        documentosFiscaisItens.cfop,
        documentosFiscaisItens.aliquotaIcms,
      )
      .orderBy(
        documentosFiscaisItens.tipoOperacaoEscriturada,
        documentosFiscaisItens.cfop,
      );

    if (fiscalConfig && simplesNacionalSemApuracaoIcms(fiscalConfig)) {
      return rows.map((row) => ({
        ...row,
        icms_creditado_debitado: '0.00',
        credito_icms: '0.00',
        debito_icms: '0.00',
      }));
    }
    return rows;
  }

  async getApuracaoIcms(input: ItemFilters) {
    const fiscalConfig = await this.getClienteFiscalConfig(input.clienteId);
    if (fiscalConfig && simplesNacionalSemApuracaoIcms(fiscalConfig)) {
      return {
        total_creditos: '0.00',
        total_debitos: '0.00',
        saldo_apurado: '0.00',
        observacao: SIMPLES_SEM_APURACAO_OBSERVACAO,
      };
    }

    const where = this.buildWhere(input, true);
    const creditoPermitido = sql`(${documentosFiscaisItens.cstIcms} IN ('00', '10', '20', '70') OR ${documentosFiscaisItens.csosnIcms} IN ('101', '201'))`;
    const rows = await this.database.db
      .select({
        total_creditos: sql<string>`COALESCE(SUM(CASE WHEN ${documentosFiscaisItens.tipoOperacaoEscriturada} = 'ENTRADA' AND ${documentosFiscaisItens.csosnIcms} IN ('101', '201') THEN COALESCE(${documentosFiscaisItens.valorCreditoIcmsSn}, 0) WHEN ${documentosFiscaisItens.tipoOperacaoEscriturada} = 'ENTRADA' AND ${creditoPermitido} THEN COALESCE(${documentosFiscaisItens.valorIcms}, 0) ELSE 0 END), 0)`,
        total_debitos: sql<string>`COALESCE(SUM(CASE WHEN ${documentosFiscaisItens.tipoOperacaoEscriturada} = 'SAIDA' THEN COALESCE(${documentosFiscaisItens.valorIcms}, 0) ELSE 0 END), 0)`,
        saldo_apurado: sql<string>`COALESCE(SUM(CASE WHEN ${documentosFiscaisItens.tipoOperacaoEscriturada} = 'SAIDA' THEN COALESCE(${documentosFiscaisItens.valorIcms}, 0) WHEN ${documentosFiscaisItens.tipoOperacaoEscriturada} = 'ENTRADA' AND ${documentosFiscaisItens.csosnIcms} IN ('101', '201') THEN -COALESCE(${documentosFiscaisItens.valorCreditoIcmsSn}, 0) WHEN ${documentosFiscaisItens.tipoOperacaoEscriturada} = 'ENTRADA' AND ${creditoPermitido} THEN -COALESCE(${documentosFiscaisItens.valorIcms}, 0) ELSE 0 END), 0)`,
      })
      .from(documentosFiscaisItens)
      .innerJoin(
        documentosFiscais,
        eq(documentosFiscais.id, documentosFiscaisItens.documentoFiscalId),
      )
      .where(where);
    const apuracaoMercadorias = rows[0] ?? {
      total_creditos: '0',
      total_debitos: '0',
      saldo_apurado: '0',
    };
    const creditosFrete =
      input.tipoOperacao === 'SAIDA' || !this.fiscalCteService
        ? '0.00'
        : await this.fiscalCteService.getTotalCreditoIcms({
            clienteId: input.clienteId,
            documentoId: input.documentoId,
            cfop: input.cfop,
            cst: input.cst,
            dataInicio: input.dataInicio,
            dataFim: input.dataFim,
          });
    return {
      total_creditos: addMoney(
        apuracaoMercadorias.total_creditos,
        creditosFrete,
      ),
      total_debitos: normalizeMoney(apuracaoMercadorias.total_debitos),
      saldo_apurado: subtractMoney(
        apuracaoMercadorias.saldo_apurado,
        creditosFrete,
      ),
      creditos_frete_cte: normalizeMoney(creditosFrete),
      observacao: null,
    };
  }

  private async getClienteFiscalConfig(clienteId?: string) {
    if (!clienteId) return null;
    const rows = await this.database.db
      .select({
        regimeTributario: clientes.regimeTributario,
        apuraIcms: clientes.apuraIcms,
      })
      .from(clientes)
      .where(eq(clientes.id, clienteId))
      .limit(1);
    const config = rows[0];
    if (!config) return null;
    return {
      regimeTributario: config.regimeTributario as RegimeTributario | null,
      apuraIcms: config.apuraIcms,
    };
  }

  private buildWhere(
    input: ItemFilters,
    onlyReadyForFiscalBooks = false,
  ): SQL | undefined {
    const conditions: SQL[] = [];
    if (onlyReadyForFiscalBooks) {
      conditions.push(
        eq(documentosFiscais.situacao, 'AUTORIZADA'),
        eq(documentosFiscais.escriturado, true),
        eq(documentosFiscais.escrituracaoStatus, 'ESCRITURADO'),
        eq(documentosFiscaisItens.cfopRevisaoNecessaria, false),
      );
    }
    if (input.clienteId) {
      conditions.push(eq(documentosFiscaisItens.clienteId, input.clienteId));
    }
    if (input.documentoId) {
      conditions.push(
        eq(documentosFiscaisItens.documentoFiscalId, input.documentoId),
      );
    }
    if (input.cfop) {
      conditions.push(eq(documentosFiscaisItens.cfop, input.cfop));
    }
    if (input.cfopXml) {
      conditions.push(eq(documentosFiscaisItens.cfopXml, input.cfopXml));
    }
    if (input.tipoOperacao) {
      conditions.push(
        eq(documentosFiscaisItens.tipoOperacaoEscriturada, input.tipoOperacao),
      );
    }
    if (input.cst) {
      conditions.push(
        or(
          eq(documentosFiscaisItens.cstIcms, input.cst),
          eq(documentosFiscaisItens.csosnIcms, input.cst),
          eq(documentosFiscaisItens.cstPis, input.cst),
          eq(documentosFiscaisItens.cstCofins, input.cst),
        )!,
      );
    }
    if (input.cstIcms) {
      conditions.push(eq(documentosFiscaisItens.cstIcms, input.cstIcms));
    }
    if (input.csosnIcms) {
      conditions.push(eq(documentosFiscaisItens.csosnIcms, input.csosnIcms));
    }
    if (input.cstPis) {
      conditions.push(eq(documentosFiscaisItens.cstPis, input.cstPis));
    }
    if (input.cstCofins) {
      conditions.push(eq(documentosFiscaisItens.cstCofins, input.cstCofins));
    }
    if (input.ncm) {
      conditions.push(eq(documentosFiscaisItens.ncm, input.ncm));
    }
    if (input.codigoProduto) {
      conditions.push(
        eq(documentosFiscaisItens.codigoProduto, input.codigoProduto),
      );
    }
    if (input.dataInicio) {
      conditions.push(gte(documentosFiscais.dataEmissao, input.dataInicio));
    }
    if (input.dataFim) {
      conditions.push(lte(documentosFiscais.dataEmissao, input.dataFim));
    }
    return conditions.length > 0 ? and(...conditions) : undefined;
  }

  private toItemResponse(row: {
    item: typeof documentosFiscaisItens.$inferSelect;
    dataEmissao: Date;
    chaveAcesso: string;
    modelo: string;
  }) {
    const item = row.item;
    return {
      id: item.id,
      documento_fiscal_id: item.documentoFiscalId,
      cliente_id: item.clienteId,
      numero_item: item.numeroItem,
      chave_acesso: row.chaveAcesso,
      modelo: row.modelo,
      data_emissao: row.dataEmissao.toISOString(),
      escrituracao: {
        tipo_operacao: item.tipoOperacaoEscriturada,
        cfop_xml: item.cfopXml,
        cfop: item.cfop,
        revisao_necessaria: item.cfopRevisaoNecessaria,
        destinacao_mercadoria: item.destinacaoMercadoria,
      },
      produto: {
        codigo_produto: item.codigoProduto,
        codigo_ean: item.codigoEan,
        descricao: item.descricao,
        ncm: item.ncm,
        nve: item.nve,
        cest: item.cest,
        ind_escala: item.indEscala,
        cnpj_fabricante: item.cnpjFabricante,
        codigo_beneficio_fiscal: item.codigoBeneficioFiscal,
        cfop_xml: item.cfopXml,
        cfop: item.cfop,
        unidade_comercial: item.unidadeComercial,
        quantidade_comercial: item.quantidadeComercial,
        valor_unitario_comercial: item.valorUnitarioComercial,
        valor_bruto_produto: item.valorBrutoProduto,
        codigo_ean_tributavel: item.codigoEanTributavel,
        unidade_tributavel: item.unidadeTributavel,
        quantidade_tributavel: item.quantidadeTributavel,
        valor_unitario_tributavel: item.valorUnitarioTributavel,
        valor_frete: item.valorFrete,
        valor_seguro: item.valorSeguro,
        valor_desconto: item.valorDesconto,
        valor_outras_despesas: item.valorOutrasDespesas,
        ind_total: item.indTotal,
        numero_pedido_compra: item.numeroPedidoCompra,
        item_pedido_compra: item.itemPedidoCompra,
        informacoes_adicionais: item.informacoesAdicionais,
      },
      icms: {
        origem_mercadoria: item.origemMercadoria,
        cst: item.cstIcms,
        csosn: item.csosnIcms,
        modalidade_bc: item.modalidadeBcIcms,
        percentual_reducao_bc: item.percentualReducaoBcIcms,
        valor_bc: item.valorBcIcms,
        aliquota: item.aliquotaIcms,
        valor: item.valorIcms,
        modalidade_bc_st: item.modalidadeBcIcmsSt,
        percentual_mva_st: item.percentualMvaSt,
        percentual_reducao_bc_st: item.percentualReducaoBcIcmsSt,
        valor_bc_st: item.valorBcIcmsSt,
        aliquota_st: item.aliquotaIcmsSt,
        valor_st: item.valorIcmsSt,
        valor_bc_fcp: item.valorBcFcp,
        aliquota_fcp: item.aliquotaFcp,
        valor_fcp: item.valorFcp,
        valor_bc_fcp_st: item.valorBcFcpSt,
        aliquota_fcp_st: item.aliquotaFcpSt,
        valor_fcp_st: item.valorFcpSt,
        motivo_desoneracao: item.motivoDesoneracaoIcms,
        valor_desonerado: item.valorIcmsDesonerado,
        percentual_diferimento: item.percentualDiferimento,
        valor_diferido: item.valorIcmsDiferido,
        valor_operacao: item.valorIcmsOperacao,
        aliquota_credito_sn: item.aliquotaCreditoSn,
        valor_credito_sn: item.valorCreditoIcmsSn,
        valor_bc_st_retido: item.valorBcIcmsStRetido,
        aliquota_st_retido: item.aliquotaIcmsStRetido,
        valor_st_retido: item.valorIcmsStRetido,
      },
      difal: {
        valor_bc_uf_dest: item.valorBcIcmsUfDest,
        valor_bc_fcp_uf_dest: item.valorBcFcpUfDest,
        percentual_fcp_uf_dest: item.percentualFcpUfDest,
        aliquota_icms_uf_dest: item.aliquotaIcmsUfDest,
        aliquota_icms_interestadual: item.aliquotaIcmsInterestadual,
        percentual_partilha: item.percentualProvisorioPartilha,
        valor_fcp_uf_dest: item.valorFcpUfDest,
        valor_icms_uf_dest: item.valorIcmsUfDest,
        valor_icms_uf_remetente: item.valorIcmsUfRemetente,
      },
      ipi: {
        cst: item.cstIpi,
        classe_enquadramento: item.classeEnquadramentoIpi,
        codigo_enquadramento: item.codigoEnquadramentoIpi,
        cnpj_produtor: item.cnpjProdutorIpi,
        valor_bc: item.valorBcIpi,
        aliquota: item.aliquotaIpi,
        quantidade_unidade: item.quantidadeUnidadeIpi,
        valor_unidade: item.valorUnidadeIpi,
        valor: item.valorIpi,
      },
      pis: {
        cst: item.cstPis,
        valor_bc: item.valorBcPis,
        aliquota_percentual: item.aliquotaPisPercentual,
        quantidade_bc: item.quantidadeBcPis,
        aliquota_reais: item.aliquotaPisReais,
        valor: item.valorPis,
        st: {
          valor_bc: item.valorBcPisSt,
          aliquota_percentual: item.aliquotaPisStPercentual,
          valor: item.valorPisSt,
        },
      },
      cofins: {
        cst: item.cstCofins,
        valor_bc: item.valorBcCofins,
        aliquota_percentual: item.aliquotaCofinsPercentual,
        quantidade_bc: item.quantidadeBcCofins,
        aliquota_reais: item.aliquotaCofinsReais,
        valor: item.valorCofins,
        st: {
          valor_bc: item.valorBcCofinsSt,
          aliquota_percentual: item.aliquotaCofinsStPercentual,
          valor: item.valorCofinsSt,
        },
      },
      totais: {
        valor_bc_ii: item.valorBcIi,
        valor_despesa_aduaneira: item.valorDespesaAduaneira,
        valor_imposto_importacao: item.valorImpostoImportacao,
        valor_iof: item.valorIof,
        valor_tributos_aproximados: item.valorTributosAproximados,
      },
      criado_em: item.criadoEm.toISOString(),
      atualizado_em: item.atualizadoEm.toISOString(),
    };
  }
}

function moneyToCents(value: string) {
  const match = value.trim().match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return 0n;
  const cents =
    BigInt(match[2]) * 100n + BigInt((match[3] ?? '').padEnd(2, '0'));
  return match[1] === '-' ? -cents : cents;
}

function centsToMoney(value: bigint) {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}

function normalizeMoney(value: string) {
  return centsToMoney(moneyToCents(value));
}

function addMoney(first: string, second: string) {
  return centsToMoney(moneyToCents(first) + moneyToCents(second));
}

function subtractMoney(first: string, second: string) {
  return centsToMoney(moneyToCents(first) - moneyToCents(second));
}
