import type { DestdaPerfil } from './destda.types';

/**
 * Domínios do registro 0030 (Perfil do contribuinte), conforme o Apêndice B do
 * Ato COTEPE/ICMS 47/2015.
 */
export const DESTDA_PERFIL_DOMINIOS: Readonly<
  Record<keyof DestdaPerfil, readonly string[]>
> = {
  indEd: ['0', '1', '2', '3'],
  indArq: ['7'],
  prfIss: ['0', '2', '9'],
  prfIcms: ['0', '1', '2', '9'],
  prfRidf: ['0', '1'],
  prfRudf: ['0', '1'],
  prfLmc: ['0', '1'],
  prfRv: ['0', '1'],
  prfRi: ['0', '1'],
  indEc: ['1', '2', '3', '4', '5', '9'],
  indIss: ['0', '1'],
  indRt: ['0', '1'],
  indIcms: ['0', '1'],
  indSt: ['0', '1'],
  indAt: ['0', '1'],
  indIpi: ['0', '1'],
  indRiAvulso: ['0', '1'],
};

/**
 * Perfil padrão de um optante pelo Simples Nacional que declara ICMS: escritura
 * no modo simplificado, não está sujeito a ISS/IPI nem a livros especiais. Os
 * indicadores IND_ST e IND_AT são derivados do movimento da competência.
 * Qualquer campo pode ser sobrescrito na configuração da empresa.
 */
export const DESTDA_PERFIL_PADRAO: Readonly<DestdaPerfil> = {
  indEd: '3',
  indArq: '7',
  prfIss: '9',
  prfIcms: '0',
  prfRidf: '1',
  prfRudf: '1',
  prfLmc: '1',
  prfRv: '1',
  prfRi: '1',
  indEc: '9',
  indIss: '1',
  indRt: '1',
  indIcms: '0',
  indSt: '1',
  indAt: '1',
  indIpi: '1',
  indRiAvulso: '1',
};

const CHAVES = Object.keys(DESTDA_PERFIL_PADRAO) as Array<keyof DestdaPerfil>;

/** Devolve as mensagens de erro de um perfil informado (vazio = válido). */
export function validarPerfil(perfil: Record<string, unknown>): string[] {
  const erros: string[] = [];
  for (const [chave, valor] of Object.entries(perfil)) {
    if (!(CHAVES as string[]).includes(chave)) {
      erros.push(`Campo de perfil desconhecido: ${chave}.`);
      continue;
    }
    const dominio = DESTDA_PERFIL_DOMINIOS[chave as keyof DestdaPerfil];
    if (typeof valor !== 'string' || !dominio.includes(valor)) {
      erros.push(`Valor inválido para ${chave}: use ${dominio.join(', ')}.`);
    }
  }
  return erros;
}

/**
 * Monta o perfil final: padrão, depois o derivado do movimento, depois as
 * sobrescritas explícitas da empresa (que sempre vencem).
 */
export function montarPerfil(
  sobrescritas: Record<string, string> | null | undefined,
  derivados: Partial<Pick<DestdaPerfil, 'indSt' | 'indAt'>>,
): DestdaPerfil {
  const base: DestdaPerfil = {
    ...DESTDA_PERFIL_PADRAO,
    ...derivados,
  };
  for (const chave of CHAVES) {
    const valor = sobrescritas?.[chave];
    if (valor !== undefined && DESTDA_PERFIL_DOMINIOS[chave].includes(valor)) {
      base[chave] = valor;
    }
  }
  return base;
}
