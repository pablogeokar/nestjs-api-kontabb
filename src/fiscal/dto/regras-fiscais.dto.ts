import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

const CFOP_PATTERN = /^[123567]\d{3}$/;
const TIPOS_OPERACAO = ['ENTRADA', 'SAIDA'] as const;
const DESTINACOES = [
  'REVENDA',
  'INDUSTRIALIZACAO',
  'USO_CONSUMO',
  'ATIVO_IMOBILIZADO',
] as const;

// ─── Simulação do motor de regras ────────────────────────────────────────────

export class SimularCfopDto {
  @ApiProperty({ enum: TIPOS_OPERACAO })
  @IsIn(TIPOS_OPERACAO)
  tipoOperacaoEscriturada!: (typeof TIPOS_OPERACAO)[number];

  @ApiProperty({ example: '5102' })
  @Matches(CFOP_PATTERN)
  cfopXml!: string;

  @ApiPropertyOptional({ example: '12345678' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  ncm?: string;

  @ApiPropertyOptional({ enum: DESTINACOES })
  @IsOptional()
  @IsIn(DESTINACOES)
  destinacaoMercadoria?: (typeof DESTINACOES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  emitenteCnpjCpf?: string;

  @ApiPropertyOptional({ example: 'SP' })
  @IsOptional()
  @IsString()
  @MaxLength(2)
  emitenteUf?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(3)
  cstIcmsXml?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4)
  csosnXml?: string;
}

// ─── CRUD de regras fiscais ──────────────────────────────────────────────────

export class CreateRegraFiscalDto {
  @ApiProperty({ example: 'Fornecedor X sempre uso e consumo' })
  @IsString()
  @MaxLength(200)
  nomeRegra!: string;

  @ApiPropertyOptional({ default: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  prioridade?: number;

  // Critérios de correspondência
  @ApiPropertyOptional({ enum: TIPOS_OPERACAO })
  @IsOptional()
  @IsIn(TIPOS_OPERACAO)
  tipoOperacaoOrigem?: (typeof TIPOS_OPERACAO)[number];

  @ApiPropertyOptional({ example: '5102' })
  @IsOptional()
  @Matches(CFOP_PATTERN)
  cfopOrigem?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(8)
  ncm?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  fornecedorCnpjCpf?: string;

  @ApiPropertyOptional({ example: 'SP' })
  @IsOptional()
  @IsString()
  @MaxLength(2)
  ufOrigem?: string;

  @ApiPropertyOptional({ enum: DESTINACOES })
  @IsOptional()
  @IsIn(DESTINACOES)
  destinacaoMercadoria?: (typeof DESTINACOES)[number];

  // Ações
  @ApiProperty({ example: '1556' })
  @Matches(CFOP_PATTERN)
  cfopDestino!: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  apropriaCreditoIcms?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  apropriaCreditoIpi?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  exigeCiap?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  exigeDifalEntrada?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  observacaoFiscal?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  ativo?: boolean;
}

export class UpdateRegraFiscalDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  nomeRegra?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  prioridade?: number;

  @ApiPropertyOptional({ enum: TIPOS_OPERACAO })
  @IsOptional()
  @IsIn(TIPOS_OPERACAO)
  tipoOperacaoOrigem?: (typeof TIPOS_OPERACAO)[number] | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(CFOP_PATTERN)
  cfopOrigem?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(8)
  ncm?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  fornecedorCnpjCpf?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2)
  ufOrigem?: string | null;

  @ApiPropertyOptional({ enum: DESTINACOES })
  @IsOptional()
  @IsIn(DESTINACOES)
  destinacaoMercadoria?: (typeof DESTINACOES)[number] | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(CFOP_PATTERN)
  cfopDestino?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  apropriaCreditoIcms?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  apropriaCreditoIpi?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  exigeCiap?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  exigeDifalEntrada?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  observacaoFiscal?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  ativo?: boolean;
}

// ─── Override de destinação de item ──────────────────────────────────────────

export class DefinirDestinacaoItemDto {
  @ApiProperty({ enum: [...DESTINACOES, 'AUTOMATICA'] })
  @IsIn([...DESTINACOES, 'AUTOMATICA'])
  destinacaoMercadoria!: (typeof DESTINACOES)[number] | 'AUTOMATICA';
}
