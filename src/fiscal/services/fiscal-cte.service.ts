import { Injectable } from '@nestjs/common';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  lte,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { PaginationParams } from '../../common/types';
import {
  simplesNacionalSemApuracaoIcms,
  type RegimeTributario,
} from '../../clientes/clientes.types';
import { DatabaseService } from '../../database/database.service';
import {
  documentosFiscais,
  documentosFiscaisCteEscrituracao,
} from '../../database/schema';
import type { CteEscrituracaoParseData } from './dacte.parser';
import { CfopService, type TipoOperacaoEscriturada } from './cfop.service';

type FiscalDatabase = DatabaseService['db'];
type FiscalTransaction = Parameters<
  Parameters<FiscalDatabase['transaction']>[0]
>[0];
type FiscalExecutor = FiscalDatabase | FiscalTransaction;

export type SituacaoDocumentoCte =
  'AUTORIZADA' | 'CANCELADA' | 'DENEGADA' | 'RESUMIDA';

export interface DecisaoEscrituracaoCte {
  escrituravel: boolean;
  motivoNaoEscrituravel: string | null;
  // ENTRADA: cliente é tomador (aquisição de frete).
  // SAIDA: cliente é o emitente/prestador do serviço de transporte.
  tipoOperacao: TipoOperacaoEscriturada;
  // Papel do cliente na operação: TOMADOR ou PRESTADOR.
  papelCliente: 'TOMADOR' | 'PRESTADOR' | 'NENHUM';
  creditaIcms: boolean;
  // Débito de ICMS quando o cliente é o prestador (saída tributada).
  debitaIcms: boolean;
  revisaoNecessaria: boolean;
}

export type EscrituracaoStatus =
  'ESCRITURADO' | 'NAO_ESCRITURAVEL' | 'PENDENTE_REVISAO';

export interface CteEscrituracaoPreparada {
  values: Omit<
    typeof documentosFiscaisCteEscrituracao.$inferInsert,
    'id' | 'documentoFiscalId' | 'clienteId' | 'criadoEm' | 'atualizadoEm'
  >;
  escrituracaoStatus: EscrituracaoStatus;
}

export interface CteFiscalFilters {
  clienteId?: string;
  documentoId?: string;
  escrituravel?: boolean;
  revisaoNecessaria?: boolean;
  cfop?: string;
  cst?: string;
  dataInicio?: Date;
  dataFim?: Date;
}

const CST_COM_CREDITO = new Set(['00', '10', '20', '70']);
const CSOSN_COM_CREDITO = new Set(['101', '201']);
const TP_SERV_REVISAO = new Set(['1', '2', '3']);

