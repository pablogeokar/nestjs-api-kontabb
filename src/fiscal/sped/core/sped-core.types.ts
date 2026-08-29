export const SPED_LAYOUT_2026 = '020' as const;

export const SPED_BLOCK_ORDER = [
  '0',
  'B',
  'C',
  'D',
  'E',
  'G',
  'H',
  'K',
  '1',
  '9',
] as const;

export type SpedBlockCode = (typeof SPED_BLOCK_ORDER)[number];
export type SpedContentBlockCode = Exclude<SpedBlockCode, '9'>;

export type SpedDecimalInput = string | bigint;
export type SpedIntegerInput = string | number | bigint;
export type SpedDateInput = string | Date;

export type SpedTypedField =
  | {
      readonly kind: 'text';
      readonly value: string | null | undefined;
    }
  | {
      readonly kind: 'decimal';
      readonly value: SpedDecimalInput | null | undefined;
    }
  | {
      readonly kind: 'integer';
      readonly value: SpedIntegerInput | null | undefined;
    }
  | {
      readonly kind: 'date';
      readonly value: SpedDateInput | null | undefined;
    };

/**
 * Strings simples sao tratadas como texto. Datas e numeros devem usar os
 * helpers tipados para que a formatacao fiscal nao dependa de heuristica.
 */
export type SpedFieldValue = string | null | undefined | SpedTypedField;

export interface SpedRecord {
  readonly reg: string;
  readonly fields: readonly SpedFieldValue[];
}

export interface SpedFileInput {
  /**
   * Registros de negocio, inclusive um unico 0000. Aberturas, fechamentos e
   * todo o Bloco 9 sao reservados ao nucleo e nao devem ser informados.
   */
  readonly records: readonly SpedRecord[];
}

export interface SerializedSpedFile {
  readonly text: string;
  readonly bytes: Buffer;
  readonly lines: readonly string[];
}

export interface BuiltSpedFile extends SerializedSpedFile {
  readonly layout: typeof SPED_LAYOUT_2026;
  readonly records: readonly SpedRecord[];
  readonly totalLines: number;
  readonly recordCounts: Readonly<Record<string, number>>;
  readonly blockCounts: Readonly<Record<SpedBlockCode, number>>;
}

export type SpedValidationIssueCode =
  | 'EMPTY_FILE'
  | 'INVALID_LINE_BREAK'
  | 'MISSING_FINAL_CRLF'
  | 'EMPTY_LINE'
  | 'INVALID_LATIN1_CHARACTER'
  | 'INVALID_CONTROL_CHARACTER'
  | 'INVALID_DELIMITERS'
  | 'INVALID_RECORD_CODE'
  | 'UNSUPPORTED_BLOCK'
  | 'INVALID_BLOCK_ORDER'
  | 'MISSING_FILE_OPENING'
  | 'MISSING_FILE_CLOSING'
  | 'INVALID_LAYOUT'
  | 'MISSING_BLOCK_SHELL'
  | 'DUPLICATE_BLOCK_SHELL'
  | 'INVALID_BLOCK_SHELL_POSITION'
  | 'INVALID_MOVEMENT_INDICATOR'
  | 'INVALID_BLOCK_LINE_COUNT'
  | 'INVALID_BLOCK_9_CONTENT'
  | 'INVALID_9900_ORDER'
  | 'DUPLICATE_9900_ENTRY'
  | 'MISSING_9900_ENTRY'
  | 'UNEXPECTED_9900_ENTRY'
  | 'INVALID_9900_COUNT'
  | 'INVALID_9990_COUNT'
  | 'INVALID_9999_COUNT';

export interface SpedValidationIssue {
  readonly code: SpedValidationIssueCode;
  readonly message: string;
  readonly line?: number;
  readonly reg?: string;
}

export interface SpedValidationResult {
  readonly valid: boolean;
  readonly issues: readonly SpedValidationIssue[];
  readonly totalLines: number;
  readonly recordCounts: Readonly<Record<string, number>>;
  readonly blockCounts: Readonly<Partial<Record<SpedBlockCode, number>>>;
}
