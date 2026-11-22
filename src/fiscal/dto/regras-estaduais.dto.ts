import { Type } from 'class-transformer';
import {
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
import { QueryIcmsRegrasDto } from './icms-regras.dto';

const PERCENTUAL = /^\d{1,3}(\.\d{1,4})?$/;

export class DifalParametrosDto {
  @Matches(PERCENTUAL) aliquota_interna!: string;
  /** Vazio: usa a alíquota destacada no item. */
  @IsOptional() @Matches(PERCENTUAL) aliquota_interestadual?: string | null;
  @IsOptional() @Matches(PERCENTUAL) aliquota_fcp?: string | null;
  @IsOptional() @Matches(PERCENTUAL) percentual_reducao?: string | null;
  @IsOptional() @Matches(PERCENTUAL) percentual_beneficio?: string | null;
  @IsBoolean() base_por_dentro!: boolean;
  @IsBoolean() base_dupla!: boolean;
  @IsBoolean() fcp_na_base_por_dentro!: boolean;
  /** Fundamento da dispensa sobre ativo para ME/EPP. Vazio: não dispensa. */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  dispensa_ativo_me_epp_fundamento?: string | null;
  @IsOptional() @IsString() @MaxLength(500) fundamento?: string | null;
}

export class SalvarDifalEstadualDto extends QueryIcmsRegrasDto {
  @IsInt() @Min(0) @Max(100000) expectedRevision!: number;
  @IsOptional() @IsString() @MaxLength(60) fonte?: string;
  @IsOptional() @IsUrl({ require_protocol: true }) fonteUrl?: string;
  /** Aprova a revisão ao salvar. Sem isso, fica como rascunho. */
  @IsBoolean() aprovar!: boolean;
  @ValidateNested()
  @Type(() => DifalParametrosDto)
  parametros!: DifalParametrosDto;
}

export class StRegraDto {
  @Matches(/^\d{7}$/) cest!: string;
  @IsOptional() @Matches(/^\d{8}$/) ncm?: string | null;
  /** Verdadeiro: a norma sujeita o CEST à ST. Falso: exclui expressamente. */
  @IsBoolean() sujeito_ast!: boolean;
  @IsOptional() @Matches(PERCENTUAL) mva?: string | null;
  @IsOptional() @Matches(PERCENTUAL) aliquota_fcp?: string | null;
  @IsOptional() @IsString() @MaxLength(500) fundamento?: string | null;
}

export class SalvarStEstadualDto extends QueryIcmsRegrasDto {
  /** Revisão atual deste CEST; 0 quando ainda não existe. */
  @IsInt() @Min(0) @Max(100000) expectedRevision!: number;
  @IsOptional() @IsString() @MaxLength(60) fonte?: string;
  @IsOptional() @IsUrl({ require_protocol: true }) fonteUrl?: string;
  @IsBoolean() aprovar!: boolean;
  @ValidateNested()
  @Type(() => StRegraDto)
  regra!: StRegraDto;
}

export class RemoverStEstadualDto extends QueryIcmsRegrasDto {
  @Matches(/^\d{7}$/) cest!: string;
}

export class AprovarFonteStDto extends QueryIcmsRegrasDto {
  /** NACIONAL: Convênio ICMS 142/18. ESTADUAL: norma da UF das regras. */
  @IsIn(['NACIONAL', 'ESTADUAL']) nivel!: 'NACIONAL' | 'ESTADUAL';
  @IsOptional() @IsString() @MaxLength(60) fonte?: string;
  @IsOptional() @IsUrl({ require_protocol: true }) fonteUrl?: string;
  /** Falso revoga a verificação. */
  @IsBoolean() aprovar!: boolean;
}
