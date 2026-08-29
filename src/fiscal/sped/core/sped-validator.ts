import {
  SPED_BLOCK_ORDER,
  SPED_LAYOUT_2026,
  type SpedBlockCode,
  type SpedContentBlockCode,
  type SpedValidationIssue,
  type SpedValidationResult,
} from './sped-core.types';
import { getSpedBlockForRecord, SPED_BLOCK_SHELLS } from './sped-file';

interface ParsedLine {
  readonly line: number;
  readonly raw: string;
  readonly reg: string;
  readonly fields: readonly string[];
  readonly block: SpedBlockCode | null;
}

const RECORD_CODE_PATTERN = /^[0-9A-Z]{4}$/u;
const EXPECTED_FIELD_COUNTS: Readonly<Record<string, number>> = {
  '0000': 14,
  '0001': 1,
  '0002': 1,
  '0005': 9,
  '0100': 13,
  '0150': 12,
  '0190': 2,
  '0200': 12,
  '0450': 2,
  '0990': 1,
  B001: 1,
  B990: 1,
  C001: 1,
  C100: 28,
  C101: 3,
  C110: 2,
  C170: 37,
  C190: 11,
  C990: 1,
  D001: 1,
  D100: 24,
  D190: 8,
  D990: 1,
  E001: 1,
  E100: 2,
  E110: 14,
  E111: 3,
  E116: 9,
  E200: 3,
  E210: 14,
  E250: 9,
  E300: 3,
  E310: 21,
  E316: 9,
  E500: 3,
  E510: 5,
  E520: 7,
  E530: 6,
  E990: 1,
  G001: 1,
  G990: 1,
  H001: 1,
  H005: 3,
  H010: 10,
  H990: 1,
  K001: 1,
  K990: 1,
  '1001': 1,
  '1010': 13,
  '1990': 1,
  '9001': 1,
  '9900': 2,
  '9990': 1,
  '9999': 1,
};

export function validateSpedFile(
  source: string | Buffer,
  options: { strictFieldCounts?: boolean } = {},
): SpedValidationResult {
  const text = Buffer.isBuffer(source) ? source.toString('latin1') : source;
  const issues: SpedValidationIssue[] = [];
  if (!text) {
    issues.push({ code: 'EMPTY_FILE', message: 'O arquivo SPED esta vazio.' });
    return validationResult(issues, [], {});
  }

  if (!text.endsWith('\r\n')) {
    issues.push({
      code: 'MISSING_FINAL_CRLF',
      message: 'O arquivo deve terminar com CRLF.',
    });
  }
  if (/[\r\n]/u.test(text.replace(/\r\n/gu, ''))) {
    issues.push({
      code: 'INVALID_LINE_BREAK',
      message: 'O arquivo contem quebra de linha diferente de CRLF.',
    });
  }

  const payload = text.endsWith('\r\n') ? text.slice(0, -2) : text;
  const rawLines = payload.split(/\r\n|\r|\n/u);
  const parsedLines: ParsedLine[] = [];

  rawLines.forEach((raw, index) => {
    const line = index + 1;
    if (!raw) {
      issues.push({ code: 'EMPTY_LINE', message: 'Linha vazia.', line });
      return;
    }
    inspectCharacters(raw, line, issues);
    if (!raw.startsWith('|') || !raw.endsWith('|')) {
      issues.push({
        code: 'INVALID_DELIMITERS',
        message: 'A linha deve iniciar e terminar com pipe.',
        line,
      });
      return;
    }

    const [reg = '', ...fields] = raw.slice(1, -1).split('|');
    if (!RECORD_CODE_PATTERN.test(reg)) {
      issues.push({
        code: 'INVALID_RECORD_CODE',
        message: `Codigo de registro invalido: ${reg || '(vazio)'}.`,
        line,
        reg: reg || undefined,
      });
      return;
    }
    const block = getSpedBlockForRecord(reg);
    if (!block) {
      issues.push({
        code: 'UNSUPPORTED_BLOCK',
        message: `O registro ${reg} pertence a um bloco nao suportado.`,
        line,
        reg,
      });
    }
    parsedLines.push({ line, raw, reg, fields, block });
  });

  validateFileBounds(parsedLines, issues);
  if (options.strictFieldCounts) validateFieldCounts(parsedLines, issues);
  validateBlockOrder(parsedLines, issues);
  validateContentBlockShells(parsedLines, issues);
  validateBlock9(parsedLines, issues);

  const recordCounts = countRecords(parsedLines);
  const blockCounts = countBlocks(parsedLines);
  return validationResult(issues, parsedLines, recordCounts, blockCounts);
}

