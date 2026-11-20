import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, isNull, lt, lte, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import {
  certificadosDigitais,
  clientes,
  controleNsu,
  financeiroBaixas,
  financeiroFaturas,
  folhasPagamento,
  guias,
  visualizacoesGuias,
} from '../database/schema';
import { getBahiaDate } from '../common/document-status';
import { FinanceiroDashboardService } from '../financeiro/services/financeiro-dashboard.service';

export type AcaoTipo =
  | 'GUIA_VENCIDA'
  | 'FATURA_VENCIDA'
  | 'CERTIFICADO'
  | 'CADASTRO_INCOMPLETO'
  | 'SYNC_FISCAL';

export interface DashboardAcao {
  tipo: AcaoTipo;
  titulo: string;
  descricao: string;
  total: number;
  href: string;
  itens: Array<{ label: string; detalhe: string; href?: string }>;
}

export interface DashboardAgendaItem {
  id: string;
  data: string;
  titulo: string;
  detalhe: string;
  href?: string;
}

export interface DashboardAtividade {
  id: string;
  tipo: 'GUIA' | 'FOLHA' | 'RECEBIMENTO';
  titulo: string;
  empresa: string;
  em: string;
}

const MS_DIA = 24 * 60 * 60 * 1000;
const TOP = 5;
/** cStat de sucesso do DistDFe (nenhum documento / documentos localizados). */
const SYNC_OK = [137, 138];

function addDias(data: string, dias: number): string {
  const [y, m, d] = data.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10);
}

/** AAAA-MM -> MM/AAAA. */
function competenciaBr(value: string): string {
  return `${value.slice(5, 7)}/${value.slice(0, 4)}`;
}

