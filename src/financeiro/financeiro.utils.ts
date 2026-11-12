import { sql } from 'drizzle-orm';
import { financeiroBaixas, financeiroFaturas } from '../database/schema';

/** Converte um valor monetário (number ou string numeric) em centavos inteiros. */
export function toCents(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  return Math.round(Number(value) * 100);
}

/** Converte centavos inteiros em string numeric(12,2). */
export function fromCents(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const text = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return negative ? `-${text}` : text;
}

/** Último dia do mês (month 1..12). */
export function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Monta YYYY-MM-DD ajustando o dia ao último dia do mês quando necessário. */
export function buildCivilDate(
  year: number,
  month: number,
  day: number,
): string {
  const safeDay = Math.min(day, lastDayOfMonth(year, month));
  return `${year}-${String(month).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`;
}

/** Vencimento no mês subsequente à competência (MM/YYYY). */
export function calcularVencimento(
  competencia: string,
  diaVencimento: number,
): string {
  const [mesStr, anoStr] = competencia.split('/');
  let year = Number(anoStr);
  let month = Number(mesStr) + 1;
  if (month > 12) {
    month = 1;
    year += 1;
  }
  return buildCivilDate(year, month, diaVencimento);
}

/** Competência (MM/YYYY) a partir de uma data civil YYYY-MM-DD. */
export function competenciaDeData(date: string): string {
  return `${date.slice(5, 7)}/${date.slice(0, 4)}`;
}

/** Valor do principal abatido por uma baixa (recebido − multa − juros + desconto). */
export function principalAbatidoCents(baixa: {
  valorRecebido: string;
  valorMulta: string;
  valorJuros: string;
  valorDesconto: string;
}): number {
  return (
    toCents(baixa.valorRecebido) -
    toCents(baixa.valorMulta) -
    toCents(baixa.valorJuros) +
    toCents(baixa.valorDesconto)
  );
}

export type StatusFaturaPersistido =
  'PENDENTE' | 'PARCIALMENTE_PAGA' | 'PAGA' | 'VENCIDA' | 'CANCELADA';

/**
 * Resolve o status de uma fatura não cancelada a partir do principal abatido.
 * Faturas em aberto (total ou parcialmente) e vencidas viram VENCIDA.
 */
export function resolverStatusFatura(input: {
  abatidoCents: number;
  liquidoCents: number;
  dataVencimento: string;
  hoje: string;
}): StatusFaturaPersistido {
  if (input.abatidoCents >= input.liquidoCents && input.liquidoCents > 0) {
    return 'PAGA';
  }
  if (input.dataVencimento < input.hoje) return 'VENCIDA';
  return input.abatidoCents > 0 ? 'PARCIALMENTE_PAGA' : 'PENDENTE';
}

/** Status exibido: deriva VENCIDA de faturas em aberto com vencimento passado. */
export function derivarStatusFatura(
  status: string,
  dataVencimento: string,
  hoje: string,
): string {
  if (
    (status === 'PENDENTE' || status === 'PARCIALMENTE_PAGA') &&
    dataVencimento < hoje
  ) {
    return 'VENCIDA';
  }
  return status;
}

/** Subquery SQL: saldo em aberto (principal) da fatura corrente. */
export const saldoAbertoSql = sql<string>`CASE WHEN ${financeiroFaturas.status} = 'CANCELADA' THEN 0.00 ELSE GREATEST(0.00, ${financeiroFaturas.valorLiquido} - COALESCE((
  SELECT SUM(${financeiroBaixas.valorRecebido} - ${financeiroBaixas.valorMulta} - ${financeiroBaixas.valorJuros} + ${financeiroBaixas.valorDesconto})
  FROM ${financeiroBaixas}
  WHERE ${financeiroBaixas.faturaId} = ${financeiroFaturas.id} AND ${financeiroBaixas.estornado} = false
), 0)) END`;

/** Detecta violação de unicidade (23505) inclusive quando encapsulada pelo Drizzle. */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if ((current as { code?: string }).code === '23505') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** Valida uma data civil YYYY-MM-DD existente no calendário (ex.: rejeita 2026-02-31). */
export function isValidCivilDate(value: string): boolean {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

/** Índice ordenável de uma competência MM/AAAA (ano*12 + mês). */
export function competenciaIndex(competencia: string): number {
  const [mes, ano] = competencia.split('/');
  return Number(ano) * 12 + Number(mes);
}

/** Verifica se a competência está dentro da vigência (limites opcionais e inclusivos). */
export function competenciaNaVigencia(
  competencia: string,
  inicio?: string | null,
  fim?: string | null,
): boolean {
  const alvo = competenciaIndex(competencia);
  if (inicio && alvo < competenciaIndex(inicio)) return false;
  if (fim && alvo > competenciaIndex(fim)) return false;
  return true;
}
