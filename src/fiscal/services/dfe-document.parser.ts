import { gunzipSync } from 'node:zlib';
import { XMLValidator } from 'fast-xml-parser';
import { parseNfeItems, type ParsedNfeItem } from './nfe-item.parser';
import {
  isValidFiscalAccessKey,
  normalizeFiscalAccessKey,
  normalizeFiscalCnpj,
  normalizeFiscalCpf,
} from './fiscal-identifier';
import {
  conferirIntegridadeDocumentoFiscal,
  somarValoresFiscais,
  type RelatorioIntegridadeDocumentoFiscal,
} from './dfe-document.integrity';
import {
  parseCteEscrituracaoXml,
  type CteEscrituracaoParseData,
} from './dacte.parser';

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

export interface ParsedParticipanteFiscal {
  cnpjCpf: string;
  cnpj: string;
  cpf: string;
  nome: string;
  ie: string;
  uf: string;
  codMun: string;
  endereco: string;
  numero: string;
  complemento: string;
  bairro: string;
  cep: string;
  suframa: string;
  codPais: string;
  pais: string;
}

/**
 * Campos do grupo ICMSTot mantidos com os nomes canônicos do leiaute da NF-e.
 * `camposAdicionais` preserva campos introduzidos por notas técnicas futuras
 * sem exigir conversão numérica ou perda de precisão.
 */
export interface ParsedNfeIcmsTot {
  vBC: string;
  vICMS: string;
  vICMSDeson: string;
  vFCPUFDest: string;
  vICMSUFDest: string;
  vICMSUFRemet: string;
  vFCP: string;
  vBCST: string;
  vST: string;
  vFCPST: string;
  vFCPSTRet: string;
  vProd: string;
  vFrete: string;
  vSeg: string;
  vDesc: string;
  vII: string;
  vIPI: string;
  vIPIDevol: string;
  vPIS: string;
  vCOFINS: string;
  vOutro: string;
  vNF: string;
  vTotTrib: string;
  qBCMono: string;
  vICMSMono: string;
  qBCMonoReten: string;
  vICMSMonoReten: string;
  qBCMonoRet: string;
  vICMSMonoRet: string;
  camposAdicionais: Readonly<Record<string, string>>;
}

export interface ParsedNfePisCofinsTotais {
  vPIS: string;
  vCOFINS: string;
  vPISST: string;
  vCOFINSST: string;
}

export interface ParsedInformacoesComplementares {
  contribuinte: string;
  fisco: string;
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
  emitente: ParsedParticipanteFiscal;
  destinatario: ParsedParticipanteFiscal | null;
  tomador: ParsedParticipanteFiscal | null;
  dataEmissao: Date;
  dataEmissaoFiscal: string;
  dataEntradaSaida: Date | null;
  dataEntradaSaidaFiscal: string | null;
  modalidadeFrete: string | null;
  valorTotal: string;
  tpNfXml: '0' | '1';
  situacao: 'AUTORIZADA' | 'CANCELADA' | 'DENEGADA';
  participantesCnpjCpf: string[];
  itens: ParsedNfeItem[];
  quantidadeItensDeclarada: number;
  icmsTot: ParsedNfeIcmsTot | null;
  pisCofinsTotais: ParsedNfePisCofinsTotais | null;
  informacoesComplementares: ParsedInformacoesComplementares;
  integridade: RelatorioIntegridadeDocumentoFiscal;
  cteEscrituracao: CteEscrituracaoParseData | null;
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
  const chaveProtocolo = normalizeFiscalAccessKey(
    extractTagValue(xml, chaveTag),
  );
  const chaveAcesso = chaveId || chaveProtocolo;
  if (
    !chaveAcesso ||
    (chaveId && chaveProtocolo && chaveId !== chaveProtocolo) ||
    !isValidFiscalAccessKey(chaveAcesso)
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
  const dataEmissaoFiscal = parseFiscalCalendarDate(dataValue);
  if (!dataValue || Number.isNaN(dataEmissao.getTime()) || !dataEmissaoFiscal)
    return null;

  const valorTotal = extractTagValue(infElement.content, valorTag);
  if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(valorTotal)) return null;

  const emitente = extractElement(infElement.content, 'emit')?.content ?? '';
  const destinatario =
    extractElement(infElement.content, 'dest')?.content ?? '';
  const emitenteParticipante = parseParticipanteFiscal(emitente, 'enderEmit');
  const destinatarioParticipante = parseParticipanteFiscal(
    destinatario,
    'enderDest',
  );
  if (!emitenteParticipante?.cnpjCpf) return null;

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
  // tpCTe/tpServ indicam finalidade/modalidade do CT-e, não o sentido fiscal.
  // Normalizamos o CT-e como emissão de saída e deixamos a comparação do
  // emitente com o cliente definir se a escrituração será entrada ou saída.
  const tpNfValue =
    tipoConsulta === 'NFE' ? extractTagValue(infElement.content, 'tpNF') : '1';
  const tpNfXml: ParsedDocumentoFiscal['tpNfXml'] =
    tpNfValue === '0' ? '0' : '1';
  let cteEscrituracao: CteEscrituracaoParseData | null = null;
  if (tipoConsulta === 'CTE') {
    try {
      cteEscrituracao = parseCteEscrituracaoXml(xml);
    } catch {
      return null;
    }
  }