function validateFieldCounts(
  lines: readonly ParsedLine[],
  issues: SpedValidationIssue[],
) {
  for (const line of lines) {
    const expected = EXPECTED_FIELD_COUNTS[line.reg];
    if (expected !== undefined && line.fields.length !== expected) {
      issues.push({
        code: 'INVALID_FIELD_COUNT',
        message: `${line.reg} deve possuir ${expected} campos após REG, mas possui ${line.fields.length}.`,
        line: line.line,
        reg: line.reg,
      });
    }
  }
}

function inspectCharacters(
  raw: string,
  line: number,
  issues: SpedValidationIssue[],
) {
  let invalidLatin1 = false;
  let invalidControl = false;
  for (const character of raw) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint > 0xff) invalidLatin1 = true;
    if (codePoint < 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f)) {
      invalidControl = true;
    }
  }
  if (invalidLatin1) {
    issues.push({
      code: 'INVALID_LATIN1_CHARACTER',
      message: 'A linha contem caractere fora de ISO-8859-1.',
      line,
    });
  }
  if (invalidControl) {
    issues.push({
      code: 'INVALID_CONTROL_CHARACTER',
      message: 'A linha contem caractere de controle.',
      line,
    });
  }
}

function validateFileBounds(
  lines: readonly ParsedLine[],
  issues: SpedValidationIssue[],
) {
  const opening = lines.filter((line) => line.reg === '0000');
  if (opening.length !== 1 || lines[0]?.reg !== '0000') {
    issues.push({
      code: 'MISSING_FILE_OPENING',
      message: 'O arquivo deve possuir um unico 0000 na primeira linha.',
      line: lines[0]?.line,
    });
  }
  const closing = lines.filter((line) => line.reg === '9999');
  if (closing.length !== 1 || lines.at(-1)?.reg !== '9999') {
    issues.push({
      code: 'MISSING_FILE_CLOSING',
      message: 'O arquivo deve possuir um unico 9999 na ultima linha.',
      line: lines.at(-1)?.line,
    });
  }
  if (opening[0]?.fields[0] !== SPED_LAYOUT_2026) {
    issues.push({
      code: 'INVALID_LAYOUT',
      message: `COD_VER deve ser ${SPED_LAYOUT_2026} para 2026.`,
      line: opening[0]?.line,
      reg: '0000',
    });
  }
}

function validateBlockOrder(
  lines: readonly ParsedLine[],
  issues: SpedValidationIssue[],
) {
  let previousIndex = -1;
  for (const line of lines) {
    if (!line.block) continue;
    const currentIndex = SPED_BLOCK_ORDER.indexOf(line.block);
    if (currentIndex < previousIndex) {
      issues.push({
        code: 'INVALID_BLOCK_ORDER',
        message: `O bloco ${line.block} esta fora da ordem oficial.`,
        line: line.line,
        reg: line.reg,
      });
      return;
    }
    previousIndex = currentIndex;
  }
}

