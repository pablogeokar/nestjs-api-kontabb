import { gunzipSync } from 'node:zlib';
import { XMLValidator } from 'fast-xml-parser';

export type TipoConsultaDfe = 'NFE' | 'CTE';

export interface DfeDocZip {
  nsu: number;
  schema: string;
  content: string;
}

export interface DfeResponseMetadata {
  cStat: number;
  ultimoNsu: number;
  maxNsu: number;
  motivo: string;
}

export interface ParsedDocumentoFiscal {
  chaveAcesso: string;
  nsu: number;
  tipoDocumento: 'NFE' | 'CTE' | 'NFCE';
  modelo: '55' | '57' | '65';
  serie: string;
  numeroDocumento: string;
  emitenteCnpjCpf: string;
  emitenteRazaoSocial: string;
  destinatarioCnpjCpf: string;
  destinatarioRazaoSocial: string;
  dataEmissao: Date;
  valorTotal: string;
  situacao: 'AUTORIZADA' | 'CANCELADA' | 'DENEGADA';
  participantesCnpjCpf: string[];
  xmlContent: string;
}

export type ManualFiscalXmlParseResult =
  | { status: 'DOCUMENTO'; documento: ParsedDocumentoFiscal }
  | { status: 'IGNORADO'; motivo: string }
  | { status: 'INVALIDO'; motivo: string };

const MAX_DOCZIP_BASE64_LENGTH = 15 * 1024 * 1024;
const MAX_XML_LENGTH = 10 * 1024 * 1024;

/**
 * A conversao interna do NFeWizard descarta os atributos NSU e schema.
 * Quando disponivel, extraimos os docZip diretamente do XML bruto retornado
 * pela SEFAZ e usamos o JSON convertido apenas como fallback.
 */
export function extractDfeDocZips(resposta: unknown): DfeDocZip[] {
  const rawXmlCandidates = getRawXmlCandidates(resposta);

  for (const rawXml of rawXmlCandidates) {
    const extracted = extractDocZipsFromXml(rawXml);
    if (extracted.length > 0) return extracted;
  }

  const retDist =
    asRecord(readPath(resposta, 'data', 'retDistDFeInt')) ??
    asRecord(readPath(resposta, 'retDistDFeInt')) ??
    {};
  const lote = asRecord(firstValue(retDist.loteDistDFeInt));
  const candidates = lote?.docZip ?? retDist.docZip;

  return toArray(candidates)
    .map(normalizeJsonDocZip)
    .filter((docZip): docZip is DfeDocZip => docZip !== null);
}

export function extractDfeResponseMetadata(
  resposta: unknown,
): DfeResponseMetadata {
  const rawXml = getRawXmlCandidates(resposta)
    .map((value) =>
      value.includes('&lt;retDistDFeInt') ? decodeXmlMarkup(value) : value,
    )
    .find((value) => hasElement(value, 'retDistDFeInt'));

  const motivo =
    firstString(
      readPath(resposta, 'xMotivo'),
      readPath(resposta, 'data', 'retDistDFeInt', 'xMotivo'),
      readPath(resposta, 'retDistDFeInt', 'xMotivo'),
    ) || (rawXml ? extractTagValue(rawXml, 'xMotivo') : '');

  let cStat = parseNonNegativeInteger(
    firstDefined(
      readPath(resposta, 'data', 'retDistDFeInt', 'cStat'),
      readPath(resposta, 'retDistDFeInt', 'cStat'),
      readPath(resposta, 'cStat'),
      rawXml ? extractTagValue(rawXml, 'cStat') : undefined,
    ),
  );
  if (cStat === 0 && /nenhum documento localizado/i.test(motivo)) {
    // O NFeWizard retorna data={} para cStat 137 e preserva apenas xMotivo.
    cStat = 137;
  }

  return {
    cStat,
    ultimoNsu: parseNonNegativeInteger(
      firstDefined(
        readPath(resposta, 'data', 'retDistDFeInt', 'ultNSU'),
        readPath(resposta, 'retDistDFeInt', 'ultNSU'),
        readPath(resposta, 'ultNSU'),
        rawXml ? extractTagValue(rawXml, 'ultNSU') : undefined,
      ),
    ),
    maxNsu: parseNonNegativeInteger(
      firstDefined(
        readPath(resposta, 'data', 'retDistDFeInt', 'maxNSU'),
        readPath(resposta, 'retDistDFeInt', 'maxNSU'),
        readPath(resposta, 'maxNSU'),
        rawXml ? extractTagValue(rawXml, 'maxNSU') : undefined,
      ),
    ),
    motivo,
  };
}

