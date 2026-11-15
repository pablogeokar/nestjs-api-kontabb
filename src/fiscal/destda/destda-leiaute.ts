/**
 * Leiaute da DeSTDA (Declaração de Substituição Tributária, Diferencial de
 * Alíquota e Antecipação) — Ajuste SINIEF 12/2015 e Manual de Orientação do
 * Leiaute instituído pelo Ato COTEPE/ICMS 47/2015 (Anexo Único).
 *
 * Fonte: https://www.confaz.fazenda.gov.br/legislacao/atos/2015/ac047_15
 * (consultada em 2026; nenhuma alteração posterior do leiaute foi localizada,
 * a versão vigente do arquivo continua sendo a tabela 3.1.1 = 2000).
 */
export const DESTDA_COD_VER = '2000' as const;
export const DESTDA_LEIAUTE_TEXTO = 'LFPD' as const;
export const DESTDA_COD_CTD = '30' as const;
export const DESTDA_PAIS = 'Brasil' as const;

/** Tabela 3.2.1 — finalidade do arquivo. */
export const DESTDA_FINALIDADES = ['0', '1'] as const;
export type DestdaFinalidade = (typeof DESTDA_FINALIDADES)[number];

/** Blocos na ordem exigida pelo manual (item 2.5.1/2.5.2). */
export const DESTDA_BLOCK_ORDER = ['0', 'G', '9'] as const;
export type DestdaBlockCode = (typeof DESTDA_BLOCK_ORDER)[number];

/**
 * Quantidade de campos de cada registro, contando o campo REG (LIN), conforme
 * o Apêndice B do manual. Usada pelo validador estrutural.
 */
export const DESTDA_EXPECTED_FIELD_COUNTS: Readonly<Record<string, number>> = {
  '0000': 20,
  '0001': 2,
  '0002': 3,
  '0005': 14,
  '0030': 18,
  '0100': 18,
  '0990': 2,
  G001: 2,
  G020: 4,
  G600: 4,
  G605: 5,
  G610: 4,
  G615: 5,
  G620: 7,
  G625: 6,
  G990: 2,
  '9001': 2,
  '9900': 3,
  '9990': 2,
  '9999': 2,
};

/** Tabela 4.2.3 — siglas das UFs (inclui EX). */
export const DESTDA_UFS = [
  'AC',
  'AL',
  'AM',
  'AP',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MG',
  'MS',
  'MT',
  'PA',
  'PB',
  'PE',
  'PI',
  'PR',
  'RJ',
  'RN',
  'RO',
  'RR',
  'RS',
  'SC',
  'SE',
  'SP',
  'TO',
  'EX',
] as const;

/** Tabela 3.3.2 — qualificação de assinantes. */
export const DESTDA_COD_ASSINANTES = [
  '203',
  '204',
  '205',
  '206',
  '207',
  '220',
  '222',
  '223',
  '226',
  '309',
  '312',
  '313',
  '315',
  '801',
  '900',
  '999',
] as const;
export const DESTDA_COD_ASSINANTE_CONTADOR = '900' as const;

/** G605.IND_SIT. */
export type DestdaIndSit = '0' | '1' | '2' | '3';
/** G620.IND_OPER. */
export type DestdaIndOper = '0' | '1';
/** G620.IND_EMIT. */
export type DestdaIndEmit = '0' | '1';
/** G625.IND_TP_ST. */
export type DestdaIndTpSt = '0' | '1' | '2' | '3';

/** Código IBGE da UF (2 primeiros dígitos do código do município). */
export const DESTDA_UF_POR_CODIGO_IBGE: Readonly<Record<string, string>> = {
  '11': 'RO',
  '12': 'AC',
  '13': 'AM',
  '14': 'RR',
  '15': 'PA',
  '16': 'AP',
  '17': 'TO',
  '21': 'MA',
  '22': 'PI',
  '23': 'CE',
  '24': 'RN',
  '25': 'PB',
  '26': 'PE',
  '27': 'AL',
  '28': 'SE',
  '29': 'BA',
  '31': 'MG',
  '32': 'ES',
  '33': 'RJ',
  '35': 'SP',
  '41': 'PR',
  '42': 'SC',
  '43': 'RS',
  '50': 'MS',
  '51': 'MT',
  '52': 'GO',
  '53': 'DF',
};
