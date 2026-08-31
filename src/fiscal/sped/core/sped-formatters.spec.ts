import {
  dateField,
  decimalField,
  encodeSpedLatin1,
  formatSpedDate,
  formatSpedDecimal,
  formatSpedField,
  formatSpedInteger,
  sanitizeSpedText,
} from './sped-formatters';
import {
  createSpedRecord,
  serializeSpedRecord,
  serializeSpedRecords,
} from './sped-writer';

describe('formatadores do nucleo EFD ICMS/IPI', () => {
  it('sanitiza delimitadores, controles e Unicode sem perder o Latin-1 valido', () => {
    expect(sanitizeSpedText('  Preço | “café” — x\n😀 \u0000  ')).toBe(
      'Preço "café" - x ?',
    );
    expect(encodeSpedLatin1('ação').toString('hex')).toBe('61e7e36f');
    expect(() => encodeSpedLatin1('😀')).toThrow(/ISO-8859-1/u);
  });

  it('formata decimais exatos com virgula e sem separador de milhar', () => {
    expect(formatSpedDecimal('001234.50')).toBe('1234,50');
    expect(formatSpedDecimal('0007,1250')).toBe('7,1250');
    expect(formatSpedDecimal('-000.00')).toBe('0,00');
    expect(formatSpedDecimal(-123n)).toBe('-123');
    expect(() => formatSpedDecimal('1.234,56')).toThrow(/Decimal fiscal/u);
    expect(() => formatSpedDecimal('1e3')).toThrow(/Decimal fiscal/u);
  });

  it('recusa inteiros inseguros e normaliza contadores', () => {
    expect(formatSpedInteger('000045')).toBe('45');
    expect(formatSpedInteger(-0)).toBe('0');
    expect(formatSpedInteger(45n)).toBe('45');
    expect(() => formatSpedInteger(Number.MAX_SAFE_INTEGER + 1)).toThrow(
      /inseguro/u,
    );
    expect(() => formatSpedInteger('4.5')).toThrow(/Inteiro fiscal/u);
  });

  it('formata datas civis em ddMMyyyy e valida o calendario', () => {
    expect(formatSpedDate('2024-02-29')).toBe('29022024');
    expect(formatSpedDate('29/02/2024')).toBe('29022024');
    expect(formatSpedDate('29022024')).toBe('29022024');
    expect(formatSpedDate(new Date('2026-08-29T23:59:00.000Z'))).toBe(
      '29082026',
    );
    expect(() => formatSpedDate('2023-02-29')).toThrow(/Data fiscal/u);
    expect(() => formatSpedDate('2026-8-9')).toThrow(/Data fiscal/u);
  });

  it('preserva campos vazios como pipes adjacentes', () => {
    const record = createSpedRecord(
      '0005',
      'Empresa | Fiscal',
      null,
      '',
      decimalField('1234.50'),
      dateField('2024-02-29'),
    );
    expect(serializeSpedRecord(record)).toBe(
      '|0005|Empresa Fiscal|||1234,50|29022024|',
    );
    expect(formatSpedField(decimalField(null))).toBe('');
  });

  it('sempre escreve CRLF final e bytes Latin-1', () => {
    const file = serializeSpedRecords([
      createSpedRecord('0000', '020', 'Razão'),
      createSpedRecord('0001', '1'),
    ]);
    expect(file.text).toBe('|0000|020|Razão|\r\n|0001|1|\r\n');
    expect(file.text.replace(/\r\n/gu, '')).not.toMatch(/[\r\n]/u);
    expect(file.bytes.equals(Buffer.from(file.text, 'latin1'))).toBe(true);
  });
});
