import { fromScaledInteger, toScaledInteger } from '../sped/sped-decimal';

// CFOP do ponto de vista do estabelecimento que recebe a devolução.
export const CFOPS_DEVOLUCAO_VENDA = [
  '1201',
  '1202',
  '1203',
  '1204',
  '1410',
  '1411',
  '1660',
  '1661',
  '1662',
  '2201',
  '2202',
  '2203',
  '2204',
  '2410',
  '2411',
  '2660',
  '2661',
  '2662',
  '3201',
  '3202',
  '3211',
];

export function segregacaoMercadoriaSimples(
  cfop: string,
  item: {
    csosn: string | null;
    cstPis: string | null;
    cstCofins: string | null;
  },
) {
  return {
    st: ['5405', '6405'].includes(cfop) || item.csosn === '500',
    monofasico: item.cstPis === '04' || item.cstCofins === '04',
  };
}

export function chaveMercadoriaSimples(
  anexo: string,
  st: boolean,
  monofasico: boolean,
) {
  return `${anexo}:${st}:${monofasico}`;
}

interface MovimentoDevolucao {
  mes: string;
  grupo: string;
  valor: bigint;
}

type TotaisPorGrupo = Map<string, { vendas: bigint; devolucoes: bigint }>;

export function distribuirDevolucoesSimples(
  vendas: MovimentoDevolucao[],
  devolucoes: MovimentoDevolucao[],
  mesesManuais: Set<string>,
  mesFinal: string,
) {
  const movimentos = new Map<string, TotaisPorGrupo>();
  for (const [tipo, itens] of [
    ['vendas', vendas],
    ['devolucoes', devolucoes],
  ] as const) {
    for (const { mes, grupo, valor } of itens) {
      const porGrupo =
        movimentos.get(mes) ??
        new Map<string, { vendas: bigint; devolucoes: bigint }>();
      const totais = porGrupo.get(grupo) ?? { vendas: 0n, devolucoes: 0n };
      totais[tipo] += valor;
      porGrupo.set(grupo, totais);
      movimentos.set(mes, porGrupo);
    }
  }
  const saldos = new Map<string, bigint>();
  const porMes = new Map<
    string,
    {
      abatimentos: Map<string, bigint>;
      saldo: bigint;
      saldoComHistoricoManual: boolean;
    }
  >();
  // Mantém a segregação nos meses sem vendas e nas viradas de ano.
  const meses = [
    ...new Set([...movimentos.keys(), ...mesesManuais, mesFinal]),
  ].sort();
  const gruposComHistoricoManual = new Set<string>();
  for (const mes of meses) {
    const porGrupo = movimentos.get(mes);
    const abatimentos = new Map<string, bigint>();
    let saldoComHistoricoManual = false;
    for (const grupo of new Set([
      ...(porGrupo?.keys() ?? []),
      ...saldos.keys(),
    ])) {
      const valores = porGrupo?.get(grupo);
      const disponivel =
        (saldos.get(grupo) ?? 0n) + (valores?.devolucoes ?? 0n);
      if (disponivel === 0n) continue;
      const receita = valores?.vendas ?? 0n;
      const abatimento = receita < disponivel ? receita : disponivel;
      if (abatimento > 0n) abatimentos.set(grupo, abatimento);
      const saldo = disponivel - abatimento;
      if (mesesManuais.has(mes) && saldo > 0n)
        gruposComHistoricoManual.add(grupo);
      if (gruposComHistoricoManual.has(grupo)) saldoComHistoricoManual = true;
      if (saldo > 0n) {
        saldos.set(grupo, saldo);
      } else {
        saldos.delete(grupo);
        gruposComHistoricoManual.delete(grupo);
      }
    }
    porMes.set(mes, {
      abatimentos,
      saldo: [...saldos.values()].reduce((total, valor) => total + valor, 0n),
      saldoComHistoricoManual,
    });
  }
  return porMes;
}

export function regimeCompetenciaParaApuracao(
  competencia: string,
  regimeCompetenciaCliente: boolean,
): boolean {
  return competencia.slice(0, 4) >= '2027' || regimeCompetenciaCliente;
}

/** A classificação é conservadora: CFOP desconhecido exige conferência fiscal. */
export function classificarOperacaoSimples(
  tipoDocumento: string,
  cfop: string | null,
): 'RECEITA' | 'NAO_RECEITA' | 'REVISAR' {
  if (tipoDocumento === 'NFSE') return 'RECEITA';
  if (!cfop || !/^[567]\d{3}$/.test(cfop)) return 'REVISAR';
  // CT-e de prestação tem CFOP próprio; a regra de venda de mercadorias não
  // alcança 5/6351-357 e 5/6360. Exportação exige segregação específica.
  if (tipoDocumento === 'CTE') {
    return /^[56]35[1-7]$|^[56]360$/.test(cfop) ? 'RECEITA' : 'REVISAR';
  }
  const operacao = cfop.slice(1);
  if (/^(10[1-9]|11\d|12[0-5]|35[1-9]|360|40[1-5]|65[1-6])$/.test(operacao))
    return 'RECEITA';
  // Simples faturamento pode antecipar receita, e o CFOP genérico depende
  // da operação subjacente. Não é seguro presumir tributação nem isenção.
  if (operacao === '922' || operacao === '949') return 'REVISAR';
  // Remessas, transferências e devoluções de compras não geram nova receita.
  if (/^(15[1-6]|2\d{2}|5\d{2}|9\d{2})$/.test(operacao)) return 'NAO_RECEITA';
  return 'REVISAR';
}

export function valorReceitaSimples(item: {
  bruto: string;
  frete: string | null;
  seguro: string | null;
  outras: string | null;
  desconto: string | null;
}): bigint {
  return (
    toScaledInteger(item.bruto) +
    toScaledInteger(item.frete ?? '0') +
    toScaledInteger(item.seguro ?? '0') +
    toScaledInteger(item.outras ?? '0') -
    toScaledInteger(item.desconto ?? '0')
  );
}

export function somarReceitaSimples(valores: bigint[]): string {
  return fromScaledInteger(valores.reduce((total, valor) => total + valor, 0n));
}
