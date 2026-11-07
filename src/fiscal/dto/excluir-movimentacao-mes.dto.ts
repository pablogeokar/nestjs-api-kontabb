import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, Matches } from 'class-validator';

export class ExcluirMovimentacaoMesDto {
  @ApiProperty({ example: '2026-09', description: 'Competência AAAA-MM.' })
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'Competência deve estar no formato AAAA-MM.',
  })
  competencia!: string;
}

export class AdminExcluirMovimentacaoMesDto extends ExcluirMovimentacaoMesDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  clienteId!: string;
}
