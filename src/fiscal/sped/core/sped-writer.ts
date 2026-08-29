import type {
  SerializedSpedFile,
  SpedFieldValue,
  SpedRecord,
} from './sped-core.types';
import {
  encodeSpedLatin1,
  formatSpedField,
  sanitizeSpedText,
} from './sped-formatters';

const RECORD_CODE_PATTERN = /^[0-9A-Z]{4}$/u;

export function createSpedRecord(
  reg: string,
  ...fields: readonly SpedFieldValue[]
): SpedRecord {
  const normalizedReg = sanitizeSpedText(reg).toUpperCase();
  if (!RECORD_CODE_PATTERN.test(normalizedReg)) {
    throw new TypeError(`Codigo de registro SPED invalido: ${reg}`);
  }
  return Object.freeze({
    reg: normalizedReg,
    fields: Object.freeze([...fields]),
  });
}

export function serializeSpedRecord(record: SpedRecord): string {
  const reg = sanitizeSpedText(record.reg).toUpperCase();
  if (!RECORD_CODE_PATTERN.test(reg)) {
    throw new TypeError(`Codigo de registro SPED invalido: ${record.reg}`);
  }
  return ['', reg, ...record.fields.map(formatSpedField), ''].join('|');
}

export function serializeSpedRecords(
  records: readonly SpedRecord[],
): SerializedSpedFile {
  if (records.length === 0) {
    throw new TypeError('O arquivo SPED deve possuir ao menos um registro.');
  }
  const lines = records.map(serializeSpedRecord);
  const text = `${lines.join('\r\n')}\r\n`;
  return Object.freeze({
    lines: Object.freeze(lines),
    text,
    bytes: encodeSpedLatin1(text),
  });
}
