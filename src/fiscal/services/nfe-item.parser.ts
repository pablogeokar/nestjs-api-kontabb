import { XMLParser } from 'fast-xml-parser';

type XmlRecord = Record<string, unknown>;

export interface ParsedNfeItem {
  numeroItem: number;
  codigoProduto: string;
  codigoEan: string | null;
  descricao: string;
  ncm: string | null;
  nve: string | null;
  cest: string | null;
  indEscala: string | null;
  cnpjFabricante: string | null;
  codigoBeneficioFiscal: string | null;
  cfop: string;
  unidadeComercial: string;
  quantidadeComercial: string;
  valorUnitarioComercial: string;
  valorBrutoProduto: string;
  codigoEanTributavel: string | null;
  unidadeTributavel: string | null;
  quantidadeTributavel: string | null;
  valorUnitarioTributavel: string | null;
  valorFrete: string | null;
  valorSeguro: string | null;
  valorDesconto: string | null;
  valorOutrasDespesas: string | null;
  indTotal: string;
  numeroPedidoCompra: string | null;
  itemPedidoCompra: string | null;
  informacoesAdicionais: string | null;
  origemMercadoria: string | null;
  cstIcms: string | null;
  csosnIcms: string | null;
  modalidadeBcIcms: string | null;
  percentualReducaoBcIcms: string | null;
  valorBcIcms: string | null;
  aliquotaIcms: string | null;
  valorIcms: string | null;
  modalidadeBcIcmsSt: string | null;
  percentualMvaSt: string | null;
  percentualReducaoBcIcmsSt: string | null;
  valorBcIcmsSt: string | null;
  aliquotaIcmsSt: string | null;
  valorIcmsSt: string | null;
  valorBcFcp: string | null;
  aliquotaFcp: string | null;
  valorFcp: string | null;
  valorBcFcpSt: string | null;
  aliquotaFcpSt: string | null;
  valorFcpSt: string | null;
  motivoDesoneracaoIcms: string | null;
  valorIcmsDesonerado: string | null;
  percentualDiferimento: string | null;
  valorIcmsDiferido: string | null;
  valorIcmsOperacao: string | null;
  aliquotaCreditoSn: string | null;
  valorCreditoIcmsSn: string | null;
  valorBcIcmsStRetido: string | null;
  aliquotaIcmsStRetido: string | null;
  valorIcmsStRetido: string | null;
  valorBcIcmsUfDest: string | null;
  valorBcFcpUfDest: string | null;
  percentualFcpUfDest: string | null;
  aliquotaIcmsUfDest: string | null;
  aliquotaIcmsInterestadual: string | null;
  percentualProvisorioPartilha: string | null;
  valorFcpUfDest: string | null;
  valorIcmsUfDest: string | null;
  valorIcmsUfRemetente: string | null;
  cstIpi: string | null;
  classeEnquadramentoIpi: string | null;
  codigoEnquadramentoIpi: string | null;
  cnpjProdutorIpi: string | null;
  valorBcIpi: string | null;
  aliquotaIpi: string | null;
  quantidadeUnidadeIpi: string | null;
  valorUnidadeIpi: string | null;
  valorIpi: string | null;
  cstPis: string | null;
  valorBcPis: string | null;
  aliquotaPisPercentual: string | null;
  quantidadeBcPis: string | null;
  aliquotaPisReais: string | null;
  valorPis: string | null;
  valorBcPisSt: string | null;
  aliquotaPisStPercentual: string | null;
  valorPisSt: string | null;
  cstCofins: string | null;
  valorBcCofins: string | null;
  aliquotaCofinsPercentual: string | null;
  quantidadeBcCofins: string | null;
  aliquotaCofinsReais: string | null;
  valorCofins: string | null;
  valorBcCofinsSt: string | null;
  aliquotaCofinsStPercentual: string | null;
  valorCofinsSt: string | null;
  valorBcIi: string | null;
  valorDespesaAduaneira: string | null;
  valorImpostoImportacao: string | null;
  valorIof: string | null;
  valorTributosAproximados: string | null;
}

const ICMS_GROUPS = [
  'ICMS00',
  'ICMS10',
  'ICMS20',
  'ICMS30',
  'ICMS40',
  'ICMS51',
  'ICMS60',
  'ICMS70',
  'ICMS90',
  'ICMSPart',
  'ICMSST',
  'ICMSSN101',
  'ICMSSN102',
  'ICMSSN201',
  'ICMSSN202',
  'ICMSSN500',
  'ICMSSN900',
] as const;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

