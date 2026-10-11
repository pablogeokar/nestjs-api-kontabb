import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
} from 'class-validator';
import type {
  ObrigacaoEntrega,
  RegistrarEntregaInput,
  RetificarEntregaInput,
  StatusValidacaoEntrega,
} from '../services/fiscal-entregas.service';

const COMPETENCIA_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const HASH_SHA256_PATTERN = /^[0-9a-f]{64}$/;
// Diferença da retificação: decimal COM sinal (pode reduzir o valor apurado).
const VALOR_COM_SINAL_PATTERN = /^-?\d+(?:\.\d{1,6})?$/;

// Domínios espelhados de fiscal-entregas.service.ts.
export const OBRIGACOES_ENTREGA = [
  'EFD_ICMS_IPI',
  'EFD_CONTRIBUICOES',
  'GIA',
  'DAS',
  'DAPI',
] as const satisfies readonly ObrigacaoEntrega[];

export const STATUS_VALIDACAO_ENTREGA = [
  'PENDENTE',
  'VALIDADA',
  'REJEITADA',
  'TRANSMITIDA',
  'FALHA_STORAGE',
] as const satisfies readonly StatusValidacaoEntrega[];

/**
 * DTO para registrar uma ENTREGA ORIGINAL (R2.1/R2.4). Só a SINTAXE é validada
 * aqui; o serviço reforça as invariantes (escopo do cliente, casamento hash ↔
 * hash do fechamento, obrigação válida). `arquivoKey`/`reciboKey` são sempre
 * keys do storage, nunca URLs (SKILL).
 */
export class RegistrarEntregaDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  clienteId!: string;

  @ApiProperty({ example: '2026-08', pattern: '^\\d{4}-(0[1-9]|1[0-2])$' })
  @IsString()
  @Matches(COMPETENCIA_PATTERN, {
    message: 'Competência deve estar no formato AAAA-MM.',
  })
  competencia!: string;

  @ApiProperty({ enum: OBRIGACOES_ENTREGA })
  @IsIn(OBRIGACOES_ENTREGA)
  obrigacao!: ObrigacaoEntrega;

  @ApiProperty({ description: 'Key do arquivo entregue no storage (nunca URL).' })
  @IsString()
  @Length(1, 1024)
  arquivoKey!: string;

  @ApiProperty({
    description: 'SHA-256 do arquivo entregue (64 chars hex minúsculo).',
    pattern: '^[0-9a-f]{64}$',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @Matches(HASH_SHA256_PATTERN, {
    message: 'Hash do arquivo deve ser SHA-256 em hexadecimal (64 caracteres).',
  })
  hashArquivo!: string;

  @ApiProperty({ example: 'PVA_EFD_ICMS_IPI', maxLength: 40 })
  @IsString()
  @Length(1, 40)
  pvaPrograma!: string;

  @ApiProperty({ example: '6.1.1', maxLength: 20 })
  @IsString()
  @Length(1, 20)
  pvaVersao!: string;

  @ApiProperty({
    example: '6.1.1',
    maxLength: 20,
    description:
      'Confirmação EXPLÍCITA da versão do PVA usada na homologação (deve casar ' +
      '`pvaVersao`). A versão nunca é presumida como "a última" (N05).',
  })
  @IsString()
  @Length(1, 20)
  pvaVersaoConfirmada!: string;

  @ApiPropertyOptional({
    example: '3.2.2',
    maxLength: 20,
    description:
      'Versão do leiaute. OPCIONAL: se omitida, é derivada da vigência da ' +
      'competência (2026 = 3.2.2; 2027 = 3.2.3 — N03/N04); se informada, deve ' +
      'casar o leiaute esperado para a vigência (R2.5).',
  })
  @IsOptional()
  @IsString()
  @Length(1, 20)
  leiauteVersao?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Versão de apuração (fechamento) vinculada. Quando informado, o hash do ' +
      'arquivo deve casar com o hash do fechamento (R2.4).',
  })
  @IsOptional()
  @IsUUID('4')
  fechamentoId?: string;

  @ApiPropertyOptional({ enum: STATUS_VALIDACAO_ENTREGA })
  @IsOptional()
  @IsIn(STATUS_VALIDACAO_ENTREGA)
  statusValidacao?: StatusValidacaoEntrega;

  @ApiPropertyOptional({
    description: 'Resultado estruturado do PVA (ocorrências/advertências).',
  })
  @IsOptional()
  @IsObject()
  validacaoResultado?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Titular/thumbprint do certificado (N02).' })
  @IsOptional()
  @IsString()
  assinaturaTitular?: string;

  @ApiPropertyOptional({ description: 'Momento da assinatura (ISO 8601).' })
  @IsOptional()
  @IsISO8601()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? new Date(value) : value,
  )
  assinaturaEm?: Date;

  @ApiPropertyOptional({ description: 'Número do protocolo/recibo do órgão.' })
  @IsOptional()
  @IsString()
  protocoloNumero?: string;

  @ApiPropertyOptional({
    description: 'Key do comprovante/recibo do PVA no storage (nunca URL).',
  })
  @IsOptional()
  @IsString()
  @Length(1, 1024)
  reciboKey?: string;

  @ApiPropertyOptional({ description: 'Momento da transmissão (ISO 8601).' })
  @IsOptional()
  @IsISO8601()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? new Date(value) : value,
  )
  transmitidaEm?: Date;
}

