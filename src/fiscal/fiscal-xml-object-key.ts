import type { ParsedDocumentoFiscal } from './services/dfe-document.parser';

export function fiscalXmlObjectKey(input: {
  cnpj: string;
  dataEmissao: Date;
  tipoDocumento: ParsedDocumentoFiscal['tipoDocumento'];
  chaveAcesso: string;
}): string {
  const ano = String(input.dataEmissao.getUTCFullYear());
  const mes = String(input.dataEmissao.getUTCMonth() + 1).padStart(2, '0');
  return `clientes/${input.cnpj}/fiscais/${ano}/${mes}/${input.tipoDocumento.toLowerCase()}/${input.chaveAcesso}.xml`;
}
