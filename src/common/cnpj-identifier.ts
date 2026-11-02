/** Remove a máscara de CNPJ sem descartar letras. Não valida dígitos. */
export function normalizeCnpjIdentifier(value: string): string {
  return value.toUpperCase().replace(/[^0-9A-Z]/g, '');
}
