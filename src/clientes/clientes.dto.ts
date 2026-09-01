import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  FONTES_CONSULTA_CNPJ,
  REGIMES_TRIBUTARIOS,
  TIPOS_CONTRIBUINTE_ICMS,
  type FonteConsultaCnpj,
  type RegimeTributario,
  type TipoContribuinteIcms,
} from './clientes.types';

export type ClientType = 'PF' | 'PJ';

export class ClientAddressDto {
  @IsString()
  @Matches(/^(?:\d{8})?$/, { message: 'CEP deve conter 8 dígitos.' })
  postal_code: string;

  @IsString()
  @Length(0, 200)
  street: string;

  @IsString()
  @Length(0, 30)
  number: string;

  @IsString()
  @Length(0, 120)
  complement: string;

  @IsString()
  @Length(0, 120)
  district: string;

  @IsString()
  @Length(0, 120)
  city: string;

  @IsString()
  @Matches(/^(?:[A-Z]{2})?$/, {
    message: 'UF deve conter 2 letras maiúsculas.',
  })
  state: string;
}

export class ClientCnaeDto {
  @IsString()
  @Matches(/^\d{7}$/, { message: 'CNAE deve conter 7 dígitos.' })
  code: string;

  @IsString()
  @Length(0, 500)
  description: string;
}

export class LookupCnpjParamsDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value.replace(/[^0-9A-Za-z]/g, '').toUpperCase()
      : value,
  )
  @IsString()
  @Matches(/^[0-9A-Z]{12}[0-9]{2}$/, {
    message: 'CNPJ deve conter 14 caracteres e dois dígitos verificadores.',
  })
  cnpj: string;
}

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
    description: 'CNPJ com 14 caracteres (obrigatório se PJ)',
    example: '12345678000190',
  })
  @ValidateIf((dto: CreateClientDto) => dto.tipo_pessoa === 'PJ')
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value.replace(/[^0-9A-Za-z]/g, '').toUpperCase()
      : value,
  )
  @IsString()
  @Matches(/^[0-9A-Z]{12}[0-9]{2}$/, { message: 'CNPJ inválido.' })
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

  @ApiPropertyOptional({ description: 'Endereço completo do cliente' })
  @IsOptional()
  @ValidateNested()
  @Type(() => ClientAddressDto)
  address?: ClientAddressDto;

  @ApiPropertyOptional({ description: 'CNAE principal do cliente' })
  @IsOptional()
  @ValidateNested()
  @Type(() => ClientCnaeDto)
  primary_activity?: ClientCnaeDto | null;

  @ApiPropertyOptional({
    description: 'CNAEs secundários do cliente',
    type: [ClientCnaeDto],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ClientCnaeDto)
  secondary_activities?: ClientCnaeDto[];

  @ApiPropertyOptional({
    description: 'Resultado da consulta de opção pelo Simples Nacional',
    type: Boolean,
    nullable: true,
  })
  @IsOptional()
  @IsBoolean()
  optante_simples_nacional?: boolean | null;

  @ApiPropertyOptional({
    description: 'Fonte que informou a opção pelo Simples Nacional',
    enum: FONTES_CONSULTA_CNPJ,
    nullable: true,
  })
  @IsOptional()
  @IsIn(FONTES_CONSULTA_CNPJ)
  simples_nacional_fonte?: FonteConsultaCnpj | null;

  @ApiPropertyOptional({
    description: 'Contador responsável pelo cliente',
    format: 'uuid',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_dto: CreateClientDto, value: unknown) => value !== null)
  @IsUUID('4')
  contador_id?: string | null;
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

  @ApiPropertyOptional({ description: 'Endereço completo do cliente' })
  @IsOptional()
  @ValidateNested()
  @Type(() => ClientAddressDto)
  address?: ClientAddressDto;

  @ApiPropertyOptional({ description: 'CNAE principal do cliente' })
  @IsOptional()
  @ValidateNested()
  @Type(() => ClientCnaeDto)
  primary_activity?: ClientCnaeDto | null;

  @ApiPropertyOptional({
    description: 'CNAEs secundários do cliente',
    type: [ClientCnaeDto],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ClientCnaeDto)
  secondary_activities?: ClientCnaeDto[];

  @ApiPropertyOptional({
    description: 'Novo resultado consultado de opção pelo Simples Nacional',
    type: Boolean,
    nullable: true,
  })
  @IsOptional()
  @IsBoolean()
  optante_simples_nacional?: boolean | null;

  @ApiPropertyOptional({
    description: 'Fonte do novo resultado da consulta do Simples Nacional',
    enum: FONTES_CONSULTA_CNPJ,
    nullable: true,
  })
  @IsOptional()
  @IsIn(FONTES_CONSULTA_CNPJ)
  simples_nacional_fonte?: FonteConsultaCnpj | null;

  @ApiPropertyOptional({
    description: 'Forma de tributação da pessoa jurídica',
    enum: REGIMES_TRIBUTARIOS,
    nullable: true,
  })
  @IsOptional()
  @IsIn(REGIMES_TRIBUTARIOS)
  regime_tributario?: RegimeTributario | null;

  @ApiPropertyOptional({
    description:
      'Indica se o ICMS é apurado separadamente; obrigatório para Lucro Presumido e Lucro Real',
    type: Boolean,
  })
  @IsOptional()
  @IsBoolean()
  apura_icms?: boolean;

  @ApiPropertyOptional({
    description: 'Classificação do cliente quanto ao ICMS',
    enum: TIPOS_CONTRIBUINTE_ICMS,
    nullable: true,
  })
  @IsOptional()
  @IsIn(TIPOS_CONTRIBUINTE_ICMS)
  tipo_contribuinte_icms?: TipoContribuinteIcms | null;

  @ApiPropertyOptional({
    description: 'Inscrição estadual, quando o cliente é contribuinte',
    nullable: true,
    example: '123.456.789.001',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsOptional()
  @IsString()
  @Matches(/^[0-9A-Z./-]{2,20}$/, {
    message: 'Formato de IE inválido.',
  })
  inscricao_estadual?: string | null;

  @ApiPropertyOptional({
    description: 'Contador responsável pelo cliente',
    format: 'uuid',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_dto: UpdateClientDto, value: unknown) => value !== null)
  @IsUUID('4')
  contador_id?: string | null;
}

export class BatchClientItemDto {
  @ApiProperty({
    description: 'CNPJ com 14 caracteres',
    example: '12345678000190',
  })
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value.replace(/[^0-9A-Za-z]/g, '').toUpperCase()
      : value,
  )
  @Matches(/^[0-9A-Z]{12}[0-9]{2}$/, { message: 'CNPJ inválido.' })
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
