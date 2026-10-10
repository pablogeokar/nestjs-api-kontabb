import { BadRequestException } from '@nestjs/common';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { FiscalNormativeCatalogService } from './fiscal-normative-catalog.service';

// Linha de catálogo como o banco a devolveria (snake→camel já aplicado pelo
// drizzle). Os campos opcionais recebem defaults coerentes com o schema.
type CatalogoRow = {
  id: string;
  tipo: string;
  uf: string;
  codigo: string;
  descricao?: string | null;
  fonte: string;
  fonteUrl?: string | null;
  hashConteudo?: string | null;
  conteudo?: Record<string, unknown>;
  vigenciaInicio: string;
  vigenciaFim?: string | null;
  escopoAprovado: boolean;
  aprovadoPor?: string | null;
};

type RegraRow = {
  id: string;
  catalogoVersaoId: string;
  chave: string;
  revisao: number;
  conteudo?: Record<string, unknown>;
  fonte: string;
  fonteUrl?: string | null;
  responsavelPor?: string | null;
  vigenciaInicio: string;
  vigenciaFim?: string | null;
};

// Renderiza a cláusula WHERE capturada em SQL + params, para asserções sobre a
// seleção por COMPETÊNCIA (que a competência entra na comparação de vigência).
function renderWhere(captured: { where?: SQL }): {
  sql: string;
  params: unknown[];
} {
  const dialect = new PgDialect();
  if (!captured.where) return { sql: '', params: [] };
  return dialect.sqlToQuery(captured.where);
}

// DB falso que registra a cláusula where e a direção do orderBy, e devolve as
// linhas filtradas EM MEMÓRIA pela própria janela de vigência — de modo que o
// teste exercite a semântica "a versão cuja vigência contém a competência",
// não apenas a forma da query. A primeira chamada a `select` resolve o
// catálogo; a segunda (quando houver) resolve as revisões de regra.
function createDb(opts: {
  catalogo: CatalogoRow[];
  regras?: RegraRow[];
}) {
  const captures: Array<{ where?: SQL; orderByDesc: boolean }> = [];

  // Aplica a MESMA regra do serviço: início <= competência e (fim nulo OU fim
  // >= competência). A competência é o 1º dia do mês ('YYYY-MM-01').
  const vigente = (
    row: { vigenciaInicio: string; vigenciaFim?: string | null },
    competencia: string,
  ) =>
    row.vigenciaInicio <= competencia &&
    (row.vigenciaFim == null || row.vigenciaFim >= competencia);

  const db = {
    select: jest.fn().mockImplementation(() => {
      // O serviço resolve o início/fim via comparação SQL; aqui simulamos o
      // resultado filtrando/ordenando em memória pela competência capturada no
      // where renderizado. A fonte (catálogo × regras) é escolhida pela TABELA
      // referenciada na cláusula WHERE, não pela ordem da chamada — assim
      // múltiplas resoluções de catálogo no mesmo teste funcionam.
      return {
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockImplementation((clause: SQL) => {
            const capture = { where: clause, orderByDesc: false };
            captures.push(capture);
            const rendered = renderWhere(capture);
            const competencia = String(
              rendered.params.find(
                (p) => typeof p === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p),
              ) ?? '',
            );
            const isRegra = rendered.sql.includes('fiscal_regras_versoes');
            const source = isRegra ? (opts.regras ?? []) : opts.catalogo;
            const filtradas = source
              .filter((r) => vigente(r, competencia))
              // Mais nova (início desc) que ainda cobre a competência.
              .sort((a, b) => (a.vigenciaInicio < b.vigenciaInicio ? 1 : -1));
            return {
              orderBy: jest.fn().mockImplementation(() => {
                capture.orderByDesc = true;
                return {
                  limit: jest
                    .fn()
                    .mockImplementation(() =>
                      Promise.resolve(filtradas.slice(0, 1)),
                    ),
                };
              }),
            };
          }),
        }),
      };
    }),
  };

  return { db: { db }, captures };
}

