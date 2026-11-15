// Resolução PURA de regra normativa por data do fato gerador (ICMS nacional, A2).
//
// Diferenças em relação a `resolverRegraVigente` (legado, mantido para CIAP/PIS):
// - vigência por DIA, não pelo primeiro dia do mês;
// - nenhum catálogo é escolhido antes: todas as regras da chave em catálogos
//   vigentes na data concorrem, então um catálogo novo não oculta regra de outro;
// - a aprovação vale por regra (`escopoAprovado` da regra; `null` herda do
//   catálogo), de modo que aprovar uma hipótese não libera as vizinhas;
// - rascunho e regra pendente nunca viram decisão definitiva;
// - empate com conteúdos distintos é AMBIGUA e devolve as candidatas.

export interface RegraCandidata {
  id: string;
  catalogoVersaoId: string;
  chave: string;
  revisao: number;
  /** AAAA-MM-DD */
  vigenciaInicio: string;
  vigenciaFim: string | null;
  ativo: boolean;
  /** Vigência do catálogo que ancora a regra; a vigência efetiva é a interseção. */
  catalogoVigenciaInicio: string;
  catalogoVigenciaFim: string | null;
  /** Aprovação efetiva: `regra.escopoAprovado ?? catalogo.escopoAprovado`. */
  aprovada: boolean;
  conteudo: Record<string, unknown>;
  /** Proveniência, repassada ao consumidor para a memória de cálculo. */
  fonte?: string;
  fonteUrl?: string | null;
  responsavelPor?: string | null;
}

export type EstadoResolucao =
  'DEFINITIVA' | 'PENDENTE_APROVACAO' | 'AMBIGUA' | 'SEM_REGRA';

export interface ResolucaoRegra {
  estado: EstadoResolucao;
  data: string;
  chave: string;
  regra: RegraCandidata | null;
  /** Candidatas que concorreram no desempate (AMBIGUA) ou pendentes. */
  candidatas: RegraCandidata[];
  /** Regras vigentes e não aprovadas que foram ignoradas por haver definitiva. */
  rascunhosIgnorados: RegraCandidata[];
  motivo: string;
}

const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;

function maior(a: string, b: string): string {
  return a >= b ? a : b;
}

function menorFim(a: string | null, b: string | null): string | null {
  if (a == null) return b;
  if (b == null) return a;
  return a <= b ? a : b;
}

/** Vigência efetiva da regra (interseção com a do catálogo). */
export function vigenciaEfetiva(r: RegraCandidata): {
  inicio: string;
  fim: string | null;
} {
  return {
    inicio: maior(r.vigenciaInicio, r.catalogoVigenciaInicio),
    fim: menorFim(r.vigenciaFim, r.catalogoVigenciaFim),
  };
}

function cobre(r: RegraCandidata, data: string): boolean {
  const v = vigenciaEfetiva(r);
  return v.inicio <= data && (v.fim == null || v.fim >= data);
}

function canonico(valor: unknown): string {
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(',')}]`;
  if (valor && typeof valor === 'object') {
    const o = valor as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonico(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(valor ?? null);
}

/** Entre as candidatas, mantém as de maior vigência efetiva e, por catálogo, a maior revisão. */
function vencedoras(lista: RegraCandidata[]): RegraCandidata[] {
  const maisRecenteInicio = lista
    .map((r) => vigenciaEfetiva(r).inicio)
    .reduce(maior);
  const doInicio = lista.filter(
    (r) => vigenciaEfetiva(r).inicio === maisRecenteInicio,
  );
  const porCatalogo = new Map<string, RegraCandidata>();
  for (const r of doInicio) {
    const atual = porCatalogo.get(r.catalogoVersaoId);
    if (!atual || r.revisao > atual.revisao) {
      porCatalogo.set(r.catalogoVersaoId, r);
    }
  }
  return [...porCatalogo.values()];
}

export function resolverRegraPorData(
  candidatas: readonly RegraCandidata[],
  entrada: { chave: string; data: string },
): ResolucaoRegra {
  if (!DATA_RE.test(entrada.data)) {
    throw new Error(`Data do fato gerador inválida: "${entrada.data}".`);
  }
  const base = { data: entrada.data, chave: entrada.chave };
  const vigentes = candidatas.filter(
    (r) => r.ativo && r.chave === entrada.chave && cobre(r, entrada.data),
  );
  if (vigentes.length === 0) {
    return {
      ...base,
      estado: 'SEM_REGRA',
      regra: null,
      candidatas: [],
      rascunhosIgnorados: [],
      motivo: 'Nenhuma regra vigente na data para a chave.',
    };
  }
  const aprovadas = vigentes.filter((r) => r.aprovada);
  const pendentes = vigentes.filter((r) => !r.aprovada);

  if (aprovadas.length === 0) {
    return {
      ...base,
      estado: 'PENDENTE_APROVACAO',
      regra: null,
      candidatas: pendentes,
      rascunhosIgnorados: [],
      motivo: 'Há regra vigente, mas nenhuma aprovada para decisão definitiva.',
    };
  }

  const topo = vencedoras(aprovadas);
  const distintas = new Set(topo.map((r) => canonico(r.conteudo)));
  if (distintas.size > 1) {
    return {
      ...base,
      estado: 'AMBIGUA',
      regra: null,
      candidatas: topo,
      rascunhosIgnorados: pendentes,
      motivo:
        'Mais de uma regra aprovada com a mesma vigência e conteúdos distintos.',
    };
  }
  const escolhida = [...topo].sort((a, b) => a.id.localeCompare(b.id))[0];
  return {
    ...base,
    estado: 'DEFINITIVA',
    regra: escolhida,
    candidatas: [],
    rascunhosIgnorados: pendentes,
    motivo: 'Regra aprovada e vigente na data.',
  };
}

/**
 * Adapta uma resolução ao formato `RegraVersaoResolvida` consumido pelos
 * cálculos existentes. DEFINITIVA vira regra aprovada; PENDENTE_APROVACAO com
 * conteúdo único vira regra NÃO aprovada (simulação); SEM_REGRA e AMBIGUA
 * viram `null`, ou seja, pendência sem valor.
 */
export function regraResolvidaDe(
  resolucao: ResolucaoRegra,
  competenciaDate: string,
): import('./fiscal-normative-catalog.service').RegraVersaoResolvida | null {
  let r: RegraCandidata | null = null;
  let aprovada = false;
  if (resolucao.estado === 'DEFINITIVA') {
    r = resolucao.regra;
    aprovada = true;
  } else if (resolucao.estado === 'PENDENTE_APROVACAO') {
    const topo = vencedoras(resolucao.candidatas);
    if (new Set(topo.map((c) => canonico(c.conteudo))).size === 1) {
      r = [...topo].sort((a, b) => a.id.localeCompare(b.id))[0];
    }
  }
  if (!r) return null;
  const v = vigenciaEfetiva(r);
  return {
    id: r.id,
    catalogoVersaoId: r.catalogoVersaoId,
    chave: r.chave,
    revisao: r.revisao,
    conteudo: r.conteudo,
    fonte: r.fonte ?? '',
    fonteUrl: r.fonteUrl ?? null,
    responsavelPor: r.responsavelPor ?? null,
    vigenciaInicio: v.inicio,
    vigenciaFim: v.fim,
    competencia: competenciaDate,
    escopoAprovado: aprovada,
    pendente: !aprovada,
  };
}