export function decidirEscrituracaoCte(input: {
  clienteCnpjCpf: string;
  regimeTributario: RegimeTributario | null;
  apuraIcms: boolean;
  emitenteCnpjCpf?: string | null;
  tomadorCnpjCpf: string;
  situacao: SituacaoDocumentoCte;
  tpCte: string;
  tpServ: string;
  cstIcms: string | null;
  csosnIcms: string | null;
}): DecisaoEscrituracaoCte {
  const cliente = normalizeTaxId(input.clienteCnpjCpf);
  const tomador = normalizeTaxId(input.tomadorCnpjCpf);
  const emitente = input.emitenteCnpjCpf
    ? normalizeTaxId(input.emitenteCnpjCpf)
    : '';

  // Determina o papel do cliente. O emitente (prestador) tem prioridade:
  // transportadora que emite o próprio CT-e escritura como SAÍDA (prestação).
  const clienteEhPrestador = Boolean(
    cliente && emitente && cliente === emitente,
  );
  const clienteEhTomador = Boolean(cliente && tomador && cliente === tomador);

  if (!clienteEhPrestador && !clienteEhTomador) {
    return {
      escrituravel: false,
      motivoNaoEscrituravel: 'CLIENTE_NAO_E_TOMADOR_NEM_PRESTADOR',
      tipoOperacao: 'ENTRADA',
      papelCliente: 'NENHUM',
      creditaIcms: false,
      debitaIcms: false,
      revisaoNecessaria: false,
    };
  }

  const servicoExigeRevisao = TP_SERV_REVISAO.has(input.tpServ);
  const simplesSemApuracao = simplesNacionalSemApuracaoIcms({
    regimeTributario: input.regimeTributario,
    apuraIcms: input.apuraIcms,
  });
  const documentoRegular = input.situacao === 'AUTORIZADA';
  const anulacao = input.tpCte === '2';

  // CT-e de SAÍDA: o cliente é o prestador do serviço de transporte.
  if (clienteEhPrestador) {
    return {
      escrituravel: true,
      motivoNaoEscrituravel: null,
      tipoOperacao: 'SAIDA',
      papelCliente: 'PRESTADOR',
      creditaIcms: false,
      // Débito de ICMS sobre a prestação tributada (exceto Simples sem
      // apuração, anulação ou documento não autorizado).
      debitaIcms: documentoRegular && !simplesSemApuracao && !anulacao,
      revisaoNecessaria: servicoExigeRevisao,
    };
  }

  // CT-e de ENTRADA: o cliente é o tomador (aquisição de frete).
  const cstPermiteCredito =
    (input.cstIcms !== null && CST_COM_CREDITO.has(input.cstIcms)) ||
    (input.csosnIcms !== null && CSOSN_COM_CREDITO.has(input.csosnIcms));

  return {
    escrituravel: true,
    motivoNaoEscrituravel: null,
    tipoOperacao: 'ENTRADA',
    papelCliente: 'TOMADOR',
    creditaIcms:
      documentoRegular &&
      !simplesSemApuracao &&
      !servicoExigeRevisao &&
      !anulacao &&
      cstPermiteCredito,
    debitaIcms: false,
    revisaoNecessaria: servicoExigeRevisao,
  };
}

export function codSituacaoSpedCte(
  situacao: SituacaoDocumentoCte,
  tpCte: string,
) {
  if (situacao === 'CANCELADA') return '02';
  if (situacao === 'DENEGADA') return '04';
  if (tpCte === '1') return '06';
  return '00';
}

@Injectable()
export class FiscalCteService {
  constructor(
    private readonly database: DatabaseService,
    private readonly cfopService: CfopService,
  ) {}

  decidirEscrituracaoCte = decidirEscrituracaoCte;

  async prepararEscrituracao(input: {
    clienteId: string;
    clienteCnpjCpf: string;
    regimeTributario: RegimeTributario | null;
    apuraIcms: boolean;
    situacao: SituacaoDocumentoCte;
    cte: CteEscrituracaoParseData;
  }): Promise<CteEscrituracaoPreparada> {
    const decisao = decidirEscrituracaoCte({
      clienteCnpjCpf: input.clienteCnpjCpf,
      regimeTributario: input.regimeTributario,
      apuraIcms: input.apuraIcms,
      emitenteCnpjCpf: input.cte.emitenteCnpjCpf,
      tomadorCnpjCpf: input.cte.tomadorCnpjCpf,
      situacao: input.situacao,
      tpCte: input.cte.tpCte,
      tpServ: input.cte.tpServ,
      cstIcms: input.cte.cstIcms,
      csosnIcms: input.cte.csosnIcms,
    });
    const cfop = await this.cfopService.resolverCfopEquivalenteDetalhado({
      clienteId: input.clienteId,
      cfopXml: input.cte.cfop,
      tipoOperacaoEscriturada: decisao.tipoOperacao,
    });
    const referenciaObrigatoria = ['1', '2', '3'].includes(input.cte.tpCte);
    const revisaoNecessaria =
      decisao.revisaoNecessaria ||
      cfop.revisaoNecessaria ||
      (referenciaObrigatoria && !input.cte.chaveCteReferenciado);
    const sign = input.cte.tpCte === '2' ? -1 : 1;
    const valorIcmsCreditavel = decisao.creditaIcms
      ? signedDecimal(input.cte.valorIcms ?? '0', sign)
      : '0.00';

    return {
      values: {
        escrituravel: decisao.escrituravel,
        motivoNaoEscrituravel: decisao.motivoNaoEscrituravel,
        tomadorCnpjCpf: input.cte.tomadorCnpjCpf,
        tomadorPapel: input.cte.tomadorPapel,
        tipoOperacaoEscriturada: decisao.tipoOperacao,
        tpCte: input.cte.tpCte,
        tpServ: input.cte.tpServ,
        modal: input.cte.modal,
        cfopXml: input.cte.cfop,
        cfop: cfop.cfop,
        cfopRevisaoNecessaria: cfop.revisaoNecessaria,
        revisaoNecessaria,
        cstIcms: input.cte.cstIcms,
        csosnIcms: input.cte.csosnIcms,
        valorTotalServico: signedDecimal(input.cte.valorTotalServico, sign),
        valorReceber: signedDecimal(input.cte.valorReceber, sign),
        valorBcIcms: signedNullableDecimal(input.cte.valorBcIcms, sign),
        aliquotaIcms: input.cte.aliquotaIcms,
        valorIcms: signedNullableDecimal(input.cte.valorIcms, sign),
        valorIcmsCreditavel,
        valorTotalTributos: signedNullableDecimal(
          input.cte.valorTotalTributos,
          sign,
        ),
        chaveCteReferenciado: input.cte.chaveCteReferenciado,
        codigoMunicipioOrigem: input.cte.codigoMunicipioOrigem,
        codigoMunicipioDestino: input.cte.codigoMunicipioDestino,
      },
      escrituracaoStatus: !decisao.escrituravel
        ? 'NAO_ESCRITURAVEL'
        : revisaoNecessaria
          ? 'PENDENTE_REVISAO'
          : 'ESCRITURADO',
    };
  }

