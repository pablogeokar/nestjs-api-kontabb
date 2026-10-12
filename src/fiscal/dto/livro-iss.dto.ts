import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Matches } from 'class-validator';

export class LivroIssQueryDto {
  @ApiPropertyOptional({ example: '2026-09' })
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'Competência deve estar no formato AAAA-MM.',
  })
  competencia!: string;

  @ApiPropertyOptional({ enum: ['ENTRADA', 'SAIDA'] })
  @IsOptional()
  @IsIn(['ENTRADA', 'SAIDA'])
  tipoOperacao?: 'ENTRADA' | 'SAIDA';
}

export class AdminLivroIssQueryDto extends LivroIssQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsUUID('4')
  clienteId!: string;
}
