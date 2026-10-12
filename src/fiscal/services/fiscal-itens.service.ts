import { alias } from 'drizzle-orm/pg-core';
import { descricaoCst } from './cst-catalogo';
import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, lte, or, sql, type SQL } from 'drizzle-orm';
import type { PaginationParams } from '../../common/types';
import { DatabaseService } from '../../database/database.service';
import {
  cfops,
  clientes,
  documentosFiscais,
  documentosFiscaisItens,
} from '../../database/schema';
import { type RegimeTributario } from '../../clientes/clientes.types';
import {
  apuraIcmsProprioParaConsumidores,
  competenciaDeIntervalo,
} from './politica-simples';
import { FiscalCteService } from './fiscal-cte.service';
import { convertDirection } from './cfop.service';
import {
  aggregateC190Analitico,
  normalizeC190Cst,
  type C190ItemInput,
} from '../sped/fiscal-c190-aggregator';
import { fromScaledInteger } from '../sped/sped-decimal';
import {
  CFOP_FINAIS_VEDA_CREDITO,
  CFOP_PREFIXOS_ENTRADA,
  CSOSN_ICMS_PERMITE_CREDITO,
  CST_ICMS_ENTRADA_CREDITO,
} from './decisao-credito';

const cfopsXml = alias(cfops, 'cfops_xml_descricao');

const SIMPLES_SEM_APURACAO_OBSERVACAO =
  'Cliente optante pelo Simples Nacional — ICMS recolhido via DAS. Apuração de débito/crédito não aplicável.';

const SIMPLES_C190_OBSERVACAO =
  'Empresa optante pelo Simples Nacional — valores de ICMS apresentados apenas para conferência, sem geração de débitos/créditos.';

/**
 * Observação padrão dos resumos DOCUMENTAIS (C190/livros por CFOP). Estes
 * resumos derivam o ICMS diretamente dos documentos e NÃO representam o imposto
 * final apurado a recolher (R7.3): ainda não incorporam ajustes E111, saldo
 * credor anterior, deduções, CIAP, débito de CT-e frete, nem consideram itens
 * pendentes de revisão/decisão de crédito. Devem ser lidos como parciais.
 */
export const RESUMO_DOCUMENTAL_PARCIAL_OBSERVACAO =
  'Resumo documental parcial — valores derivados diretamente dos documentos. NÃO representa o imposto final apurado a recolher: não inclui ajustes (E111), saldo credor anterior, deduções, CIAP nem débito de CT-e frete, e pode conter itens pendentes de revisão. Consulte a apuração de ICMS para o valor final.';

/**
 * Observação da apuração de ICMS documental (créditos/débitos por item + crédito
 * de CT-e frete). Nesta fase ela ainda é PARCIAL em relação ao imposto final a
 * recolher (R7.3): não incorpora ajustes E111, saldo credor anterior, deduções
 * e CIAP — conciliação completa fica na Fase 3. Rotulada para o usuário não a
 * confundir com o valor definitivo a recolher.
 */
