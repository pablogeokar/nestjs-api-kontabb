import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';

export class QueryCteFiscalDto {
  @ApiPropertyOptional({ description: 'Número da página', example: '1' })
  @IsOptional()
  @IsString()
  page?: string;

  @ApiPropertyOptional({ description: 'Itens por página', example: '50' })
  @IsOptional()
  @IsString()
  pageSize?: string;

  @ApiPropertyOptional({ description: 'ID do cliente' })
  @IsOptional()
  @IsUUID('4')
  clienteId?: string;

  @ApiPropertyOptional({ description: 'ID do documento fiscal' })
  @IsOptional()
  @IsUUID('4')
  documentoId?: string;

  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  escrituravel?: string;

  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  revisaoNecessaria?: string;

  @ApiPropertyOptional({ description: 'CFOP escriturado', example: '1353' })
  @IsOptional()
  @Matches(/^\d{4}$/)
  cfop?: string;

  @ApiPropertyOptional({ description: 'CST/CSOSN', example: '00' })
  @IsOptional()
  @Matches(/^\d{2,4}$/)
  cst?: string;

  @ApiPropertyOptional({ description: 'Início do período de emissão' })
  @IsOptional()
  @IsDateString({ strict: true })
  dataInicio?: string;

  @ApiPropertyOptional({ description: 'Fim do período de emissão' })
  @IsOptional()
  @IsDateString({ strict: true })
  dataFim?: string;
}
