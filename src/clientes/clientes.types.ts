export const REGIMES_TRIBUTARIOS = [
  'SIMPLES_NACIONAL',
  'LUCRO_PRESUMIDO',
  'LUCRO_REAL',
] as const;

export type RegimeTributario = (typeof REGIMES_TRIBUTARIOS)[number];

export const TIPOS_CONTRIBUINTE_ICMS = [
  'CONTRIBUINTE',
  'ISENTO',
  'NAO_CONTRIBUINTE',
] as const;

export type TipoContribuinteIcms = (typeof TIPOS_CONTRIBUINTE_ICMS)[number];

export const FONTES_CONSULTA_CNPJ = ['OPEN_CNPJ', 'RECEITA_WS'] as const;

export type FonteConsultaCnpj = (typeof FONTES_CONSULTA_CNPJ)[number];

export function simplesNacionalSemApuracaoIcms(config: {
  regimeTributario: RegimeTributario | null;
  apuraIcms: boolean;
}) {
  return config.regimeTributario === 'SIMPLES_NACIONAL' && !config.apuraIcms;
}
