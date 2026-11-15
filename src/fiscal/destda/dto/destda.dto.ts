import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  DESTDA_COD_ASSINANTES,
  DESTDA_FINALIDADES,
  DESTDA_UFS,
} from '../destda-leiaute';

const somenteDigitos = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.replace(/\D/gu, '') : value;

export class PreviewDestdaDto {
  @ApiProperty({ example: '2026-08', pattern: '^\\d{4}-(0[1-9]|1[0-2])$' })
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/u, {
    message: 'Competência deve estar no formato YYYY-MM.',
  })
  competencia: string;

  @ApiPropertyOptional({
    enum: DESTDA_FINALIDADES,
    default: '0',
    description: '0 = arquivo original; 1 = arquivo substituto.',
  })
  @Transform(({ value }: { value: unknown }) =>
    value === undefined || value === null || value === ''
      ? '0'
      : typeof value === 'number'
        ? String(value)
        : value,
  )
  @IsIn(DESTDA_FINALIDADES)
  finalidade: (typeof DESTDA_FINALIDADES)[number] = '0';
}

export class GerarDestdaDto extends PreviewDestdaDto {}

export class AdminPreviewDestdaDto extends PreviewDestdaDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  clienteId: string;
}

export class AdminGerarDestdaDto extends GerarDestdaDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  clienteId: string;
}

export class HistoricoDestdaDto {
  @ApiPropertyOptional({ example: '2026-08' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/u)
  competencia?: string;
}

export class AdminHistoricoDestdaDto extends HistoricoDestdaDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  clienteId: string;
}

export class InscricaoSubstitutoDto {
  @ApiProperty({ enum: DESTDA_UFS })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsIn(DESTDA_UFS.filter((uf) => uf !== 'EX'))
  uf: string;

  @ApiProperty({ minLength: 2, maxLength: 20 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value.replace(/[^0-9A-Za-z]/gu, '').toUpperCase()
      : value,
  )
  @IsString()
  @Matches(/^[0-9A-Z]{2,20}$/u)
  ie: string;
}

export class AtualizarDestdaConfiguracaoDto {
  @ApiPropertyOptional({ pattern: '^\\d{7}$' })
  @IsOptional()
  @Transform(somenteDigitos)
  @IsString()
  @Matches(/^\d{7}$/u)
  codigoMunicipioIbge?: string | null;

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
  @Transform(somenteDigitos)
  @IsString()
  @Matches(/^\d{9}$/u, { message: 'A inscrição Suframa deve ter 9 dígitos.' })
  suframa?: string | null;

  @ApiPropertyOptional({ pattern: '^\\d{11}$' })
  @IsOptional()
  @Transform(somenteDigitos)
  @IsString()
  @Matches(/^\d{11}$/u, { message: 'O NIRE deve ter 11 dígitos.' })
  nire?: string | null;

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

  @ApiPropertyOptional({ description: 'Nome do responsável (registro 0005).' })
  @IsOptional()
  @IsString()
  @Length(2, 100)
  responsavelNome?: string | null;

  @ApiPropertyOptional({ pattern: '^\\d{11}$' })
  @IsOptional()
  @Transform(somenteDigitos)
  @IsString()
  @Matches(/^\d{11}$/u)
  responsavelCpf?: string | null;

  @ApiPropertyOptional({ enum: DESTDA_COD_ASSINANTES, default: '801' })
  @IsOptional()
  @IsIn(DESTDA_COD_ASSINANTES)
  responsavelCodAssinante?: (typeof DESTDA_COD_ASSINANTES)[number];

  @ApiPropertyOptional({
    type: [InscricaoSubstitutoDto],
    description:
      'Inscrições estaduais como contribuinte substituto em outras UFs (registro 0002).',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(26)
  @ValidateNested({ each: true })
  @Type(() => InscricaoSubstitutoDto)
  inscricoesSubstituto?: InscricaoSubstitutoDto[];

  @ApiPropertyOptional({
    description:
      'Ajustes do perfil do contribuinte (registro 0030), por exemplo { "prfIcms": "0" }.',
  })
  @IsOptional()
  @IsObject()
  perfil?: Record<string, string>;
}

export class AdminAtualizarDestdaConfiguracaoDto extends AtualizarDestdaConfiguracaoDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  clienteId: string;
}
