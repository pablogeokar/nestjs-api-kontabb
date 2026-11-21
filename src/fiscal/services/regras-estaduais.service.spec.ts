import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  RegrasEstaduaisService,
  validarParametrosDifal,
} from './regras-estaduais.service';

const catalogo = {
  id: 'cat-1',
  tipo: 'DIFAL',
  uf: 'BA',
  escopoAprovado: false,
  vigenciaInicio: '2026-01-01',
  vigenciaFim: '2026-12-31',
  fonte: 'RICMS-BA',
  fonteUrl: 'https://x.gov.br',
};
const parametros = {
  aliquota_interna: '20.5',
  base_por_dentro: false,
  base_dupla: true,
  fcp_na_base_por_dentro: false,
  fundamento: 'Lei 7.014/96, art. 15',
};
const query = { uf: 'BA', competencia: '2026-11' };

function criar(respostas: unknown[][]) {
  const inserts: Record<string, unknown>[] = [];
  const fila = [...respostas];
  const tx = {
    execute: jest.fn(),
    select: () => {
      const chain: Record<string, unknown> = {};
      chain.from = () => chain;
      chain.where = () => chain;
      chain.orderBy = () => chain;
      chain.limit = () => Promise.resolve(fila.shift() ?? []);
      return chain;
    },
    insert: () => ({
      values: (valor: Record<string, unknown>) => {
        inserts.push(valor);
        return {
          returning: () => Promise.resolve([{ id: 'novo', ...valor }]),
          then: (ok: (v: unknown) => unknown) => ok(undefined),
        };
      },
    }),
    update: () => ({
      set: () => ({
        where: () => ({ returning: () => Promise.resolve([{ id: 'r1' }]) }),
      }),
    }),
  };
  const service = new RegrasEstaduaisService({
    db: { ...tx, transaction: (fn: (t: typeof tx) => unknown) => fn(tx) },
  } as never);
  return { service, inserts };
}

describe('regras estaduais de DIFAL', () => {
  it('grava rascunho como nova revisão e preserva fontes anteriores', async () => {
    const { service, inserts } = criar([
      [catalogo],
      [
        {
          revisao: 2,
          fonte: 'RICMS-BA',
          fonteUrl: 'https://x.gov.br',
          conteudo: {
            fontes: ['a'],
            dispensa_ativo_me_epp: { fundamento: 'x' },
          },
        },
      ],
      [{ revisao: 2 }],
    ]);
    const r = await service.salvarDifal(
      { ...query, expectedRevision: 2, aprovar: false, parametros } as never,
      'u1',
    );
    expect(r).toMatchObject({ revisao: 3, aprovada: false });
    expect(inserts[0]).toMatchObject({
      escopoAprovado: false,
      aprovadoPor: null,
      chave: 'DIFAL_ENTRADA_CONTRIBUINTE',
    });
    const conteudo = inserts[0].conteudo as Record<string, unknown>;
    expect(conteudo.fontes).toEqual(['a']);
    expect(conteudo.aliquota_interna).toBe('20.5');
    expect(conteudo.dispensa_ativo_me_epp).toBeUndefined();
  });

  it('aprova a revisão com o usuário e exige fundamento e link', async () => {
    const { service, inserts } = criar([[catalogo], []]);
    await service.salvarDifal(
      { ...query, expectedRevision: 0, aprovar: true, parametros } as never,
      'u1',
    );
    expect(inserts[0]).toMatchObject({
      escopoAprovado: true,
      aprovadoPor: 'u1',
    });
    await expect(
      criar([[{ ...catalogo, fonteUrl: null }], []]).service.salvarDifal(
        {
          ...query,
          expectedRevision: 0,
          aprovar: true,
          parametros,
        } as never,
        'u1',
      ),
    ).rejects.toThrow(/link oficial/);
    expect(() =>
      validarParametrosDifal({ ...parametros, fundamento: '' } as never, true),
    ).toThrow(BadRequestException);
  });

  it('rejeita FCP na base sem alíquota e revisão desatualizada', async () => {
    expect(() =>
      validarParametrosDifal(
        { ...parametros, fcp_na_base_por_dentro: true } as never,
        false,
      ),
    ).toThrow(/FCP/);
    await expect(
      criar([
        [catalogo],
        [{ revisao: 5, conteudo: {}, fonte: 'x' }],
      ]).service.salvarDifal(
        { ...query, expectedRevision: 4, aprovar: false, parametros } as never,
        'u1',
      ),
    ).rejects.toThrow(ConflictException);
  });
});

describe('regras estaduais de ST', () => {
  const st = {
    cest: '1705302',
    sujeito_ast: true,
    mva: '40',
    fundamento: 'Conv. 142/18',
  };
  it('cria o catálogo da UF no primeiro cadastro e grava a regra por CEST', async () => {
    const { service, inserts } = criar([[], [], []]);
    const r = await service.salvarSt(
      {
        uf: 'PE',
        competencia: '2026-11',
        expectedRevision: 0,
        aprovar: true,
        fonte: 'RICMS-PE',
        fonteUrl: 'https://pe.gov.br',
        regra: st,
      } as never,
      'u1',
    );
    expect(inserts[0]).toMatchObject({
      tipo: 'ST_FCP',
      uf: 'PE',
      vigenciaInicio: '2026-01-01',
      vigenciaFim: '2026-12-31',
    });
    expect(inserts[1]).toMatchObject({
      chave: '1705302',
      escopoAprovado: true,
    });
    expect(r.revisao).toBe(1);
  });

  it('zera MVA e FCP quando o CEST é excluído da ST', async () => {
    const { service, inserts } = criar([[{ ...catalogo, tipo: 'ST_FCP' }], []]);
    await service.salvarSt(
      {
        ...query,
        expectedRevision: 0,
        aprovar: false,
        regra: { ...st, sujeito_ast: false, aliquota_fcp: '2' },
      } as never,
      'u1',
    );
    const conteudo = inserts[0].conteudo as Record<string, unknown>;
    expect(conteudo).toMatchObject({
      sujeito_ast: false,
      mva: null,
      aliquota_fcp: null,
    });
  });
});