  const itens = tipoConsulta === 'NFE' ? parseNfeItems(xml) : [];
  const quantidadeItensDeclarada =
    tipoConsulta === 'NFE'
      ? extractElements(infElement.content, 'det').length
      : 0;
  const icmsTot =
    tipoConsulta === 'NFE'
      ? parseIcmsTot(
          extractElement(infElement.content, 'ICMSTot')?.content ?? '',
        )
      : null;
  const pisCofinsTotais = icmsTot
    ? {
        vPIS: icmsTot.vPIS,
        vCOFINS: icmsTot.vCOFINS,
        vPISST: somarValoresFiscais(itens.map((item) => item.valorPisSt)),
        vCOFINSST: somarValoresFiscais(itens.map((item) => item.valorCofinsSt)),
      }
    : null;
  const tomador =
    tipoConsulta === 'CTE'
      ? parseTomadorCteParticipante(infElement.content)
      : null;
  const dataEntradaSaidaValue =
    tipoConsulta === 'NFE'
      ? extractTagValue(infElement.content, 'dhSaiEnt') ||
        extractTagValue(infElement.content, 'dSaiEnt')
      : '';
  const documentoSemIntegridade: Omit<ParsedDocumentoFiscal, 'integridade'> = {
    chaveAcesso,
    nsu,
    tipoDocumento,
    modelo,
    serie,
    numeroDocumento,
    emitenteCnpjCpf: emitenteParticipante.cnpjCpf,
    emitenteRazaoSocial: emitenteParticipante.nome,
    destinatarioCnpjCpf: destinatarioParticipante?.cnpjCpf ?? '',
    destinatarioRazaoSocial: destinatarioParticipante?.nome ?? '',
    emitente: emitenteParticipante,
    destinatario: destinatarioParticipante,
    tomador,
    dataEmissao,
    dataEmissaoFiscal,
    dataEntradaSaida:
      tipoConsulta === 'NFE'
        ? parseOptionalFiscalDate(dataEntradaSaidaValue)
        : null,
    dataEntradaSaidaFiscal: parseFiscalCalendarDate(dataEntradaSaidaValue),
    modalidadeFrete:
      tipoConsulta === 'NFE'
        ? extractTagValue(
            extractElement(infElement.content, 'transp')?.content ?? '',
            'modFrete',
          ) || null
        : null,
    valorTotal,
    tpNfXml,
    situacao,
    participantesCnpjCpf: extractParticipantTaxIds(
      infElement.content,
      tipoConsulta,
    ),
    itens,
    quantidadeItensDeclarada,
    icmsTot,
    pisCofinsTotais,
    informacoesComplementares: parseInformacoesComplementares(
      infElement.content,
      tipoConsulta,
    ),
    cteEscrituracao,
    xmlContent: xml,
  };
  return {
    ...documentoSemIntegridade,
    integridade: conferirIntegridadeDocumentoFiscal(documentoSemIntegridade),
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

function extractElements(
  xml: string,
  tagName: string,
): Array<{ openingTag: string; content: string }> {
  const pattern = new RegExp(
    `(<(?:[A-Za-z_][\\w.-]*:)?${tagName}\\b[^>]*>)([\\s\\S]*?)<\\/(?:[A-Za-z_][\\w.-]*:)?${tagName}\\s*>`,
    'gi',
  );
  return [...xml.matchAll(pattern)].map((match) => ({
    openingTag: match[1],
    content: match[2],
  }));
}

function extractTagValue(xml: string, tagName: string): string {
  const element = extractElement(xml, tagName);
  return element ? decodeXmlText(element.content).trim() : '';
}

function extractTaxId(xml: string): string {
  return (
    normalizeFiscalCnpj(extractTagValue(xml, 'CNPJ')) ||
    normalizeFiscalCpf(extractTagValue(xml, 'CPF'))
  );
}

function parseParticipanteFiscal(
  partyXml: string,
  addressTag: string,
): ParsedParticipanteFiscal | null {
  if (!partyXml.trim()) return null;

  const cnpj = normalizeFiscalCnpj(extractTagValue(partyXml, 'CNPJ'));
  const cpf = normalizeFiscalCpf(extractTagValue(partyXml, 'CPF'));
  const cnpjCpf = cnpj || cpf;
  const nome =
    extractTagValue(partyXml, 'xNome') || extractTagValue(partyXml, 'xFant');
  const address = extractElement(partyXml, addressTag)?.content ?? '';
  if (!cnpjCpf && !nome && !address) return null;

  return {
    cnpjCpf,
    cnpj,
    cpf,
    nome,
    ie: extractTagValue(partyXml, 'IE'),
    uf: extractTagValue(address, 'UF'),
    codMun: extractTagValue(address, 'cMun'),
    endereco: extractTagValue(address, 'xLgr'),
    numero: extractTagValue(address, 'nro'),
    complemento: extractTagValue(address, 'xCpl'),
    bairro: extractTagValue(address, 'xBairro'),
    cep: extractTagValue(address, 'CEP'),
    suframa: extractTagValue(partyXml, 'ISUF'),
    codPais: extractTagValue(address, 'cPais'),
    pais: extractTagValue(address, 'xPais'),
  };
}

function parseTomadorCteParticipante(
  infCte: string,
): ParsedParticipanteFiscal | null {
  const ide = extractElement(infCte, 'ide')?.content ?? '';
  const toma4 = extractElement(ide, 'toma4')?.content;
  if (toma4) return parseParticipanteFiscal(toma4, 'enderToma');

  const tomaCode = extractTagValue(
    extractElement(ide, 'toma3')?.content ?? '',
    'toma',
  );
  const sourceByCode: Record<string, [string, string]> = {
    '0': ['rem', 'enderReme'],
    '1': ['exped', 'enderExped'],
    '2': ['receb', 'enderReceb'],
    '3': ['dest', 'enderDest'],
  };
  const source = sourceByCode[tomaCode];
  if (!source) return null;
  return parseParticipanteFiscal(
    extractElement(infCte, source[0])?.content ?? '',
    source[1],
  );
}

const ICMS_TOT_FIELDS = [
  'vBC',
  'vICMS',
  'vICMSDeson',
  'vFCPUFDest',
  'vICMSUFDest',
  'vICMSUFRemet',
  'vFCP',
  'vBCST',
  'vST',
  'vFCPST',
  'vFCPSTRet',
  'vProd',
  'vFrete',
  'vSeg',
  'vDesc',
  'vII',
  'vIPI',
  'vIPIDevol',
  'vPIS',
  'vCOFINS',
  'vOutro',
  'vNF',
  'vTotTrib',
  'qBCMono',
  'vICMSMono',
  'qBCMonoReten',
  'vICMSMonoReten',
  'qBCMonoRet',
  'vICMSMonoRet',
] as const;

function parseIcmsTot(xml: string): ParsedNfeIcmsTot | null {
  const values = extractDirectTagValues(xml);
  if (Object.keys(values).length === 0) return null;

  const knownFields = Object.fromEntries(
    ICMS_TOT_FIELDS.map((field) => [field, values[field] ?? '']),
  ) as unknown as Omit<ParsedNfeIcmsTot, 'camposAdicionais'>;
  const known = new Set<string>(ICMS_TOT_FIELDS);
  const camposAdicionais = Object.fromEntries(
    Object.entries(values).filter(([field]) => !known.has(field)),
  );
  return { ...knownFields, camposAdicionais };
}

function extractDirectTagValues(xml: string): Record<string, string> {
  const result: Record<string, string> = {};
  const pattern =
    /<(?:[A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)\b[^>]*>([^<]*)<\/(?:[A-Za-z_][\w.-]*:)?\1\s*>/gi;
  for (const match of xml.matchAll(pattern)) {
    result[match[1]] = decodeXmlText(match[2]).trim();
  }
  return result;
}

function parseInformacoesComplementares(
  fiscalInfo: string,
  tipoConsulta: TipoConsultaDfe,
): ParsedInformacoesComplementares {
  if (tipoConsulta === 'NFE') {
    const infAdic = extractElement(fiscalInfo, 'infAdic')?.content ?? '';
    return {
      contribuinte: extractTagValue(infAdic, 'infCpl'),
      fisco: extractTagValue(infAdic, 'infAdFisco'),
    };
  }

  const compl = extractElement(fiscalInfo, 'compl')?.content ?? '';
  const contributorNotes = [
    ...extractElements(compl, 'xObs').map((item) =>
      decodeXmlText(item.content).trim(),
    ),
    ...extractElements(compl, 'ObsCont').map(formatCteObservation),
  ].filter(Boolean);
  const taxNotes = extractElements(compl, 'ObsFisco')
    .map(formatCteObservation)
    .filter(Boolean);
  return {
    contribuinte: contributorNotes.join('\n'),
    fisco: taxNotes.join('\n'),
  };
}

function formatCteObservation(element: {
  openingTag: string;
  content: string;
}): string {
  const field = readAttribute(element.openingTag, 'xCampo');
  const text = extractTagValue(element.content, 'xTexto');
  return [field, text].filter(Boolean).join(': ');
}

function parseOptionalFiscalDate(value: string): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseFiscalCalendarDate(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(value.trim());
  if (!match) return null;
  const normalized = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === normalized
    ? normalized
    : null;
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
  return id.toUpperCase().startsWith(prefix.toUpperCase())
    ? normalizeFiscalAccessKey(id)
    : '';
}

function readAttribute(attributes: string, name: string): string {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = attributes.match(
    new RegExp(`(?:^|\\s)${escapedName}\\s*=\\s*(["'])(.*?)\\1`, 'i'),
  );
  return match ? decodeXmlText(match[2]).trim() : '';
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
