import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Matches } from 'class-validator';

const COMPETENCIA = /^\d{4}-(0[1-9]|1[0-2])$/;

export class CompetenciaSimplesDto {
  @ApiProperty({ example: '2026-10' })
  @IsString()
  @Matches(COMPETENCIA, { message: 'Competência deve estar no formato AAAA-MM.' })
  competencia!: string;
}

export class AdminCompetenciaSimplesDto extends CompetenciaSimplesDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  clienteId!: string;
}

export class FecharSimplesDto extends AdminCompetenciaSimplesDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  apuracaoId?: string;
}
