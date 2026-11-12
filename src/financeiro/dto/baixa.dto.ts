import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  DATA_CIVIL_MESSAGE,
  DATA_CIVIL_REGEX,
  FORMAS_PAGAMENTO,
} from './common';

export class RegistrarBaixaDto {
  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  valorRecebido!: number;

  @ApiProperty({ example: '2026-11-12' })
  @Matches(DATA_CIVIL_REGEX, { message: DATA_CIVIL_MESSAGE })
  dataPagamento!: string;

  @ApiProperty({ enum: FORMAS_PAGAMENTO })
  @IsIn(FORMAS_PAGAMENTO)
  formaPagamento!: (typeof FORMAS_PAGAMENTO)[number];

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  valorMulta?: number;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  valorJuros?: number;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  valorDesconto?: number;

  @ApiPropertyOptional({ description: 'Chave do objeto no storage (R2/S3).' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comprovanteKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  comprovanteNome?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  observacao?: string;
}

export class EstornarBaixaDto {
  @ApiProperty({ minLength: 5 })
  @IsString()
  @MinLength(5)
  motivo!: string;
}
