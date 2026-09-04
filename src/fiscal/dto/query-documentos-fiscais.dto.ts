import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class QueryDocumentosFiscaisDto {
  @ApiPropertyOptional({ description: 'Número da página', example: '1' })
  @IsOptional()
  @IsString()
  page?: string;

  @ApiPropertyOptional({ description: 'Itens por página', example: '15' })
  @IsOptional()
  @IsString()
  pageSize?: string;

  @ApiPropertyOptional({
    description: 'Filtrar por ID do cliente',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @IsOptional()
  @IsUUID('4')
  clienteId?: string;

  @ApiPropertyOptional({
    description: 'Filtrar por tipo de documento',
    enum: ['NFE', 'CTE', 'NFCE'],
  })
  @IsOptional()
  @IsIn(['NFE', 'CTE', 'NFCE'])
  tipoDocumento?: string;

  @ApiPropertyOptional({
    description: 'Filtrar por situação do documento',
    enum: ['AUTORIZADA', 'CANCELADA', 'DENEGADA', 'RESUMIDA'],
  })
  @IsOptional()
  @IsIn(['AUTORIZADA', 'CANCELADA', 'DENEGADA', 'RESUMIDA'])
  situacao?: string;

  @ApiPropertyOptional({
    description: 'Filtrar por status de manifestação',
    enum: [
      'SEM_MANIFESTACAO',
      'CIENCIA',
      'CONFIRMADA',
      'DESCONHECIDA',
      'NAO_REALIZADA',
    ],
  })
  @IsOptional()
  @IsIn([
    'SEM_MANIFESTACAO',
    'CIENCIA',
    'CONFIRMADA',
    'DESCONHECIDA',
    'NAO_REALIZADA',
  ])
  manifestacaoStatus?: string;

  @ApiPropertyOptional({
    description: 'Data de início do período (ISO 8601)',
    example: '2025-01-01',
  })
  @IsOptional()
  @IsDateString({ strict: true })
  dataInicio?: string;

  @ApiPropertyOptional({
    description: 'Data de fim do período (ISO 8601)',
    example: '2025-12-31',
  })
  @IsOptional()
  @IsDateString({ strict: true })
  dataFim?: string;

  @ApiPropertyOptional({
    description: 'Busca por chave de acesso, razão social ou CNPJ do emitente',
    example: '12345678000190',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({
    description: 'Filtrar documentos com CFOP pendente de revisão',
    enum: ['true', 'false'],
  })
  @IsOptional()
  @IsIn(['true', 'false'])
  revisaoNecessaria?: string;
}
