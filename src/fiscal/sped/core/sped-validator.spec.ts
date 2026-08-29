import { buildSpedFile } from './sped-file';
import { createSpedRecord } from './sped-writer';
import { validateSpedFile } from './sped-validator';

describe('validador estrutural EFD ICMS/IPI', () => {
  const validFile = () =>
    buildSpedFile({
      records: [
        createSpedRecord('0000', '020'),
        createSpedRecord('0005', 'EMPRESA'),
        createSpedRecord('C100', 'DOC'),
      ],
    }).text;

  it('aceita o arquivo construido pelo nucleo e devolve seus contadores', () => {
    const result = validateSpedFile(validFile());
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.recordCounts['0000']).toBe(1);
    expect(result.recordCounts['9900']).toBe(
      Object.keys(result.recordCounts).length,
    );
    expect(result.blockCounts.C).toBe(3);
  });

  it('valida a quantidade oficial de campos quando o modo estrito e ativado', () => {
    const result = validateSpedFile(validFile(), { strictFieldCounts: true });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'INVALID_FIELD_COUNT',
          reg: '0000',
        }),
        expect.objectContaining({
          code: 'INVALID_FIELD_COUNT',
          reg: 'C100',
        }),
      ]),
    );
  });

  it('detecta contagem incorreta de bloco e dos fechamentos gerais', () => {
    const source = validFile()
      .replace('|C990|3|', '|C990|99|')
      .replace(/\r\n\|9990\|(\d+)\|\r\n/u, '\r\n|9990|1|\r\n')
      .replace(/\r\n\|9999\|(\d+)\|\r\n/u, '\r\n|9999|1|\r\n');
    const codes = validateSpedFile(source).issues.map((issue) => issue.code);

    expect(codes).toContain('INVALID_BLOCK_LINE_COUNT');
    expect(codes).toContain('INVALID_9990_COUNT');
    expect(codes).toContain('INVALID_9999_COUNT');
  });

  it('detecta a autorreferencia incorreta do 9900', () => {
    const source = validFile().replace(
      /\|9900\|9900\|(\d+)\|/u,
      '|9900|9900|1|',
    );
    const result = validateSpedFile(source);

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'INVALID_9900_COUNT',
          reg: '9900',
        }),
      ]),
    );
  });

  it('detecta totalizador ausente, duplicado e fora de ordem', () => {
    const source = validFile().replace(
      '|9900|C001|1|\r\n|9900|C100|1|',
      '|9900|C001|1|\r\n|9900|C001|1|',
    );
    const codes = validateSpedFile(source).issues.map((issue) => issue.code);

    expect(codes).toContain('DUPLICATE_9900_ENTRY');
    expect(codes).toContain('INVALID_9900_ORDER');
    expect(codes).toContain('MISSING_9900_ENTRY');
  });

  it('detecta quebra LF, CRLF final ausente e bloco fora da ordem', () => {
    const reordered = validFile()
      .replace('|B001|1|\r\n|B990|2|\r\n', '')
      .replace('|D001|1|', '|D001|1|\r\n|B001|1|\r\n|B990|2|');
    const invalid = reordered.replace(/\r\n/gu, '\n').replace(/\n$/u, '');
    const codes = validateSpedFile(invalid).issues.map((issue) => issue.code);

    expect(codes).toContain('INVALID_LINE_BREAK');
    expect(codes).toContain('MISSING_FINAL_CRLF');
    expect(codes).toContain('INVALID_BLOCK_ORDER');
  });

  it('detecta shells/indicador invalidos e caracteres fora de Latin-1', () => {
    const source = validFile()
      .replace('|G001|1|\r\n|G990|2|\r\n', '')
      .replace('|H001|1|', '|H001|0|')
      .replace('|0005|EMPRESA|', '|0005|EMPRESA😀|');
    const codes = validateSpedFile(source).issues.map((issue) => issue.code);

    expect(codes).toContain('MISSING_BLOCK_SHELL');
    expect(codes).toContain('INVALID_MOVEMENT_INDICATOR');
    expect(codes).toContain('INVALID_LATIN1_CHARACTER');
  });
});