  async persistirEscrituracao(
    executor: FiscalExecutor,
    input: {
      documentoFiscalId: string;
      clienteId: string;
      chaveAcesso: string;
      preparada: CteEscrituracaoPreparada;
    },
  ): Promise<{ escrituravel: boolean; status: EscrituracaoStatus }> {
    const values = { ...input.preparada.values };

    if (
      values.tpCte === '2' &&
      values.escrituravel &&
      values.chaveCteReferenciado
    ) {
      const original = await executor
        .select({
          valorIcmsCreditavel:
            documentosFiscaisCteEscrituracao.valorIcmsCreditavel,
        })
        .from(documentosFiscaisCteEscrituracao)
        .innerJoin(
          documentosFiscais,
          eq(
            documentosFiscais.id,
            documentosFiscaisCteEscrituracao.documentoFiscalId,
          ),
        )
        .where(
          and(
            eq(documentosFiscaisCteEscrituracao.clienteId, input.clienteId),
            eq(documentosFiscais.chaveAcesso, values.chaveCteReferenciado),
          ),
        )
        .limit(1);
      if (original[0]) {
        values.valorIcmsCreditavel = negateDecimal(
          original[0].valorIcmsCreditavel,
        );
      } else {
        values.valorIcmsCreditavel = '0.00';
        values.revisaoNecessaria = true;
      }
    }

    const substitutos = await executor
      .select({ id: documentosFiscaisCteEscrituracao.id })
      .from(documentosFiscaisCteEscrituracao)
      .where(
        and(
          eq(documentosFiscaisCteEscrituracao.clienteId, input.clienteId),
          eq(documentosFiscaisCteEscrituracao.tpCte, '3'),
          eq(
            documentosFiscaisCteEscrituracao.chaveCteReferenciado,
            input.chaveAcesso,
          ),
          eq(documentosFiscaisCteEscrituracao.escrituravel, true),
        ),
      )
      .limit(1);
    if (substitutos[0]) {
      values.escrituravel = false;
      values.motivoNaoEscrituravel = 'SUBSTITUIDO';
      values.valorIcmsCreditavel = '0.00';
    }

    await executor
      .insert(documentosFiscaisCteEscrituracao)
      .values({
        ...values,
        documentoFiscalId: input.documentoFiscalId,
        clienteId: input.clienteId,
        atualizadoEm: new Date(),
      })
      .onConflictDoUpdate({
        target: documentosFiscaisCteEscrituracao.documentoFiscalId,
        set: {
          ...values,
          clienteId: input.clienteId,
          atualizadoEm: new Date(),
        },
      });

    const status: EscrituracaoStatus = !values.escrituravel
      ? 'NAO_ESCRITURAVEL'
      : values.revisaoNecessaria
        ? 'PENDENTE_REVISAO'
        : 'ESCRITURADO';
    await executor
      .update(documentosFiscais)
      .set({
        escriturado: values.escrituravel,
        escrituracaoStatus: status,
        tipoOperacaoEscriturada: values.tipoOperacaoEscriturada,
        atualizadoEm: new Date(),
      })
      .where(eq(documentosFiscais.id, input.documentoFiscalId));

    if (
      values.tpCte === '3' &&
      values.escrituravel &&
      values.chaveCteReferenciado
    ) {
      const referenciados = await executor
        .select({ id: documentosFiscais.id })
        .from(documentosFiscais)
        .where(
          and(
            eq(documentosFiscais.clienteId, input.clienteId),
            eq(documentosFiscais.chaveAcesso, values.chaveCteReferenciado),
          ),
        );
      for (const referenciado of referenciados) {
        await executor
          .update(documentosFiscaisCteEscrituracao)
          .set({
            escrituravel: false,
            motivoNaoEscrituravel: 'SUBSTITUIDO',
            valorIcmsCreditavel: '0.00',
            atualizadoEm: new Date(),
          })
          .where(
            eq(
              documentosFiscaisCteEscrituracao.documentoFiscalId,
              referenciado.id,
            ),
          );
        await executor
          .update(documentosFiscais)
          .set({
            escriturado: false,
            escrituracaoStatus: 'NAO_ESCRITURAVEL',
            atualizadoEm: new Date(),
          })
          .where(eq(documentosFiscais.id, referenciado.id));
      }
    }

    return { escrituravel: values.escrituravel, status };
  }