export const APURACAO_ICMS_PARCIAL_OBSERVACAO =
  'Apuração parcial — considera débitos e créditos documentais (inclusive CT-e frete), mas ainda NÃO incorpora ajustes (E111), saldo credor anterior, deduções nem CIAP. NÃO use como imposto final a recolher até a conciliação completa.';

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
  revisaoNecessaria?: boolean;
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
          cfopDescricao: cfops.descricao,
          cfopXmlDescricao: cfopsXml.descricao,
        })
        .from(documentosFiscaisItens)
        .innerJoin(
          documentosFiscais,
          eq(documentosFiscais.id, documentosFiscaisItens.documentoFiscalId),
        )
        .leftJoin(cfops, eq(cfops.codigo, documentosFiscaisItens.cfop))
        .leftJoin(cfopsXml, eq(cfopsXml.codigo, documentosFiscaisItens.cfopXml))
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

    // F16 (R5.4): a UI projeta o C190 do MESMO agregador analítico comum que o
    // TXT (`aggregateC190Analitico`), não de um cálculo independente. Buscamos
    // as linhas por item (sem agregação no SQL) e deixamos a decomposição —
    // CST normalizado (R5.2), alíquota decimal antes da chave e escopo por
    // documento (R5.3), redução só com percentual efetivo (R5.1) — a cargo do
    // agregador, para que livro e arquivo coincidam por construção.
    //
    // Fonte da projeção (R5.4, design "C190 alinhado"): o modelo-alvo é a
    // tabela comum `fiscal_lancamentos` (migração aditiva 0016). Nesta fase,
    // porém, nenhum escritor ainda popula os lançamentos — o fechamento
    // versionado (tarefas 3.x) é quem passa a gravá-los. Até lá, projetamos a
    // partir de `documentosFiscaisItens`, que são os MESMOS valores documentais
    // já persistidos que o builder EFD consome. Como UI e TXT atravessam o
    // ÚNICO agregador comum, há um só caminho de cálculo e a decomposição
    // coincide por construção; migrar a origem para `fiscal_lancamentos`
    // (quando houver escritor) não reintroduz um segundo cálculo — apenas troca
    // a tabela de leitura por uma projeção equivalente dos mesmos fatos.
    const itens = await this.database.db
      .select({
        documento_fiscal_id: documentosFiscaisItens.documentoFiscalId,
        tipo_operacao: documentosFiscaisItens.tipoOperacaoEscriturada,
        cfop_xml: documentosFiscaisItens.cfopXml,
        cstIcms: documentosFiscaisItens.cstIcms,
        csosnIcms: documentosFiscaisItens.csosnIcms,
        origemMercadoria: documentosFiscaisItens.origemMercadoria,
        cfop: documentosFiscaisItens.cfop,
        aliquotaIcms: documentosFiscaisItens.aliquotaIcms,
        percentualReducaoBcIcms: documentosFiscaisItens.percentualReducaoBcIcms,
        valorBrutoProduto: documentosFiscaisItens.valorBrutoProduto,
        valorDesconto: documentosFiscaisItens.valorDesconto,
        valorFrete: documentosFiscaisItens.valorFrete,
        valorSeguro: documentosFiscaisItens.valorSeguro,
        valorOutrasDespesas: documentosFiscaisItens.valorOutrasDespesas,
        valorBcIcms: documentosFiscaisItens.valorBcIcms,
        valorIcms: documentosFiscaisItens.valorIcms,
        valorBcIcmsSt: documentosFiscaisItens.valorBcIcmsSt,
        valorIcmsSt: documentosFiscaisItens.valorIcmsSt,
        valorFcpSt: documentosFiscaisItens.valorFcpSt,
        valorIpi: documentosFiscaisItens.valorIpi,
      })
      .from(documentosFiscaisItens)
      .innerJoin(
        documentosFiscais,
        eq(documentosFiscais.id, documentosFiscaisItens.documentoFiscalId),
      )
      .where(where)
      .orderBy(
        documentosFiscaisItens.documentoFiscalId,
        documentosFiscaisItens.tipoOperacaoEscriturada,
        documentosFiscaisItens.cfop,
        documentosFiscaisItens.aliquotaIcms,
      );

    const data = projectC190FromItens(itens);

    // Política única (R6.3): a decisão de o ICMS próprio compor a apuração sai
    // da MESMA matriz fiscal que o builder/CT-e consultam. Sem fiscalConfig
    // (cliente desconhecido) o C190 segue documental completo (compõe).
    const icmsCompoeApuracao = fiscalConfig
      ? apuraIcmsProprioParaConsumidores(
          fiscalConfig,
          competenciaDeIntervalo(input),
        )
      : true;
    // O C190 é um resumo DOCUMENTAL: sempre parcial em relação ao imposto final
    // apurado (R7.3). Preserva a observação do Simples quando aplicável,
    // concatenando-a à do resumo parcial para não perder nenhuma advertência.
    const observacao = icmsCompoeApuracao
      ? RESUMO_DOCUMENTAL_PARCIAL_OBSERVACAO
      : `${SIMPLES_C190_OBSERVACAO} ${RESUMO_DOCUMENTAL_PARCIAL_OBSERVACAO}`;
    return {
      data,
      icms_compoe_apuracao: icmsCompoeApuracao,
      parcial: true,
      observacao,
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
    const creditoPermitido = this.creditoIcmsPermitidoSql();
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

    // Política única (R6.3): zera crédito/débito do livro quando a matriz
    // fiscal resolve que o cliente NÃO apura ICMS próprio na competência.
    if (fiscalConfig && !this.apuraIcmsProprio(fiscalConfig, input)) {
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
    // Política única (R6.3): sem apuração de ICMS próprio pela matriz fiscal,
    // a apuração documental é zerada (ICMS recolhido via DAS).
    if (fiscalConfig && !this.apuraIcmsProprio(fiscalConfig, input)) {
      return {
        total_creditos: '0.00',
        total_debitos: '0.00',
        saldo_apurado: '0.00',
        observacao: SIMPLES_SEM_APURACAO_OBSERVACAO,
      };
    }

    const where = this.buildWhere(input, true);
    const creditoPermitido = this.creditoIcmsPermitidoSql();
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
      parcial: true,
      observacao: APURACAO_ICMS_PARCIAL_OBSERVACAO,
    };
  }

  /**
   * Condição SQL de admissibilidade de crédito de ICMS de entrada, espelhando
   * `decidirCreditoIcms` (decisao-credito.ts) — a MESMA fonte que o builder
   * SPED consome (R7.1). A precedência é idêntica ao builder:
   *  - CSOSN 101/201 (Simples) permite crédito, sem sujeição à vedação por CFOP;
   *  - regime normal credita quando o CST está na allow-list E o CFOP não veda
   *    o crédito (R7.2: uso/consumo, substituído, ativo → sem crédito, ainda
   *    que o CST autorize).
   * Deriva das constantes compartilhadas (CST/CSOSN/CFOP), sem reimplementar as
   * listas aqui, para que livros e builder concedam o mesmo crédito documental.
   */
  private creditoIcmsPermitidoSql(): SQL {
    const csts = CST_ICMS_ENTRADA_CREDITO.map((c) => `'${c}'`).join(', ');
    const csosns = CSOSN_ICMS_PERMITE_CREDITO.map((c) => `'${c}'`).join(', ');
    return sql`((${documentosFiscaisItens.cstIcms} IN (${sql.raw(csts)}) AND NOT ${this.cfopVedaCreditoIcmsSql()}) OR ${documentosFiscaisItens.csosnIcms} IN (${sql.raw(csosns)}))`;
  }

  /**
   * Condição SQL que replica `cfopVedaCreditoIcms` (decisao-credito.ts): CFOP de
   * entrada (primeiro dígito 1/2/3) cuja terminação (3 últimos dígitos) veda a
   * apropriação de crédito de ICMS (R7.2). Deriva das constantes compartilhadas.
   */
  private cfopVedaCreditoIcmsSql(): SQL {
    const prefixos = CFOP_PREFIXOS_ENTRADA.map((p) => `'${p}'`).join(', ');
    const finais = CFOP_FINAIS_VEDA_CREDITO.map((f) => `'${f}'`).join(', ');
    // Normaliza o CFOP a dígitos e só considera o código de 4 dígitos, como a
    // função pura `cfopVedaCreditoIcms` (replace(/\D/g,'') + length === 4).
    const digitos = sql`regexp_replace(COALESCE(${documentosFiscaisItens.cfop}, ''), '[^0-9]', '', 'g')`;
    return sql`(LENGTH(${digitos}) = 4 AND LEFT(${digitos}, 1) IN (${sql.raw(prefixos)}) AND RIGHT(${digitos}, 3) IN (${sql.raw(finais)}))`;
  }

  /**
   * Ponte dos livros para a POLÍTICA ÚNICA (R6.3): consulta a mesma matriz
   * fiscal que o builder/CT-e, derivando a competência do intervalo do filtro.
   * É o único ponto do serviço que decide apuração de ICMS próprio.
   */
  private apuraIcmsProprio(
    fiscalConfig: {
      regimeTributario: RegimeTributario | null;
      apuraIcms: boolean;
    },
    input: ItemFilters,
  ): boolean {
    return apuraIcmsProprioParaConsumidores(
      fiscalConfig,
      competenciaDeIntervalo(input),
    );
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
    if (input.revisaoNecessaria !== undefined) {
      conditions.push(
        eq(
          documentosFiscaisItens.cfopRevisaoNecessaria,
          input.revisaoNecessaria,
        ),
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
    cfopDescricao?: string | null;
    cfopXmlDescricao?: string | null;
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
        cfop_sugerido:
          item.cfopRevisaoNecessaria &&
          item.cfopXml &&
          item.cfopOrigemResolucao !== 'PENDENTE_CLASSIFICACAO'
            ? convertDirection(
                item.cfopXml,
                item.tipoOperacaoEscriturada as 'ENTRADA' | 'SAIDA',
              )
            : null,
        destinacao_mercadoria: item.destinacaoMercadoria,
        destinacao_efetiva:
          item.destinacaoMercadoria ??
          (Number(item.destinacaoConfianca) >= 0.9
            ? item.destinacaoInferida
            : null),
        destinacao_inferida: item.destinacaoInferida,
        destinacao_origem: item.destinacaoOrigem,
        destinacao_confianca: item.destinacaoConfianca,
        destinacao_justificativa: item.destinacaoJustificativa,
        origem_resolucao: item.cfopOrigemResolucao,
        motivo_resolucao: item.cfopMotivoResolucao,
        cfop_descricao: row.cfopDescricao ?? null,
        cfop_xml_descricao: row.cfopXmlDescricao ?? null,
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
        origem_descricao: descricaoCst('ORIGEM', item.origemMercadoria),
        cst: item.cstIcms,
        cst_descricao: descricaoCst('ICMS', item.cstIcms),
        csosn: item.csosnIcms,
        csosn_descricao: descricaoCst('CSOSN', item.csosnIcms),
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
        cst_descricao: descricaoCst('IPI', item.cstIpi),
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
        cst_descricao: descricaoCst('PIS', item.cstPis),
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
        cst_descricao: descricaoCst('COFINS', item.cstCofins),
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
      iss: {
        valor_bc: item.valorBcIss,
        aliquota: item.aliquotaIss,
        valor: item.valorIss,
        retido: item.issRetido,
        item_lista_servico: item.itemListaServico,
        cnae: item.cnae,
        codigo_tributacao_municipio: item.codigoTributacaoMunicipio,
        exigibilidade: item.exigibilidadeIss,
        municipio_incidencia: item.municipioIncidencia,
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

/** Linha por item consumida pela projeção do C190 na UI. */
export interface C190ItemRow extends C190ItemInput {
  documento_fiscal_id: string;
  tipo_operacao: string;
  cfop_xml: string | null;
}

/**
 * F16 (R5.4): projeta a decomposição do C190 para a UI a partir das linhas por
 * item, usando o MESMO agregador analítico comum (`aggregateC190Analitico`) que
 * o builder EFD. O escopo é por documento (R5.3): os itens são particionados
 * por (documento, tipo de operação) antes da agregação. Além da decomposição,
 * preserva o CFOP XML distinto por linha analítica (auditoria), sem reintroduzir
 * um cálculo independente. Os valores decimais são formatados (string), não
 * recalculados.
 */
export function projectC190FromItens(itens: readonly C190ItemRow[]) {
  // Partição por documento + sentido (escopo por documento do agregador).
  const buckets = new Map<
    string,
    {
      documento_fiscal_id: string;
      tipo_operacao: string;
      itens: C190ItemRow[];
    }
  >();
  for (const item of itens) {
    const partitionKey = `${item.documento_fiscal_id}|${item.tipo_operacao}`;
    const bucket = buckets.get(partitionKey) ?? {
      documento_fiscal_id: item.documento_fiscal_id,
      tipo_operacao: item.tipo_operacao,
      itens: [],
    };
    bucket.itens.push(item);
    buckets.set(partitionKey, bucket);
  }

  const linhas: Array<{
    tipo_operacao: string;
    documento_fiscal_id: string;
    cst_icms_csosn: string;
    cfop: string;
    cfops_xml: string[];
    aliquota_icms: string;
    vl_opr: string;
    vl_bc_icms: string;
    vl_icms: string;
    vl_bc_icms_st: string;
    vl_icms_st: string;
    vl_red_bc: string;
    vl_ipi: string;
  }> = [];

  for (const bucket of buckets.values()) {
    for (const analitico of aggregateC190Analitico(bucket.itens)) {
      // CFOP XML distinto dos itens que compõem esta linha analítica, para
      // auditoria (a chave analítica usa o CFOP escriturado).
      const cfopsXml = [
        ...new Set(
          bucket.itens
            .filter(
              (item) =>
                normalizeC190Cst(item) === analitico.cst &&
                item.cfop === analitico.cfop,
            )
            .map((item) => item.cfop_xml)
            .filter((value): value is string => value != null),
        ),
      ];
      linhas.push({
        tipo_operacao: bucket.tipo_operacao,
        documento_fiscal_id: bucket.documento_fiscal_id,
        cst_icms_csosn: analitico.cst,
        cfop: analitico.cfop,
        cfops_xml: cfopsXml,
        aliquota_icms: analitico.aliquota,
        vl_opr: fromScaledInteger(analitico.valorOperacao),
        vl_bc_icms: fromScaledInteger(analitico.valorBcIcms),
        vl_icms: fromScaledInteger(analitico.valorIcms),
        vl_bc_icms_st: fromScaledInteger(analitico.valorBcIcmsSt),
        vl_icms_st: fromScaledInteger(analitico.valorIcmsSt),
        vl_red_bc: fromScaledInteger(analitico.valorReducaoBc),
        vl_ipi: fromScaledInteger(analitico.valorIpi),
      });
    }
  }
  return linhas;
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
