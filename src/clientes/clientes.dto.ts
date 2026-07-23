import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export type ClientType = 'PF' | 'PJ';

export class CreateClientDto {
  @ApiProperty({
    description: 'Tipo de pessoa',
    enum: ['PF', 'PJ'],
    default: 'PJ',
  })
  @IsIn(['PF', 'PJ'])
  tipo_pessoa: ClientType = 'PJ';

  @ApiProperty({
    description: 'Razão social ou nome completo',
    minLength: 1,
    maxLength: 160,
  })
  @IsString()
  @Length(1, 160)
  company_name: string;

  @ApiPropertyOptional({
    description: 'CNPJ com 14 dígitos (obrigatório se PJ)',
    example: '12345678000190',
  })
  @ValidateIf((dto: CreateClientDto) => dto.tipo_pessoa === 'PJ')
  @IsString()
  @Matches(/^\d{14}$/, { message: 'CNPJ deve conter 14 dígitos.' })
  cnpj?: string;

  @ApiPropertyOptional({
    description: 'CPF com 11 dígitos (obrigatório se PF)',
    example: '12345678901',
  })
  @ValidateIf((dto: CreateClientDto) => dto.tipo_pessoa === 'PF')
  @IsString()
  @Matches(/^\d{11}$/, { message: 'CPF deve conter 11 dígitos.' })
  cpf?: string;

  @ApiPropertyOptional({
    description: 'E-mail(s) do cliente para notificações',
    type: [String],
  })
  @IsOptional()
  @IsEmail({}, { each: true })
  emails?: string | string[];
}

export class UpdateClientDto {
  @ApiPropertyOptional({
    description: 'Nova razão social',
    minLength: 1,
    maxLength: 160,
  })
  @IsOptional()
  @IsString()
  @Length(1, 160)
  company_name?: string;

  @ApiPropertyOptional({
    description: 'Novos e-mails do cliente',
    type: [String],
  })
  @IsOptional()
  @IsEmail({}, { each: true })
  emails?: string | string[];
}

export class BatchClientItemDto {
  @ApiProperty({
    description: 'CNPJ com 14 dígitos',
    example: '12345678000190',
  })
  @IsString()
  @Matches(/^\d{14}$/, { message: 'CNPJ deve conter 14 dígitos.' })
  cnpj: string;

  @ApiProperty({ description: 'Razão social', minLength: 1, maxLength: 160 })
  @IsString()
  @Length(1, 160)
  company_name: string;
}

export class BatchClientDto {
  @ApiProperty({
    description: 'Lista de clientes para cadastro em lote (máx 100)',
    type: [BatchClientItemDto],
  })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => BatchClientItemDto)
  clients: BatchClientItemDto[];
}