  async listCtes(input: CteFiscalFilters & { pagination: PaginationParams }) {
    const where = this.buildWhere(input);
    const [totalRows, rows] = await Promise.all([
      this.database.db
        .select({ total: count() })
        .from(documentosFiscaisCteEscrituracao)
        .innerJoin(
          documentosFiscais,
          eq(
            documentosFiscais.id,
            documentosFiscaisCteEscrituracao.documentoFiscalId,
          ),
        )
        .where(where),
      this.database.db
        .select({
          cte: documentosFiscaisCteEscrituracao,
          chaveAcesso: documentosFiscais.chaveAcesso,
          numeroDocumento: documentosFiscais.numeroDocumento,
          serie: documentosFiscais.serie,
          emitenteCnpjCpf: documentosFiscais.emitenteCnpjCpf,
          emitenteRazaoSocial: documentosFiscais.emitenteRazaoSocial,
          dataEmissao: documentosFiscais.dataEmissao,
          situacao: documentosFiscais.situacao,
          escrituracaoStatus: documentosFiscais.escrituracaoStatus,
        })
        .from(documentosFiscaisCteEscrituracao)
        .innerJoin(
          documentosFiscais,
          eq(
            documentosFiscais.id,
            documentosFiscaisCteEscrituracao.documentoFiscalId,
          ),
        )
        .where(where)
        .orderBy(desc(documentosFiscais.dataEmissao))
        .limit(input.pagination.limit)
        .offset(input.pagination.offset),
    ]);
    return {
      total: Number(totalRows[0]?.total ?? 0),
      data: rows.map((row) => ({
        id: row.cte.id,
        documento_fiscal_id: row.cte.documentoFiscalId,
        cliente_id: row.cte.clienteId,
        chave_acesso: row.chaveAcesso,
        numero_documento: row.numeroDocumento,
        serie: row.serie,
        emitente_cnpj_cpf: row.emitenteCnpjCpf,
        emitente_razao_social: row.emitenteRazaoSocial,
        data_emissao: row.dataEmissao.toISOString(),
        situacao: row.situacao,
        escrituracao_status: row.escrituracaoStatus,
        escrituravel: row.cte.escrituravel,
        motivo_nao_escrituravel: row.cte.motivoNaoEscrituravel,
        revisao_necessaria: row.cte.revisaoNecessaria,
        tomador_papel: row.cte.tomadorPapel,
        tipo_cte: row.cte.tpCte,
        tipo_servico: row.cte.tpServ,
        modal: row.cte.modal,
        cfop_xml: row.cte.cfopXml,
        cfop: row.cte.cfop,
        cfop_revisao_necessaria: row.cte.cfopRevisaoNecessaria,
        cst_icms: row.cte.cstIcms,
        csosn_icms: row.cte.csosnIcms,
        valor_total_servico: row.cte.valorTotalServico,
        valor_receber: row.cte.valorReceber,
        valor_bc_icms: row.cte.valorBcIcms,
        aliquota_icms: row.cte.aliquotaIcms,
        valor_icms: row.cte.valorIcms,
        valor_icms_creditavel: row.cte.valorIcmsCreditavel,
        chave_cte_referenciado: row.cte.chaveCteReferenciado,
      })),
    };
  }