export function parseDfeDocZip(
  docZip: DfeDocZip,
  tipoConsulta: TipoConsultaDfe,
): ParsedDocumentoFiscal | null {
  if (!isAcceptedSchema(docZip.schema, tipoConsulta)) return null;

  const xml = decompressDocZip(docZip.content);
  if (!xml) return null;

  return parseFiscalXml(xml, docZip.nsu, tipoConsulta);
}

/**
 * Classifica um XML enviado manualmente sem depender do envelope docZip.
 * Eventos, resumos e modelos fora do escopo fiscal do sistema são ignorados.
 */
export function parseManualFiscalXml(xml: string): ManualFiscalXmlParseResult {
  const normalized = xml.replace(/^\uFEFF/, '').trim();
  if (!normalized || normalized.length > MAX_XML_LENGTH) {
    return {
      status: 'INVALIDO',
      motivo: 'O conteúdo XML está vazio ou excede o limite de 10 MB.',
    };
  }
  if (/<!DOCTYPE\b|<!ENTITY\b/i.test(normalized)) {
    return {
      status: 'INVALIDO',
      motivo: 'XML com declaração DTD ou entidade externa não é aceito.',
    };
  }

  const validation = XMLValidator.validate(normalized, {
    allowBooleanAttributes: false,
  });
  if (validation !== true) {
    return {
      status: 'INVALIDO',
      motivo: 'O arquivo não contém um XML bem-formado.',
    };
  }

  if (hasElement(normalized, 'nfeProc')) {
    const documento = parseFiscalXml(normalized, 0, 'NFE');
    return documento
      ? { status: 'DOCUMENTO', documento }
      : {
          status: 'INVALIDO',
          motivo:
            'O XML processado de NF-e/NFC-e possui dados fiscais, protocolo ou chave de acesso inválidos.',
        };
  }

  if (hasElement(normalized, 'cteProc')) {
    const infCte = extractElement(normalized, 'infCte');
    const modelo = infCte ? extractTagValue(infCte.content, 'mod') : '';
    if (modelo && modelo !== '57') {
      return {
        status: 'IGNORADO',
        motivo: `Documento modelo ${modelo} fora do escopo de CT-e modelo 57.`,
      };
    }

    const documento = parseFiscalXml(normalized, 0, 'CTE');
    return documento
      ? { status: 'DOCUMENTO', documento }
      : {
          status: 'INVALIDO',
          motivo:
            'O XML processado de CT-e possui dados fiscais, protocolo ou chave de acesso inválidos.',
        };
  }

  return {
    status: 'IGNORADO',
    motivo:
      'XML descartado por não ser um documento processado de NF-e, NFC-e ou CT-e.',
  };
}

function extractDocZipsFromXml(rawXml: string): DfeDocZip[] {
  const xml = rawXml.includes('&lt;docZip') ? decodeXmlMarkup(rawXml) : rawXml;
  const docZips: DfeDocZip[] = [];
  const docZipPattern =
    /<(?:[A-Za-z_][\w.-]*:)?docZip\b([^>]*)>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?docZip\s*>/gi;

  for (const match of xml.matchAll(docZipPattern)) {
    const attributes = match[1] ?? '';
    const content = decodeXmlText(match[2] ?? '').replace(/\s+/g, '');
    if (!content) continue;

    const nsu = parseNonNegativeInteger(readAttribute(attributes, 'NSU'));
    const schema = readAttribute(attributes, 'schema');
    docZips.push({ nsu, schema, content });
  }

  return docZips;
}

function normalizeJsonDocZip(value: unknown): DfeDocZip | null {
  if (typeof value === 'string') {
    const content = value.replace(/\s+/g, '');
    return content ? { nsu: 0, schema: '', content } : null;
  }
  const docZip = asRecord(value);
  if (!docZip) return null;

  const attributes = asRecord(docZip.$) ?? docZip;
  const contentValue =
    docZip._ ?? docZip.$value ?? docZip['#text'] ?? docZip.docZip;
  if (typeof contentValue !== 'string') return null;

  const content = contentValue.replace(/\s+/g, '');
  if (!content) return null;

  return {
    nsu: parseNonNegativeInteger(
      attributes.NSU ?? attributes['@_NSU'] ?? docZip.NSU,
    ),
    schema: readString(
      attributes.schema ?? attributes['@_schema'] ?? docZip.schema,
    ),
    content,
  };
}

