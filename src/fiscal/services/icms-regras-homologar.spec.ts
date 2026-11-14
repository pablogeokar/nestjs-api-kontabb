import { ConflictException } from '@nestjs/common';
import {
  fiscalCatalogosVersoes,
  fiscalRegrasVersoes,
} from '../../database/schema';
import { IcmsRegrasService } from './icms-regras.service';

const enquadramento = {
  ncm: '19053100',
  cest: '1705302',
  regime: 'LUCRO_REAL',
  uf_origem: 'SE',
  origem_mercadoria: '0',
  tratamento: 'APLICAVEL',
  aliquota_interna: '20.5',
  fundamento: 'RICMS-BA, art. 321',
  confirmado_fiscalmente: true,
};

function catalogo(over: Record<string, unknown> = {}) {
  return {
    id: 'cat1',
    tipo: 'DIFAL',
    uf: 'BA',
    vigenciaInicio: '2026-10-01',
    vigenciaFim: '2026-10-31',
    escopoAprovado: false,
    aprovadoPor: null,
    ...over,
  };
}
function regra(over: Record<string, unknown> = {}) {
  return {
    id: 'reg1',
    catalogoVersaoId: 'cat1',
    chave: 'ANTECIPACAO_PARCIAL',
    revisao: 2,
    conteudo: { enquadramentos: [enquadramento] },
    fonte: 'RICMS-BA',
    fonteUrl: 'https://exemplo.gov.br/norma',
    vigenciaInicio: '2026-10-01',
    vigenciaFim: '2026-10-31',
    escopoAprovado: null,
    aprovadoPor: null,
    aprovadoEm: null,
    ...over,
  };
}

// tx falso: cada `.limit()` consome o próximo item da fila (catálogo, regra...).
function fakeDb(fila: unknown[][]) {
  const updates: Array<{ table: unknown; set: Record<string, unknown> }> = [];
  const inserts: unknown[] = [];
  const limit = jest.fn(() => Promise.resolve(fila.shift() ?? []));
  const chain = { limit, orderBy: () => ({ limit }) };
  const tx = {
    execute: jest.fn().mockResolvedValue(undefined),
    select: () => ({ from: () => ({ where: () => chain }) }),
    update: (table: unknown) => ({
      set: (set: Record<string, unknown>) => {
        updates.push({ table, set });
        return { where: () => Promise.resolve() };
      },
    }),
    insert: () => ({
      values: (v: unknown) => {
        inserts.push(v);
        return { returning: () => Promise.resolve([catalogo()]) };
      },
    }),
  };
  return {
    updates,
    inserts,
    db: { transaction: (cb: (t: typeof tx) => unknown) => cb(tx) },
  };
}

const input = { uf: 'BA', competencia: '2026-10', expectedRevision: 2 };