  async getD100(input: CteFiscalFilters) {
    const conditions = this.buildConditions({
      ...input,
      escrituravel: true,
      revisaoNecessaria: false,
    });
    conditions.push(
      eq(documentosFiscaisCteEscrituracao.cfopRevisaoNecessaria, false),
    );
    const rows = await this.database.db
      .select({
        documentoId: documentosFiscais.id,
        chaveAcesso: documentosFiscais.chaveAcesso,
        serie: documentosFiscais.serie,
        numeroDocumento: documentosFiscais.numeroDocumento,
        emitenteCnpjCpf: documentosFiscais.emitenteCnpjCpf,
        dataEmissao: documentosFiscais.dataEmissao,
        situacao: documentosFiscais.situacao,
        cte: documentosFiscaisCteEscrituracao,
      })
      .from(documentosFiscaisCteEscrituracao)
      .innerJoin(
        documentosFiscais,
        eq(
          documentosFiscais.id,
          documentosFiscaisCteEscrituracao.documentoFiscalId,
        ),
      )
      .where(and(...conditions))
      .orderBy(asc(documentosFiscais.dataEmissao));

    return {
      leiaute_efd_icms_ipi: '020',
      guia_pratico: '3.2.2',
      data: rows.map((row) => {
        const semValores = row.situacao !== 'AUTORIZADA';
        const valorServico = semValores
          ? '0.00'
          : absoluteDecimal(row.cte.valorTotalServico);
        const valorBc = semValores
          ? '0.00'
          : absoluteDecimal(row.cte.valorBcIcms ?? '0');
        const valorIcms = semValores
          ? '0.00'
          : absoluteDecimal(row.cte.valorIcms ?? '0');
        const saida = row.cte.tipoOperacaoEscriturada === 'SAIDA';
        return {
          reg: 'D100',
          documento_fiscal_id: row.documentoId,
          // ind_oper: 0=entrada (aquisição), 1=saída (prestação própria).
          ind_oper: saida ? '1' : '0',
          // ind_emit: 0=emissão própria, 1=terceiros.
          ind_emit: saida ? '0' : '1',
          cod_part: row.emitenteCnpjCpf,
          cod_mod: '57',
          cod_sit: codSituacaoSpedCte(
            row.situacao as SituacaoDocumentoCte,
            row.cte.tpCte,
          ),
          ser: row.serie,
          sub: null,
          num_doc: row.numeroDocumento,
          chv_cte: row.chaveAcesso,
          dt_doc: row.dataEmissao.toISOString(),
          dt_a_p: row.dataEmissao.toISOString(),
          vl_doc: valorServico,
          vl_desc: '0.00',
          ind_frt: indFrete(row.cte.tomadorPapel),
          vl_serv: valorServico,
          vl_bc_icms: valorBc,
          vl_icms: valorIcms,
          vl_nt: subtractNonNegative(valorServico, valorBc),
          cod_inf: null,
          cod_cta: null,
          cod_mun_orig: row.cte.codigoMunicipioOrigem,
          cod_mun_dest: row.cte.codigoMunicipioDestino,
        };
      }),
    };
  }

