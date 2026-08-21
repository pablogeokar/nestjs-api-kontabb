import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class SincronizarFiscalDto {
  @ApiPropertyOptional({
    description: 'ID do cliente. Quando omitido, sincroniza todos os clientes.',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID('4')
  clienteId?: string;
}
