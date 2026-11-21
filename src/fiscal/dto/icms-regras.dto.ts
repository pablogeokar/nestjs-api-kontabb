import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export const UFS_ICMS =
  'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(
    ' ',
  );

export class QueryIcmsRegrasDto {
  @Matches(/^[A-Z]{2}$/) uf!: string;
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) competencia!: string;
}

export class EnquadramentoIcmsDto {
  @Matches(/^\d{8}$/) ncm!: string;
  @IsOptional() @Matches(/^\d{7}$/) cest!: string | null;
  @IsIn(['SIMPLES_NACIONAL', 'LUCRO_PRESUMIDO', 'LUCRO_REAL']) regime!: string;
  @IsIn(UFS_ICMS) uf_origem!: string;
  @Matches(/^[0-8]$/) origem_mercadoria!: string;
  @IsIn(['APLICAVEL', 'ICMS_ST', 'DISPENSADO', 'CONFERIR']) tratamento!: string;
  @IsOptional() @Matches(/^\d{1,3}(\.\d{1,4})?$/) aliquota_interna?: string;
  @IsOptional()
  @Matches(/^\d{1,3}(\.\d{1,4})?$/)
  aliquota_interestadual?: string;
  @IsOptional() @IsIn(['INCLUIR', 'EXCLUIR']) ipi_na_base?:
    'INCLUIR' | 'EXCLUIR';
  @IsOptional() @IsString() @MaxLength(500) fundamento_ipi?: string;
  @IsOptional() @IsString() @MaxLength(500) motivo?: string;
  @IsOptional() @IsString() @MaxLength(500) fundamento?: string;
  @IsOptional() @IsString() @MaxLength(500) revisao_fiscal?: string;
  @IsBoolean() confirmado_fiscalmente!: boolean;
}

export class SalvarIcmsRegrasDto extends QueryIcmsRegrasDto {
  @IsString() @MaxLength(60) fonte!: string;
  @IsOptional() @IsUrl({ require_protocol: true }) fonteUrl?: string;
  @IsInt() @Min(0) @Max(100000) expectedRevision!: number;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => EnquadramentoIcmsDto)
  enquadramentos!: EnquadramentoIcmsDto[];
}

export class HomologarIcmsRegrasDto extends QueryIcmsRegrasDto {
  @IsInt() @Min(1) expectedRevision!: number;
}
export class ChaveEnquadramentoIcmsDto {
  @Matches(/^\d{8}$/) ncm!: string;
  @IsOptional() @Matches(/^\d{7}$/) cest!: string | null;
  @IsIn(['SIMPLES_NACIONAL', 'LUCRO_PRESUMIDO', 'LUCRO_REAL']) regime!: string;
  @IsIn(UFS_ICMS) uf_origem!: string;
  @Matches(/^[0-8]$/) origem_mercadoria!: string;
}
/** Salva UM enquadramento, sem reenviar nem reaprovar os demais. */
export class SalvarEnquadramentoIcmsDto extends QueryIcmsRegrasDto {
  @IsInt() @Min(0) @Max(100000) expectedRevision!: number;
  @IsOptional() @IsString() @MaxLength(60) fonte?: string;
  @IsOptional() @IsUrl({ require_protocol: true }) fonteUrl?: string;
  @ValidateNested()
  @Type(() => EnquadramentoIcmsDto)
  enquadramento!: EnquadramentoIcmsDto;
  /** Chave anterior, quando a edição altera NCM/CEST/regime/origem. */
  @IsOptional()
  @ValidateNested()
  @Type(() => ChaveEnquadramentoIcmsDto)
  chaveAnterior?: ChaveEnquadramentoIcmsDto;
}
export class RemoverEnquadramentoIcmsDto extends QueryIcmsRegrasDto {
  @IsInt() @Min(1) expectedRevision!: number;
  @ValidateNested()
  @Type(() => ChaveEnquadramentoIcmsDto)
  chave!: ChaveEnquadramentoIcmsDto;
}
