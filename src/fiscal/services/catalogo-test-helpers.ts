import type { RegraCandidata, ResolucaoRegra } from './catalogo-resolucao';
import type { RegraVersaoResolvida } from './fiscal-normative-catalog.service';

// Utilitários de teste: catálogo falso que responde `resolverRegraPorData`.
// Converte uma regra já resolvida na ResolucaoRegra que o catálogo devolve.
export function resolucaoDe(
  regra: RegraVersaoResolvida | null,
  data: string,
  chave: string,
): ResolucaoRegra {
  if (regra == null) {
    return {
      estado: 'SEM_REGRA',
      data,
      chave,
      regra: null,
      candidatas: [],
      rascunhosIgnorados: [],
      motivo: 'sem regra',
    };
  }
  const candidata: RegraCandidata = {
    id: regra.id,
    catalogoVersaoId: regra.catalogoVersaoId,
    chave,
    revisao: regra.revisao,
    vigenciaInicio: regra.vigenciaInicio,
    vigenciaFim: regra.vigenciaFim,
    ativo: true,
    catalogoVigenciaInicio: regra.vigenciaInicio,
    catalogoVigenciaFim: regra.vigenciaFim,
    aprovada: regra.escopoAprovado,
    conteudo: regra.conteudo,
    fonte: regra.fonte,
    fonteUrl: regra.fonteUrl,
    responsavelPor: regra.responsavelPor,
  };
  return regra.escopoAprovado
    ? {
        estado: 'DEFINITIVA',
        data,
        chave,
        regra: candidata,
        candidatas: [],
        rascunhosIgnorados: [],
        motivo: 'ok',
      }
    : {
        estado: 'PENDENTE_APROVACAO',
        data,
        chave,
        regra: null,
        candidatas: [candidata],
        rascunhosIgnorados: [],
        motivo: 'pendente',
      };
}
export function regraPadrao(
  regra: Partial<RegraVersaoResolvida>,
): RegraVersaoResolvida {
  return {
    id: 'reg-1',
    catalogoVersaoId: 'cat-1',
    chave: 'DIFAL_ENTRADA_CONTRIBUINTE',
    revisao: 1,
    conteudo: {},
    fonte: 'LC190/2022',
    fonteUrl: null,
    responsavelPor: null,
    vigenciaInicio: '2026-01-01',
    vigenciaFim: null,
    competencia: '2026-09-01',
    escopoAprovado: true,
    pendente: false,
    ...regra,
  };
}
export function createCatalogo(regra: Partial<RegraVersaoResolvida> | null): {
  resolverRegraPorData: jest.Mock;
} {
  const resolvida = regra == null ? null : regraPadrao(regra);
  return {
    resolverRegraPorData: jest.fn(
      ({ data, chave }: { data: string; chave: string }) =>
        Promise.resolve(resolucaoDe(resolvida, data, chave)),
    ),
  };
}