function isAcceptedSchema(
  schema: string,
  tipoConsulta: TipoConsultaDfe,
): boolean {
  if (!schema.trim()) return true;

  const fileName = schema.trim().split(/[\\/]/).pop() ?? '';
  if (tipoConsulta === 'NFE') {
    return /^procNFe_v[\d.]+\.xsd$/i.test(fileName);
  }
  return /^procCTe_v[\d.]+\.xsd$/i.test(fileName);
}

function decompressDocZip(content: string): string | null {
  if (!content || content.length > MAX_DOCZIP_BASE64_LENGTH) return null;

  if (content.trimStart().startsWith('<')) {
    return content.length <= MAX_XML_LENGTH ? content : null;
  }

  let compressed: Buffer;
  try {
    compressed = Buffer.from(content, 'base64');
  } catch {
    return null;
  }

  if (compressed.length === 0) return null;

  try {
    return gunzipSync(compressed, { maxOutputLength: MAX_XML_LENGTH }).toString(
      'utf8',
    );
  } catch {
    const decoded = compressed.toString('utf8');
    return decoded.trimStart().startsWith('<') &&
      decoded.length <= MAX_XML_LENGTH
      ? decoded
      : null;
  }
}

function parseFiscalXml(
  xml: string,
  nsu: number,
  tipoConsulta: TipoConsultaDfe,
): ParsedDocumentoFiscal | null {
  const isNfeProc = hasElement(xml, 'nfeProc') && hasElement(xml, 'NFe');
  const isCteProc = hasElement(xml, 'cteProc') && hasElement(xml, 'CTe');

  if (tipoConsulta === 'NFE' && !isNfeProc) return null;
  if (tipoConsulta === 'CTE' && !isCteProc) return null;

  const infTag = tipoConsulta === 'NFE' ? 'infNFe' : 'infCte';
  const idPrefix = tipoConsulta === 'NFE' ? 'NFe' : 'CTe';
  const chaveTag = tipoConsulta === 'NFE' ? 'chNFe' : 'chCTe';
  const numeroTag = tipoConsulta === 'NFE' ? 'nNF' : 'nCT';
  const valorTag = tipoConsulta === 'NFE' ? 'vNF' : 'vTPrest';

  const infElement = extractElement(xml, infTag);
  if (!infElement) return null;

  const chaveId = readElementId(infElement.openingTag, idPrefix);
  const chaveProtocolo = extractTagValue(xml, chaveTag);
  const chaveAcesso = chaveId || chaveProtocolo;
  if (
    !chaveAcesso ||
    (chaveId && chaveProtocolo && chaveId !== chaveProtocolo) ||
    !isValidAccessKey(chaveAcesso)
  ) {
    return null;
  }

  const modelo = extractTagValue(infElement.content, 'mod');
  if (modelo !== chaveAcesso.substring(20, 22)) return null;

  let tipoDocumento: ParsedDocumentoFiscal['tipoDocumento'];
  if (tipoConsulta === 'NFE' && modelo === '55') {
    tipoDocumento = 'NFE';
  } else if (tipoConsulta === 'NFE' && modelo === '65') {
    tipoDocumento = 'NFCE';
  } else if (tipoConsulta === 'CTE' && modelo === '57') {
    tipoDocumento = 'CTE';
  } else {
    // Exclui CT-e OS, GTV-e, BP-e e qualquer outro DF-e retornado no lote.
    return null;
  }

  const serie = extractTagValue(infElement.content, 'serie');
  const numeroDocumento = extractTagValue(infElement.content, numeroTag);
  if (!/^\d+$/.test(serie) || !/^\d+$/.test(numeroDocumento)) return null;

  const dataValue =
    extractTagValue(infElement.content, 'dhEmi') ||
    extractTagValue(infElement.content, 'dEmi');
  const dataEmissao = new Date(dataValue);
  if (!dataValue || Number.isNaN(dataEmissao.getTime())) return null;

  const valorTotal = extractTagValue(infElement.content, valorTag);
  if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(valorTotal)) return null;

  const emitente = extractElement(infElement.content, 'emit')?.content ?? '';
  const destinatario =
    extractElement(infElement.content, 'dest')?.content ?? '';
  const emitenteCnpjCpf = extractTaxId(emitente);
  if (!emitenteCnpjCpf) return null;

  const protocolElement = extractElement(
    xml,
    tipoConsulta === 'NFE' ? 'protNFe' : 'protCTe',
  )?.content;
  const protocolStatus = protocolElement
    ? extractTagValue(protocolElement, 'cStat')
    : '';
  if (!['100', '110', '150', '301', '302'].includes(protocolStatus)) {
    return null;
  }

  let situacao: ParsedDocumentoFiscal['situacao'] = 'AUTORIZADA';
  if (['110', '301', '302'].includes(protocolStatus)) {
    situacao = 'DENEGADA';
  }

  return {
    chaveAcesso,
    nsu,
    tipoDocumento,
    modelo,
    serie,
    numeroDocumento,
    emitenteCnpjCpf,
    emitenteRazaoSocial: extractTagValue(emitente, 'xNome'),
    destinatarioCnpjCpf: extractTaxId(destinatario),
    destinatarioRazaoSocial: extractTagValue(destinatario, 'xNome'),
    dataEmissao,
    valorTotal,
    situacao,
    participantesCnpjCpf: extractParticipantTaxIds(
      infElement.content,
      tipoConsulta,
    ),
    xmlContent: xml,
  };
}

