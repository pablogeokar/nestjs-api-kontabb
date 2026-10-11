import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class ExecutarImportacaoChavesDto {
  @ApiPropertyOptional({
    description: 'ID do cliente selecionado no contexto administrativo.',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID('4')
  clienteId?: string;

  @ApiProperty({
    description: 'Chaves de acesso validadas na etapa de conferência.',
    type: [String],
    minItems: 1,
    maxItems: 500,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  chaves: string[];

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  forcarReimportacao?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  manifestarAutomaticamente?: boolean;
}
