import {
  resolverRegraPorData,
  type RegraCandidata,
} from './catalogo-resolucao';
import { FiscalNormativeCatalogService } from './fiscal-normative-catalog.service';

function regra(over: Partial<RegraCandidata> = {}): RegraCandidata {
  return {
    id: 'r1',
    catalogoVersaoId: 'cat1',
    chave: 'DIFAL_ENTRADA_CONTRIBUINTE',
    revisao: 1,
    vigenciaInicio: '2026-01-01',
    vigenciaFim: null,
    ativo: true,
    catalogoVigenciaInicio: '2026-01-01',
    catalogoVigenciaFim: null,
    aprovada: true,
    conteudo: { aliquota: '20.50' },
    ...over,
  };
}
const K = 'DIFAL_ENTRADA_CONTRIBUINTE';

describe('A2 — comportamento legado reproduzido (resolverRegraVigente)', () => {
  it('catálogo mais novo da mesma UF/tipo oculta a regra que só existe no catálogo anterior', async () => {
    // 1ª consulta: o catálogo escolhido (o de início mais recente, só com
    // antecipação). 2ª consulta: regras da chave DENTRO dele → vazio.
    const catNovo = {
      id: 'cat-novo',
      tipo: 'DIFAL',
      uf: 'BA',
      codigo: 'X',
      fonte: 'f',
      conteudo: {},
      vigenciaInicio: '2026-10-01',
      vigenciaFim: null,
      escopoAprovado: false,
    };
    const results = [[catNovo], []];
    const limit = jest.fn(() => Promise.resolve(results.shift()));
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({ orderBy: () => ({ limit }) }),
        }),
      }),
    };
    const svc = new FiscalNormativeCatalogService({ db } as never);
    const r = await svc.resolverRegraVigente({
      tipo: 'DIFAL',
      uf: 'BA',
      competencia: '2026-10',
      chave: K,
    });
    // O DIFAL vigente no catálogo anterior não é encontrado: defeito A2.
    expect(r).toBeNull();
  });
});