  async getD190(input: CteFiscalFilters) {
    const conditions = this.buildConditions({
      ...input,
      escrituravel: true,
      revisaoNecessaria: false,
    });
    conditions.push(
      eq(documentosFiscais.situacao, 'AUTORIZADA'),
      eq(documentosFiscaisCteEscrituracao.cfopRevisaoNecessaria, false),
    );
    const cst = sql<string>`COALESCE(${documentosFiscaisCteEscrituracao.cstIcms}, ${documentosFiscaisCteEscrituracao.csosnIcms}, '')`;
    const reducao = sql`CASE WHEN ${documentosFiscaisCteEscrituracao.valorTotalServico} < 0 THEN -GREATEST(ABS(COALESCE(${documentosFiscaisCteEscrituracao.valorTotalServico}, 0)) - ABS(COALESCE(${documentosFiscaisCteEscrituracao.valorBcIcms}, 0)), 0) ELSE GREATEST(COALESCE(${documentosFiscaisCteEscrituracao.valorTotalServico}, 0) - COALESCE(${documentosFiscaisCteEscrituracao.valorBcIcms}, 0), 0) END`;
    const rows = await this.database.db
      .select({
        reg: sql<string>`'D190'`,
        documento_fiscal_id: documentosFiscaisCteEscrituracao.documentoFiscalId,
        cst_icms: cst,
        cfop: documentosFiscaisCteEscrituracao.cfop,
        aliquota_icms: documentosFiscaisCteEscrituracao.aliquotaIcms,
        vl_opr: sql<string>`COALESCE(SUM(${documentosFiscaisCteEscrituracao.valorTotalServico}), 0)`,
        vl_bc_icms: sql<string>`COALESCE(SUM(${documentosFiscaisCteEscrituracao.valorBcIcms}), 0)`,
        vl_icms: sql<string>`COALESCE(SUM(${documentosFiscaisCteEscrituracao.valorIcms}), 0)`,
        vl_red_bc: sql<string>`COALESCE(SUM(${reducao}), 0)`,
        cod_obs: sql<null>`NULL`,
      })
      .from(documentosFiscaisCteEscrituracao)
      .innerJoin(
        documentosFiscais,
        eq(
          documentosFiscais.id,
          documentosFiscaisCteEscrituracao.documentoFiscalId,
        ),
      )
      .where(and(...conditions))
      .groupBy(
        documentosFiscaisCteEscrituracao.documentoFiscalId,
        cst,
        documentosFiscaisCteEscrituracao.cfop,
        documentosFiscaisCteEscrituracao.aliquotaIcms,
      )
      .orderBy(
        documentosFiscaisCteEscrituracao.documentoFiscalId,
        documentosFiscaisCteEscrituracao.cfop,
        documentosFiscaisCteEscrituracao.aliquotaIcms,
      );
    return { data: rows };
  }

  async getResumoLivros(input: CteFiscalFilters) {
    const conditions = this.buildConditions({
      ...input,
      escrituravel: true,
      revisaoNecessaria: false,
    });
    conditions.push(
      eq(documentosFiscais.situacao, 'AUTORIZADA'),
      eq(documentosFiscaisCteEscrituracao.cfopRevisaoNecessaria, false),
    );
    return this.database.db
      .select({
        bloco: sql<string>`'D'`,
        tipo_operacao: documentosFiscaisCteEscrituracao.tipoOperacaoEscriturada,
        cfop: documentosFiscaisCteEscrituracao.cfop,
        aliquota_icms: documentosFiscaisCteEscrituracao.aliquotaIcms,
        valor_servicos: sql<string>`COALESCE(SUM(${documentosFiscaisCteEscrituracao.valorTotalServico}), 0)`,
        base_icms: sql<string>`COALESCE(SUM(${documentosFiscaisCteEscrituracao.valorBcIcms}), 0)`,
        icms_destacado: sql<string>`COALESCE(SUM(${documentosFiscaisCteEscrituracao.valorIcms}), 0)`,
        credito_icms: sql<string>`COALESCE(SUM(${documentosFiscaisCteEscrituracao.valorIcmsCreditavel}), 0)`,
      })
      .from(documentosFiscaisCteEscrituracao)
      .innerJoin(
        documentosFiscais,
        eq(
          documentosFiscais.id,
          documentosFiscaisCteEscrituracao.documentoFiscalId,
        ),
      )
      .where(and(...conditions))
      .groupBy(
        documentosFiscaisCteEscrituracao.tipoOperacaoEscriturada,
        documentosFiscaisCteEscrituracao.cfop,
        documentosFiscaisCteEscrituracao.aliquotaIcms,
      )
      .orderBy(documentosFiscaisCteEscrituracao.cfop);
  }

