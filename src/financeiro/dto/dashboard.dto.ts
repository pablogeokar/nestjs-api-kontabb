import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { COMPETENCIA_MESSAGE, COMPETENCIA_REGEX } from './common';

export class DashboardQueryDto {
  @ApiPropertyOptional({
    example: '11/2026',
    description: 'Padrão: mês corrente.',
  })
  @IsOptional()
  @Matches(COMPETENCIA_REGEX, { message: COMPETENCIA_MESSAGE })
  competencia?: string;
}

export class ExtratoQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 60, default: 12 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  meses?: number;

  @ApiPropertyOptional()
  @IsOptional()
  page?: string;

  @ApiPropertyOptional()
  @IsOptional()
  pageSize?: string;
}

export class ListContratosQueryDto {
  @ApiPropertyOptional({ description: 'Busca por razão social ou CNPJ.' })
  @IsOptional()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  page?: string;

  @ApiPropertyOptional()
  @IsOptional()
  pageSize?: string;
}