function hasElement(xml: string, tagName: string): boolean {
  return new RegExp(`<(?:[A-Za-z_][\\w.-]*:)?${tagName}(?:\\s|>)`, 'i').test(
    xml,
  );
}

function extractElement(
  xml: string,
  tagName: string,
): { openingTag: string; content: string } | null {
  const pattern = new RegExp(
    `(<(?:[A-Za-z_][\\w.-]*:)?${tagName}\\b[^>]*>)([\\s\\S]*?)<\\/(?:[A-Za-z_][\\w.-]*:)?${tagName}\\s*>`,
    'i',
  );
  const match = xml.match(pattern);
  return match ? { openingTag: match[1], content: match[2] } : null;
}

function extractTagValue(xml: string, tagName: string): string {
  const element = extractElement(xml, tagName);
  return element ? decodeXmlText(element.content).trim() : '';
}

function extractTaxId(xml: string): string {
  const cnpj = extractTagValue(xml, 'CNPJ');
  if (/^\d{14}$/.test(cnpj)) return cnpj;

  const cpf = extractTagValue(xml, 'CPF');
  return /^\d{11}$/.test(cpf) ? cpf : '';
}

function extractParticipantTaxIds(
  fiscalInfo: string,
  tipoConsulta: TipoConsultaDfe,
): string[] {
  const participantTags =
    tipoConsulta === 'NFE'
      ? ['emit', 'dest']
      : ['emit', 'rem', 'dest', 'exped', 'receb', 'toma4'];
  const ids = participantTags
    .map((tag) => extractElement(fiscalInfo, tag)?.content ?? '')
    .map(extractTaxId)
    .filter(Boolean);

  return [...new Set(ids)];
}

function readElementId(openingTag: string, prefix: string): string {
  const id = readAttribute(openingTag, 'Id');
  const match = id.match(new RegExp(`^${prefix}(\\d{44})$`));
  return match?.[1] ?? '';
}

function readAttribute(attributes: string, name: string): string {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = attributes.match(
    new RegExp(`(?:^|\\s)${escapedName}\\s*=\\s*(["'])(.*?)\\1`, 'i'),
  );
  return match ? decodeXmlText(match[2]).trim() : '';
}

function isValidAccessKey(chave: string): boolean {
  if (!/^\d{44}$/.test(chave)) return false;

  let weight = 2;
  let sum = 0;
  for (let index = 42; index >= 0; index--) {
    sum += Number(chave[index]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const remainder = sum % 11;
  const calculatedDigit =
    remainder === 0 || remainder === 1 ? 0 : 11 - remainder;
  return calculatedDigit === Number(chave[43]);
}

function parseNonNegativeInteger(value: unknown): number {
  const normalized =
    typeof value === 'number' || typeof value === 'string' ? String(value) : '';
  const parsed = Number.parseInt(normalized, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function firstValue(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  const normalized = firstValue(value);
  return normalized !== null && typeof normalized === 'object'
    ? (normalized as Record<string, unknown>)
    : null;
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function readPath(value: unknown, ...path: string[]): unknown {
  let current = value;
  for (const key of path) {
    const record = asRecord(current);
    if (!record) return undefined;
    current = record[key];
  }
  return firstValue(current);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const normalized = firstValue(value);
    if (typeof normalized === 'string' && normalized.trim()) {
      return normalized.trim();
    }
  }
  return '';
}

function firstDefined(...values: unknown[]): unknown {
  return values.find((value) => value !== null && value !== undefined);
}

function getRawXmlCandidates(resposta: unknown): string[] {
  return [
    readPath(resposta, 'data', 'retDistDFeInt', 'xml'),
    readPath(resposta, 'retDistDFeInt', 'xml'),
    readPath(resposta, 'data', 'xml'),
    readPath(resposta, 'xml'),
  ].filter((value): value is string => typeof value === 'string');
}

function decodeXmlMarkup(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([\da-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&amp;/g, '&');
}
