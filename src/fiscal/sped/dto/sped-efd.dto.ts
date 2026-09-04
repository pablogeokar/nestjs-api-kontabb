import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Matches,
  Min,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const SPED_FINALIDADES = ['0', '1'] as const;
export const SPED_PERFIS = ['A', 'B', 'C'] as const;

export class PreviewEfdIcmsIpiDto {
  @ApiProperty({ example: '2026-08', pattern: '^\\d{4}-(0[1-9]|1[0-2])$' })
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'Competência deve estar no formato YYYY-MM.',
  })
  competencia: string;

  @ApiPropertyOptional({ enum: SPED_FINALIDADES, default: '0' })
  @Transform(({ value }: { value: unknown }) =>
    value === undefined || value === null || value === ''
      ? '0'
      : value === 0
        ? '0'
        : value === 1
          ? '1'
          : value,
  )
  @IsIn(SPED_FINALIDADES)
  finalidade: (typeof SPED_FINALIDADES)[number] = '0';
}

export class GerarEfdIcmsIpiDto extends PreviewEfdIcmsIpiDto {}

export class AdminPreviewEfdIcmsIpiDto extends PreviewEfdIcmsIpiDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  clienteId: string;
}

export class AdminGerarEfdIcmsIpiDto extends GerarEfdIcmsIpiDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  clienteId: string;
}

export class SpedContabilistaDto {
  @ApiProperty({ minLength: 2, maxLength: 100 })
  @IsString()
  @Length(2, 100)
  nome: string;

  @ApiPropertyOptional({ pattern: '^\\d{11}$' })
  @ValidateIf((value: SpedContabilistaDto) => !value.cnpj)
  @IsString()
  @Matches(/^\d{11}$/)
  cpf?: string | null;

  @ApiProperty({ minLength: 2, maxLength: 30 })
  @IsString()
  @Length(2, 30)
  crc: string;

  @ApiPropertyOptional({ pattern: '^[0-9A-Z]{12}[0-9]{2}$' })
  @ValidateIf((value: SpedContabilistaDto) => !value.cpf)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value.replace(/[^0-9A-Za-z]/g, '').toUpperCase()
      : value,
  )
  @IsString()
  @Matches(/^[0-9A-Z]{12}[0-9]{2}$/)
  cnpj?: string | null;

  @ApiPropertyOptional({ pattern: '^\\d{8}$' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{8}$/)
  cep?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 255)
  logradouro?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 30)
  numero?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 120)
  complemento?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 120)
  bairro?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 30)
  telefone?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 30)
  fax?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string | null;

  @ApiProperty({ pattern: '^\\d{7}$' })
  @IsString()
  @Matches(/^\d{7}$/)
  codigoMunicipioIbge: string;
}

export class AtualizarSpedConfiguracaoDto {
  @ApiProperty()
  @IsBoolean()
  obrigadoEfdIcmsIpi: boolean;

  @ApiProperty({ enum: SPED_PERFIS })
  @IsIn(SPED_PERFIS)
  perfilEfd: (typeof SPED_PERFIS)[number];

  @ApiProperty({ enum: ['0', '1'] })
  @IsIn(['0', '1'])
  indAtiv: '0' | '1';

  @ApiPropertyOptional({ pattern: '^\\d{2}$' })
  @ValidateIf((value: AtualizarSpedConfiguracaoDto) => value.indAtiv === '0')
  @IsString()
  @Matches(/^\d{2}$/)
  classificacaoEstabelecimentoIndustrial?: string | null;

  @ApiProperty({ pattern: '^\\d{7}$' })
  @IsString()
  @Matches(/^\d{7}$/)
  codigoMunicipioIbge: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 160)
  nomeFantasia?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 30)
  inscricaoMunicipal?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 20)
  suframa?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 30)
  telefone?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 30)
  fax?: string | null;

  @ApiPropertyOptional({ default: false })
  @IsBoolean()
  inventarioObrigatorio = false;

  @ApiPropertyOptional({ minimum: 1, maximum: 12, default: 2 })
  @Transform(({ value }: { value: unknown }) =>
    value === undefined || value === null || value === '' ? 2 : Number(value),
  )
  @IsInt()
  @Min(1)
  @Max(12)
  mesEntregaInventario = 2;

  @ApiPropertyOptional({ default: false })
  @IsBoolean()
  blocoKComMovimento = false;

  @ApiPropertyOptional({ pattern: '^\\d{2}$', default: '00' })
  @IsString()
  @Matches(/^\d{2}$/)
  tipoItemPadrao = '00';

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  indicadores1010?: Record<string, 'S' | 'N'>;
}

export class AdminAtualizarSpedConfiguracaoDto extends AtualizarSpedConfiguracaoDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  clienteId: string;
}
