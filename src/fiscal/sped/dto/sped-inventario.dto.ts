import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const DATE_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
const MONEY_PATTERN = /^\d{1,13}(?:\.\d{1,2})?$/;
const QUANTITY_PATTERN = /^\d{1,11}(?:\.\d{1,4})?$/;
const UNIT_VALUE_PATTERN = /^\d{1,11}(?:\.\d{1,10})?$/;
const TAX_ID_PATTERN = /^(?:\d{11}|[A-Z0-9]{12}\d{2})$/;

function trimText(value: unknown) {
  return typeof value === 'string' ? value.trim() : value;
}

function trimOptionalText(value: unknown) {
  if (typeof value !== 'string') return value;
  return value.trim() || undefined;
}

function normalizeDecimal(value: unknown) {
  return typeof value === 'string' ? value.trim().replace(',', '.') : value;
}

function normalizeOptionalDecimal(value: unknown) {
  if (typeof value !== 'string') return value;
  return value.trim() ? value.trim().replace(',', '.') : undefined;
}

function normalizeUppercase(value: unknown) {
  return typeof value === 'string' ? value.trim().toUpperCase() : value;
}

function normalizeTaxId(value: unknown) {
  if (typeof value !== 'string') return value;
  return (
    value
      .trim()
      .toUpperCase()
      .replace(/[^0-9A-Z]/g, '') || undefined
  );
}

export class DataInventarioSpedDto {
  @ApiProperty({ example: '2025-12-31' })
  @IsString()
  @Matches(DATE_PATTERN)
  data: string;
}

export class AdminDataInventarioSpedDto extends DataInventarioSpedDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  clienteId: string;
}

export class SpedInventarioItemDto {
  @ApiProperty({ example: 'SKU-0001' })
  @Transform(({ value }: { value: unknown }) => trimOptionalText(value))
  @IsString()
  @Length(1, 120)
  codigoExterno: string;

  @ApiProperty({ example: 'Mercadoria para revenda' })
  @Transform(({ value }: { value: unknown }) => trimOptionalText(value))
  @IsString()
  @Length(1, 500)
  descricao: string;

  @ApiProperty({ example: 'UN', maxLength: 6 })
  @Transform(({ value }: { value: unknown }) => normalizeUppercase(value))
  @IsString()
  @Length(1, 20)
  unidade: string;

  @ApiPropertyOptional({ example: 'Unidade' })
  @Transform(({ value }: { value: unknown }) => trimOptionalText(value))
  @IsOptional()
  @IsString()
  @Length(1, 100)
  descricaoUnidade?: string | null;

  @ApiProperty({
    enum: [
      '00',
      '01',
      '02',
      '03',
      '04',
      '05',
      '06',
      '07',
      '08',
      '09',
      '10',
      '99',
    ],
    example: '00',
  })
  @IsIn([
    '00',
    '01',
    '02',
    '03',
    '04',
    '05',
    '06',
    '07',
    '08',
    '09',
    '10',
    '99',
  ])
  tipoItem:
    | '00'
    | '01'
    | '02'
    | '03'
    | '04'
    | '05'
    | '06'
    | '07'
    | '08'
    | '09'
    | '10'
    | '99';

  @ApiPropertyOptional({ example: '22030000' })
  @Transform(({ value }: { value: unknown }) => trimOptionalText(value))
  @IsOptional()
  @IsString()
  @Matches(/^\d{8}$/)
  ncm?: string | null;

  @ApiPropertyOptional({ example: '0300100' })
  @Transform(({ value }: { value: unknown }) => trimOptionalText(value))
  @IsOptional()
  @IsString()
  @Matches(/^\d{7}$/)
  cest?: string | null;

  @ApiProperty({ example: '10.5000' })
  @Transform(({ value }: { value: unknown }) => normalizeDecimal(value))
  @IsString()
  @Matches(QUANTITY_PATTERN)
  quantidade: string;

  @ApiProperty({ example: '12.3456789000' })
  @Transform(({ value }: { value: unknown }) => normalizeDecimal(value))
  @IsString()
  @Matches(UNIT_VALUE_PATTERN)
  valorUnitario: string;

  @ApiProperty({ example: '129.63' })
  @Transform(({ value }: { value: unknown }) => normalizeDecimal(value))
  @IsString()
  @Matches(MONEY_PATTERN)
  valorItem: string;

  @ApiProperty({ enum: ['0', '1', '2'], default: '0' })
  @IsIn(['0', '1', '2'])
  indicadorPropriedade: '0' | '1' | '2' = '0';

  @ApiPropertyOptional({
    description:
      'CPF/CNPJ de participante já cadastrado no SPED; obrigatório para propriedade 1 ou 2.',
    example: '09157533000156',
  })
  @Transform(({ value }: { value: unknown }) => normalizeTaxId(value))
  @ValidateIf(
    (row: SpedInventarioItemDto, value: unknown) =>
      row.indicadorPropriedade !== '0' ||
      (value !== undefined && value !== null),
  )
  @IsString()
  @Matches(TAX_ID_PATTERN)
  participanteDocumento?: string | null;

  @ApiPropertyOptional()
  @Transform(({ value }: { value: unknown }) => trimOptionalText(value))
  @IsOptional()
  @IsString()
  @Length(1, 500)
  textoComplementar?: string | null;

  @ApiPropertyOptional()
  @Transform(({ value }: { value: unknown }) => trimText(value))
  @IsOptional()
  @IsString()
  @Length(1, 120)
  codigoConta?: string | null;

  @ApiPropertyOptional({ example: '129.63' })
  @Transform(({ value }: { value: unknown }) => normalizeOptionalDecimal(value))
  @IsOptional()
  @IsString()
  @Matches(MONEY_PATTERN)
  valorItemIr?: string | null;
}

export class AtualizarInventarioSpedDto {
  @ApiProperty({
    description: 'Motivo do inventário conforme tabela do registro H005.',
    example: '01',
  })
  @IsString()
  @Matches(/^\d{2}$/)
  motivo: string;

  @ApiProperty({ example: '129.63' })
  @Transform(({ value }: { value: unknown }) => normalizeDecimal(value))
  @IsString()
  @Matches(MONEY_PATTERN)
  valorTotal: string;

  @ApiProperty({ enum: ['RASCUNHO', 'FECHADO'] })
  @Transform(({ value }: { value: unknown }) => normalizeUppercase(value))
  @IsIn(['RASCUNHO', 'FECHADO'])
  status: 'RASCUNHO' | 'FECHADO';

  @ApiProperty({ type: [SpedInventarioItemDto] })
  @IsArray()
  @ArrayMaxSize(25_000)
  @ValidateNested({ each: true })
  @Type(() => SpedInventarioItemDto)
  itens: SpedInventarioItemDto[];
}
