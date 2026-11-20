import { asc, eq, isNull, and } from 'drizzle-orm';
import type { DatabaseService } from '../database/database.service';
import {
  clientes,
  contadores,
  financeiroContratos,
  financeiroContratosAditivos,
  financeiroContratosItens,
  financeiroTiposLancamento,
} from '../database/schema';
import {
  buildCivilDate,
  competenciaIndex,
  fromCents,
  toCents,
} from './financeiro.utils';
import type { ContratoPdfData } from './services/financeiro-contrato-documento.service';
import { SERVICOS_CONTRATO } from './financeiro-servicos.catalogo';

export type ExecutorContrato =
  | DatabaseService['db']
  | Parameters<Parameters<DatabaseService['db']['transaction']>[0]>[0];
export interface ItemEstado {
  id: string;
  tipoLancamentoId: string;
  descricao: string;
  valor: string;
  natureza: string;
  competenciaInicio: string | null;
  competenciaFim: string | null;
  ativo: boolean;
}
export interface EstadoContrato {
  contrato: Pick<
    typeof financeiroContratos.$inferSelect,
    | 'id'
    | 'valorMensalidade'
    | 'diaVencimento'
    | 'diaFechamento'
    | 'gera13o'
    | 'mes13o'
    | 'ativo'
    | 'dataInicio'
    | 'localAssinatura'
    | 'dataAssinatura'
    | 'avisoPrevioDias'
    | 'condicoesContratuais'
    | 'servicosContratados'
    | 'versao'
    | 'competenciaVigencia'
    | 'dataUltimoReajuste'
  >;
  itens: ItemEstado[];
  cliente: ContratoPdfData['cliente'];
  contador:
    | (Omit<ContratoPdfData['contador'], 'municipio' | 'uf'> & {
        codigoMunicipioIbge: string;
      })
    | null;
}

export function contratoFormalizado(estado: EstadoContrato): boolean {
  const c = estado.contrato;
  return Boolean(
    c.dataInicio &&
    c.dataAssinatura &&
    c.localAssinatura?.trim() &&
    c.servicosContratados.length &&
    estado.contador?.nome &&
    estado.contador.documento &&
    estado.contador.crc &&
    (estado.cliente.tipoPessoa !== 'PJ' ||
      estado.cliente.representante?.trim()),
  );
}

export async function capturarEstadoContrato(
  tx: ExecutorContrato,
  contrato: typeof financeiroContratos.$inferSelect,
): Promise<EstadoContrato> {
  const itens = await tx
    .select({
      id: financeiroContratosItens.id,
      tipoLancamentoId: financeiroContratosItens.tipoLancamentoId,
      descricao: financeiroContratosItens.descricao,
      valor: financeiroContratosItens.valor,
      natureza: financeiroTiposLancamento.natureza,
      competenciaInicio: financeiroContratosItens.competenciaInicio,
      competenciaFim: financeiroContratosItens.competenciaFim,
      ativo: financeiroContratosItens.ativo,
    })
    .from(financeiroContratosItens)
    .innerJoin(
      financeiroTiposLancamento,
      eq(
        financeiroTiposLancamento.id,
        financeiroContratosItens.tipoLancamentoId,
      ),
    )
    .where(
      and(
        eq(financeiroContratosItens.contratoId, contrato.id),
        isNull(financeiroContratosItens.removidoEm),
      ),
    )
    .orderBy(
      asc(financeiroContratosItens.criadoEm),
      asc(financeiroContratosItens.id),
    );
  const [row] = await tx
    .select({ cliente: clientes, contador: contadores })
    .from(clientes)
    .leftJoin(contadores, eq(contadores.id, clientes.contadorId))
    .where(eq(clientes.id, contrato.clienteId))
    .limit(1);
  const c = row.cliente;
  const p = row.contador;
  const endereco = (r: {
    logradouro: string | null;
    numero: string | null;
    complemento: string | null;
    bairro: string | null;
    cep: string | null;
  }) =>
    [r.logradouro, r.numero, r.complemento, r.bairro, r.cep]
      .filter(Boolean)
      .join(', ');
  const {
    id,
    valorMensalidade,
    diaVencimento,
    diaFechamento,
    gera13o,
    mes13o,
    ativo,
    dataInicio,
    localAssinatura,
    dataAssinatura,
    avisoPrevioDias,
    condicoesContratuais,
    servicosContratados,
    versao,
    competenciaVigencia,
    dataUltimoReajuste,
  } = contrato;
  return {
    contrato: {
      id,
      valorMensalidade,
      diaVencimento,
      diaFechamento,
      gera13o,
      mes13o,
      ativo,
      dataInicio,
      localAssinatura,
      dataAssinatura,
      avisoPrevioDias,
      condicoesContratuais,
      servicosContratados,
      versao,
      competenciaVigencia,
      dataUltimoReajuste,
    },
    itens,
    cliente: {
      razaoSocial: c.razaoSocial,
      cnpj: c.cnpj,
      tipoPessoa: c.tipoPessoa,
      representante: c.responsavelNome,
      municipio: c.municipio,
      uf: c.uf,
      endereco: [endereco(c), c.municipio, c.uf].filter(Boolean).join(', '),
    },
    contador: p
      ? {
          nome: p.nome,
          documento: p.cpf ?? p.cnpj ?? '',
          crc: p.crc,
          endereco: endereco(p),
          codigoMunicipioIbge: p.codigoMunicipioIbge,
        }
      : null,
  };
}

