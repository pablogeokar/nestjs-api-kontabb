import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUUID, MinLength } from 'class-validator';

export class UploadCertificadoDto {
  @ApiProperty({
    description: 'ID do cliente ao qual o certificado será vinculado',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @IsUUID('4')
  @IsNotEmpty()
  clienteId: string;

  @ApiProperty({
    description: 'Senha do certificado digital A1 (.pfx/.p12)',
    example: 'minhaSenha123',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  senha: string;
}

export class UploadCertificadoClienteDto {
  @ApiProperty({
    description: 'Senha do certificado digital A1 (.pfx/.p12)',
    example: 'minhaSenha123',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  senha: string;
}
