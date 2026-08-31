import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
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

const MONEY_PATTERN = /^\d{1,13}(?:\.\d{1,2})?$/;
const DATE_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
const UF_PATTERN = /^[A-Z]{2}$/;

function normalizeMoney(value: unknown) {
  return typeof value === 'string' ? value.trim().replace(',', '.') : value;
}

function normalizeUf(value: unknown) {
  return typeof value === 'string' ? value.trim().toUpperCase() : value;
}

function normalizeUppercase(value: unknown) {
  return typeof value === 'string' ? value.trim().toUpperCase() : value;
}

export class CompetenciaSpedDto {
  @ApiProperty({ example: '2026-08' })
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  competencia: string;
}

export class AdminCompetenciaSpedDto extends CompetenciaSpedDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  clienteId: string;
}

export class SpedSaldoApuracaoDto {
  @ApiProperty({ enum: ['ICMS_PROPRIO', 'ICMS_ST', 'IPI'] })
  @IsIn(['ICMS_PROPRIO', 'ICMS_ST', 'IPI'])
  tipo: 'ICMS_PROPRIO' | 'ICMS_ST' | 'IPI';

  @ApiPropertyOptional({ example: 'BA' })
  @Transform(({ value }: { value: unknown }) => normalizeUf(value))
  @ValidateIf(
    (row: SpedSaldoApuracaoDto, value: unknown) =>
      row.tipo === 'ICMS_ST' || (value !== undefined && value !== null),
  )
  @IsString()
  @Matches(UF_PATTERN)
  uf?: string | null;

  @ApiProperty({ example: '1250.42' })
  @Transform(({ value }: { value: unknown }) => normalizeMoney(value))
  @IsString()
  @Matches(MONEY_PATTERN)
  saldoCredorAnterior: string;
}

export class SpedAjusteApuracaoDto {
  @ApiProperty({ enum: ['E111', 'E220', 'E311', 'E530'] })
  @Transform(({ value }: { value: unknown }) => normalizeUppercase(value))
  @IsIn(['E111', 'E220', 'E311', 'E530'])
  registro: 'E111' | 'E220' | 'E311' | 'E530';

  @ApiProperty()
  @Transform(({ value }: { value: unknown }) => normalizeUppercase(value))
  @IsString()
  @Length(1, 120)
  codigoAjuste: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 500)
  descricao?: string | null;

  @ApiProperty({ example: '150.00' })
  @Transform(({ value }: { value: unknown }) => normalizeMoney(value))
  @IsString()
  @Matches(MONEY_PATTERN)
  valor: string;

  @ApiProperty({
    enum: [
      'DEBITO',
      'CREDITO',
      'ESTORNO_DEBITO',
      'ESTORNO_CREDITO',
      'DEDUCAO',
      'DEBITO_ESPECIAL',
    ],
  })
  @Transform(({ value }: { value: unknown }) => normalizeUppercase(value))
  @IsIn([
    'DEBITO',
    'CREDITO',
    'ESTORNO_DEBITO',
    'ESTORNO_CREDITO',
    'DEDUCAO',
    'DEBITO_ESPECIAL',
  ])
  indicador:
    | 'DEBITO'
    | 'CREDITO'
    | 'ESTORNO_DEBITO'
    | 'ESTORNO_CREDITO'
    | 'DEDUCAO'
    | 'DEBITO_ESPECIAL';

  @ApiPropertyOptional({ example: 'BA' })
  @Transform(({ value }: { value: unknown }) => normalizeUf(value))
  @ValidateIf(
    (row: SpedAjusteApuracaoDto, value: unknown) =>
      row.registro === 'E220' ||
      row.registro === 'E311' ||
      (value !== undefined && value !== null),
  )
  @IsString()
  @Matches(UF_PATTERN)
  uf?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 80)
  numeroDocumento?: string | null;
}

export class SpedObrigacaoRecolhimentoDto {
  @ApiProperty({ enum: ['ICMS_PROPRIO', 'ICMS_ST', 'DIFAL_FCP'] })
  @IsIn(['ICMS_PROPRIO', 'ICMS_ST', 'DIFAL_FCP'])
  tipo: 'ICMS_PROPRIO' | 'ICMS_ST' | 'DIFAL_FCP';

  @ApiPropertyOptional({ example: 'BA' })
  @Transform(({ value }: { value: unknown }) => normalizeUf(value))
  @ValidateIf(
    (row: SpedObrigacaoRecolhimentoDto, value: unknown) =>
      row.tipo !== 'ICMS_PROPRIO' || (value !== undefined && value !== null),
  )
  @IsString()
  @Matches(UF_PATTERN)
  uf?: string | null;

  @ApiProperty()
  @IsString()
  @Length(1, 120)
  codigoObrigacao: string;

  @ApiProperty({ example: '850.32' })
  @Transform(({ value }: { value: unknown }) => normalizeMoney(value))
  @IsString()
  @Matches(MONEY_PATTERN)
  valor: string;

  @ApiProperty({ example: '2026-09-09' })
  @IsString()
  @Matches(DATE_PATTERN)
  dataVencimento: string;

  @ApiProperty()
  @IsString()
  @Length(1, 80)
  codigoReceita: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 80)
  numeroProcesso?: string | null;

  @ApiPropertyOptional({ enum: ['0', '1', '2'] })
  @IsOptional()
  @IsIn(['0', '1', '2'])
  indicadorProcesso?: '0' | '1' | '2' | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 120)
  processo?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 500)
  textoComplementar?: string | null;

  @ApiProperty({ example: '082026' })
  @IsString()
  @Matches(/^(0[1-9]|1[0-2])\d{4}$/)
  mesReferencia: string;
}

export class SpedResponsabilidadeTributariaDto {
  @ApiProperty({ enum: ['ICMS_ST', 'DIFAL_FCP'] })
  @IsIn(['ICMS_ST', 'DIFAL_FCP'])
  tipo: 'ICMS_ST' | 'DIFAL_FCP';

  @ApiProperty({ example: 'BA' })
  @Transform(({ value }: { value: unknown }) => normalizeUf(value))
  @IsString()
  @Matches(UF_PATTERN)
  uf: string;

  @ApiProperty({ example: '2026-01-01' })
  @IsString()
  @Matches(DATE_PATTERN)
  vigenciaInicio: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN)
  vigenciaFim?: string | null;

  @ApiPropertyOptional({ default: true })
  @IsBoolean()
  ativo = true;
}

export class AtualizarContextoApuracaoSpedDto extends CompetenciaSpedDto {
  @ApiProperty({ type: [SpedSaldoApuracaoDto] })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SpedSaldoApuracaoDto)
  saldos: SpedSaldoApuracaoDto[];

  @ApiProperty({ type: [SpedAjusteApuracaoDto] })
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => SpedAjusteApuracaoDto)
  ajustes: SpedAjusteApuracaoDto[];

  @ApiProperty({ type: [SpedObrigacaoRecolhimentoDto] })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SpedObrigacaoRecolhimentoDto)
  obrigacoes: SpedObrigacaoRecolhimentoDto[];

  @ApiPropertyOptional({ type: [SpedResponsabilidadeTributariaDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SpedResponsabilidadeTributariaDto)
  responsabilidades?: SpedResponsabilidadeTributariaDto[];
}

export class AdminAtualizarContextoApuracaoSpedDto extends AtualizarContextoApuracaoSpedDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  clienteId: string;
}
