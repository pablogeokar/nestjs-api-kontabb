import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  ValidateIf,
} from 'class-validator';

const VALOR = /^\d{1,13}(?:\.\d{1,2})?$/;
const ALIQUOTA = /^\d{1,2}(?:\.\d{1,4})?$/;

export class SimularAntecipacaoParcialDto {
  @IsIn(['DIFERENCA_ALIQUOTAS', 'DEDUCAO_ORIGEM'])
  metodo!: 'DIFERENCA_ALIQUOTAS' | 'DEDUCAO_ORIGEM';

  @IsString()
  @Matches(VALOR)
  baseCalculo!: string;

  @IsString()
  @Matches(ALIQUOTA)
  aliquotaInterna!: string;

  @ValidateIf(
    (dto: SimularAntecipacaoParcialDto) => dto.metodo === 'DIFERENCA_ALIQUOTAS',
  )
  @IsString()
  @Matches(ALIQUOTA)
  aliquotaInterestadual?: string;

  @ValidateIf(
    (dto: SimularAntecipacaoParcialDto) => dto.metodo === 'DEDUCAO_ORIGEM',
  )
  @IsString()
  @Matches(VALOR)
  deducaoOrigem?: string;

  @IsOptional()
  @IsString()
  @Matches(ALIQUOTA)
  percentualReducao?: string;
}