/**
 * Extrai os itens canônicos de NF-e/NFC-e sem converter decimais para number.
 * Itens estruturalmente inválidos são descartados para não persistir dados
 * fiscais parciais ou arredondados.
 */
export function parseNfeItems(xml: string): ParsedNfeItem[] {
  if (!xml.trim() || /<!DOCTYPE\b|<!ENTITY\b/i.test(xml)) return [];

  let parsed: unknown;
  try {
    parsed = parser.parse(xml) as unknown;
  } catch {
    return [];
  }

  const infNfe = findInfNfe(parsed);
  if (!infNfe) return [];

  return toArray(infNfe.det)
    .map(asRecord)
    .filter((value): value is XmlRecord => value !== null)
    .map(parseItem)
    .filter((value): value is ParsedNfeItem => value !== null);
}

export function normalizeFiscalDecimal(
  value: unknown,
  precision: number,
  scale: number,
): string | null {
  const raw = readText(value);
  const match = raw.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) return null;

  const integer = match[1].replace(/^0+(?=\d)/, '');
  const fraction = match[2] ?? '';
  if (integer.length > precision - scale || fraction.length > scale) {
    return null;
  }
  return fraction ? `${integer}.${fraction}` : integer;
}

function parseItem(det: XmlRecord): ParsedNfeItem | null {
  const prod = asRecord(det.prod);
  if (!prod) return null;

  const numeroItem = parseItemNumber(det['@_nItem']);
  const codigoProduto = readText(prod.cProd);
  const descricao = readText(prod.xProd);
  const cfop = limitedText(prod.CFOP, 4);
  const unidadeComercial = limitedText(prod.uCom, 10);
  const quantidadeComercial = decimal(prod.qCom, 15, 4);
  const valorUnitarioComercial = decimal(prod.vUnCom, 21, 10);
  const valorBrutoProduto = decimal(prod.vProd, 15, 2);
  const indTotal = limitedText(prod.indTot, 1);

  if (
    numeroItem === null ||
    !codigoProduto ||
    !descricao ||
    !/^\d{4}$/.test(cfop ?? '') ||
    !unidadeComercial ||
    quantidadeComercial === null ||
    valorUnitarioComercial === null ||
    valorBrutoProduto === null ||
    !/^[01]$/.test(indTotal ?? '')
  ) {
    return null;
  }

  const imposto = asRecord(det.imposto) ?? {};
  const icmsContainer = asRecord(imposto.ICMS) ?? {};
  const icms = firstRecord(icmsContainer, ICMS_GROUPS) ?? {};
  const icmsUfDest = asRecord(imposto.ICMSUFDest) ?? {};
  const ipi = asRecord(imposto.IPI) ?? {};
  const ipiTributacao = firstRecord(ipi, ['IPITrib', 'IPINT']) ?? {};
  const pisContainer = asRecord(imposto.PIS) ?? {};
  const pis =
    firstRecord(pisContainer, ['PISAliq', 'PISQtde', 'PISNT', 'PISOutr']) ?? {};
  const pisSt = asRecord(imposto.PISST) ?? {};
  const cofinsContainer = asRecord(imposto.COFINS) ?? {};
  const cofins =
    firstRecord(cofinsContainer, [
      'COFINSAliq',
      'COFINSQtde',
      'COFINSNT',
      'COFINSOutr',
    ]) ?? {};
  const cofinsSt = asRecord(imposto.COFINSST) ?? {};
  const ii = asRecord(imposto.II) ?? {};

  return {
    numeroItem,
    codigoProduto,
    codigoEan: nullableText(prod.cEAN),
    descricao,
    ncm: limitedText(prod.NCM, 8),
    nve: joinedText(prod.NVE),
    cest: limitedText(prod.CEST, 7),
    indEscala: limitedText(prod.indEscala, 1),
    cnpjFabricante: taxId(prod.CNPJFab, 14),
    codigoBeneficioFiscal: nullableText(prod.cBenef),
    cfop: cfop!,
    unidadeComercial,
    quantidadeComercial,
    valorUnitarioComercial,
    valorBrutoProduto,
    codigoEanTributavel: nullableText(prod.cEANTrib),
    unidadeTributavel: limitedText(prod.uTrib, 10),
    quantidadeTributavel: decimal(prod.qTrib, 15, 4),
    valorUnitarioTributavel: decimal(prod.vUnTrib, 21, 10),
    valorFrete: decimal(prod.vFrete, 15, 2),
    valorSeguro: decimal(prod.vSeg, 15, 2),
    valorDesconto: decimal(prod.vDesc, 15, 2),
    valorOutrasDespesas: decimal(prod.vOutro, 15, 2),
    indTotal: indTotal!,
    numeroPedidoCompra: nullableText(prod.xPed),
    itemPedidoCompra: nullableText(prod.nItemPed),
    informacoesAdicionais: nullableText(det.infAdProd ?? prod.infAdProd),

    origemMercadoria: limitedText(icms.orig, 1),
    cstIcms: limitedText(icms.CST, 3),
    csosnIcms: limitedText(icms.CSOSN, 4),
    modalidadeBcIcms: limitedText(icms.modBC, 1),
    percentualReducaoBcIcms: decimal(icms.pRedBC, 7, 4),
    valorBcIcms: decimal(icms.vBC, 15, 2),
    aliquotaIcms: decimal(icms.pICMS, 7, 4),
    valorIcms: decimal(icms.vICMS, 15, 2),
    modalidadeBcIcmsSt: limitedText(icms.modBCST, 1),
    percentualMvaSt: decimal(icms.pMVAST, 7, 4),
    percentualReducaoBcIcmsSt: decimal(icms.pRedBCST, 7, 4),
    valorBcIcmsSt: decimal(icms.vBCST, 15, 2),
    aliquotaIcmsSt: decimal(icms.pICMSST, 7, 4),
    valorIcmsSt: decimal(icms.vICMSST, 15, 2),
    valorBcFcp: decimal(icms.vBCFCP, 15, 2),
    aliquotaFcp: decimal(icms.pFCP, 7, 4),
    valorFcp: decimal(icms.vFCP, 15, 2),
    valorBcFcpSt: decimal(icms.vBCFCPST, 15, 2),
    aliquotaFcpSt: decimal(icms.pFCPST, 7, 4),
    valorFcpSt: decimal(icms.vFCPST, 15, 2),
    motivoDesoneracaoIcms: limitedText(icms.motDesICMS, 2),
    valorIcmsDesonerado: decimal(icms.vICMSDeson, 15, 2),
    percentualDiferimento: decimal(icms.pDif, 7, 4),
    valorIcmsDiferido: decimal(icms.vICMSDif, 15, 2),
    valorIcmsOperacao: decimal(icms.vICMSOp, 15, 2),
    aliquotaCreditoSn: decimal(icms.pCredSN, 7, 4),
    valorCreditoIcmsSn: decimal(icms.vCredICMSSN, 15, 2),
    valorBcIcmsStRetido: decimal(icms.vBCSTRet, 15, 2),
    aliquotaIcmsStRetido: decimal(icms.pST, 7, 4),
    valorIcmsStRetido: decimal(icms.vICMSSTRet, 15, 2),

    valorBcIcmsUfDest: decimal(icmsUfDest.vBCUFDest, 15, 2),
    valorBcFcpUfDest: decimal(icmsUfDest.vBCFCPUFDest, 15, 2),
    percentualFcpUfDest: decimal(icmsUfDest.pFCPUFDest, 7, 4),
    aliquotaIcmsUfDest: decimal(icmsUfDest.pICMSUFDest, 7, 4),
    aliquotaIcmsInterestadual: decimal(icmsUfDest.pICMSInter, 7, 4),
    percentualProvisorioPartilha: decimal(icmsUfDest.pICMSInterPart, 7, 4),
    valorFcpUfDest: decimal(icmsUfDest.vFCPUFDest, 15, 2),
    valorIcmsUfDest: decimal(icmsUfDest.vICMSUFDest, 15, 2),
    valorIcmsUfRemetente: decimal(icmsUfDest.vICMSUFRemet, 15, 2),

    cstIpi: limitedText(ipiTributacao.CST, 2),
    classeEnquadramentoIpi: limitedText(ipi.clEnq, 5),
    codigoEnquadramentoIpi: limitedText(ipi.cEnq, 3),
    cnpjProdutorIpi: taxId(ipi.CNPJProd, 14),
    valorBcIpi: decimal(ipiTributacao.vBC, 15, 2),
    aliquotaIpi: decimal(ipiTributacao.pIPI, 7, 4),
    quantidadeUnidadeIpi: decimal(ipiTributacao.qUnid, 15, 4),
    valorUnidadeIpi: decimal(ipiTributacao.vUnid, 15, 4),
    valorIpi: decimal(ipiTributacao.vIPI, 15, 2),

    cstPis: limitedText(pis.CST, 2),
    valorBcPis: decimal(pis.vBC, 15, 2),
    aliquotaPisPercentual: decimal(pis.pPIS, 7, 4),
    quantidadeBcPis: decimal(pis.qBCProd, 15, 4),
    aliquotaPisReais: decimal(pis.vAliqProd, 15, 4),
    valorPis: decimal(pis.vPIS, 15, 2),
    valorBcPisSt: decimal(pisSt.vBC, 15, 2),
    aliquotaPisStPercentual: decimal(pisSt.pPIS, 7, 4),
    valorPisSt: decimal(pisSt.vPIS, 15, 2),

    cstCofins: limitedText(cofins.CST, 2),
    valorBcCofins: decimal(cofins.vBC, 15, 2),
    aliquotaCofinsPercentual: decimal(cofins.pCOFINS, 7, 4),
    quantidadeBcCofins: decimal(cofins.qBCProd, 15, 4),
    aliquotaCofinsReais: decimal(cofins.vAliqProd, 15, 4),
    valorCofins: decimal(cofins.vCOFINS, 15, 2),
    valorBcCofinsSt: decimal(cofinsSt.vBC, 15, 2),
    aliquotaCofinsStPercentual: decimal(cofinsSt.pCOFINS, 7, 4),
    valorCofinsSt: decimal(cofinsSt.vCOFINS, 15, 2),

    valorBcIi: decimal(ii.vBC, 15, 2),
    valorDespesaAduaneira: decimal(ii.vDespAdu, 15, 2),
    valorImpostoImportacao: decimal(ii.vII, 15, 2),
    valorIof: decimal(ii.vIOF, 15, 2),
    valorTributosAproximados: decimal(imposto.vTotTrib, 15, 2),
  };
}

