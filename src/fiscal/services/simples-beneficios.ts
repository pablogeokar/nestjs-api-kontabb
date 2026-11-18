import { createHash } from 'node:crypto';
import { UnprocessableEntityException } from '@nestjs/common';
import { toScaledInteger } from '../sped/sped-decimal';

export const ATIVIDADES_BENEFICIO = ['ANEXO_I', 'ANEXO_II'] as const;
export type AtividadeBeneficio = (typeof ATIVIDADES_BENEFICIO)[number];
export const CRITERIOS_BENEFICIO = [
  'RBT12_FAIXA',
  'RBT12_REAL',
  'RBA_ATUAL',
  'RBA_ANTERIOR',
] as const;
export interface RegraBeneficioSimples {
  id: string;
  codigo: string;
  versao: number;
  uf: string;
  descricao: string;
  tipo: string;
  atividades: string[];
  criterioReceita: string;
  receitaDe: string;
  receitaAte: string;
  percentualReducao: string;
  somenteMe: boolean;
  vigenciaInicio: string;
  vigenciaFim: string;
  fundamentoLegal: string;
  fonteUrl: string;
  ativo: boolean;
  atual: boolean;
}
export interface ContextoBeneficioSimples {
  uf: string;
  competencia: string;
  rbt12Faixa: string;
  rbt12Real: string;
  rbaAtual: string;
  rbaAnterior: string;
  dataAberturaCnpj: string | null;
  rbt12Proporcional: boolean;
}
export interface BeneficioIcmsAplicado extends RegraBeneficioSimples {
  atividade: string;
  baseReceita: string;
  receitaBeneficiada: string;
  valorSemBeneficio: string;
  valorDispensado: string;
}
export const BENEFICIO_BA_2026 = {
  codigo: 'BA_SN_ICMS_180MIL_2026',
  uf: 'BA',
  descricao: 'Isenção de ICMS para ME até R$ 180 mil',
  tipo: 'ISENCAO',
  atividades: ['ANEXO_I', 'ANEXO_II'],
  criterioReceita: 'RBT12_FAIXA',
  receitaDe: '0.00',
  receitaAte: '180000.00',
  percentualReducao: '1.0000',
  somenteMe: true,
  vigenciaInicio: '2026-01-01',
  vigenciaFim: '2026-12-01',
  ativo: true,
  fundamentoLegal:
    'RICMS/BA, Decreto 13.780/2012, art. 277 e parágrafo único (Decreto 19.025/2019).',
  fonteUrl:
    'https://mbusca.sefaz.ba.gov.br/DITRI/normas_complementares/decretos/decreto_2012_13780_ricms_texto_2021.pdf',
};
export function assinaturaBeneficios(regras: RegraBeneficioSimples[]): string {
  return createHash('sha256')
    .update(
      JSON.stringify([...regras].sort((a, b) => a.id.localeCompare(b.id))),
    )
    .digest('hex');
}
export function regrasBeneficioConflitam(
  a: RegraBeneficioSimples,
  b: RegraBeneficioSimples,
) {
  if (
    !a.ativo ||
    !b.ativo ||
    a.uf !== b.uf ||
    a.vigenciaInicio > b.vigenciaFim ||
    b.vigenciaInicio > a.vigenciaFim ||
    !a.atividades.some((item) => b.atividades.includes(item))
  )
    return false;
  return (
    a.criterioReceita !== b.criterioReceita ||
    (toScaledInteger(a.receitaDe) <= toScaledInteger(b.receitaAte) &&
      toScaledInteger(b.receitaDe) <= toScaledInteger(a.receitaAte))
  );
}
export function resolverBeneficioSimples(
  regras: RegraBeneficioSimples[],
  contexto: ContextoBeneficioSimples,
  atividade: AtividadeBeneficio,
) {
  const bases: Record<string, string> = {
    RBT12_FAIXA: contexto.rbt12Faixa,
    RBT12_REAL: contexto.rbt12Real,
    RBA_ATUAL: contexto.rbaAtual,
    RBA_ANTERIOR: contexto.rbaAnterior,
  };
  const ano = Number(contexto.competencia.slice(0, 4));
  const abertura = contexto.dataAberturaCnpj;
  const limiteMeAnterior = abertura?.startsWith(String(ano - 1))
    ? 3_000_000n * BigInt(13 - Number(abertura.slice(5, 7)))
    : 36_000_000n;
  const aplicaveis = regras.filter(
    (regra) =>
      regra.atual &&
      regra.ativo &&
      regra.uf === contexto.uf &&
      regra.atividades.includes(atividade) &&
      regra.vigenciaInicio.slice(0, 7) <= contexto.competencia &&
      regra.vigenciaFim.slice(0, 7) >= contexto.competencia &&
      toScaledInteger(bases[regra.criterioReceita]) >=
        toScaledInteger(regra.receitaDe) &&
      toScaledInteger(bases[regra.criterioReceita]) <=
        toScaledInteger(regra.receitaAte) &&
      (!regra.somenteMe ||
        toScaledInteger(contexto.rbaAnterior) <= limiteMeAnterior),
  );
  if (aplicaveis.length > 1)
    throw new UnprocessableEntityException(
      'Há benefícios de ICMS conflitantes. Revise o cadastro antes de apurar.',
    );
  const regra = aplicaveis[0];
  if (!regra) return null;
  if (!abertura && (contexto.rbt12Proporcional || regra.somenteMe))
    throw new UnprocessableEntityException(
      'Informe a data de abertura do CNPJ para conferir o benefício de ICMS e o enquadramento como ME.',
    );
  return { ...regra, baseReceita: bases[regra.criterioReceita] };
}
