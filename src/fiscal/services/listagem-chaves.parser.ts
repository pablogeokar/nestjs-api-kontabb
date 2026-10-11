import ExcelJS from 'exceljs';
import {
  isValidFiscalAccessKey,
  normalizeFiscalAccessKey,
} from './fiscal-identifier';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ACCESS_KEY_PATTERN = /\d{6}[0-9A-Z]{12}\d{26}/g;
const CONTAINS_ACCESS_KEY_PATTERN = /\d{6}[0-9A-Z]{12}\d{26}/;
const SUPPORTED_EXTENSIONS = new Set(['txt', 'csv', 'xlsx']);

const UF_BY_CODE: Record<string, string> = {
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

export interface FiscalAccessKeyMetadata {
  uf: string;
  codigoUf: string;
  competencia: string;
  cnpjEmitente: string;
  modelo: string;
  serie: string;
  numeroDocumento: string;
  tipoEmissao: string;
  codigoNumerico: string;
  digitoVerificador: string;
}

export interface ParsedFiscalAccessKey {
  entrada: string;
  chaveAcesso: string;
  valida: boolean;
  aptaParaBusca: boolean;
  motivo: string | null;
  ocorrencias: number;
  metadata: FiscalAccessKeyMetadata | null;
}

export interface ParsedChavesExtractionResult {
  totalRegistros: number;
  validas: number;
  aptasParaBusca: number;
  invalidas: number;
  duplicadas: number;
  itens: ParsedFiscalAccessKey[];
  avisos: string[];
}

interface ParseOptions {
  avisos?: string[];
}

interface ExtractOptions {
  includeMalformed?: boolean;
}

export function parseChavesFromText(
  text: string,
  options: ParseOptions = {},
): ParsedChavesExtractionResult {
  const candidates = extractCandidates(stripComments(text));
  return buildResult(candidates, options.avisos ?? []);
}

export async function parseChavesFromBuffer(
  buffer: Buffer,
  filename: string,
  mimeType?: string,
): Promise<ParsedChavesExtractionResult> {
  validateFile(buffer, filename, mimeType);
  const extension = fileExtension(filename);

  if (extension === 'xlsx') {
    return parseXlsx(buffer);
  }

  const text = decodeText(buffer);
  if (extension === 'csv') {
    const delimiter = detectCsvDelimiter(text);
    const rows = parseDelimitedRows(text, delimiter);
    const candidates = rows.flatMap((row) =>
      row.flatMap((cell) =>
        extractCandidates(cell, { includeMalformed: false }),
      ),
    );
    return buildResult(candidates, []);
  }

  return parseChavesFromText(text);
}

export function decodeFiscalAccessKey(
  chaveAcesso: string,
): FiscalAccessKeyMetadata | null {
  const normalized = normalizeFiscalAccessKey(chaveAcesso);
  if (!normalized) return null;

  const yearMonth = normalized.slice(2, 6);
  const month = yearMonth.slice(2, 4);
  const year = `20${yearMonth.slice(0, 2)}`;

  return {
    codigoUf: normalized.slice(0, 2),
    uf: UF_BY_CODE[normalized.slice(0, 2)] ?? 'Exterior/Desconhecida',
    competencia: `${month}/${year}`,
    cnpjEmitente: normalized.slice(6, 20),
    modelo: normalized.slice(20, 22),
    serie: String(Number(normalized.slice(22, 25))),
    numeroDocumento: String(Number(normalized.slice(25, 34))),
    tipoEmissao: normalized.slice(34, 35),
    codigoNumerico: normalized.slice(35, 43),
    digitoVerificador: normalized.slice(43, 44),
  };
}

function buildResult(
  candidates: string[],
  avisos: string[],
): ParsedChavesExtractionResult {
  const grouped = new Map<string, { entrada: string; ocorrencias: number }>();

  for (const rawCandidate of candidates) {
    const cleaned = cleanCandidate(rawCandidate);
    const normalized = normalizeFiscalAccessKey(cleaned);
    const identity = normalized || cleaned || rawCandidate.trim();
    if (!identity) continue;
    const current = grouped.get(identity);
    if (current) current.ocorrencias += 1;
    else
      grouped.set(identity, {
        entrada: publicValue(rawCandidate),
        ocorrencias: 1,
      });
  }

  const itens = [...grouped.entries()].map(([identity, groupedItem]) => {
    const chaveAcesso = normalizeFiscalAccessKey(identity);
    const formatoValido = Boolean(chaveAcesso);
    const dvValido = formatoValido && isValidFiscalAccessKey(chaveAcesso);
    const metadata = formatoValido ? decodeFiscalAccessKey(chaveAcesso) : null;
    const suporte = metadata ? supportForModel(metadata.modelo) : null;
    const valida = Boolean(dvValido && metadata);
    const aptaParaBusca = Boolean(valida && suporte?.supported);

    return {
      entrada: groupedItem.entrada,
      chaveAcesso: chaveAcesso || publicValue(identity),
      valida,
      aptaParaBusca,
      motivo: !formatoValido
        ? 'A chave deve possuir 44 posições no leiaute fiscal.'
        : !dvValido
          ? 'Dígito verificador da chave inválido.'
          : (suporte?.message ?? null),
      ocorrencias: groupedItem.ocorrencias,
      metadata,
    } satisfies ParsedFiscalAccessKey;
  });

  const duplicadas = itens.reduce(
    (total, item) => total + Math.max(0, item.ocorrencias - 1),
    0,
  );

  return {
    totalRegistros: itens.length + duplicadas,
    validas: itens.filter((item) => item.valida).length,
    aptasParaBusca: itens.filter((item) => item.aptaParaBusca).length,
    invalidas: itens.filter((item) => !item.valida).length,
    duplicadas,
    itens,
    avisos: [...new Set(avisos)],
  };
}

function extractCandidates(
  text: string,
  options: ExtractOptions = { includeMalformed: true },
): string[] {
  const normalized = text.toUpperCase();
  const exactMatches = normalized.match(ACCESS_KEY_PATTERN) ?? [];
  const segments = normalized
    .split(/[\n\r,;\t]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  const candidates = [...exactMatches];

  for (const segment of segments) {
    if (CONTAINS_ACCESS_KEY_PATTERN.test(segment)) continue;

    const withoutLabel = segment.replace(
      /^\s*(?:CHAVE(?:\s+DE\s+ACESSO)?|CHNFE|CHAVE_NFE|CHAVE_CTE|NFE|CTE)\s*[:=-]?\s*/i,
      '',
    );
    const compact = withoutLabel.replace(/[^0-9A-Z]/g, '');
    if (compact.length === 44) {
      candidates.push(compact);
    } else if (
      compact.length > 44 &&
      compact.length % 44 === 0 &&
      /^\d+$/.test(compact)
    ) {
      for (let index = 0; index < compact.length; index += 44) {
        candidates.push(compact.slice(index, index + 44));
      }
    } else if (options.includeMalformed && compact.length >= 20) {
      candidates.push(compact.slice(0, 80));
    }
  }

  return candidates;
}

function cleanCandidate(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(
      /^\s*(?:CHAVE(?:\s+DE\s+ACESSO)?|CHNFE|CHAVE_NFE|CHAVE_CTE)\s*[:=-]?\s*/i,
      '',
    )
    .replace(/[.\s:/-]/g, '');
}

function supportForModel(modelo: string) {
  if (modelo === '55') return { supported: true, message: null };
  if (modelo === '57') {
    return {
      supported: false,
      message:
        'CT-e modelo 57 não possui consulta pontual por chave no Ambiente Nacional; use a sincronização por NSU ou envie o XML.',
    };
  }
  if (modelo === '65') {
    return {
      supported: false,
      message:
        'NFC-e modelo 65 não é disponibilizada pela Distribuição DF-e por chave; envie o XML.',
    };
  }
  return {
    supported: false,
    message: `Modelo ${modelo} não suportado pela importação por chave.`,
  };
}

async function parseXlsx(
  buffer: Buffer,
): Promise<ParsedChavesExtractionResult> {
  const workbook = new ExcelJS.Workbook();
  try {
    // ExcelJS 4 ainda tipa Buffer com ArrayBuffer estrito; a cópia evita
    // propagar um SharedArrayBuffer possível no tipo genérico do Node 24.
    const bytes = new Uint8Array(buffer.length);
    bytes.set(buffer);
    await workbook.xlsx.load(bytes.buffer);
  } catch {
    throw new Error('A planilha XLSX está corrompida ou não pôde ser lida.');
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error('A planilha não possui uma aba de dados.');

  const candidates: string[] = [];
  const warnings: string[] = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (typeof cell.value === 'number') {
        if (Math.abs(cell.value) >= 1e15) {
          warnings.push(
            'Uma ou mais células numéricas longas foram ignoradas porque o Excel limita números a 15 dígitos. Formate a coluna como Texto e cole novamente as chaves originais.',
          );
        }
        return;
      }
      const value = cell.text?.trim();
      if (value) {
        candidates.push(
          ...extractCandidates(value, { includeMalformed: false }),
        );
      }
    });
  });

  if (candidates.length === 0 && warnings.length === 0) {
    throw new Error('Nenhuma chave fiscal foi encontrada na primeira aba.');
  }
  return buildResult(candidates, warnings);
}

