// Perfil fiscal do estabelecimento NA DATA do fato (ICMS nacional, A3).
// Puro: sem banco. O serviço carrega as linhas de `clientes_perfis_fiscais`.

import { dataCalendarioValida, ufValida } from './fiscal-guias-vinculo';

export interface PerfilFiscalLinha {
  /** AAAA-MM-DD */
  vigenciaInicio: string;
  vigenciaFim: string | null;
  uf: string | null;
  inscricaoEstadual: string | null;
  regimeTributario: string | null;
  origem: string;
}

export interface PerfilAtual {
  uf: string | null;
  inscricaoEstadual?: string | null;
  regimeTributario: string | null;
}

export type FontePerfil =
  /** Linha de histórico cuja vigência contém a data. */
  | 'HISTORICO'
  /** Data anterior ao primeiro registro: usa o primeiro perfil conhecido. */
  | 'HISTORICO_ANTERIOR_AO_REGISTRO'
  /** Sem histórico utilizável: cadastro atual, sem prova para a data. */
  | 'CADASTRO_ATUAL_SEM_HISTORICO';

export interface PerfilResolvido {
  uf: string | null;
  inscricaoEstadual: string | null;
  regimeTributario: string | null;
  fonte: FontePerfil;
  /** ALTA só quando uma linha de histórico cobre a data e não é presumida. */
  confianca: 'ALTA' | 'BAIXA';
  /** `origem` da linha usada, quando houver. */
  origem: string | null;
}

function normUf(uf: string | null | undefined): string | null {
  const v = (uf ?? '').trim().toUpperCase();
  return v === '' ? null : v;
}

function normTxt(v: string | null | undefined): string | null {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
}

export function perfilNaData(
  perfis: readonly PerfilFiscalLinha[],
  data: string,
  atual: PerfilAtual,
): PerfilResolvido {
  const doAtual = (): PerfilResolvido => ({
    uf: normUf(atual.uf),
    inscricaoEstadual: normTxt(atual.inscricaoEstadual),
    regimeTributario: normTxt(atual.regimeTributario),
    fonte: 'CADASTRO_ATUAL_SEM_HISTORICO',
    confianca: 'BAIXA',
    origem: null,
  });
  if (perfis.length === 0) return doAtual();

  const cobrindo = perfis
    .filter(
      (p) =>
        p.vigenciaInicio <= data &&
        (p.vigenciaFim == null || p.vigenciaFim >= data),
    )
    .sort((a, b) => b.vigenciaInicio.localeCompare(a.vigenciaInicio));
  const usar = (
    p: PerfilFiscalLinha,
    fonte: FontePerfil,
    confianca: 'ALTA' | 'BAIXA',
  ): PerfilResolvido => ({
    uf: normUf(p.uf),
    inscricaoEstadual: normTxt(p.inscricaoEstadual),
    regimeTributario: normTxt(p.regimeTributario),
    fonte,
    confianca,
    origem: p.origem,
  });
  if (cobrindo.length > 0) {
    const p = cobrindo[0];
    // Um perfil presumido desde a criação do cadastro não prova a data.
    return usar(
      p,
      'HISTORICO',
      p.origem === 'ANTERIOR_A_ALTERACAO' ? 'BAIXA' : 'ALTA',
    );
  }
  const primeiro = [...perfis].sort((a, b) =>
    a.vigenciaInicio.localeCompare(b.vigenciaInicio),
  )[0];
  if (data < primeiro.vigenciaInicio) {
    return usar(primeiro, 'HISTORICO_ANTERIOR_AO_REGISTRO', 'BAIXA');
  }
  // Lacuna entre perfis ou data após um perfil encerrado.
  return doAtual();
}

/** UFs do estabelecimento que podem valer em algum dia do intervalo. */
export function ufsNoIntervalo(
  perfis: readonly PerfilFiscalLinha[],
  inicio: string,
  fim: string,
  atual: PerfilAtual,
): Set<string> {
  const ufs = new Set<string>();
  for (const p of perfis) {
    if (
      p.vigenciaInicio <= fim &&
      (p.vigenciaFim == null || p.vigenciaFim >= inicio)
    ) {
      const u = normUf(p.uf);
      if (u) ufs.add(u);
    }
  }
  if (ufs.size === 0) {
    const u = normUf(atual.uf);
    if (u) ufs.add(u);
  }
  return ufs;
}

export const REGIMES_PERFIL = [
  'SIMPLES_NACIONAL',
  'LUCRO_PRESUMIDO',
  'LUCRO_REAL',
] as const;

export interface PerfilManualInput {
  vigenciaInicio: string;
  vigenciaFim?: string | null;
  uf: string;
  inscricaoEstadual?: string | null;
  regimeTributario?: string | null;
  fonte: string;
  justificativa: string;
}

/** Valida o perfil informado manualmente. Retorna a lista de problemas (vazia = válido). */
export function validarPerfilManual(input: PerfilManualInput): string[] {
  const erros: string[] = [];
  if (!dataCalendarioValida(input.vigenciaInicio)) {
    erros.push('Início de vigência inválido (AAAA-MM-DD).');
  }
  if (input.vigenciaFim != null) {
    if (!dataCalendarioValida(input.vigenciaFim)) {
      erros.push('Fim de vigência inválido (AAAA-MM-DD).');
    } else if (input.vigenciaFim < input.vigenciaInicio) {
      erros.push('O fim da vigência não pode ser anterior ao início.');
    }
  }
  if (!ufValida(input.uf ?? '')) erros.push('UF inválida.');
  if (
    input.regimeTributario != null &&
    !(REGIMES_PERFIL as readonly string[]).includes(input.regimeTributario)
  ) {
    erros.push('Regime tributário inválido.');
  }
  if (
    input.inscricaoEstadual != null &&
    !/^[0-9A-Z./-]{2,20}$/.test(input.inscricaoEstadual)
  ) {
    erros.push('Inscrição estadual em formato inválido.');
  }
  if ((input.fonte ?? '').trim().length < 3) {
    erros.push('Informe a fonte do dado (documento ou comprovante).');
  }
  if ((input.justificativa ?? '').trim().length < 10) {
    erros.push('Informe a justificativa (mínimo de 10 caracteres).');
  }
  return erros;
}