/**
 * DTO para RETIFICAR uma entrega (R2.2). A obrigação/competência são herdadas da
 * original — não se informam aqui. A diferença (`valorDiferenca`) é obrigatória
 * e pode ser negativa (a retificação pode reduzir o valor apurado). O recibo é
 * PRÓPRIO da retificadora e a entrega anterior permanece imutável.
 */
export class RetificarEntregaDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  clienteId!: string;

  @ApiProperty({ format: 'uuid', description: 'Entrega original a retificar.' })
  @IsUUID('4')
  entregaOriginalId!: string;

  @ApiProperty({ description: 'Key do novo arquivo entregue (nunca URL).' })
  @IsString()
  @Length(1, 1024)
  arquivoKey!: string;

  @ApiProperty({
    description: 'SHA-256 do novo arquivo (64 chars hex minúsculo).',
    pattern: '^[0-9a-f]{64}$',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @Matches(HASH_SHA256_PATTERN, {
    message: 'Hash do arquivo deve ser SHA-256 em hexadecimal (64 caracteres).',
  })
  hashArquivo!: string;

  @ApiProperty({
    example: '-50.00',
    description:
      'Diferença da retificação (decimal com sinal; pode reduzir o valor).',
  })
  @IsString()
  @Matches(VALOR_COM_SINAL_PATTERN, {
    message:
      'A diferença deve ser um decimal com sinal (ex.: "50.00", "-50.00").',
  })
  valorDiferenca!: string;

  @ApiProperty({ example: 'PVA_EFD_ICMS_IPI', maxLength: 40 })
  @IsString()
  @Length(1, 40)
  pvaPrograma!: string;

  @ApiProperty({ example: '6.1.1', maxLength: 20 })
  @IsString()
  @Length(1, 20)
  pvaVersao!: string;

  @ApiProperty({
    example: '6.1.1',
    maxLength: 20,
    description:
      'Confirmação EXPLÍCITA da versão do PVA usada na homologação (deve casar ' +
      '`pvaVersao`). A versão nunca é presumida como "a última" (N05).',
  })
  @IsString()
  @Length(1, 20)
  pvaVersaoConfirmada!: string;

  @ApiPropertyOptional({
    example: '3.2.2',
    maxLength: 20,
    description:
      'Versão do leiaute. OPCIONAL: se omitida, é derivada da vigência da ' +
      'competência da original (2026 = 3.2.2; 2027 = 3.2.3 — N03/N04); se ' +
      'informada, deve casar o leiaute esperado para a vigência (R2.5).',
  })
  @IsOptional()
  @IsString()
  @Length(1, 20)
  leiauteVersao?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Versão de apuração da retificadora. Default: herda o fechamento da ' +
      'original. Quando informado, o hash deve casar com o do fechamento (R2.4).',
  })
  @IsOptional()
  @IsUUID('4')
  fechamentoId?: string;

  @ApiPropertyOptional({ enum: STATUS_VALIDACAO_ENTREGA })
  @IsOptional()
  @IsIn(STATUS_VALIDACAO_ENTREGA)
  statusValidacao?: StatusValidacaoEntrega;

  @ApiPropertyOptional({
    description: 'Resultado estruturado do PVA (ocorrências/advertências).',
  })
  @IsOptional()
  @IsObject()
  validacaoResultado?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Titular/thumbprint do certificado (N02).' })
  @IsOptional()
  @IsString()
  assinaturaTitular?: string;

  @ApiPropertyOptional({ description: 'Momento da assinatura (ISO 8601).' })
  @IsOptional()
  @IsISO8601()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? new Date(value) : value,
  )
  assinaturaEm?: Date;

  @ApiPropertyOptional({ description: 'Número do protocolo/recibo do órgão.' })
  @IsOptional()
  @IsString()
  protocoloNumero?: string;

  @ApiPropertyOptional({
    description: 'Key do recibo PRÓPRIO da retificadora (nunca URL).',
  })
  @IsOptional()
  @IsString()
  @Length(1, 1024)
  reciboKey?: string;

  @ApiPropertyOptional({ description: 'Momento da transmissão (ISO 8601).' })
  @IsOptional()
  @IsISO8601()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? new Date(value) : value,
  )
  transmitidaEm?: Date;
}

// Garante que os DTOs satisfazem as entradas do serviço (menos clienteId que o
// controller resolve do contexto quando necessário — aqui admin informa).
type _AssertRegistrar = RegistrarEntregaDto extends RegistrarEntregaInput
  ? true
  : never;
type _AssertRetificar = RetificarEntregaDto extends RetificarEntregaInput
  ? true
  : never;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _assertRegistrar: _AssertRegistrar = true;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _assertRetificar: _AssertRetificar = true;
