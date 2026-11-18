import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsString,
  IsUrl,
  Length,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import {
  ATIVIDADES_BENEFICIO,
  CRITERIOS_BENEFICIO,
} from '../services/simples-beneficios';

export class SalvarSimplesBeneficioDto {
  @IsString() @Matches(/^[A-Z0-9_]{3,80}$/) codigo!: string;
  @IsInt() @Min(0) versaoAnterior!: number;
  @IsString()
  @IsIn(
    'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(
      ' ',
    ),
  )
  uf!: string;
  @IsString() @Length(3, 300) descricao!: string;
  @IsIn(['ISENCAO', 'REDUCAO']) tipo!: 'ISENCAO' | 'REDUCAO';
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsIn(ATIVIDADES_BENEFICIO, { each: true })
  atividades!: string[];
  @IsIn(CRITERIOS_BENEFICIO) criterioReceita!: string;
  @IsString() @Matches(/^\d{1,13}(?:\.\d{1,2})?$/) receitaDe!: string;
  @IsString() @Matches(/^\d{1,13}(?:\.\d{1,2})?$/) receitaAte!: string;
  @IsString() @Matches(/^\d(?:\.\d{1,4})?$/) percentualReducao!: string;
  @IsBoolean() somenteMe!: boolean;
  @IsString() @Matches(/^\d{4}-(0[1-9]|1[0-2])-01$/) vigenciaInicio!: string;
  @IsString() @Matches(/^\d{4}-(0[1-9]|1[0-2])-01$/) vigenciaFim!: string;
  @IsString() @Length(3, 2000) fundamentoLegal!: string;
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2000)
  fonteUrl!: string;
  @IsBoolean() ativo!: boolean;
}
