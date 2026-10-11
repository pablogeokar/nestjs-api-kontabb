import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
} from 'class-validator';
import type {
  CriarGuiaInput,
  OrigemGuia,
  OrigemPagamento,
  TipoGuia,
  TributoGuia,
} from '../services/fiscal-guias.service';
import type { TipoEventoPagamento } from '../services/fiscal-pagamentos-trilha';
import type { DifalCalculoStatus } from '../services/difal-calculador';

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

// Origem da guia (R1.1 / Fase 5 tarefa 1.2): calculada a partir de uma versão
// de apuração (fechamento) ou lançada manualmente. Espelha OrigemGuia.
export const ORIGENS_GUIA = [
  'APURACAO',
  'MANUAL',
] as const satisfies readonly OrigemGuia[];

// Estados do cálculo de DIFAL (espelha DifalCalculoStatus). Só CALCULADO pode
// virar guia (tarefa 2.3 / R1.2); SIMULACAO/PENDENTE são barrados no serviço.
export const DIFAL_CALCULO_STATUS = [
  'CALCULADO',
  'SIMULACAO',
  'PENDENTE',
] as const satisfies readonly DifalCalculoStatus[];

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

  @ApiPropertyOptional({
    enum: DIFAL_CALCULO_STATUS,
    description:
      'Estado do cálculo do DIFAL. Obrigatório para DIFAL_ENTRADA/DIFAL_SAIDA: ' +
      'só CALCULADO gera guia; SIMULACAO/PENDENTE são bloqueados (R1.2).',
  })
  @IsOptional()
  @IsIn(DIFAL_CALCULO_STATUS)
  difalStatus?: DifalCalculoStatus;

  @ApiPropertyOptional({
    enum: ORIGENS_GUIA,
    description:
      'Origem da guia (R1.1). APURACAO = calculada de um fechamento (exige ' +
      'fechamentoId, R1.7); MANUAL (default) = lançada manualmente.',
  })
  @IsOptional()
  @IsIn(ORIGENS_GUIA)
  origem?: OrigemGuia;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Versão de apuração (fechamento da Fase 3) que originou a obrigação ' +
      'calculada. Obrigatório quando origem = APURACAO (R1.7).',
  })
  @IsOptional()
  @IsUUID('4')
  fechamentoId?: string;

  @ApiPropertyOptional({
    maxLength: 255,
    description:
      'Chave de idempotência por requisição (R1.6). Opcional. Um retry com a ' +
      'mesma chave não cria guia duplicada — retorna a já criada. NÃO é ' +
      'unicidade por tributo/período/UF: múltiplas obrigações legítimas do ' +
      'mesmo tributo/período/UF continuam permitidas (chaves distintas).',
  })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  idempotencyKey?: string;
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

// Tipos de evento de pagamento/estorno (espelha TipoEventoPagamento). Cada
// evento é imutável na trilha; o saldo é reconstruído, nunca sobrescrito (R1.3).
export const TIPOS_EVENTO_PAGAMENTO = [
  'PAGAMENTO',
  'PAGAMENTO_PARCIAL',
  'ESTORNO',
] as const satisfies readonly TipoEventoPagamento[];

// Origem do evento (espelha OrigemPagamento).
export const ORIGENS_PAGAMENTO = [
  'MANUAL',
  'IMPORTACAO',
  'CONCILIACAO',
] as const satisfies readonly OrigemPagamento[];

/**
 * DTO para registrar um EVENTO de pagamento/estorno na trilha de uma guia
 * (R1.3/R1.4). O serviço reforça as invariantes (evidência/declaração manual
 * para pagamento, referência de estorno); aqui validamos apenas a sintaxe.
 */
export class RegistrarEventoPagamentoDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  clienteId!: string;

  @ApiProperty({ enum: TIPOS_EVENTO_PAGAMENTO })
  @IsIn(TIPOS_EVENTO_PAGAMENTO)
  tipo!: TipoEventoPagamento;

  @ApiProperty({ example: '100.00' })
  @IsString()
  @Matches(VALOR_NAO_NEGATIVO_PATTERN, { message: VALOR_MENSAGEM })
  valor!: string;

  @ApiProperty({ example: '2026-09-10', pattern: '^\\d{4}-\\d{2}-\\d{2}$' })
  @IsString()
  @Matches(DATA_PATTERN, {
    message: 'Data do evento deve estar no formato AAAA-MM-DD.',
  })
  dataEvento!: string;

  @ApiPropertyOptional({ enum: ORIGENS_PAGAMENTO })
  @IsOptional()
  @IsIn(ORIGENS_PAGAMENTO)
  origem?: OrigemPagamento;

  @ApiPropertyOptional({
    description: 'Key do comprovante no storage (nunca URL — R1.5).',
  })
  @IsOptional()
  @IsString()
  comprovanteKey?: string;

  @ApiPropertyOptional({
    description:
      'Indicação explícita de declaração manual sem comprovante anexo (R1.5).',
  })
  @IsOptional()
  @IsBoolean()
  declaracaoManual?: boolean;

  @ApiPropertyOptional({
    description:
      'Identificador externo do evento (autenticação bancária etc.).',
  })
  @IsOptional()
  @IsString()
  documentoExterno?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Obrigatório para ESTORNO: o pagamento revertido (mesma guia).',
  })
  @IsOptional()
  @IsUUID('4')
  eventoEstornadoId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  observacao?: string;
}

/**
 * DTO para marcar uma guia como EMITIDA NO ÓRGÃO arrecadador (R1.5). Registrar
 * a guia no sistema ≠ emiti-la no órgão; este endpoint registra esse fato
 * distinto. Sem corpo além do cliente (a data de emissão é a de registro).
 */
export class MarcarEmitidaOrgaoDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  clienteId!: string;
}

/**
 * DTO para o CANCELAMENTO LÓGICO de uma guia (R1.4) — nunca delete físico.
 */
export class CancelarGuiaDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  clienteId!: string;

  @ApiPropertyOptional({ description: 'Motivo do cancelamento (rastro).' })
  @IsOptional()
  @IsString()
  motivo?: string;
}
