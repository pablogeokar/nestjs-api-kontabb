import type { FaturamentoMesSnapshot } from '../../database/schema';

/** Centavos a partir de "123.45" (duas casas), sem passar por ponto flutuante. */
export const centavos = (value: string): bigint => {
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = value.replace('-', '').split('.');
  const amount =
    BigInt(whole || '0') * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
  return negative ? -amount : amount;
};

/** "123.45" a partir de centavos. */
export const decimal = (value: bigint): string => {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  return `${negative ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
};

/** "1.234,56" a partir de centavos, com milhar e vírgula decimal. */
export function formatarCentavos(value: bigint): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(3, '0');
  const inteiro = digits.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}${inteiro},${digits.slice(-2)}`;
}

export type TipoReceita = 'MERCADORIAS' | 'SERVICOS' | 'TRANSPORTES';

export const TIPOS_RECEITA: TipoReceita[] = [
  'MERCADORIAS',
  'SERVICOS',
  'TRANSPORTES',
];

export const ROTULO_TIPO: Record<TipoReceita, string> = {
  MERCADORIAS: 'MERCADORIAS',
  SERVICOS: 'SERVIÇOS',
  TRANSPORTES: 'TRANSPORTES',
};

export function valorDoTipo(mes: FaturamentoMesSnapshot, tipo: TipoReceita) {
  if (tipo === 'MERCADORIAS') return centavos(mes.valorProdutos);
  if (tipo === 'SERVICOS') return centavos(mes.valorServicos);
  return centavos(mes.valorTransportes ?? '0.00');
}

export function quantidadeDoTipo(
  mes: FaturamentoMesSnapshot,
  tipo: TipoReceita,
) {
  if (tipo === 'MERCADORIAS') return mes.quantidadeProdutos;
  if (tipo === 'SERVICOS') return mes.quantidadeServicos;
  return mes.quantidadeTransportes ?? 0;
}

/**
 * Colunas exibidas na tabela: só os tipos de receita com movimento no período.
 * Sem movimento algum, mostra mercadorias e serviços para o quadro não ficar vazio.
 */
export function colunasAtivas(meses: FaturamentoMesSnapshot[]): TipoReceita[] {
  const ativas = TIPOS_RECEITA.filter((tipo) =>
    meses.some(
      (mes) => valorDoTipo(mes, tipo) !== 0n || quantidadeDoTipo(mes, tipo) > 0,
    ),
  );
  return ativas.length > 0 ? ativas : ['MERCADORIAS', 'SERVICOS'];
}

export function documentosDoMes(mes: FaturamentoMesSnapshot): number {
  return TIPOS_RECEITA.reduce((n, tipo) => n + quantidadeDoTipo(mes, tipo), 0);
}

export interface TotaisPeriodo {
  porTipo: Record<TipoReceita, bigint>;
  documentos: number;
  total: bigint;
  /** Total dividido pelo número de competências do período (inclui meses sem receita), arredondado ao centavo. */
  mediaMensal: bigint;
  competencias: number;
}

export function totaisPeriodo(meses: FaturamentoMesSnapshot[]): TotaisPeriodo {
  const porTipo: Record<TipoReceita, bigint> = {
    MERCADORIAS: 0n,
    SERVICOS: 0n,
    TRANSPORTES: 0n,
  };
  let documentos = 0;
  let total = 0n;
  for (const mes of meses) {
    for (const tipo of TIPOS_RECEITA) porTipo[tipo] += valorDoTipo(mes, tipo);
    documentos += documentosDoMes(mes);
    total += centavos(mes.total);
  }
  const n = BigInt(meses.length);
  const mediaMensal = n > 0n ? (total * 2n + n) / (2n * n) : 0n;
  return {
    porTipo,
    documentos,
    total,
    mediaMensal,
    competencias: meses.length,
  };
}

/** "2026-10" -> "10/2026". */
export const rotuloCompetencia = (value: string) =>
  `${value.slice(5)}/${value.slice(0, 4)}`;

export function rotuloPeriodo(inicio: string, fim: string): string {
  return inicio === fim
    ? rotuloCompetencia(inicio)
    : `${rotuloCompetencia(inicio)} a ${rotuloCompetencia(fim)}`;
}

/** CNPJ (inclusive alfanumérico) ou CPF com máscara; valor fora do padrão volta como veio. */
export function formatarDocumentoFiscal(value: string): string {
  const raw = value.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  if (/^\d{11}$/.test(raw))
    return raw.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  if (/^[0-9A-Z]{12}\d{2}$/.test(raw))
    return raw.replace(
      /^([0-9A-Z]{2})([0-9A-Z]{3})([0-9A-Z]{3})([0-9A-Z]{4})(\d{2})$/,
      '$1.$2.$3/$4-$5',
    );
  return value;
}

/** "21/11/2026 às 14:32", no horário da Bahia, sem depender do ICU do ambiente. */
export function formatarDataHora(date: Date): string {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Bahia',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')} às ${get('hour')}:${get('minute')}`;
}

export function formatarData(date: Date): string {
  return formatarDataHora(date).split(' às ')[0];
}
