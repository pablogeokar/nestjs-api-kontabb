import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
} from 'class-validator';
import { NATUREZAS, type Natureza } from './common';

export class CreateTipoLancamentoDto {
  @ApiProperty({ example: 'DECLARACAO_IRPF', description: 'A-Z, 0-9 e _.' })
  @IsString()
  @Length(2, 50)
  @Matches(/^[A-Z0-9_]+$/, {
    message: 'codigo deve conter apenas A-Z, 0-9 e _.',
  })
  codigo!: string;

  @ApiProperty({ example: 'Declaração de IRPF' })
  @IsString()
  @Length(2, 150)
  nome!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  descricao?: string;

  @ApiProperty({ enum: NATUREZAS })
  @IsIn(NATUREZAS)
  natureza!: Natureza;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  valorPadrao?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  permiteAvulso?: boolean;
}

export class UpdateTipoLancamentoDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(2, 150)
  nome?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  descricao?: string;

  @ApiPropertyOptional({ enum: NATUREZAS })
  @IsOptional()
  @IsIn(NATUREZAS)
  natureza?: Natureza;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  valorPadrao?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  permiteAvulso?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  ativo?: boolean;
}
