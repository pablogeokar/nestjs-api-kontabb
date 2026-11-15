import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Matches,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  COMPETENCIA_MESSAGE,
  COMPETENCIA_REGEX,
  DATA_CIVIL_MESSAGE,
  DATA_CIVIL_REGEX,
  NATUREZAS,
  STATUS_FATURA,
  type Natureza,
  type StatusFatura,
} from './common';

export class GerarFaturasLoteDto {
  @ApiProperty({ example: '11/2026' })
  @Matches(COMPETENCIA_REGEX, { message: COMPETENCIA_MESSAGE })
  competencia!: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Se vazio, processa todos os clientes elegíveis.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID('all', { each: true })
  clienteIds?: string[];
}

export class ItemFaturaAvulsaDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  tipoLancamentoId!: string;

  @ApiProperty({ minLength: 3 })
  @IsString()
  @MinLength(3)
  descricao!: string;

  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  valor!: number;

  @ApiProperty({ enum: NATUREZAS })
  @IsIn(NATUREZAS)
  natureza!: Natureza;
}

export class GerarFaturaAvulsaDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  clienteId!: string;

  @ApiProperty({ example: '11/2026' })
  @Matches(COMPETENCIA_REGEX, { message: COMPETENCIA_MESSAGE })
  competencia!: string;

  @ApiProperty({ example: '2026-12-10' })
  @Matches(DATA_CIVIL_REGEX, { message: DATA_CIVIL_MESSAGE })
  dataVencimento!: string;

  @ApiProperty({ type: [ItemFaturaAvulsaDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ItemFaturaAvulsaDto)
  itens!: ItemFaturaAvulsaDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  observacoes?: string;
}

export class FiltroFaturasDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  clienteId?: string;

  @ApiPropertyOptional({ example: '11/2026' })
  @IsOptional()
  @Matches(COMPETENCIA_REGEX, { message: COMPETENCIA_MESSAGE })
  competencia?: string;

  @ApiPropertyOptional({ enum: STATUS_FATURA })
  @IsOptional()
  @IsIn(STATUS_FATURA)
  status?: StatusFatura;

  @ApiPropertyOptional({ example: '2026-11-01' })
  @IsOptional()
  @Matches(DATA_CIVIL_REGEX, { message: DATA_CIVIL_MESSAGE })
  vencimentoInicio?: string;

  @ApiPropertyOptional({ example: '2026-11-30' })
  @IsOptional()
  @Matches(DATA_CIVIL_REGEX, { message: DATA_CIVIL_MESSAGE })
  vencimentoFim?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  page?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pageSize?: string;
}

export class CancelarFaturaDto {
  @ApiProperty({ minLength: 5 })
  @IsString()
  @MinLength(5)
  motivo!: string;
}