function findInfNfe(value: unknown): XmlRecord | null {
  const root = asRecord(value);
  if (!root) return null;
  const process = asRecord(root.nfeProc);
  const nfe = asRecord(process?.NFe ?? root.NFe);
  return asRecord(nfe?.infNFe);
}

function parseItemNumber(value: unknown): number | null {
  const raw = readText(value);
  if (!/^\d{1,3}$/.test(raw)) return null;
  const parsed = Number(raw);
  return parsed >= 1 && parsed <= 990 ? parsed : null;
}

function decimal(value: unknown, precision: number, scale: number) {
  const raw = readText(value);
  return raw ? normalizeFiscalDecimal(raw, precision, scale) : null;
}

function limitedText(value: unknown, maxLength: number): string | null {
  const normalized = nullableText(value);
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function taxId(value: unknown, length: number): string | null {
  const normalized = readText(value).replace(/\D/g, '');
  return normalized.length === length ? normalized : null;
}

function nullableText(value: unknown): string | null {
  return readText(value) || null;
}

function joinedText(value: unknown): string | null {
  const values = toArray(value).map(readText).filter(Boolean);
  return values.length > 0 ? values.join(',') : null;
}

function readText(value: unknown): string {
  const normalized: unknown = Array.isArray(value)
    ? (value as unknown[])[0]
    : value;
  if (
    typeof normalized === 'string' ||
    typeof normalized === 'number' ||
    typeof normalized === 'boolean'
  ) {
    return String(normalized).trim();
  }
  const record = asRecord(normalized);
  return record ? readText(record['#text']) : '';
}

function firstRecord(
  source: XmlRecord,
  keys: readonly string[],
): XmlRecord | null {
  for (const key of keys) {
    const value = asRecord(source[key]);
    if (value) return value;
  }
  return null;
}

function asRecord(value: unknown): XmlRecord | null {
  const normalized: unknown = Array.isArray(value)
    ? (value as unknown[])[0]
    : value;
  return normalized !== null && typeof normalized === 'object'
    ? (normalized as XmlRecord)
    : null;
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}