function validateFile(buffer: Buffer, filename: string, mimeType?: string) {
  if (!buffer.length) throw new Error('O arquivo está vazio.');
  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error('O arquivo excede o limite de 10 MB.');
  }

  const extension = fileExtension(filename);
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new Error('Envie um arquivo .txt, .csv ou .xlsx.');
  }
  if (extension === 'xlsx' && !(buffer[0] === 0x50 && buffer[1] === 0x4b)) {
    throw new Error(
      'O conteúdo do arquivo não corresponde a uma planilha XLSX.',
    );
  }
  if (
    extension !== 'xlsx' &&
    buffer.subarray(0, Math.min(buffer.length, 2048)).includes(0)
  ) {
    throw new Error('O arquivo de texto contém dados binários inválidos.');
  }

  const declaredMime = mimeType?.toLowerCase().split(';')[0].trim();
  if (
    declaredMime &&
    declaredMime !== 'application/octet-stream' &&
    extension === 'xlsx' &&
    !declaredMime.includes('spreadsheetml')
  ) {
    throw new Error('O tipo declarado do arquivo não corresponde a XLSX.');
  }
}

function decodeText(buffer: Buffer): string {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buffer.subarray(2));
  }
  return buffer.toString('utf8').replace(/^\uFEFF/, '');
}

function stripComments(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith('#') && !trimmed.startsWith('//');
    })
    .join('\n');
}

function detectCsvDelimiter(text: string): ',' | ';' | '\t' {
  const sample = text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .slice(0, 5)
    .join('\n');
  const candidates = [',', ';', '\t'] as const;
  return candidates.reduce((best, candidate) =>
    countOutsideQuotes(sample, candidate) > countOutsideQuotes(sample, best)
      ? candidate
      : best,
  );
}

function parseDelimitedRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && character === delimiter) {
      row.push(cell);
      cell = '';
      continue;
    }
    if (!quoted && (character === '\n' || character === '\r')) {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += character;
  }
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function countOutsideQuotes(text: string, delimiter: string) {
  let count = 0;
  let quoted = false;
  for (const character of text) {
    if (character === '"') quoted = !quoted;
    else if (!quoted && character === delimiter) count += 1;
  }
  return count;
}

function fileExtension(filename: string): string {
  return filename.toLowerCase().split('.').pop() ?? '';
}

function publicValue(value: string) {
  return value
    .replace(/[\r\n\0]/g, '')
    .trim()
    .slice(0, 80);
}
