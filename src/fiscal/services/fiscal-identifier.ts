const CPF_PATTERN = /^\d{11}$/;
const CNPJ_PATTERN = /^[A-Z0-9]{12}\d{2}$/;
const ACCESS_KEY_PATTERN = /^\d{6}[A-Z0-9]{12}\d{26}$/;

/**
 * Normaliza CPF/CNPJ sem converter o identificador em number. O CNPJ aceita o
 * formato alfanumérico definido para o domínio fiscal, preservando os CNPJs
 * numéricos já emitidos nos XMLs atuais.
 */
export function normalizeFiscalTaxId(value: string): string {
  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/[./\s-]/g, '');
  return CPF_PATTERN.test(normalized) || CNPJ_PATTERN.test(normalized)
    ? normalized
    : '';
}

/** Remove somente o prefixo XML e espaços de apresentação da chave. */
export function normalizeFiscalAccessKey(value: string): string {
  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/^(?:NFE|CTE)/, '')
    .replace(/\s/g, '');
  return ACCESS_KEY_PATTERN.test(normalized) ? normalized : '';
}

/**
 * Confere o dígito verificador módulo 11 da chave de acesso. Letras usam o
 * valor ASCII menos 48, regra compatível com os identificadores fiscais
 * alfanuméricos, enquanto dígitos mantêm exatamente o cálculo histórico.
 */
export function isValidFiscalAccessKey(value: string): boolean {
  const normalized = normalizeFiscalAccessKey(value);
  if (!normalized) return false;

  let weight = 2;
  let sum = 0;
  for (let index = 42; index >= 0; index--) {
    const character = normalized[index];
    const digitValue = /\d/.test(character)
      ? Number(character)
      : character.charCodeAt(0) - 48;
    sum += digitValue * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const remainder = sum % 11;
  const calculatedDigit = remainder < 2 ? 0 : 11 - remainder;
  return calculatedDigit === Number(normalized[43]);
}
