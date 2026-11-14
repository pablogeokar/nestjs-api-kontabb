import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ContratoPreferenciasDto {
  @ApiProperty({ example: 'Feira de Santana/BA', maxLength: 120 })
  @IsString()
  @MaxLength(120)
  localAssinatura!: string;

  @ApiProperty({ minimum: 1, maximum: 31, example: 10 })
  @IsInt()
  @Min(1)
  @Max(31)
  diaVencimento!: number;

  @ApiProperty({ minimum: 1, maximum: 31, example: 25 })
  @IsInt()
  @Min(1)
  @Max(31)
  diaFechamento!: number;

  @ApiProperty({ minimum: 0, maximum: 365, example: 30 })
  @IsInt()
  @Min(0)
  @Max(365)
  avisoPrevioDias!: number;

  @ApiProperty({ example: false })
  @IsBoolean()
  gera13o!: boolean;

  @ApiProperty({ minimum: 1, maximum: 12, example: 12 })
  @IsInt()
  @Min(1)
  @Max(12)
  mes13o!: number;
}
