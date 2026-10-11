import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({
    description:
      'E-mail do usuário (ou identificador@kontabb.local para clientes)',
  })
  @IsString()
  email: string;

  @ApiProperty({ description: 'Senha' })
  @IsString()
  password: string;
}

export class ChangePasswordDto {
  @ApiProperty({ description: 'Senha atual' })
  @IsString()
  currentPassword: string;

  @ApiProperty({ description: 'Nova senha (mín 6 caracteres)', minLength: 6 })
  @IsString()
  @MinLength(6)
  newPassword: string;
}
