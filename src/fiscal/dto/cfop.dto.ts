import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsBooleanString,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const CFOP_PATTERN = /^[123567]\d{3}$/;
const TIPOS_OPERACAO = ['ENTRADA', 'SAIDA'] as const;
const ABRANGENCIAS = ['ESTADUAL', 'INTERESTADUAL', 'EXTERIOR'] as const;
const TIPOS_EQUIVALENCIA = [
  'SAIDA_PARA_ENTRADA',
  'ENTRADA_PARA_SAIDA',
] as const;

export class QueryCfopsDto {
  @ApiPropertyOptional({ description: 'Busca por código ou descrição' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @ApiPropertyOptional({ enum: TIPOS_OPERACAO })
  @IsOptional()
  @IsIn(TIPOS_OPERACAO)
  tipoOperacao?: (typeof TIPOS_OPERACAO)[number];

  @ApiPropertyOptional({ enum: ABRANGENCIAS })
  @IsOptional()
  @IsIn(ABRANGENCIAS)
  abrangencia?: (typeof ABRANGENCIAS)[number];

  @ApiPropertyOptional({ example: 'true' })
  @IsOptional()
  @IsBooleanString()
  ativo?: string;

  @ApiPropertyOptional({ example: '1' })
  @IsOptional()
  @IsString()
  page?: string;

  @ApiPropertyOptional({ example: '25' })
  @IsOptional()
  @IsString()
  pageSize?: string;
}

export class CreateCfopDto {
  @ApiProperty({ example: '1102' })
  @Matches(CFOP_PATTERN)
  codigo!: string;

  @ApiProperty({ example: 'Compra para comercialização' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  descricao!: string;

  @ApiProperty({ enum: TIPOS_OPERACAO })
  @IsIn(TIPOS_OPERACAO)
  tipoOperacao!: (typeof TIPOS_OPERACAO)[number];

  @ApiProperty({ enum: ABRANGENCIAS })
  @IsIn(ABRANGENCIAS)
  abrangencia!: (typeof ABRANGENCIAS)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  grupo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  descricaoDetalhada?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  ativo?: boolean;
}

export class UpdateCfopDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  descricao?: string;

  @ApiPropertyOptional({ enum: TIPOS_OPERACAO })
  @IsOptional()
  @IsIn(TIPOS_OPERACAO)
  tipoOperacao?: (typeof TIPOS_OPERACAO)[number];

  @ApiPropertyOptional({ enum: ABRANGENCIAS })
  @IsOptional()
  @IsIn(ABRANGENCIAS)
  abrangencia?: (typeof ABRANGENCIAS)[number];

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  grupo?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  descricaoDetalhada?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  ativo?: boolean;
}

export class QueryCfopEquivalenciasDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  clienteId?: string;

  @ApiPropertyOptional({ example: 'true' })
  @IsOptional()
  @IsBooleanString()
  includeGlobal?: string;

  @ApiPropertyOptional({ example: 'true' })
  @IsOptional()
  @IsBooleanString()
  ativo?: string;

  @ApiPropertyOptional({ example: '1' })
  @IsOptional()
  @IsString()
  page?: string;

  @ApiPropertyOptional({ example: '25' })
  @IsOptional()
  @IsString()
  pageSize?: string;
}

export class CreateCfopEquivalenciaDto {
  @ApiPropertyOptional({
    nullable: true,
    description: 'Nulo para regra global',
  })
  @IsOptional()
  @IsUUID('4')
  clienteId?: string | null;

  @ApiProperty({ example: '5102' })
  @Matches(CFOP_PATTERN)
  cfopOrigem!: string;

  @ApiProperty({ example: '1102' })
  @Matches(CFOP_PATTERN)
  cfopDestino!: string;

  @ApiProperty({ enum: TIPOS_EQUIVALENCIA })
  @IsIn(TIPOS_EQUIVALENCIA)
  tipoOperacao!: (typeof TIPOS_EQUIVALENCIA)[number];

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  descricao?: string | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  ativo?: boolean;
}

export class UpdateCfopEquivalenciaDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID('4')
  clienteId?: string | null;

  @ApiPropertyOptional({ example: '5102' })
  @IsOptional()
  @Matches(CFOP_PATTERN)
  cfopOrigem?: string;

  @ApiPropertyOptional({ example: '1102' })
  @IsOptional()
  @Matches(CFOP_PATTERN)
  cfopDestino?: string;

  @ApiPropertyOptional({ enum: TIPOS_EQUIVALENCIA })
  @IsOptional()
  @IsIn(TIPOS_EQUIVALENCIA)
  tipoOperacao?: (typeof TIPOS_EQUIVALENCIA)[number];

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  descricao?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  ativo?: boolean;
}

export class ReprocessarEscrituracaoDto {
  @ApiProperty()
  @IsUUID('4')
  clienteId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString({ strict: true })
  dataInicio?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString({ strict: true })
  dataFim?: string;
}