/** Mês anterior ao de `hoje` (AAAA-MM-DD) em AAAA-MM. */
function mesAnterior(hoje: string): string {
  const [y, m] = hoje.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly database: DatabaseService,
    private readonly financeiro: FinanceiroDashboardService,
  ) {}

  /**
   * Resumo operacional do escritório. Os valores financeiros só são
   * calculados quando `incluirFinanceiro` é verdadeiro.
   * `competencia` (AAAA-MM) define o mês em fechamento; padrão: mês anterior.
   */
  async resumo(input: { competencia?: string; incluirFinanceiro: boolean }) {
    const hoje = getBahiaDate();
    const competenciaFechamento = input.competencia ?? mesAnterior(hoje);
    const competenciaFechamentoBr = competenciaBr(competenciaFechamento);
    const inicioMes = `${hoje.slice(0, 7)}-01`;

    const [
      indicadoresClientes,
      guiasIndicadores,
      certificados,
      financeiroDados,
      guiasVencidasLista,
      cadastro,
      sync,
      agendaGuias,
      fechamento,
      atividade,
    ] = await Promise.all([
      this.indicadoresClientes(),
      this.indicadoresGuias(hoje, inicioMes),
      this.certificados(),
      input.incluirFinanceiro ? this.financeiro.getDashboard() : null,
      this.guiasVencidasNaoVisualizadas(hoje),
      this.cadastroIncompleto(),
      this.syncComProblema(),
      this.agendaGuias(hoje),
      this.fechamento(competenciaFechamentoBr),
      this.atividade(input.incluirFinanceiro),
    ]);

    const acoes: DashboardAcao[] = [];
    if (guiasVencidasLista.total > 0) {
      acoes.push({
        tipo: 'GUIA_VENCIDA',
        titulo: 'Guias vencidas sem visualização',
        descricao: 'O cliente ainda não abriu a guia vencida.',
        total: guiasVencidasLista.total,
        href: '/admin/guias?status=VENCIDO',
        itens: guiasVencidasLista.itens,
      });
    }
    if (financeiroDados && financeiroDados.rankingDevedores.length > 0) {
      acoes.push({
        tipo: 'FATURA_VENCIDA',
        titulo: 'Clientes com faturas vencidas',
        descricao: 'Maiores saldos em atraso.',
        total: financeiroDados.inadimplencia.clientes,
        href: '/admin/financeiro',
        itens: financeiroDados.rankingDevedores.slice(0, TOP).map((devedor) => ({
          label: devedor.razaoSocial,
          detalhe: `${devedor.faturasVencidas} fatura(s) · R$ ${devedor.valorDevido}`,
          href: '/admin/financeiro',
        })),
      });
    }
    if (certificados.vencidos + certificados.aVencer30Dias > 0) {
      acoes.push({
        tipo: 'CERTIFICADO',
        titulo: 'Certificados digitais',
        descricao: 'Vencidos ou com vencimento em até 30 dias.',
        total: certificados.vencidos + certificados.aVencer30Dias,
        href: '/admin/fiscal',
        itens: certificados.itens,
      });
    }
    if (cadastro.total > 0) {
      acoes.push({
        tipo: 'CADASTRO_INCOMPLETO',
        titulo: 'Cadastros incompletos',
        descricao: 'Faltam contador, regime, município ou responsável.',
        total: cadastro.total,
        href: '/admin/clientes',
        itens: cadastro.itens,
      });
    }
    if (sync.total > 0) {
      acoes.push({
        tipo: 'SYNC_FISCAL',
        titulo: 'Sincronização fiscal com problema',
        descricao: 'A última consulta de documentos retornou erro.',
        total: sync.total,
        href: '/admin/fiscal',
        itens: sync.itens,
      });
    }

    const agenda: DashboardAgendaItem[] = [...agendaGuias];
    const prazoDestda = await this.prazoDestda(hoje);
    if (prazoDestda) agenda.push(prazoDestda);
    agenda.sort((a, b) => a.data.localeCompare(b.data));

    return {
      geradoEm: new Date().toISOString(),
      hoje,
      clientes: indicadoresClientes,
      guias: guiasIndicadores,
      certificados: {
        vencidos: certificados.vencidos,
        aVencer30Dias: certificados.aVencer30Dias,
      },
      financeiro: financeiroDados
        ? {
            competencia: financeiroDados.competencia,
            totalFaturado: financeiroDados.totalFaturado,
            totalRecebido: financeiroDados.totalRecebido,
            totalEmAberto: financeiroDados.totalEmAberto,
            pendentesGeracao: financeiroDados.pendentesGeracao,
            inadimplencia: financeiroDados.inadimplencia,
          }
        : null,
      acoes,
      agenda,
      fechamento: {
        competencia: competenciaFechamento,
        ...fechamento,
      },
      atividade,
    };
  }

  private async indicadoresClientes() {
    const [row] = await this.database.db
      .select({
        ativos: sql<number>`count(*) FILTER (WHERE ${clientes.suspenso} = false)::int`,
        suspensos: sql<number>`count(*) FILTER (WHERE ${clientes.suspenso} = true)::int`,
      })
      .from(clientes);
    return { ativos: row?.ativos ?? 0, suspensos: row?.suspensos ?? 0 };
  }

  private async indicadoresGuias(hoje: string, inicioMes: string) {
    const [row] = await this.database.db
      .select({
        vencidas: sql<number>`count(*) FILTER (WHERE ${guias.status} = 'PENDENTE' AND ${guias.vencimento} < ${hoje})::int`,
        aVencer7Dias: sql<number>`count(*) FILTER (WHERE ${guias.status} = 'PENDENTE' AND ${guias.vencimento} >= ${hoje} AND ${guias.vencimento} <= ${addDias(hoje, 7)})::int`,
        enviadasNoMes: sql<number>`count(*) FILTER (WHERE ${guias.criadoEm} >= ${inicioMes}::timestamp)::int`,
      })
      .from(guias);
    return {
      vencidas: row?.vencidas ?? 0,
      aVencer7Dias: row?.aVencer7Dias ?? 0,
      enviadasNoMes: row?.enviadasNoMes ?? 0,
    };
  }

  /** Último certificado de cada cliente (o mais recente vence). */
  private async certificados() {
    const agora = new Date();
    const limite = new Date(agora.getTime() + 30 * MS_DIA);
    const ultimos = await this.database.db
      .select({
        clienteId: certificadosDigitais.clienteId,
        razaoSocial: sql<string>`max(${certificadosDigitais.razaoSocial})`,
        validadeFim: sql<Date>`max(${certificadosDigitais.validadeFim})`.mapWith(
          certificadosDigitais.validadeFim,
        ),
      })
      .from(certificadosDigitais)
      .groupBy(certificadosDigitais.clienteId);
    const criticos = ultimos
      .filter((c) => c.validadeFim <= limite)
      .sort((a, b) => a.validadeFim.getTime() - b.validadeFim.getTime());
    const vencidos = criticos.filter((c) => c.validadeFim < agora).length;
    return {
      vencidos,
      aVencer30Dias: criticos.length - vencidos,
      itens: criticos.slice(0, TOP).map((c) => {
        const dias = Math.ceil((c.validadeFim.getTime() - agora.getTime()) / MS_DIA);
        return {
          label: c.razaoSocial,
          detalhe: dias < 0 ? `Vencido há ${-dias} dia(s)` : `Vence em ${dias} dia(s)`,
          href: '/admin/fiscal',
        };
      }),
    };
  }

  private async guiasVencidasNaoVisualizadas(hoje: string) {
    const naoVisualizada = sql`NOT EXISTS (SELECT 1 FROM ${visualizacoesGuias} v WHERE v.guia_id = ${guias.id})`;
    const where = and(eq(guias.status, 'PENDENTE'), lt(guias.vencimento, hoje), naoVisualizada);
    const [[contagem], rows] = await Promise.all([
      this.database.db.select({ total: sql<number>`count(*)::int` }).from(guias).where(where),
      this.database.db
        .select({
          tipo: guias.tipo,
          periodo: guias.periodo,
          vencimento: guias.vencimento,
          razaoSocial: clientes.razaoSocial,
        })
        .from(guias)
        .innerJoin(clientes, eq(clientes.id, guias.clienteId))
        .where(where)
        .orderBy(asc(guias.vencimento))
        .limit(TOP),
    ]);
    return {
      total: contagem?.total ?? 0,
      itens: rows.map((g) => ({
        label: g.razaoSocial,
        detalhe: `${g.tipo} · ${g.periodo} · venc. ${formatarData(g.vencimento)}`,
        href: '/admin/guias?status=VENCIDO',
      })),
    };
  }

  /** Clientes ativos (sem suspensão) com dados essenciais ausentes. */
  private async cadastroIncompleto() {
    const faltas = {
      contador: isNull(clientes.contadorId),
      regime: sql`(${clientes.tipoPessoa} = 'PJ' AND ${clientes.regimeTributario} IS NULL)`,
      municipio: sql`(${clientes.tipoPessoa} = 'PJ' AND ${clientes.codigoMunicipioIbge} IS NULL)`,
      responsavel: sql`(${clientes.tipoPessoa} = 'PJ' AND (${clientes.responsavelNome} IS NULL OR ${clientes.responsavelCpf} IS NULL))`,
    };
    const incompleto = sql`(${faltas.contador} OR ${faltas.regime} OR ${faltas.municipio} OR ${faltas.responsavel})`;
    const where = and(eq(clientes.suspenso, false), incompleto);
    const [[contagem], rows] = await Promise.all([
      this.database.db.select({ total: sql<number>`count(*)::int` }).from(clientes).where(where),
      this.database.db
        .select({
          id: clientes.id,
          razaoSocial: clientes.razaoSocial,
          semContador: sql<boolean>`${clientes.contadorId} IS NULL`,
          semRegime: sql<boolean>`${faltas.regime}`,
          semMunicipio: sql<boolean>`${faltas.municipio}`,
          semResponsavel: sql<boolean>`${faltas.responsavel}`,
        })
        .from(clientes)
        .where(where)
        .orderBy(asc(clientes.razaoSocial))
        .limit(TOP),
    ]);
    return {
      total: contagem?.total ?? 0,
      itens: rows.map((c) => ({
        label: c.razaoSocial,
        detalhe:
          'Falta: ' +
          [
            c.semContador && 'contador',
            c.semRegime && 'regime',
            c.semMunicipio && 'município',
            c.semResponsavel && 'responsável',
          ]
            .filter(Boolean)
            .join(', '),
        href: '/admin/clientes',
      })),
    };
  }

  private async syncComProblema() {
    const where = and(
      sql`${controleNsu.statusSefaz} IS NOT NULL`,
      sql`${controleNsu.statusSefaz} NOT IN (${sql.join(SYNC_OK.map((c) => sql`${c}`), sql`, `)})`,
    );
    const rows = await this.database.db
      .select({
        clienteId: controleNsu.clienteId,
        razaoSocial: clientes.razaoSocial,
        tipoDocumento: controleNsu.tipoDocumento,
        motivo: controleNsu.motivoSefaz,
        ultimaConsultaEm: controleNsu.ultimaConsultaEm,
      })
      .from(controleNsu)
      .innerJoin(clientes, eq(clientes.id, controleNsu.clienteId))
      .where(and(where, eq(clientes.suspenso, false)))
      .orderBy(desc(controleNsu.ultimaConsultaEm));
    return {
      total: rows.length,
      itens: rows.slice(0, TOP).map((r) => ({
        label: r.razaoSocial,
        detalhe: `${r.tipoDocumento}${r.motivo ? ` · ${r.motivo}` : ''}`,
        href: '/admin/fiscal',
      })),
    };
  }

  private async agendaGuias(hoje: string): Promise<DashboardAgendaItem[]> {
    const rows = await this.database.db
      .select({
        id: guias.id,
        tipo: guias.tipo,
        periodo: guias.periodo,
        vencimento: guias.vencimento,
        razaoSocial: clientes.razaoSocial,
      })
      .from(guias)
      .innerJoin(clientes, eq(clientes.id, guias.clienteId))
      .where(
        and(
          eq(guias.status, 'PENDENTE'),
          gte(guias.vencimento, hoje),
          lte(guias.vencimento, addDias(hoje, 15)),
        ),
      )
      .orderBy(asc(guias.vencimento))
      .limit(12);
    return rows.map((g) => ({
      id: g.id,
      data: g.vencimento as string,
      titulo: g.razaoSocial,
      detalhe: `${g.tipo} · ${g.periodo}`,
      href: '/admin/guias',
    }));
  }

  /** DeSTDA vence no dia 28 do mês seguinte à competência (Simples Nacional). */
  private async prazoDestda(hoje: string): Promise<DashboardAgendaItem | null> {
    const [y, m] = hoje.split('-').map(Number);
    let prazo = `${y}-${String(m).padStart(2, '0')}-28`;
    if (prazo < hoje) {
      const proximo = new Date(Date.UTC(y, m, 28));
      prazo = proximo.toISOString().slice(0, 10);
    }
    if (prazo > addDias(hoje, 15)) return null;
    const [row] = await this.database.db
      .select({ total: sql<number>`count(*)::int` })
      .from(clientes)
      .where(
        and(
          eq(clientes.suspenso, false),
          eq(clientes.tipoPessoa, 'PJ'),
          eq(clientes.regimeTributario, 'SIMPLES_NACIONAL'),
        ),
      );
    if (!row?.total) return null;
    return {
      id: `destda-${prazo}`,
      data: prazo,
      titulo: 'Entrega da DeSTDA',
      detalhe: `${row.total} cliente(s) do Simples Nacional`,
      href: '/admin/fiscal/destda',
    };
  }

  /** Clientes ativos sem guia ou folha na competência em fechamento (MM/AAAA). */
  private async fechamento(competenciaBrValue: string) {
    const ativos = and(eq(clientes.suspenso, false));
    const [[total], [semGuia], [semFolha]] = await Promise.all([
      this.database.db
        .select({ total: sql<number>`count(*)::int` })
        .from(clientes)
        .where(ativos),
      this.database.db
        .select({ total: sql<number>`count(*)::int` })
        .from(clientes)
        .where(
          and(
            ativos,
            sql`NOT EXISTS (SELECT 1 FROM ${guias} g WHERE g.cliente_id = ${clientes.id} AND g.periodo = ${competenciaBrValue})`,
          ),
        ),
      this.database.db
        .select({ total: sql<number>`count(*)::int` })
        .from(clientes)
        .where(
          and(
            ativos,
            sql`NOT EXISTS (SELECT 1 FROM ${folhasPagamento} f WHERE f.cliente_id = ${clientes.id} AND f.competencia = ${competenciaBrValue})`,
          ),
        ),
    ]);
    return {
      totalClientes: total?.total ?? 0,
      semGuia: semGuia?.total ?? 0,
      semFolha: semFolha?.total ?? 0,
    };
  }

  private async atividade(incluirFinanceiro: boolean): Promise<DashboardAtividade[]> {
    const [guiasRows, folhasRows, baixasRows] = await Promise.all([
      this.database.db
        .select({
          id: guias.id,
          tipo: guias.tipo,
          periodo: guias.periodo,
          em: guias.criadoEm,
          empresa: clientes.razaoSocial,
        })
        .from(guias)
        .innerJoin(clientes, eq(clientes.id, guias.clienteId))
        .orderBy(desc(guias.criadoEm))
        .limit(6),
      this.database.db
        .select({
          id: folhasPagamento.id,
          competencia: folhasPagamento.competencia,
          em: folhasPagamento.criadoEm,
          empresa: clientes.razaoSocial,
        })
        .from(folhasPagamento)
        .innerJoin(clientes, eq(clientes.id, folhasPagamento.clienteId))
        .orderBy(desc(folhasPagamento.criadoEm))
        .limit(6),
      !incluirFinanceiro
        ? Promise.resolve([])
        : this.database.db
        .select({
          id: financeiroBaixas.id,
          valor: financeiroBaixas.valorRecebido,
          em: financeiroBaixas.criadoEm,
          empresa: clientes.razaoSocial,
        })
        .from(financeiroBaixas)
        .innerJoin(financeiroFaturas, eq(financeiroFaturas.id, financeiroBaixas.faturaId))
        .innerJoin(clientes, eq(clientes.id, financeiroFaturas.clienteId))
        .orderBy(desc(financeiroBaixas.criadoEm))
        .limit(6),
    ]);
    const itens: DashboardAtividade[] = [
      ...guiasRows.map((g) => ({
        id: `guia-${g.id}`,
        tipo: 'GUIA' as const,
        titulo: `Guia ${g.tipo} ${g.periodo} enviada`,
        empresa: g.empresa,
        em: g.em.toISOString(),
      })),
      ...folhasRows.map((f) => ({
        id: `folha-${f.id}`,
        tipo: 'FOLHA' as const,
        titulo: `Folha ${f.competencia} lançada`,
        empresa: f.empresa,
        em: f.em.toISOString(),
      })),
      ...baixasRows.map((b) => ({
        id: `baixa-${b.id}`,
        tipo: 'RECEBIMENTO' as const,
        titulo: `Recebimento de R$ ${b.valor}`,
        empresa: b.empresa,
        em: b.em.toISOString(),
      })),
    ];
    return itens.sort((a, b) => b.em.localeCompare(a.em)).slice(0, 10);
  }
}

function formatarData(value: string | null): string {
  if (!value) return '—';
  const [y, m, d] = value.split('-');
  return `${d}/${m}/${y}`;
}
