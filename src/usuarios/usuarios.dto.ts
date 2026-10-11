import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const ROLES_SISTEMA = ['ADMIN', 'COLABORADOR'] as const;
export type RoleSistema = (typeof ROLES_SISTEMA)[number];

export class CreateUsuarioDto {
  @ApiProperty({
    description: 'Nome completo',
    minLength: 1,
    maxLength: 160,
  })
  @IsString()
  @Length(1, 160)
  name: string;

  @ApiProperty({
    description: 'E-mail do usuário',
    format: 'email',
  })
  @IsEmail()
  email: string;

  @ApiProperty({
    description: 'Senha (mín 6 caracteres)',
    minLength: 6,
  })
  @IsString()
  @MinLength(6)
  password: string;

  @ApiPropertyOptional({
    description: 'Role do usuário',
    enum: ROLES_SISTEMA,
    default: 'COLABORADOR',
  })
  @IsOptional()
  @IsIn(ROLES_SISTEMA)
  role?: RoleSistema = 'COLABORADOR';
}

export class UpdateUsuarioDto {
  @ApiPropertyOptional({
    description: 'Novo nome completo',
    minLength: 1,
    maxLength: 160,
  })
  @IsOptional()
  @IsString()
  @Length(1, 160)
  name?: string;

  @ApiPropertyOptional({
    description: 'Nova role do usuário',
    enum: ROLES_SISTEMA,
  })
  @IsOptional()
  @IsIn(ROLES_SISTEMA)
  role?: RoleSistema;
}

export class ChangePasswordDto {
  @ApiProperty({
    description: 'Nova senha (mín 6 caracteres)',
    minLength: 6,
  })
  @IsString()
  @MinLength(6)
  password: string;
}
