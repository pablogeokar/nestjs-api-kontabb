import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Matches,
  MinLength,
} from 'class-validator';
import {
  COMPETENCIA_MESSAGE,
  COMPETENCIA_REGEX,
  DATA_CIVIL_MESSAGE,
  DATA_CIVIL_REGEX,
  STATUS_LANCAMENTO,
} from './common';

export class CreateLancamentoDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  clienteId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  tipoLancamentoId!: string;

  @ApiProperty({ example: '11/2026' })
  @Matches(COMPETENCIA_REGEX, { message: COMPETENCIA_MESSAGE })
  competencia!: string;

  @ApiProperty({ minLength: 3 })
  @IsString()
  @MinLength(3)
  descricao!: string;

  @ApiProperty({ description: 'Valor positivo; a natureza vem do tipo.' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  valor!: number;

  @ApiPropertyOptional({ example: '2026-11-12', description: 'Padrão: hoje.' })
  @IsOptional()
  @Matches(DATA_CIVIL_REGEX, { message: DATA_CIVIL_MESSAGE })
  dataLancamento?: string;
}

export class FiltroLancamentosDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  clienteId?: string;

  @ApiPropertyOptional({ example: '11/2026' })
  @IsOptional()
  @Matches(COMPETENCIA_REGEX, { message: COMPETENCIA_MESSAGE })
  competencia?: string;

  @ApiPropertyOptional({ enum: STATUS_LANCAMENTO })
  @IsOptional()
  @IsIn(STATUS_LANCAMENTO)
  status?: (typeof STATUS_LANCAMENTO)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  page?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pageSize?: string;
}