describe('resolverRegraPorData (novo)', () => {
  it('catálogo novo sem a chave não oculta a regra do catálogo anterior', () => {
    const doAnterior = regra({ id: 'difal-antigo', catalogoVersaoId: 'cat1' });
    const outraChave = regra({
      id: 'antecipacao',
      catalogoVersaoId: 'cat2',
      chave: 'ANTECIPACAO',
      catalogoVigenciaInicio: '2026-10-01',
      vigenciaInicio: '2026-10-01',
    });
    const r = resolverRegraPorData([doAnterior, outraChave], {
      chave: K,
      data: '2026-10-20',
    });
    expect(r.estado).toBe('DEFINITIVA');
    expect(r.regra?.id).toBe('difal-antigo');
  });

  it('rascunho de antecipação convive com DIFAL vigente e não é usado', () => {
    const r = resolverRegraPorData(
      [
        regra({ id: 'aprovada' }),
        regra({
          id: 'rascunho',
          revisao: 2,
          vigenciaInicio: '2026-10-01',
          catalogoVigenciaInicio: '2026-10-01',
          aprovada: false,
          conteudo: { aliquota: '21.00' },
        }),
      ],
      { chave: K, data: '2026-10-20' },
    );
    expect(r.estado).toBe('DEFINITIVA');
    expect(r.regra?.id).toBe('aprovada');
    expect(r.rascunhosIgnorados.map((x) => x.id)).toEqual(['rascunho']);
  });

  it('só rascunho vigente é PENDENTE_APROVACAO, nunca definitiva', () => {
    const r = resolverRegraPorData([regra({ aprovada: false })], {
      chave: K,
      data: '2026-10-20',
    });
    expect(r.estado).toBe('PENDENTE_APROVACAO');
    expect(r.regra).toBeNull();
  });

  it('mudança normativa no meio do mês: cada data resolve a sua regra', () => {
    const antes = regra({
      id: 'antes',
      vigenciaFim: '2026-10-14',
      conteudo: { aliquota: '20.50' },
    });
    const depois = regra({
      id: 'depois',
      catalogoVersaoId: 'cat2',
      vigenciaInicio: '2026-10-15',
      catalogoVigenciaInicio: '2026-10-15',
      conteudo: { aliquota: '22.00' },
    });
    const c = [antes, depois];
    expect(
      resolverRegraPorData(c, { chave: K, data: '2026-10-14' }).regra?.id,
    ).toBe('antes');
    expect(
      resolverRegraPorData(c, { chave: K, data: '2026-10-15' }).regra?.id,
    ).toBe('depois');
    expect(
      resolverRegraPorData(c, { chave: K, data: '2026-10-31' }).regra?.id,
    ).toBe('depois');
  });

  it('regra revogada (vigência encerrada) não resolve após o fim e resolve antes dele', () => {
    const c = [regra({ vigenciaFim: '2026-09-30' })];
    expect(
      resolverRegraPorData(c, { chave: K, data: '2026-09-30' }).estado,
    ).toBe('DEFINITIVA');
    expect(
      resolverRegraPorData(c, { chave: K, data: '2026-10-01' }).estado,
    ).toBe('SEM_REGRA');
  });

  it('lacuna de vigência dá SEM_REGRA, sem fallback para outra', () => {
    const c = [
      regra({ id: 'a', vigenciaFim: '2026-03-31' }),
      regra({
        id: 'b',
        vigenciaInicio: '2026-06-01',
        catalogoVigenciaInicio: '2026-06-01',
      }),
    ];
    expect(
      resolverRegraPorData(c, { chave: K, data: '2026-04-15' }).estado,
    ).toBe('SEM_REGRA');
  });

  it('vigência efetiva é a interseção com a do catálogo', () => {
    const c = [regra({ catalogoVigenciaFim: '2026-06-30' })];
    expect(
      resolverRegraPorData(c, { chave: K, data: '2026-07-01' }).estado,
    ).toBe('SEM_REGRA');
  });

  it('empate aprovado com conteúdos distintos é AMBIGUA e lista candidatas', () => {
    const r = resolverRegraPorData(
      [
        regra({ id: 'a' }),
        regra({
          id: 'b',
          catalogoVersaoId: 'cat2',
          conteudo: { aliquota: '19.00' },
        }),
      ],
      { chave: K, data: '2026-10-20' },
    );
    expect(r.estado).toBe('AMBIGUA');
    expect(r.candidatas.map((x) => x.id).sort()).toEqual(['a', 'b']);
  });

  it('empate com conteúdo idêntico resolve de forma determinística', () => {
    const r = resolverRegraPorData(
      [regra({ id: 'b' }), regra({ id: 'a', catalogoVersaoId: 'cat2' })],
      { chave: K, data: '2026-10-20' },
    );
    expect(r.estado).toBe('DEFINITIVA');
    expect(r.regra?.id).toBe('a');
  });

  it('maior revisão vence dentro do mesmo catálogo', () => {
    const r = resolverRegraPorData(
      [
        regra({ id: 'r1' }),
        regra({ id: 'r2', revisao: 2, conteudo: { aliquota: '21.00' } }),
      ],
      { chave: K, data: '2026-10-20' },
    );
    expect(r.regra?.id).toBe('r2');
  });

  it('regra inativa é ignorada e data inválida é rejeitada', () => {
    expect(
      resolverRegraPorData([regra({ ativo: false })], {
        chave: K,
        data: '2026-10-20',
      }).estado,
    ).toBe('SEM_REGRA');
    expect(() =>
      resolverRegraPorData([], { chave: K, data: '2026-10' }),
    ).toThrow();
  });

  it('aprovação por regra: aprovar uma hipótese não libera a vizinha do mesmo catálogo', () => {
    // Modelado no mapeamento do serviço: regra.escopoAprovado ?? catalogo.
    const aprovada = regra({
      id: 'antecipacao',
      chave: 'ANTECIPACAO',
      aprovada: true,
    });
    const vizinha = regra({ id: 'difal', aprovada: false });
    const c = [aprovada, vizinha];
    expect(
      resolverRegraPorData(c, { chave: 'ANTECIPACAO', data: '2026-10-20' })
        .estado,
    ).toBe('DEFINITIVA');
    expect(
      resolverRegraPorData(c, { chave: K, data: '2026-10-20' }).estado,
    ).toBe('PENDENTE_APROVACAO');
  });
});
