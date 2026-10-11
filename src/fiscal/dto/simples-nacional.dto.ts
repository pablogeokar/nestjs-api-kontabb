import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

const COMPETENCIA = /^\d{4}-(0[1-9]|1[0-2])$/;

export class CompetenciaSimplesDto {
  @ApiProperty({ example: '2026-10' })
  @IsString()
  @Matches(COMPETENCIA, {
    message: 'Competência deve estar no formato AAAA-MM.',
  })
  competencia!: string;
}

export class AdminCompetenciaSimplesDto extends CompetenciaSimplesDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  clienteId!: string;
}

export class FecharSimplesDto extends AdminCompetenciaSimplesDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  apuracaoId?: string;
}

const DECIMAL = /^\d+(?:\.\d{1,4})?$/;
const MONEY = /^\d+(?:\.\d{1,2})?$/;
const ANEXOS = [
  'ANEXO_I',
  'ANEXO_II',
  'ANEXO_III',
  'ANEXO_IV',
  'ANEXO_V',
] as const;

export class SimplesFaixaDto {
  @IsInt()
  @Min(1)
  @Max(6)
  faixa!: number;
  @IsString()
  @Matches(MONEY)
  rbt12De!: string;
  @IsString()
  @Matches(MONEY)
  rbt12Ate!: string;
  @IsString()
  @Matches(DECIMAL)
  aliquotaNominal!: string;
  @IsString()
  @Matches(MONEY)
  parcelaDeduzir!: string;
  @IsString() @Matches(DECIMAL) percentualIrpj!: string;
  @IsString() @Matches(DECIMAL) percentualCsll!: string;
  @IsString() @Matches(DECIMAL) percentualCofins!: string;
  @IsString() @Matches(DECIMAL) percentualPis!: string;
  @IsString() @Matches(DECIMAL) percentualCpp!: string;
  @IsString() @Matches(DECIMAL) percentualIpi!: string;
  @IsString() @Matches(DECIMAL) percentualIcms!: string;
  @IsString() @Matches(DECIMAL) percentualIss!: string;
}

export class SimplesAnexoDto {
  @IsIn(ANEXOS)
  anexo!: (typeof ANEXOS)[number];
  @IsString()
  @Length(2, 500)
  descricao!: string;
  @IsIn(['COMERCIO', 'INDUSTRIA', 'SERVICOS', 'LOCACAO'])
  tipoAtividade!: 'COMERCIO' | 'INDUSTRIA' | 'SERVICOS' | 'LOCACAO';
  @IsBoolean()
  permiteFatorR!: boolean;
  @IsBoolean()
  recolheCppNoDas!: boolean;
  @IsArray()
  @ArrayMinSize(6)
  @ValidateNested({ each: true })
  @Type(() => SimplesFaixaDto)
  faixas!: SimplesFaixaDto[];
}

export class SalvarSimplesTabelaDto {
  @IsString()
  @Length(2, 30)
  versao!: string;
  @IsString()
  @Length(5, 1000)
  descricao!: string;
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  vigenciaInicio!: string;
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  vigenciaFim?: string | null;
  @IsBoolean()
  ativo!: boolean;
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SimplesAnexoDto)
  anexos!: SimplesAnexoDto[];
}

export class HistoricoSimplesQueryDto {
  @IsUUID('4')
  clienteId!: string;
  @IsString()
  @Matches(COMPETENCIA)
  competenciaFinal!: string;
}

export class HistoricoSimplesItemDto {
  @IsString()
  @Matches(COMPETENCIA)
  competencia!: string;
  @IsOptional()
  @IsString()
  @Matches(MONEY)
  receitaBruta?: string;
  @IsOptional()
  @IsString()
  @Matches(MONEY)
  folhaSalariosEncargos?: string;
  @IsOptional()
  @IsString()
  @Length(0, 500)
  observacao?: string;
}

export class SalvarHistoricoSimplesDto {
  @IsUUID('4')
  clienteId!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => HistoricoSimplesItemDto)
  itens!: HistoricoSimplesItemDto[];
}