function validateContentBlockShells(
  lines: readonly ParsedLine[],
  issues: SpedValidationIssue[],
) {
  for (const [block, shell] of Object.entries(SPED_BLOCK_SHELLS) as Array<
    [SpedContentBlockCode, { opening: string; closing: string }]
  >) {
    const blockLines = lines.filter((line) => line.block === block);
    const openings = blockLines.filter((line) => line.reg === shell.opening);
    const closings = blockLines.filter((line) => line.reg === shell.closing);
    if (openings.length === 0 || closings.length === 0) {
      issues.push({
        code: 'MISSING_BLOCK_SHELL',
        message: `O bloco ${block} deve possuir ${shell.opening} e ${shell.closing}.`,
      });
      continue;
    }
    if (openings.length !== 1 || closings.length !== 1) {
      issues.push({
        code: 'DUPLICATE_BLOCK_SHELL',
        message: `O bloco ${block} possui abertura ou fechamento duplicado.`,
      });
    }

    const expectedOpeningIndex = block === '0' ? 1 : 0;
    if (
      blockLines[expectedOpeningIndex]?.reg !== shell.opening ||
      blockLines.at(-1)?.reg !== shell.closing ||
      (block === '0' && blockLines[0]?.reg !== '0000')
    ) {
      issues.push({
        code: 'INVALID_BLOCK_SHELL_POSITION',
        message: `Abertura ou fechamento do bloco ${block} esta fora de posicao.`,
        line: openings[0]?.line,
      });
    }

    const shellSize = block === '0' ? 3 : 2;
    const contentCount = Math.max(0, blockLines.length - shellSize);
    const expectedIndicator = contentCount > 0 ? '0' : '1';
    if (
      openings[0]?.fields.length !== 1 ||
      openings[0]?.fields[0] !== expectedIndicator
    ) {
      issues.push({
        code: 'INVALID_MOVEMENT_INDICATOR',
        message: `${shell.opening} deve informar IND_MOV ${expectedIndicator}.`,
        line: openings[0]?.line,
        reg: shell.opening,
      });
    }

    const declaredCount = parseCount(closings[0]?.fields);
    if (declaredCount !== blockLines.length) {
      issues.push({
        code: 'INVALID_BLOCK_LINE_COUNT',
        message: `${shell.closing} declara ${String(
          declaredCount ?? 'valor invalido',
        )}, mas o bloco possui ${blockLines.length} linhas.`,
        line: closings[0]?.line,
        reg: shell.closing,
      });
    }
  }
}

