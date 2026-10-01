import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

// Formato de competência mensal (AAAA-MM), com mês entre 01 e 12.
const COMPETENCIA_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
// Data ISO (AAAA-MM-DD).
const DATA_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
// Valor monetário decimal NÃO NEGATIVO (ex.: "0", "12", "12.34").
// O sinal negativo é rejeitado no padrão para garantir não-negatividade (R6.1/R6.3).
const VALOR_NAO_NEGATIVO_PATTERN = /^\d+(?:\.\d{1,6})?$/;

// Limite legal de parcelas de apropriação do CIAP (1/48).
const PARCELAS_MIN = 1;
const PARCELAS_MAX = 48;

// Domínio de motivo de baixa do bem (registro G do CIAP).
export const CIAP_MOTIVOS_BAIXA = ['01', '02', '03'] as const;

const VALOR_MENSAGEM =
  'O valor deve ser um decimal não negativo (ex.: "0", "12", "12.34").';

/**
 * DTO para importação automática / apropriação efetiva do CIAP na competência.
 * Ambas as rotas recebem apenas cliente e competência.
 */
export class CiapCompetenciaDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  clienteId!: string;

  @ApiProperty({ example: '2026-08', pattern: '^\\d{4}-(0[1-9]|1[0-2])$' })
  @IsString()
  @Matches(COMPETENCIA_PATTERN, {
    message: 'Competência deve estar no formato AAAA-MM.',
  })
  competencia!: string;
}

/**
 * DTO para rotas de CIAP que operam sobre todo o acervo de um cliente, sem
 * competência (ex.: diagnóstico de fichas e migração da identidade por
 * aquisição).
 */
export class CiapClienteDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  clienteId!: string;
}

/**
 * DTO para registro manual de um bem do ativo permanente no CIAP.
 */
export class RegistrarBemCiapDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  clienteId!: string;

  @ApiProperty({ example: 'BEM-001', maxLength: 60 })
  @IsString()
  @Length(1, 60)
  codigoBem!: string;

  @ApiProperty({ example: 'Torno CNC modelo X', maxLength: 255 })
  @IsString()
  @Length(1, 255)
  identificacaoBem!: string;

  @ApiProperty({ example: '2026-08-15', pattern: '^\\d{4}-\\d{2}-\\d{2}$' })
  @IsString()
  @Matches(DATA_PATTERN, {
    message: 'Data de entrada deve estar no formato AAAA-MM-DD.',
  })
  dataEntrada!: string;

  @ApiProperty({ example: '1200.00' })
  @IsString()
  @Matches(VALOR_NAO_NEGATIVO_PATTERN, { message: VALOR_MENSAGEM })
  valorIcmsTotal!: string;

  @ApiPropertyOptional({ example: '0.00' })
  @IsOptional()
  @IsString()
  @Matches(VALOR_NAO_NEGATIVO_PATTERN, { message: VALOR_MENSAGEM })
  valorIcmsFrete?: string;

  @ApiPropertyOptional({ example: '0.00' })
  @IsOptional()
  @IsString()
  @Matches(VALOR_NAO_NEGATIVO_PATTERN, { message: VALOR_MENSAGEM })
  valorIcmsDifal?: string;

  @ApiPropertyOptional({
    minimum: PARCELAS_MIN,
    maximum: PARCELAS_MAX,
    default: PARCELAS_MAX,
  })
  @IsOptional()
  @IsInt()
  @Min(PARCELAS_MIN)
  @Max(PARCELAS_MAX)
  quantidadeParcelas?: number;
}

// Coeficiente de apropriação (índice de participação), 0..1 com até 4 casas.
const COEFICIENTE_PATTERN = /^(?:0(?:\.\d{1,4})?|1(?:\.0{1,4})?)$/;

/**
 * DTO para correção retroativa de uma apropriação CIAP já efetivada (R1.6/R1.7).
 * A correção cria uma nova versão na razão e um movimento de estorno/correção,
 * sem sobrescrever a entrega anterior. Corrige o coeficiente (rateio/cenário)
 * de um bem numa competência; a base e a parcela passível originais são
 * preservadas.
 */
export class CorrigirApropriacaoCiapDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  clienteId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  bemId!: string;

  @ApiProperty({ example: '2026-08', pattern: '^\\d{4}-(0[1-9]|1[0-2])$' })
  @IsString()
  @Matches(COMPETENCIA_PATTERN, {
    message: 'Competência deve estar no formato AAAA-MM.',
  })
  competencia!: string;

  @ApiProperty({ example: '0.6000' })
  @IsString()
  @Matches(COEFICIENTE_PATTERN, {
    message: 'O coeficiente deve estar entre 0 e 1 (ex.: "0.6000").',
  })
  coeficiente!: string;

  @ApiProperty({ example: 'saidas_tributadas', maxLength: 40 })
  @IsString()
  @Length(1, 40)
  coeficienteFonte!: string;

  @ApiPropertyOptional({
    example: 'Reclassificação de saída tributada após retificação de NF-e.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  motivo?: string;

  @ApiPropertyOptional({
    example: '2026-09-15',
    pattern: '^\\d{4}-\\d{2}-\\d{2}$',
  })
  @IsOptional()
  @IsString()
  @Matches(DATA_PATTERN, {
    message: 'Data da correção deve estar no formato AAAA-MM-DD.',
  })
  dataCorrecao?: string;
}

/**
 * DTO para baixa de um bem do CIAP.
 */
export class BaixarBemCiapDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  clienteId!: string;

  @ApiProperty({ example: '2026-08-31', pattern: '^\\d{4}-\\d{2}-\\d{2}$' })
  @IsString()
  @Matches(DATA_PATTERN, {
    message: 'Data de baixa deve estar no formato AAAA-MM-DD.',
  })
  dataBaixa!: string;

  @ApiProperty({ enum: CIAP_MOTIVOS_BAIXA })
  @IsIn(CIAP_MOTIVOS_BAIXA)
  motivoBaixa!: (typeof CIAP_MOTIVOS_BAIXA)[number];
}
