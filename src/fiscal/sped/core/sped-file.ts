import {
  SPED_BLOCK_ORDER,
  SPED_LAYOUT_2026,
  type BuiltSpedFile,
  type SpedBlockCode,
  type SpedContentBlockCode,
  type SpedFileInput,
  type SpedRecord,
} from './sped-core.types';
import { formatSpedField, integerField } from './sped-formatters';
import { createSpedRecord, serializeSpedRecords } from './sped-writer';

interface BlockShell {
  readonly opening: string;
  readonly closing: string;
}

const CONTENT_BLOCK_ORDER = SPED_BLOCK_ORDER.filter(
  (block): block is SpedContentBlockCode => block !== '9',
);

const BLOCK_SHELLS: Readonly<Record<SpedContentBlockCode, BlockShell>> = {
  '0': { opening: '0001', closing: '0990' },
  B: { opening: 'B001', closing: 'B990' },
  C: { opening: 'C001', closing: 'C990' },
  D: { opening: 'D001', closing: 'D990' },
  E: { opening: 'E001', closing: 'E990' },
  G: { opening: 'G001', closing: 'G990' },
  H: { opening: 'H001', closing: 'H990' },
  K: { opening: 'K001', closing: 'K990' },
  '1': { opening: '1001', closing: '1990' },
};

const RESERVED_RECORDS = new Set<string>([
  ...Object.values(BLOCK_SHELLS).flatMap((shell) => [
    shell.opening,
    shell.closing,
  ]),
  '9001',
  '9900',
  '9990',
  '9999',
]);

export function getSpedBlockForRecord(reg: string): SpedBlockCode | null {
  const prefix = reg.trim().toUpperCase().slice(0, 1);
  return (SPED_BLOCK_ORDER as readonly string[]).includes(prefix)
    ? (prefix as SpedBlockCode)
    : null;
}

/**
 * Ordena somente os blocos. A ordem relativa dentro de cada bloco e preservada
 * para nao separar registros filhos de seus respectivos pais.
 */
export function orderSpedRecordsByBlock(
  records: readonly SpedRecord[],
): readonly SpedRecord[] {
  const buckets = new Map<SpedBlockCode, SpedRecord[]>(
    SPED_BLOCK_ORDER.map((block) => [block, []]),
  );
  for (const record of records) {
    const block = getSpedBlockForRecord(record.reg);
    if (!block) {
      throw new TypeError(`Bloco nao suportado para o registro ${record.reg}.`);
    }
    buckets.get(block)!.push(record);
  }
  return Object.freeze(
    SPED_BLOCK_ORDER.flatMap((block) => buckets.get(block) ?? []),
  );
}

export function assembleSpedRecords(
  input: SpedFileInput,
): readonly SpedRecord[] {
  const openingRecords = input.records.filter(
    (record) => record.reg.toUpperCase() === '0000',
  );
  if (openingRecords.length !== 1) {
    throw new TypeError('Informe exatamente um registro 0000.');
  }
  if (formatSpedField(openingRecords[0].fields[0]) !== SPED_LAYOUT_2026) {
    throw new TypeError(
      `O registro 0000 deve informar COD_VER ${SPED_LAYOUT_2026}.`,
    );
  }

  const contents = new Map<SpedContentBlockCode, SpedRecord[]>(
    CONTENT_BLOCK_ORDER.map((block) => [block, []]),
  );
  for (const record of input.records) {
    const reg = record.reg.toUpperCase();
    if (reg === '0000') continue;
    if (RESERVED_RECORDS.has(reg)) {
      throw new TypeError(
        `O registro ${reg} e reservado ao fechamento automatico do SPED.`,
      );
    }
    const block = getSpedBlockForRecord(reg);
    if (!block || block === '9') {
      throw new TypeError(`Bloco nao suportado para o registro ${reg}.`);
    }
    contents.get(block)!.push(record);
  }

  const recordsBeforeBlock9: SpedRecord[] = [];
  for (const block of CONTENT_BLOCK_ORDER) {
    const content = contents.get(block)!;
    const shell = BLOCK_SHELLS[block];
    const opening = createSpedRecord(
      shell.opening,
      content.length > 0 ? '0' : '1',
    );
    const closing = createSpedRecord(
      shell.closing,
      integerField(content.length + (block === '0' ? 3 : 2)),
    );

    if (block === '0') {
      recordsBeforeBlock9.push(openingRecords[0], opening, ...content, closing);
    } else {
      recordsBeforeBlock9.push(opening, ...content, closing);
    }
  }

  return Object.freeze([
    ...recordsBeforeBlock9,
    ...buildBlock9(recordsBeforeBlock9),
  ]);
}

export function buildSpedFile(input: SpedFileInput): BuiltSpedFile {
  const records = assembleSpedRecords(input);
  const serialized = serializeSpedRecords(records);
  const recordCounts = countRecords(records);
  const blockCounts = countBlocks(records);

  return Object.freeze({
    layout: SPED_LAYOUT_2026,
    records,
    ...serialized,
    totalLines: records.length,
    recordCounts: Object.freeze(recordCounts),
    blockCounts: Object.freeze(blockCounts),
  });
}

function buildBlock9(recordsBeforeBlock9: readonly SpedRecord[]) {
  const previousCounts = countRecords(recordsBeforeBlock9);
  const totalizedCodes = Array.from(
    new Set([...Object.keys(previousCounts), '9001', '9900', '9990', '9999']),
  ).sort(compareRecordCodes);
  const total9900Records = totalizedCodes.length;
  const block9LineCount = total9900Records + 3;
  const fileLineCount = recordsBeforeBlock9.length + block9LineCount;

  const finalCounts: Record<string, number> = {
    ...previousCounts,
    '9001': 1,
    '9900': total9900Records,
    '9990': 1,
    '9999': 1,
  };

  return [
    createSpedRecord('9001', '0'),
    ...totalizedCodes.map((reg) =>
      createSpedRecord('9900', reg, integerField(finalCounts[reg])),
    ),
    // O Guia Pratico determina que 9999 tambem integra QTD_LIN_9.
    createSpedRecord('9990', integerField(block9LineCount)),
    createSpedRecord('9999', integerField(fileLineCount)),
  ];
}

function countRecords(records: readonly SpedRecord[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const record of records) {
    const reg = record.reg.toUpperCase();
    counts[reg] = (counts[reg] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort(([first], [second]) =>
      compareRecordCodes(first, second),
    ),
  );
}

function compareRecordCodes(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0;
}

function countBlocks(
  records: readonly SpedRecord[],
): Record<SpedBlockCode, number> {
  const counts = Object.fromEntries(
    SPED_BLOCK_ORDER.map((block) => [block, 0]),
  ) as Record<SpedBlockCode, number>;
  for (const record of records) {
    const block = getSpedBlockForRecord(record.reg);
    if (block) counts[block] += 1;
  }
  return counts;
}

export const SPED_BLOCK_SHELLS = BLOCK_SHELLS;
