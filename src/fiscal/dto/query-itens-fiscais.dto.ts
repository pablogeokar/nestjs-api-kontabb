import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

export class QueryItensFiscaisDto {
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

  @ApiPropertyOptional({ description: 'CFOP exato', example: '5102' })
  @IsOptional()
  @Matches(/^\d{4}$/)
  cfop?: string;

  @ApiPropertyOptional({ description: 'CFOP original do XML', example: '5102' })
  @IsOptional()
  @Matches(/^\d{4}$/)
  cfopXml?: string;

  @ApiPropertyOptional({ enum: ['ENTRADA', 'SAIDA'] })
  @IsOptional()
  @Matches(/^(ENTRADA|SAIDA)$/)
  tipoOperacao?: 'ENTRADA' | 'SAIDA';

  @ApiPropertyOptional({ description: 'CST/CSOSN exato', example: '00' })
  @IsOptional()
  @Matches(/^\d{2,4}$/)
  cst?: string;

  @ApiPropertyOptional({ description: 'CST de ICMS', example: '00' })
  @IsOptional()
  @Matches(/^\d{2,3}$/)
  cstIcms?: string;

  @ApiPropertyOptional({ description: 'CSOSN de ICMS', example: '102' })
  @IsOptional()
  @Matches(/^\d{3,4}$/)
  csosnIcms?: string;

  @ApiPropertyOptional({ description: 'CST de PIS', example: '01' })
  @IsOptional()
  @Matches(/^\d{2}$/)
  cstPis?: string;

  @ApiPropertyOptional({ description: 'CST de COFINS', example: '01' })
  @IsOptional()
  @Matches(/^\d{2}$/)
  cstCofins?: string;

  @ApiPropertyOptional({ description: 'NCM exato', example: '84713012' })
  @IsOptional()
  @Matches(/^\d{2,8}$/)
  ncm?: string;

  @ApiPropertyOptional({ description: 'Início do período de emissão' })
  @IsOptional()
  @IsDateString({ strict: true })
  dataInicio?: string;

  @ApiPropertyOptional({ description: 'Fim do período de emissão' })
  @IsOptional()
  @IsDateString({ strict: true })
  dataFim?: string;

  @ApiPropertyOptional({ description: 'Código do produto no emissor' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  codigoProduto?: string;
}
