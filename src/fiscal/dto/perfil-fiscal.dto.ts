import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import { REGIMES_PERFIL } from '../services/estabelecimento-perfil';

const DATA = /^\d{4}-\d{2}-\d{2}$/;

export class RegistrarPerfilManualDto {
  @IsString()
  @Matches(DATA, { message: 'Início de vigência no formato AAAA-MM-DD.' })
  vigenciaInicio!: string;

  @IsOptional()
  @IsString()
  @Matches(DATA, { message: 'Fim de vigência no formato AAAA-MM-DD.' })
  vigenciaFim?: string | null;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z]{2}$/, { message: 'UF com 2 letras.' })
  uf!: string;

  @IsOptional()
  @IsString()
  @Length(2, 20)
  inscricaoEstadual?: string | null;

  @IsOptional()
  @IsIn(REGIMES_PERFIL)
  regimeTributario?: string | null;

  @IsString()
  @Length(3, 200)
  fonte!: string;

  @IsString()
  @Length(10, 1000)
  justificativa!: string;
}
