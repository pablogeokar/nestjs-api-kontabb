import { fromScaledInteger, toScaledInteger } from '../sped/sped-decimal';

/** A classificação é conservadora: CFOP desconhecido exige conferência fiscal. */
export function classificarOperacaoSimples(
  tipoDocumento: string,
  cfop: string | null,
): 'RECEITA' | 'NAO_RECEITA' | 'REVISAR' {
  if (tipoDocumento === 'NFSE') return 'RECEITA';
  if (!cfop || !/^[567]\d{3}$/.test(cfop)) return 'REVISAR';
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