describe('IcmsRegrasService.homologar — aprovação por regra', () => {
  it('aprova só a regra e não marca o catálogo como aprovado', async () => {
    const f = fakeDb([[catalogo()], [regra()]]);
    const service = new IcmsRegrasService(f as never);
    const out = await service.homologar(input as never, 'u1');

    expect(out).toMatchObject({ escopoAprovado: true, revisao: 2 });
    const daRegra = f.updates.find((u) => u.table === fiscalRegrasVersoes)!;
    expect(daRegra.set).toMatchObject({
      escopoAprovado: true,
      aprovadoPor: 'u1',
    });
    expect(daRegra.set.aprovadoEm).toBeInstanceOf(Date);
    const doCatalogo = f.updates.find(
      (u) => u.table === fiscalCatalogosVersoes,
    )!;
    expect(doCatalogo.set).not.toHaveProperty('escopoAprovado');
    expect(doCatalogo.set).not.toHaveProperty('aprovadoPor');
    expect(doCatalogo.set.hashConteudo).toMatch(/^[0-9a-f]{64}$/);
  });

  it('o hash muda quando muda a fonte ou a vigência, não só os enquadramentos', async () => {
    const hash = async (r: Record<string, unknown>) => {
      const f = fakeDb([[catalogo()], [regra(r)]]);
      await new IcmsRegrasService(f as never).homologar(input as never, 'u1');
      return f.updates.find((u) => u.table === fiscalCatalogosVersoes)!.set
        .hashConteudo;
    };
    const base = await hash({});
    expect(await hash({ fonteUrl: 'https://exemplo.gov.br/outra' })).not.toBe(
      base,
    );
    expect(await hash({ vigenciaFim: '2026-10-15' })).not.toBe(base);
    expect(await hash({})).toBe(base);
  });

  it('rejeita regra já homologada individualmente', async () => {
    const f = fakeDb([[catalogo()], [regra({ escopoAprovado: true })]]);
    await expect(
      new IcmsRegrasService(f as never).homologar(input as never, 'u1'),
    ).rejects.toThrow(ConflictException);
    expect(f.updates).toHaveLength(0);
  });

  it('rejeita regra herdada de catálogo legado já homologado em bloco', async () => {
    const f = fakeDb([[catalogo({ escopoAprovado: true })], [regra()]]);
    await expect(
      new IcmsRegrasService(f as never).homologar(input as never, 'u1'),
    ).rejects.toThrow('Regra já homologada');
  });

  it('regra com aprovação própria falsa prevalece sobre catálogo aprovado', async () => {
    const f = fakeDb([
      [catalogo({ escopoAprovado: true })],
      [regra({ escopoAprovado: false })],
    ]);
    await expect(
      new IcmsRegrasService(f as never).homologar(input as never, 'u1'),
    ).resolves.toMatchObject({ escopoAprovado: true });
  });

  it('rejeita revisão desatualizada', async () => {
    const f = fakeDb([[catalogo()], [regra({ revisao: 3 })]]);
    await expect(
      new IcmsRegrasService(f as never).homologar(input as never, 'u1'),
    ).rejects.toThrow('A revisão mudou');
    expect(f.updates).toHaveLength(0);
  });
});

describe('IcmsRegrasService.salvar — revisão homologada é imutável', () => {
  it('bloqueia nova revisão sobre regra aprovada mesmo com catálogo não aprovado', async () => {
    const f = fakeDb([[catalogo()], [regra({ escopoAprovado: true })]]);
    await expect(
      new IcmsRegrasService(f as never).salvar(
        {
          ...input,
          fonte: 'RICMS-BA',
          enquadramentos: [enquadramento],
        } as never,
        'u1',
      ),
    ).rejects.toThrow('Esta regra já foi homologada');
    expect(f.inserts).toHaveLength(0);
  });
});

describe('IcmsRegrasService — competência dentro de vigência anual', () => {
  const anual = { vigenciaInicio: '2026-01-01', vigenciaFim: '2026-12-31' };

  it('salvar em 2026-10 grava a revisão na vigência que contém a competência', async () => {
    const f = fakeDb([[catalogo(anual)], [regra({ ...anual, revisao: 2 })]]);
    const out = await new IcmsRegrasService(f as never).salvar(
      {
        uf: 'BA',
        competencia: '2026-10',
        fonte: 'RICMS-BA',
        fonteUrl: 'https://exemplo.gov.br/norma',
        expectedRevision: 2,
        enquadramentos: [enquadramento],
      } as never,
      'u1',
    );
    expect(out).toMatchObject({ revisao: 3, ...anual });
    expect(f.inserts).toHaveLength(1);
    expect(f.inserts[0]).toMatchObject({ revisao: 3, ...anual });
  });

  it('homologar em 2026-10 encontra o catálogo anual', async () => {
    const f = fakeDb([[catalogo(anual)], [regra({ ...anual, revisao: 2 })]]);
    await expect(
      new IcmsRegrasService(f as never).homologar(
        { uf: 'BA', competencia: '2026-10', expectedRevision: 2 } as never,
        'u1',
      ),
    ).resolves.toMatchObject({ escopoAprovado: true, revisao: 2 });
  });
});
