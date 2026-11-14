// Perfil fiscal do estabelecimento NA DATA do fato (ICMS nacional, A3).
// Puro: sem banco. O serviço carrega as linhas de `clientes_perfis_fiscais`.

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
