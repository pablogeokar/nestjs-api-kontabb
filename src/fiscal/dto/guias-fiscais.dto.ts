import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
} from 'class-validator';
import type {
  CriarGuiaInput,
  TipoGuia,
  TributoGuia,
} from '../services/fiscal-guias.service';

const COMPETENCIA_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATA_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UF_PATTERN = /^[A-Z]{2}$/;
// Valor monetário decimal não negativo (ver ciap.dto.ts).
const VALOR_NAO_NEGATIVO_PATTERN = /^\d+(?:\.\d{1,6})?$/;
const VALOR_MENSAGEM =
  'O valor deve ser um decimal não negativo (ex.: "0", "12", "12.34").';

// Domínios espelhados de fiscal-guias.service.ts.
export const TRIBUTOS_GUIA = [
  'ICMS_PROPRIO',
  'ICMS_ST',
  'DIFAL_ENTRADA',
  'DIFAL_SAIDA',
  'FCP',
  'IPI',
  'PIS',
  'COFINS',
  'DAS_SIMPLES',
] as const satisfies readonly TributoGuia[];

export const TIPOS_GUIA = [
  'DAE',
  'GNRE',
  'DARF',
  'DAS',
] as const satisfies readonly TipoGuia[];

export const STATUS_PAGAMENTO_GUIA = ['PENDENTE', 'PAGO', 'VENCIDO'] as const;

/**
 * DTO para criação de guia de recolhimento. Espelha CriarGuiaInput do serviço.
 */
export class CriarGuiaDto implements CriarGuiaInput {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  clienteId!: string;

  @ApiProperty({ example: '2026-08', pattern: '^\\d{4}-(0[1-9]|1[0-2])$' })
  @IsString()
  @Matches(COMPETENCIA_PATTERN, {
    message: 'Competência deve estar no formato AAAA-MM.',
  })
  competencia!: string;

  @ApiProperty({ enum: TRIBUTOS_GUIA })
  @IsIn(TRIBUTOS_GUIA)
  tributo!: TributoGuia;

  @ApiProperty({ example: 'SP', pattern: '^[A-Z]{2}$' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Matches(UF_PATTERN, {
    message: 'UF favorecida deve ter 2 letras maiúsculas (ex.: "SP").',
  })
  ufFavorecida!: string;

  @ApiProperty({ enum: TIPOS_GUIA })
  @IsIn(TIPOS_GUIA)
  tipoGuia!: TipoGuia;

  @ApiProperty({ example: '046', maxLength: 20 })
  @IsString()
  @Length(1, 20)
  codigoReceita!: string;

  @ApiProperty({ example: '2026-09-10', pattern: '^\\d{4}-\\d{2}-\\d{2}$' })
  @IsString()
  @Matches(DATA_PATTERN, {
    message: 'Data de vencimento deve estar no formato AAAA-MM-DD.',
  })
  dataVencimento!: string;

  @ApiProperty({ example: '100.00' })
  @IsString()
  @Matches(VALOR_NAO_NEGATIVO_PATTERN, { message: VALOR_MENSAGEM })
  valorPrincipal!: string;

  @ApiPropertyOptional({ example: '0.00' })
  @IsOptional()
  @IsString()
  @Matches(VALOR_NAO_NEGATIVO_PATTERN, { message: VALOR_MENSAGEM })
  valorMulta?: string;

  @ApiPropertyOptional({ example: '0.00' })
  @IsOptional()
  @IsString()
  @Matches(VALOR_NAO_NEGATIVO_PATTERN, { message: VALOR_MENSAGEM })
  valorJuros?: string;
}

/**
 * DTO para atualização do status de pagamento de uma guia.
 */
export class MarcarPagamentoGuiaDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  clienteId!: string;

  @ApiProperty({ enum: STATUS_PAGAMENTO_GUIA })
  @IsIn(STATUS_PAGAMENTO_GUIA)
  statusPagamento!: (typeof STATUS_PAGAMENTO_GUIA)[number];
}