export async function estadoNaCompetencia(
  tx: ExecutorContrato,
  contratoId: string,
  competencia: string,
): Promise<EstadoContrato | null> {
  const historico = await tx
    .select({
      anterior: financeiroContratosAditivos.anterior,
      posterior: financeiroContratosAditivos.posterior,
      competencia: financeiroContratosAditivos.competenciaInicio,
    })
    .from(financeiroContratosAditivos)
    .where(eq(financeiroContratosAditivos.contratoId, contratoId))
    .orderBy(asc(financeiroContratosAditivos.numero));
  let estado = historico[0]?.anterior ?? null;
  for (const versao of historico) {
    if (competenciaIndex(versao.competencia) <= competenciaIndex(competencia))
      estado = versao.posterior;
  }
  return estado;
}

export function proximoReajuste(dataBase: string | null): string | null {
  if (!dataBase) return null;
  const [ano, mes, dia] = dataBase.split('-').map(Number);
  // O faturamento é mensal: a primeira competência deve começar após 12 meses completos.
  return dia === 1
    ? buildCivilDate(ano + 1, mes, 1)
    : buildCivilDate(
        ano + 1 + (mes === 12 ? 1 : 0),
        mes === 12 ? 1 : mes + 1,
        1,
      );
}

export function reajustarValor(valor: string, percentual: number): string {
  const fator = 1_000_000n + BigInt(Math.round(percentual * 10_000));
  const cents = (BigInt(toCents(valor)) * fator + 500_000n) / 1_000_000n;
  if (cents > 999_999_999_999n)
    throw new Error('O valor reajustado excede o limite permitido.');
  return fromCents(Number(cents));
}

export function alteracoesDoContrato(
  antes: EstadoContrato,
  depois: EstadoContrato,
): string[] {
  const campos: Array<[keyof EstadoContrato['contrato'], string]> = [
    ['valorMensalidade', 'Mensalidade base'],
    ['diaVencimento', 'Dia de vencimento'],
    ['diaFechamento', 'Dia de fechamento'],
    ['gera13o', 'Adicional anual'],
    ['mes13o', 'Mês do adicional anual'],
    ['ativo', 'Contrato ativo'],
    ['dataInicio', 'Início do contrato'],
    ['localAssinatura', 'Local de assinatura'],
    ['dataAssinatura', 'Data de assinatura'],
    ['avisoPrevioDias', 'Aviso prévio (dias)'],
    ['condicoesContratuais', 'Condições adicionais'],
    ['servicosContratados', 'Serviços e honorários'],
  ];
  const exibir = (v: unknown) => {
    if (v === null || v === '') return 'não informado';
    if (typeof v === 'boolean') return v ? 'sim' : 'não';
    if (typeof v === 'string') return v;
    if (typeof v === 'number') return v.toString();
    return JSON.stringify(v) ?? 'não informado';
  };
  const linhas: string[] = [];
  for (const [campo, nome] of campos) {
    if (
      JSON.stringify(antes.contrato[campo]) ===
      JSON.stringify(depois.contrato[campo])
    )
      continue;
    if (campo === 'servicosContratados') {
      const servicos = (e: EstadoContrato) =>
        e.contrato.servicosContratados
          .map(
            (s) =>
              `${s.descricao || SERVICOS_CONTRATO.find((c) => c.codigo === s.codigo)?.nome || s.codigo}: R$ ${Number(s.valorMensal).toFixed(2).replace('.', ',')}`,
          )
          .join('; ') || 'nenhum';
      linhas.push(
        `${nome} - anterior: ${servicos(antes)}. Novo: ${servicos(depois)}.`,
      );
    } else if (campo === 'valorMensalidade') {
      const moeda = (valor: string) =>
        new Intl.NumberFormat('pt-BR', {
          style: 'currency',
          currency: 'BRL',
        }).format(Number(valor));
      linhas.push(
        `${nome} - anterior: ${moeda(antes.contrato.valorMensalidade)}. Novo: ${moeda(depois.contrato.valorMensalidade)}.`,
      );
    } else
      linhas.push(
        `${nome} - anterior: ${exibir(antes.contrato[campo])}. Novo: ${exibir(depois.contrato[campo])}.`,
      );
  }
  const itens = (e: EstadoContrato) =>
    e.itens.map((i) => [
      i.tipoLancamentoId,
      i.descricao,
      i.valor,
      i.natureza,
      i.competenciaInicio,
      i.competenciaFim,
      i.ativo,
    ]);
  if (JSON.stringify(itens(antes)) !== JSON.stringify(itens(depois))) {
    const descrever = (e: EstadoContrato) =>
      e.itens
        .map(
          (i) =>
            `${i.descricao}: ${i.natureza === 'CREDITO' ? 'desconto de ' : ''}R$ ${Number(i.valor).toFixed(2).replace('.', ',')} (${i.ativo ? 'ativo' : 'inativo'}; ${i.competenciaInicio ?? 'sem início definido'} a ${i.competenciaFim ?? 'sem fim definido'})`,
        )
        .join('; ') || 'nenhum';
    linhas.push(
      `Adicionais e descontos - anteriores: ${descrever(antes)}. Novos: ${descrever(depois)}.`,
    );
  }
  return linhas;
}
