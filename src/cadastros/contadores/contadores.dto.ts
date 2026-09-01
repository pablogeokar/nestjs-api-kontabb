import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

function normalizeDocument(value: unknown) {
  return typeof value === 'string'
    ? value.replace(/[^0-9A-Za-z]/g, '').toUpperCase() || null
    : value;
}

function trimOptional(value: unknown) {
  return typeof value === 'string' ? value.trim() || null : value;
}

export class CriarContadorDto {
  @ApiProperty({ minLength: 2, maxLength: 100 })
  @IsString()
  @Length(2, 100)
  nome: string;

  @ApiPropertyOptional({ pattern: '^\\d{11}$', nullable: true })
  @Transform(({ value }: { value: unknown }) => normalizeDocument(value))
  @ValidateIf((dto: CriarContadorDto) => !dto.cnpj)
  @IsString()
  @Matches(/^\d{11}$/, { message: 'CPF deve conter 11 dígitos.' })
  cpf?: string | null;

  @ApiProperty({ minLength: 2, maxLength: 30 })
  @IsString()
  @Length(2, 30)
  crc: string;

  @ApiPropertyOptional({ pattern: '^[0-9A-Z]{12}[0-9]{2}$', nullable: true })
  @Transform(({ value }: { value: unknown }) => normalizeDocument(value))
  @ValidateIf((dto: CriarContadorDto) => !dto.cpf)
  @IsString()
  @Matches(/^[0-9A-Z]{12}[0-9]{2}$/, {
    message: 'CNPJ deve conter 14 caracteres e dois dígitos finais.',
  })
  cnpj?: string | null;

  @ApiPropertyOptional({ pattern: '^\\d{8}$', nullable: true })
  @Transform(({ value }: { value: unknown }) => normalizeDocument(value))
  @IsOptional()
  @IsString()
  @Matches(/^\d{8}$/, { message: 'CEP deve conter 8 dígitos.' })
  cep?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(({ value }: { value: unknown }) => trimOptional(value))
  @IsOptional()
  @IsString()
  @Length(0, 255)
  logradouro?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(({ value }: { value: unknown }) => trimOptional(value))
  @IsOptional()
  @IsString()
  @Length(0, 30)
  numero?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(({ value }: { value: unknown }) => trimOptional(value))
  @IsOptional()
  @IsString()
  @Length(0, 120)
  complemento?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(({ value }: { value: unknown }) => trimOptional(value))
  @IsOptional()
  @IsString()
  @Length(0, 120)
  bairro?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(({ value }: { value: unknown }) => trimOptional(value))
  @IsOptional()
  @IsString()
  @Length(0, 30)
  telefone?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(({ value }: { value: unknown }) => trimOptional(value))
  @IsOptional()
  @IsString()
  @Length(0, 30)
  fax?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(({ value }: { value: unknown }) => trimOptional(value))
  @IsOptional()
  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  email?: string | null;

  @ApiProperty({ pattern: '^\\d{7}$' })
  @Transform(({ value }: { value: unknown }) => normalizeDocument(value))
  @IsString()
  @Matches(/^\d{7}$/, {
    message: 'Código do município IBGE deve conter 7 dígitos.',
  })
  codigoMunicipioIbge: string;
}

export class AtualizarContadorDto extends PartialType(CriarContadorDto) {}