const CATALOGO_SP_2024 = (): CatalogoRow => ({
  id: 'cat-2024',
  tipo: 'DIFAL',
  uf: 'SP',
  codigo: 'SP-DIFAL-2024',
  descricao: 'DIFAL SP vigência 2024',
  fonte: 'LC190/2022',
  fonteUrl: 'https://exemplo/2024',
  hashConteudo: null,
  conteudo: { aliquota_interna: '18.0000' },
  vigenciaInicio: '2024-01-01',
  vigenciaFim: '2025-12-31',
  escopoAprovado: true,
  aprovadoPor: 'user-1',
});

const CATALOGO_SP_2026 = (): CatalogoRow => ({
  id: 'cat-2026',
  tipo: 'DIFAL',
  uf: 'SP',
  codigo: 'SP-DIFAL-2026',
  descricao: 'DIFAL SP vigência 2026',
  fonte: 'LC190/2022-rev',
  fonteUrl: 'https://exemplo/2026',
  hashConteudo: null,
  conteudo: { aliquota_interna: '20.0000' },
  vigenciaInicio: '2026-01-01',
  vigenciaFim: null,
  escopoAprovado: true,
  aprovadoPor: 'user-1',
});

describe('FiscalNormativeCatalogService', () => {
  describe('resolução por competência (R3.1)', () => {
    it('escolhe a versão cuja vigência contém a competência consultada', async () => {
      const { db } = createDb({
        catalogo: [CATALOGO_SP_2024(), CATALOGO_SP_2026()],
      });
      const service = new FiscalNormativeCatalogService(db as never);

      const versao = await service.resolverVersaoVigente({
        tipo: 'DIFAL',
        uf: 'SP',
        competencia: '2024-06',
      });

      expect(versao?.id).toBe('cat-2024');
      expect(versao?.codigo).toBe('SP-DIFAL-2024');
      expect(versao?.competencia).toBe('2024-06-01');
    });

    it('NÃO retorna a última versão para uma competência histórica', async () => {
      // Catálogo tem a versão 2026 (mais nova) e a 2024. Uma competência de
      // 2024 DEVE resolver a 2024, nunca a 2026 (design §7).
      const { db } = createDb({
        catalogo: [CATALOGO_SP_2024(), CATALOGO_SP_2026()],
      });
      const service = new FiscalNormativeCatalogService(db as never);

      const historica = await service.resolverVersaoVigente({
        tipo: 'DIFAL',
        uf: 'SP',
        competencia: '2024-11',
      });
      const atual = await service.resolverVersaoVigente({
        tipo: 'DIFAL',
        uf: 'SP',
        competencia: '2026-03',
      });

      expect(historica?.id).toBe('cat-2024');
      expect(historica?.codigo).toBe('SP-DIFAL-2024');
      // A versão mais nova NÃO vazou para a competência histórica.
      expect(historica?.id).not.toBe('cat-2026');
      // E a competência atual resolve a versão nova.
      expect(atual?.id).toBe('cat-2026');
    });

    it('resolve nas datas de fronteira da vigência (início e fim inclusivos)', async () => {
      const { db } = createDb({
        catalogo: [CATALOGO_SP_2024(), CATALOGO_SP_2026()],
      });
      const service = new FiscalNormativeCatalogService(db as never);

      // Fronteira de início da 2024.
      const inicio = await service.resolverVersaoVigente({
        tipo: 'DIFAL',
        uf: 'SP',
        competencia: '2024-01',
      });
      // Fronteira de fim da 2024 (vigenciaFim = 2025-12-31; dez/2025 ainda
      // cabe, pois a competência 2025-12-01 <= 2025-12-31).
      const fim = await service.resolverVersaoVigente({
        tipo: 'DIFAL',
        uf: 'SP',
        competencia: '2025-12',
      });

      expect(inicio?.id).toBe('cat-2024');
      expect(fim?.id).toBe('cat-2024');
    });

    it('devolve null quando nenhuma vigência cobre a competência (sem fallback para o último)', async () => {
      const { db } = createDb({
        catalogo: [CATALOGO_SP_2024()],
      });
      const service = new FiscalNormativeCatalogService(db as never);

      // Competência anterior ao início da única vigência cadastrada.
      const versao = await service.resolverVersaoVigente({
        tipo: 'DIFAL',
        uf: 'SP',
        competencia: '2023-05',
      });

      expect(versao).toBeNull();
    });

    it('a query filtra pela competência (1º dia do mês) e ordena por início desc', async () => {
      const { db, captures } = createDb({
        catalogo: [CATALOGO_SP_2024()],
      });
      const service = new FiscalNormativeCatalogService(db as never);

      await service.resolverVersaoVigente({
        tipo: 'DIFAL',
        uf: 'SP',
        competencia: '2024-06',
      });

      const { params } = renderWhere(captures[0]);
      // A competência entra como '2024-06-01' na comparação de vigência.
      expect(params).toContain('2024-06-01');
      expect(captures[0].orderByDesc).toBe(true);
    });
  });

  describe('escopo aprovado × pendência (R3.5)', () => {
    it('resolverVersaoAprovada rejeita (null) uma versão vigente NÃO aprovada', async () => {
      const naoAprovada: CatalogoRow = {
        ...CATALOGO_SP_2024(),
        escopoAprovado: false,
        aprovadoPor: null,
      };
      const { db } = createDb({ catalogo: [naoAprovada] });
      const service = new FiscalNormativeCatalogService(db as never);

      const aprovada = await service.resolverVersaoAprovada({
        tipo: 'DIFAL',
        uf: 'SP',
        competencia: '2024-06',
      });

      expect(aprovada).toBeNull();
    });

    it('resolverVersaoParaSimulacao devolve a versão vigente NÃO aprovada marcada como pendente', async () => {
      const naoAprovada: CatalogoRow = {
        ...CATALOGO_SP_2024(),
        escopoAprovado: false,
        aprovadoPor: null,
      };
      const { db } = createDb({ catalogo: [naoAprovada] });
      const service = new FiscalNormativeCatalogService(db as never);

      const simulacao = await service.resolverVersaoParaSimulacao({
        tipo: 'DIFAL',
        uf: 'SP',
        competencia: '2024-06',
      });

      expect(simulacao).not.toBeNull();
      expect(simulacao?.escopoAprovado).toBe(false);
      // A versão não aprovada é pendência/simulação, nunca guia definitiva.
      expect(simulacao?.pendente).toBe(true);
    });

    it('resolverCodigo bloqueia quando não há versão aprovada vigente', async () => {
      const naoAprovada: CatalogoRow = {
        ...CATALOGO_SP_2024(),
        escopoAprovado: false,
        aprovadoPor: null,
      };
      const { db } = createDb({ catalogo: [naoAprovada] });
      const service = new FiscalNormativeCatalogService(db as never);

      await expect(
        service.resolverCodigo({
          tipo: 'DIFAL',
          uf: 'SP',
          competencia: '2024-06',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('resolverCodigo devolve o código de uma versão aprovada vigente', async () => {
      const { db } = createDb({ catalogo: [CATALOGO_SP_2024()] });
      const service = new FiscalNormativeCatalogService(db as never);

      const codigo = await service.resolverCodigo({
        tipo: 'DIFAL',
        uf: 'SP',
        competencia: '2024-06',
      });

      expect(codigo).toBe('SP-DIFAL-2024');
    });

    it('uma versão aprovada é marcada como não pendente', async () => {
      const { db } = createDb({ catalogo: [CATALOGO_SP_2024()] });
      const service = new FiscalNormativeCatalogService(db as never);

      const versao = await service.resolverVersaoVigente({
        tipo: 'DIFAL',
        uf: 'SP',
        competencia: '2024-06',
      });

      expect(versao?.escopoAprovado).toBe(true);
      expect(versao?.pendente).toBe(false);
    });
  });

  describe('fontes e vigências (R3.1)', () => {
    it('resolverFonte expõe fonte, URL e hash da versão vigente', async () => {
      const { db } = createDb({ catalogo: [CATALOGO_SP_2024()] });
      const service = new FiscalNormativeCatalogService(db as never);

      const fonte = await service.resolverFonte({
        tipo: 'DIFAL',
        uf: 'SP',
        competencia: '2024-06',
      });

      expect(fonte?.fonte).toBe('LC190/2022');
      expect(fonte?.fonteUrl).toBe('https://exemplo/2024');
      expect(fonte?.escopoAprovado).toBe(true);
    });

    it('resolverVigencia devolve a janela resolvida e o estado de aprovação', async () => {
      const { db } = createDb({ catalogo: [CATALOGO_SP_2024()] });
      const service = new FiscalNormativeCatalogService(db as never);

      const vigencia = await service.resolverVigencia({
        tipo: 'DIFAL',
        uf: 'SP',
        competencia: '2024-06',
      });

      expect(vigencia?.vigenciaInicio).toBe('2024-01-01');
      expect(vigencia?.vigenciaFim).toBe('2025-12-31');
      expect(vigencia?.pendente).toBe(false);
    });
  });

  describe('regras versionadas por competência', () => {
    it('resolve a revisão de regra ancorada na versão de catálogo vigente', async () => {
      const { db } = createDb({
        catalogo: [CATALOGO_SP_2024()],
        regras: [
          {
            id: 'reg-2024',
            catalogoVersaoId: 'cat-2024',
            chave: 'uso-consumo',
            revisao: 1,
            conteudo: { aliquota: '12.0000' },
            fonte: 'LC190/2022',
            vigenciaInicio: '2024-01-01',
            vigenciaFim: '2025-12-31',
          },
        ],
      });
      const service = new FiscalNormativeCatalogService(db as never);

      const regra = await service.resolverRegraVigente({
        tipo: 'DIFAL',
        uf: 'SP',
        competencia: '2024-06',
        chave: 'uso-consumo',
      });

      expect(regra?.id).toBe('reg-2024');
      expect(regra?.escopoAprovado).toBe(true);
      expect(regra?.pendente).toBe(false);
    });

    it('resolverRegraAprovada rejeita quando a versão de catálogo está pendente', async () => {
      const naoAprovada: CatalogoRow = {
        ...CATALOGO_SP_2024(),
        escopoAprovado: false,
        aprovadoPor: null,
      };
      const { db } = createDb({
        catalogo: [naoAprovada],
        regras: [
          {
            id: 'reg-2024',
            catalogoVersaoId: 'cat-2024',
            chave: 'uso-consumo',
            revisao: 1,
            fonte: 'LC190/2022',
            vigenciaInicio: '2024-01-01',
            vigenciaFim: '2025-12-31',
          },
        ],
      });
      const service = new FiscalNormativeCatalogService(db as never);

      const regra = await service.resolverRegraAprovada({
        tipo: 'DIFAL',
        uf: 'SP',
        competencia: '2024-06',
        chave: 'uso-consumo',
      });

      expect(regra).toBeNull();
    });
  });

  describe('validação de entrada', () => {
    it('rejeita competência em formato inválido', async () => {
      const { db } = createDb({ catalogo: [CATALOGO_SP_2024()] });
      const service = new FiscalNormativeCatalogService(db as never);

      await expect(
        service.resolverVersaoVigente({
          tipo: 'DIFAL',
          uf: 'SP',
          competencia: '2024/06',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejeita UF inválida', async () => {
      const { db } = createDb({ catalogo: [CATALOGO_SP_2024()] });
      const service = new FiscalNormativeCatalogService(db as never);

      await expect(
        service.resolverVersaoVigente({
          tipo: 'DIFAL',
          uf: 'Sao Paulo',
          competencia: '2024-06',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
