import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class EditarCfopDto {
  @ApiProperty({ example: '1102', description: 'CFOP escriturado de destino' })
  @Matches(/^\d{4}$/)
  cfop!: string;

  @ApiPropertyOptional({ description: 'Justificativa da correção manual' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  motivo?: string;
}
