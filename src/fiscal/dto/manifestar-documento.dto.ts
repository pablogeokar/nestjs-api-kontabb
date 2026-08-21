import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class ManifestarDocumentoDto {
  @ApiProperty({
    description: 'Tipo de evento de manifestação do destinatário',
    enum: ['210210', '210200', '210220', '210240'],
    example: '210210',
  })
  @IsString()
  @IsNotEmpty()
  @IsIn(['210210', '210200', '210220', '210240'])
  tipoEvento: '210210' | '210200' | '210220' | '210240';

  @ApiPropertyOptional({
    description:
      'Justificativa (obrigatória para Desconhecimento e Operação não Realizada)',
    example: 'Não reconheço esta operação',
  })
  @IsOptional()
  @IsString()
  @MinLength(15, {
    message: 'A justificativa deve ter no mínimo 15 caracteres',
  })
  justificativa?: string;
}
