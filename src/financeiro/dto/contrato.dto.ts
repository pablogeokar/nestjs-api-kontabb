import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { COMPETENCIA_MESSAGE, COMPETENCIA_REGEX } from './common';
import {
  CODIGOS_SERVICO_CONTRATO,
  type CodigoServicoContrato,
} from '../financeiro-servicos.catalogo';

export class ServicoContratoDto {
  @ApiProperty({ enum: CODIGOS_SERVICO_CONTRATO })
  @IsIn(CODIGOS_SERVICO_CONTRATO)
  codigo!: CodigoServicoContrato;

  @ApiPropertyOptional({ description: 'Obrigatória para o serviço OUTROS.' })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  descricao?: string;

  @ApiProperty({ minimum: 0, description: 'Honorário mensal deste serviço.' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  valorMensal!: number;
}

export class ItemContratoDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Informe para atualizar um item existente.',
  })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  tipoLancamentoId!: string;

  @ApiProperty({ minLength: 3 })
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  descricao!: string;

  @ApiProperty({ description: 'Valor positivo; a natureza vem do tipo.' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  valor!: number;

  @ApiPropertyOptional({
    example: '01/2026',
    description: 'Primeira competência.',
  })
  @IsOptional()
  @Matches(COMPETENCIA_REGEX, { message: COMPETENCIA_MESSAGE })
  competenciaInicio?: string;

  @ApiPropertyOptional({
    example: '12/2026',
    description: 'Última competência.',
  })
  @IsOptional()
  @Matches(COMPETENCIA_REGEX, { message: COMPETENCIA_MESSAGE })
  competenciaFim?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  ativo?: boolean;
}

export class UpsertContratoDto {
  @ApiPropertyOptional({ type: [ServicoContratoDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ServicoContratoDto)
  servicos?: ServicoContratoDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(150)
  contratanteRepresentante?: string;

  @ApiPropertyOptional({ example: '2026-11-12' })
  @IsOptional()
  @Matches(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/, {
    message: 'Data de início inválida.',
  })
  dataInicio?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 365 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  avisoPrevioDias?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  condicoesContratuais?: string;
  @ApiProperty({ minimum: 0, example: 450 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  valorMensalidade!: number;

  @ApiProperty({ minimum: 1, maximum: 31, example: 10 })
  @IsInt()
  @Min(1)
  @Max(31)
  diaVencimento!: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 31, default: 25 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  diaFechamento?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  gera13o?: boolean;

  @ApiPropertyOptional({ minimum: 1, maximum: 12, default: 12 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  mes13o?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  ativo?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  observacoes?: string;

  @ApiPropertyOptional({
    type: [ItemContratoDto],
    description:
      'Lançamentos fixos aplicados a todas as faturas mensais. Quando informado, substitui a lista atual; omita para mantê-la.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ItemContratoDto)
  itens?: ItemContratoDto[];
}