  async getTotalCreditoIcms(input: CteFiscalFilters) {
    const conditions = this.buildConditions({
      ...input,
      escrituravel: true,
      revisaoNecessaria: false,
    });
    conditions.push(
      eq(documentosFiscais.situacao, 'AUTORIZADA'),
      eq(documentosFiscaisCteEscrituracao.cfopRevisaoNecessaria, false),
    );
    const rows = await this.database.db
      .select({
        total_creditos_frete: sql<string>`COALESCE(SUM(${documentosFiscaisCteEscrituracao.valorIcmsCreditavel}), 0)`,
      })
      .from(documentosFiscaisCteEscrituracao)
      .innerJoin(
        documentosFiscais,
        eq(
          documentosFiscais.id,
          documentosFiscaisCteEscrituracao.documentoFiscalId,
        ),
      )
      .where(and(...conditions));
    return rows[0]?.total_creditos_frete ?? '0.00';
  }

  async getApuracaoFrete(input: CteFiscalFilters) {
    return {
      total_creditos_frete: await this.getTotalCreditoIcms(input),
      observacao:
        'Somente CT-e autorizados, tomados pelo cliente e sem bloqueio de crédito automático compõem este total.',
    };
  }

  private buildWhere(input: CteFiscalFilters) {
    const conditions = this.buildConditions(input);
    return conditions.length ? and(...conditions) : undefined;
  }

  private buildConditions(input: CteFiscalFilters): SQL[] {
    const conditions: SQL[] = [];
    if (input.clienteId) {
      conditions.push(
        eq(documentosFiscaisCteEscrituracao.clienteId, input.clienteId),
      );
    }
    if (input.documentoId) {
      conditions.push(
        eq(
          documentosFiscaisCteEscrituracao.documentoFiscalId,
          input.documentoId,
        ),
      );
    }
    if (input.escrituravel !== undefined) {
      conditions.push(
        eq(documentosFiscaisCteEscrituracao.escrituravel, input.escrituravel),
      );
    }
    if (input.revisaoNecessaria !== undefined) {
      conditions.push(
        eq(
          documentosFiscaisCteEscrituracao.revisaoNecessaria,
          input.revisaoNecessaria,
        ),
      );
    }
    if (input.cfop) {
      conditions.push(eq(documentosFiscaisCteEscrituracao.cfop, input.cfop));
    }
    if (input.cst) {
      conditions.push(
        sql`COALESCE(${documentosFiscaisCteEscrituracao.cstIcms}, ${documentosFiscaisCteEscrituracao.csosnIcms}) = ${input.cst}`,
      );
    }
    if (input.dataInicio) {
      conditions.push(gte(documentosFiscais.dataEmissao, input.dataInicio));
    }
    if (input.dataFim) {
      conditions.push(lte(documentosFiscais.dataEmissao, input.dataFim));
    }
    return conditions;
  }
}

function normalizeTaxId(value: string) {
  const normalized = value.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  return /^\d{11}$|^[0-9A-Z]{12}\d{2}$/.test(normalized) ? normalized : '';
}

function signedNullableDecimal(value: string | null, sign: number) {
  return value === null ? null : signedDecimal(value, sign);
}

function signedDecimal(value: string, sign: number) {
  const cents = decimalToCents(value);
  return centsToDecimal(sign < 0 ? -absCents(cents) : absCents(cents));
}

function negateDecimal(value: string) {
  return centsToDecimal(-absCents(decimalToCents(value)));
}

function absoluteDecimal(value: string) {
  return centsToDecimal(absCents(decimalToCents(value)));
}

function subtractNonNegative(total: string, base: string) {
  const difference = decimalToCents(total) - decimalToCents(base);
  return centsToDecimal(difference > 0n ? difference : 0n);
}

function decimalToCents(value: string) {
  const match = value.trim().match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return 0n;
  const cents =
    BigInt(match[2]) * 100n + BigInt((match[3] ?? '').padEnd(2, '0'));
  return match[1] === '-' ? -cents : cents;
}

function centsToDecimal(value: bigint) {
  const sign = value < 0n ? '-' : '';
  const absolute = absCents(value);
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}

function absCents(value: bigint) {
  return value < 0n ? -value : value;
}

function indFrete(tomadorPapel: string) {
  if (tomadorPapel === 'REMETENTE') return '0';
  if (tomadorPapel === 'DESTINATARIO') return '1';
  return '2';
}
