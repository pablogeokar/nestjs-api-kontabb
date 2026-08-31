import { MINIMAL_EFD_020_GOLDEN_LATIN1_BASE64 } from './__fixtures__/minimal-efd-020.golden';
import {
  assembleSpedRecords,
  buildSpedFile,
  orderSpedRecordsByBlock,
} from './sped-file';
import { decimalField } from './sped-formatters';
import { createSpedRecord, serializeSpedRecord } from './sped-writer';
import { validateSpedFile } from './sped-validator';

describe('montagem do arquivo EFD ICMS/IPI', () => {
  it('produz o arquivo minimo exatamente igual ao golden Latin-1', () => {
    const file = buildSpedFile({
      records: [createSpedRecord('0000', '020')],
    });

    expect(file.bytes.toString('base64')).toBe(
      MINIMAL_EFD_020_GOLDEN_LATIN1_BASE64,
    );
    expect(file.totalLines).toBe(45);
    expect(file.bytes.length).toBe(570);
    expect(file.blockCounts).toEqual({
      '0': 3,
      B: 2,
      C: 2,
      D: 2,
      E: 2,
      G: 2,
      H: 2,
      K: 2,
      '1': 2,
      '9': 26,
    });
    expect(validateSpedFile(file.bytes)).toMatchObject({ valid: true });
  });

  it('ordena os blocos e preserva a hierarquia informada dentro de cada bloco', () => {
    const c100a = createSpedRecord('C100', 'A');
    const c170a = createSpedRecord('C170', 'A-1');
    const c190a = createSpedRecord('C190', 'A-TOTAL');
    const c100b = createSpedRecord('C100', 'B');
    const c170b = createSpedRecord('C170', 'B-1');
    const ordered = orderSpedRecordsByBlock([
      createSpedRecord('D100', 'D'),
      c100a,
      createSpedRecord('0005', 'EMPRESA'),
      c170a,
      c190a,
      c100b,
      createSpedRecord('H005', 'H'),
      c170b,
      createSpedRecord('0000', '020'),
    ]);

    expect(ordered.map((record) => serializeSpedRecord(record))).toEqual([
      '|0005|EMPRESA|',
      '|0000|020|',
      '|C100|A|',
      '|C170|A-1|',
      '|C190|A-TOTAL|',
      '|C100|B|',
      '|C170|B-1|',
      '|D100|D|',
      '|H005|H|',
    ]);

    const file = buildSpedFile({ records: ordered });
    const cLines = file.lines.filter((line) =>
      /^\|C(?:001|100|170|190|990)\|/u.test(line),
    );
    expect(cLines).toEqual([
      '|C001|0|',
      '|C100|A|',
      '|C170|A-1|',
      '|C190|A-TOTAL|',
      '|C100|B|',
      '|C170|B-1|',
      '|C990|7|',
    ]);
    expect(file.lines).toContain('|B001|1|');
    expect(file.lines).toContain('|G001|1|');
    expect(file.lines).toContain('|H001|0|');
    expect(file.lines).toContain('|H990|3|');
    expect(file.lines).toContain('|K001|1|');
    expect(validateSpedFile(file.text).valid).toBe(true);
  });

  it('calcula 9900, 9990 e 9999 com todas as autorreferencias', () => {
    const file = buildSpedFile({
      records: [
        createSpedRecord('0000', '020'),
        createSpedRecord('0005', 'EMPRESA'),
        createSpedRecord('C100', '1'),
        createSpedRecord('C170', '1', decimalField('10.50')),
        createSpedRecord('C100', '2'),
      ],
    });
    const uniqueRecordTypes = Object.keys(file.recordCounts).length;

    expect(file.recordCounts.C100).toBe(2);
    expect(file.recordCounts['9900']).toBe(uniqueRecordTypes);
    expect(file.lines).toContain(`|9900|9900|${uniqueRecordTypes}|`);
    expect(file.lines).toContain('|9900|9990|1|');
    expect(file.lines).toContain('|9900|9999|1|');
    expect(file.lines).toContain('|9900|C100|2|');
    expect(file.lines.at(-2)).toBe(`|9990|${file.blockCounts['9']}|`);
    expect(file.lines.at(-1)).toBe(`|9999|${file.totalLines}|`);
  });

  it('gera o mesmo resultado em execucoes sucessivas', () => {
    const input = {
      records: [
        createSpedRecord('0000', '020'),
        createSpedRecord('0005', 'EMPRESA'),
        createSpedRecord('D100', '57'),
      ],
    };
    expect(buildSpedFile(input).bytes.equals(buildSpedFile(input).bytes)).toBe(
      true,
    );
  });

  it('rejeita abertura ausente/duplicada, leiaute incorreto e controles manuais', () => {
    expect(() => assembleSpedRecords({ records: [] })).toThrow(
      /um registro 0000/u,
    );
    expect(() =>
      assembleSpedRecords({
        records: [
          createSpedRecord('0000', '020'),
          createSpedRecord('0000', '020'),
        ],
      }),
    ).toThrow(/um registro 0000/u);
    expect(() =>
      assembleSpedRecords({ records: [createSpedRecord('0000', '019')] }),
    ).toThrow(/COD_VER 020/u);
    expect(() =>
      assembleSpedRecords({
        records: [
          createSpedRecord('0000', '020'),
          createSpedRecord('C990', '2'),
        ],
      }),
    ).toThrow(/reservado/u);
    expect(() =>
      assembleSpedRecords({
        records: [
          createSpedRecord('0000', '020'),
          createSpedRecord('A100', 'X'),
        ],
      }),
    ).toThrow(/nao suportado/u);
  });
});
