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
const QUANTITY_PATTERN = /^\d{1,12}(?:\.\d{1,3})?$/;
const UNIT_VALUE_PATTERN = /^\d{1,15}(?:\.\d{1,6})?$/;
const TAX_ID_PATTERN = /^(?:\d{11}|[A-Z0-9]{12}\d{2})$/;

export const SPED_INVENTORY_REASONS = [
  '01',
  '02',
  '03',
  '04',
  '05',
  '06',
] as const;

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

function normalizeUnitCodeInput(value: unknown) {
  return typeof value === 'string' ? normalizeInventoryUnitCode(value) : value;
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

function normalizeDigits(value: unknown) {
  if (typeof value !== 'string') return value;
  return value.replace(/\D/g, '') || undefined;
}

function normalizeCountryCode(value: unknown) {
  if (typeof value !== 'string') return value;
  const digits = value.replace(/\D/g, '');
  return digits ? digits.slice(-5).padStart(5, '0') : value.trim();
}

export function normalizeInventoryUnitCode(value: string) {
  return value
    .trim()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^0-9A-Za-z]/g, '')
    .toUpperCase();
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

export class SpedInventarioParticipanteDto {
  @ApiProperty({ enum: ['CNPJ', 'CPF'], example: 'CNPJ' })
  @Transform(({ value }: { value: unknown }) => normalizeUppercase(value))
  @IsIn(['CNPJ', 'CPF'])
  tipoDocumento: 'CNPJ' | 'CPF';

  @ApiProperty({ example: '09157533000156' })
  @Transform(({ value }: { value: unknown }) => normalizeTaxId(value))
  @IsString()
  @Matches(TAX_ID_PATTERN)
  documento: string;

  @ApiProperty({ example: 'Depositário ou proprietário do estoque' })
  @Transform(({ value }: { value: unknown }) => trimOptionalText(value))
  @IsString()
  @Length(1, 255)
  nome: string;

  @ApiProperty({ example: '01058', default: '01058' })
  @Transform(({ value }: { value: unknown }) => normalizeCountryCode(value))
  @IsString()
  @Matches(/^\d{5}$/)
  codigoPais = '01058';

  @ApiPropertyOptional({ example: 'ISENTO' })
  @Transform(({ value }: { value: unknown }) => trimOptionalText(value))
  @IsOptional()
  @IsString()
  @Length(1, 30)
  inscricaoEstadual?: string | null;

  @ApiProperty({ example: '2927408' })
  @Transform(({ value }: { value: unknown }) => normalizeDigits(value))
  @IsString()
  @Matches(/^\d{7}$/)
  codigoMunicipioIbge: string;

  @ApiPropertyOptional({ example: '123456789' })
  @Transform(({ value }: { value: unknown }) => normalizeDigits(value))
  @IsOptional()
  @IsString()
  @Length(1, 20)
  suframa?: string | null;

  @ApiProperty({ example: 'Rua do Depósito' })
  @Transform(({ value }: { value: unknown }) => trimOptionalText(value))
  @IsString()
  @Length(1, 255)
  logradouro: string;

  @ApiProperty({ example: '100' })
  @Transform(({ value }: { value: unknown }) => trimOptionalText(value))
  @IsString()
  @Length(1, 60)
  numero: string;

  @ApiPropertyOptional({ example: 'Galpão 2' })
  @Transform(({ value }: { value: unknown }) => trimOptionalText(value))
  @IsOptional()
  @IsString()
  @Length(1, 255)
  complemento?: string | null;

  @ApiProperty({ example: 'Centro' })
  @Transform(({ value }: { value: unknown }) => trimOptionalText(value))
  @IsString()
  @Length(1, 120)
  bairro: string;

  @ApiPropertyOptional({ example: '40000000' })
  @Transform(({ value }: { value: unknown }) => normalizeDigits(value))
  @IsOptional()
  @IsString()
  @Matches(/^\d{8}$/)
  cep?: string | null;
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
  @Transform(({ value }: { value: unknown }) => normalizeUnitCodeInput(value))
  @IsString()
  @Length(1, 6)
  @Matches(/^[0-9A-Z]+$/)
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

  @ApiProperty({ example: '10.500' })
  @Transform(({ value }: { value: unknown }) => normalizeDecimal(value))
  @IsString()
  @Matches(QUANTITY_PATTERN)
  quantidade: string;

  @ApiProperty({ example: '12.345679' })
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
    enum: SPED_INVENTORY_REASONS,
  })
  @IsString()
  @IsIn(SPED_INVENTORY_REASONS)
  motivo: (typeof SPED_INVENTORY_REASONS)[number];

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

  @ApiPropertyOptional({
    type: [SpedInventarioParticipanteDto],
    description:
      'Participantes do H010 ainda não existentes no catálogo 0150. Participantes já cadastrados podem ser omitidos.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5_000)
  @ValidateNested({ each: true })
  @Type(() => SpedInventarioParticipanteDto)
  participantes?: SpedInventarioParticipanteDto[];
}
