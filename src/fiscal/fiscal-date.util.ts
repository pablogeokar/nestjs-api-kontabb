export function parseFiscalStartDate(value?: string) {
  return value ? new Date(value) : undefined;
}

export function parseFiscalEndDate(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    date.setUTCHours(23, 59, 59, 999);
  }
  return date;
}

export interface CompetenciaRange {
  // Primeiro dia do mês no formato 'YYYY-MM-01' (usado nas colunas date do SPED).
  competencia: string;
  // Limites do mês para filtros por data de emissão (timestamps).
  inicio: Date;
  fim: Date;
}

/**
 * Normaliza uma competência mensal 'YYYY-MM' para o padrão fiscal do sistema:
 * data 'YYYY-MM-01' e o intervalo [primeiro dia 00:00, último dia 23:59:59].
 * Lança Error para entradas inválidas (o chamador converte em BadRequest).
 */
export function parseCompetenciaMensal(value: string): CompetenciaRange {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value ?? '');
  if (!match) {
    throw new Error(
      'Competência inválida. Utilize o formato AAAA-MM (ex.: 2026-09).',
    );
  }
  const ano = Number(match[1]);
  const mes = Number(match[2]);
  const competencia = `${match[1]}-${match[2]}-01`;
  const inicio = new Date(Date.UTC(ano, mes - 1, 1, 0, 0, 0, 0));
  // Dia 0 do mês seguinte = último dia do mês corrente.
  const fim = new Date(Date.UTC(ano, mes, 0, 23, 59, 59, 999));
  return { competencia, inicio, fim };
}
