import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpsertContratoDto {
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
}
