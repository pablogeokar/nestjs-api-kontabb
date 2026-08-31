import type {
  SpedDateInput,
  SpedDecimalInput,
  SpedFieldValue,
  SpedIntegerInput,
  SpedTypedField,
} from './sped-core.types';

const UNICODE_REPLACEMENTS: Readonly<Record<string, string>> = {
  '\u2010': '-',
  '\u2011': '-',
  '\u2012': '-',
  '\u2013': '-',
  '\u2014': '-',
  '\u2015': '-',
  '\u2018': "'",
  '\u2019': "'",
  '\u201a': "'",
  '\u201c': '"',
  '\u201d': '"',
  '\u201e': '"',
  '\u2026': '...',
  '\u20ac': 'EUR',
};

export function textField(value: string | null | undefined): SpedTypedField {
  return { kind: 'text', value };
}

export function decimalField(
  value: SpedDecimalInput | null | undefined,
): SpedTypedField {
  return { kind: 'decimal', value };
}

export function integerField(
  value: SpedIntegerInput | null | undefined,
): SpedTypedField {
  return { kind: 'integer', value };
}

export function dateField(
  value: SpedDateInput | null | undefined,
): SpedTypedField {
  return { kind: 'date', value };
}

export function sanitizeSpedText(value: string | null | undefined): string {
  if (value == null) return '';

  const normalized = Array.from(value.normalize('NFC'), (character) => {
    const codePoint = character.codePointAt(0)!;
    const isControl =
      codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
    return character === '|' || isControl ? ' ' : character;
  }).join('');
  let result = '';

  for (const character of normalized) {
    const replacement = UNICODE_REPLACEMENTS[character];
    if (replacement !== undefined) {
      result += replacement;
      continue;
    }

    const codePoint = character.codePointAt(0)!;
    if (codePoint <= 0xff) {
      result += character;
      continue;
    }

    const asciiFallback = character
      .normalize('NFKD')
      .replace(/\p{Mark}/gu, '')
      .replace(/[^\x20-\x7e]/gu, '');
    result += asciiFallback || '?';
  }

  return result.replace(/\s+/gu, ' ').trim();
}

export function formatSpedDecimal(value: SpedDecimalInput): string {
  const raw = String(value).trim();
  const match = raw.match(/^(-?)(\d+)(?:[.,](\d+))?$/u);
  if (!match) {
    throw new TypeError(`Decimal fiscal invalido: ${raw || '(vazio)'}`);
  }

  const integer = match[2].replace(/^0+(?=\d)/u, '');
  const fraction = match[3];
  const isZero = /^0+$/u.test(integer) && (!fraction || /^0+$/u.test(fraction));
  const sign = match[1] === '-' && !isZero ? '-' : '';
  return `${sign}${integer}${fraction ? `,${fraction}` : ''}`;
}

export function formatSpedInteger(value: SpedIntegerInput): string {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError(`Inteiro fiscal inseguro: ${String(value)}`);
    }
    return String(value);
  }

  const raw = String(value).trim();
  const match = raw.match(/^(-?)(\d+)$/u);
  if (!match) {
    throw new TypeError(`Inteiro fiscal invalido: ${raw || '(vazio)'}`);
  }
  const integer = match[2].replace(/^0+(?=\d)/u, '');
  return match[1] === '-' && integer !== '0' ? `-${integer}` : integer;
}

export function formatSpedDate(value: SpedDateInput): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new TypeError('Data fiscal invalida.');
    }
    return formatDateParts(
      value.getUTCFullYear(),
      value.getUTCMonth() + 1,
      value.getUTCDate(),
    );
  }

  const raw = value.trim();
  let year: number;
  let month: number;
  let day: number;

  let match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (match) {
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
    return formatDateParts(year, month, day);
  }

  match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/u);
  if (match) {
    day = Number(match[1]);
    month = Number(match[2]);
    year = Number(match[3]);
    return formatDateParts(year, month, day);
  }

  match = raw.match(/^(\d{2})(\d{2})(\d{4})$/u);
  if (match) {
    day = Number(match[1]);
    month = Number(match[2]);
    year = Number(match[3]);
    return formatDateParts(year, month, day);
  }

  throw new TypeError(`Data fiscal invalida: ${raw || '(vazio)'}`);
}

export function formatSpedField(field: SpedFieldValue): string {
  if (field == null) return '';
  if (typeof field === 'string') return sanitizeSpedText(field);
  if (field.value == null) return '';

  switch (field.kind) {
    case 'text':
      return sanitizeSpedText(field.value);
    case 'decimal':
      return formatSpedDecimal(field.value);
    case 'integer':
      return formatSpedInteger(field.value);
    case 'date':
      return formatSpedDate(field.value);
  }
}

export function encodeSpedLatin1(text: string): Buffer {
  for (const character of text) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint > 0xff) {
      throw new TypeError(
        `Texto contem caractere fora de ISO-8859-1: U+${codePoint
          .toString(16)
          .toUpperCase()
          .padStart(4, '0')}`,
      );
    }
  }
  return Buffer.from(text, 'latin1');
}

function formatDateParts(year: number, month: number, day: number): string {
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) {
    throw new TypeError('Data fiscal invalida.');
  }
  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const maximumDay = [
    31,
    isLeapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ][month - 1];
  if (day > maximumDay) throw new TypeError('Data fiscal invalida.');

  return `${String(day).padStart(2, '0')}${String(month).padStart(
    2,
    '0',
  )}${String(year).padStart(4, '0')}`;
}