function validateBlock9(
  lines: readonly ParsedLine[],
  issues: SpedValidationIssue[],
) {
  const blockLines = lines.filter((line) => line.block === '9');
  const opening = blockLines.filter((line) => line.reg === '9001');
  const closing = blockLines.filter((line) => line.reg === '9990');
  const fileClosing = blockLines.filter((line) => line.reg === '9999');
  if (
    opening.length !== 1 ||
    closing.length !== 1 ||
    fileClosing.length !== 1 ||
    blockLines[0]?.reg !== '9001' ||
    blockLines.at(-2)?.reg !== '9990' ||
    blockLines.at(-1)?.reg !== '9999' ||
    opening[0]?.fields.length !== 1 ||
    opening[0]?.fields[0] !== '0' ||
    blockLines.slice(1, -2).some((line) => line.reg !== '9900')
  ) {
    issues.push({
      code: 'INVALID_BLOCK_9_CONTENT',
      message:
        'O Bloco 9 deve conter 9001, apenas totalizadores 9900, 9990 e 9999.',
      line: blockLines[0]?.line,
    });
  }

  const actualCounts = countRecords(lines);
  const totalizerLines = blockLines.filter((line) => line.reg === '9900');
  const entries = new Map<string, { count: number | null; line: number }>();
  let previousReg = '';
  for (const totalizer of totalizerLines) {
    const [reg, countValue, ...extra] = totalizer.fields;
    if (
      !RECORD_CODE_PATTERN.test(reg ?? '') ||
      countValue === undefined ||
      extra.length > 0
    ) {
      issues.push({
        code: 'INVALID_BLOCK_9_CONTENT',
        message: 'Registro 9900 deve possuir REG_BLC e QTD_REG_BLC.',
        line: totalizer.line,
        reg: '9900',
      });
      continue;
    }
    if (previousReg && compareRecordCodes(previousReg, reg) >= 0) {
      issues.push({
        code: 'INVALID_9900_ORDER',
        message:
          'Os registros 9900 devem estar em ordem crescente por REG_BLC.',
        line: totalizer.line,
        reg: '9900',
      });
    }
    previousReg = reg;
    if (entries.has(reg)) {
      issues.push({
        code: 'DUPLICATE_9900_ENTRY',
        message: `REG_BLC ${reg} foi totalizado mais de uma vez.`,
        line: totalizer.line,
        reg: '9900',
      });
    }
    entries.set(reg, {
      count: parseNumericCount(countValue),
      line: totalizer.line,
    });
  }

  for (const [reg, actualCount] of Object.entries(actualCounts)) {
    const entry = entries.get(reg);
    if (!entry) {
      issues.push({
        code: 'MISSING_9900_ENTRY',
        message: `Falta o totalizador 9900 para ${reg}.`,
        reg,
      });
      continue;
    }
    if (entry.count !== actualCount) {
      issues.push({
        code: 'INVALID_9900_COUNT',
        message: `9900 de ${reg} declara ${String(
          entry.count ?? 'valor invalido',
        )}, mas existem ${actualCount} registros.`,
        line: entry.line,
        reg,
      });
    }
  }
  for (const [reg, entry] of entries) {
    if (actualCounts[reg] === undefined) {
      issues.push({
        code: 'UNEXPECTED_9900_ENTRY',
        message: `9900 totaliza ${reg}, que nao existe no arquivo.`,
        line: entry.line,
        reg,
      });
    }
  }

  const declaredBlock9Count = parseCount(closing[0]?.fields);
  if (declaredBlock9Count !== blockLines.length) {
    issues.push({
      code: 'INVALID_9990_COUNT',
      message: `9990 deve contabilizar ${blockLines.length} linhas, incluindo 9999.`,
      line: closing[0]?.line,
      reg: '9990',
    });
  }
  const declaredFileCount = parseCount(fileClosing[0]?.fields);
  if (declaredFileCount !== lines.length) {
    issues.push({
      code: 'INVALID_9999_COUNT',
      message: `9999 deve contabilizar as ${lines.length} linhas do arquivo.`,
      line: fileClosing[0]?.line,
      reg: '9999',
    });
  }
}

function parseCount(fields: readonly string[] | undefined): number | null {
  return fields?.length === 1 ? parseNumericCount(fields[0]) : null;
}

function parseNumericCount(value: string | undefined): number | null {
  if (!value || !/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function countRecords(lines: readonly ParsedLine[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const line of lines) counts[line.reg] = (counts[line.reg] ?? 0) + 1;
  return Object.fromEntries(
    Object.entries(counts).sort(([first], [second]) =>
      compareRecordCodes(first, second),
    ),
  );
}

function countBlocks(
  lines: readonly ParsedLine[],
): Partial<Record<SpedBlockCode, number>> {
  const counts: Partial<Record<SpedBlockCode, number>> = {};
  for (const line of lines) {
    if (line.block) counts[line.block] = (counts[line.block] ?? 0) + 1;
  }
  return counts;
}

function compareRecordCodes(first: string, second: string) {
  return first < second ? -1 : first > second ? 1 : 0;
}

function validationResult(
  issues: SpedValidationIssue[],
  lines: readonly ParsedLine[],
  recordCounts: Record<string, number>,
  blockCounts: Partial<Record<SpedBlockCode, number>> = {},
): SpedValidationResult {
  return Object.freeze({
    valid: issues.length === 0,
    issues: Object.freeze(issues),
    totalLines: lines.length,
    recordCounts: Object.freeze(recordCounts),
    blockCounts: Object.freeze(blockCounts),
  });
}
