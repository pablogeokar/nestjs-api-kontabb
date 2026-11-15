export const COMPETENCIA_REGEX = /^(0[1-9]|1[0-2])\/[0-9]{4}$/;
export const DATA_CIVIL_REGEX =
  /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;
export const COMPETENCIA_MESSAGE = 'competência deve estar no formato MM/AAAA.';
export const DATA_CIVIL_MESSAGE = 'data deve estar no formato AAAA-MM-DD.';
export const NATUREZAS = ['DEBITO', 'CREDITO'] as const;
export type Natureza = (typeof NATUREZAS)[number];
export const STATUS_LANCAMENTO = ['PENDENTE', 'FATURADO', 'CANCELADO'] as const;
export const STATUS_FATURA = [
  'PENDENTE',
  'PARCIALMENTE_PAGA',
  'PAGA',
  'VENCIDA',
  'CANCELADA',
] as const;
export type StatusFatura = (typeof STATUS_FATURA)[number];
export const FORMAS_PAGAMENTO = [
  'PIX',
  'BOLETO',
  'TRANSFERENCIA',
  'DINHEIRO',
  'CARTAO',
  'OUTROS',
] as const;
