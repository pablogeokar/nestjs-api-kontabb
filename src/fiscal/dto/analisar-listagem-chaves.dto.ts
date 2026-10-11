import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class AnalisarListagemChavesDto {
  @ApiPropertyOptional({
    description: 'ID do cliente selecionado no contexto administrativo.',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID('4')
  clienteId?: string;

  @ApiPropertyOptional({
    description: 'Lista de chaves colada pelo usuário.',
    maxLength: 100_000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100_000)
  chavesTexto?: string;
}
