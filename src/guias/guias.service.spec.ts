import { avaliarVinculoGuiaSimples, GuiasService } from './guias.service';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

const candidata = {
  id: 'guia-fiscal-1',
  valorTotal: '100.00',
  dataVencimento: '2026-10-20',
  tipoGuia: 'DAS',
  tributo: 'DAS_SIMPLES',
  cancelada: false,
  guiaUploadId: null,
};

describe('avaliarVinculoGuiaSimples', () => {
  it('vincula quando tipo, valor e vencimento conferem', () => {
    expect(
      avaliarVinculoGuiaSimples({
        tipo: 'DAS',
        valorUpload: '100.00',
        vencimentoUpload: '2026-10-20',
        candidata,
      }),
    ).toMatchObject({
      status: 'VINCULADO',
      guiaFiscalId: candidata.id,
      diferenca: '0.00',
    });
  });

  it('aceita diferença de até dois centavos e preserva a diferença', () => {
    expect(
      avaliarVinculoGuiaSimples({
        tipo: 'DAS',
        valorUpload: '100.02',
        vencimentoUpload: '2026-10-20',
        candidata,
      }),
    ).toMatchObject({ status: 'VINCULADO', diferenca: '0.02' });
  });

  it('não vincula valor divergente', () => {
    expect(
      avaliarVinculoGuiaSimples({
        tipo: 'DAS',
        valorUpload: '100.03',
        vencimentoUpload: '2026-10-20',
        candidata,
      }),
    ).toMatchObject({
      status: 'DIVERGENTE',
      guiaFiscalId: null,
      diferenca: '0.03',
    });
  });

  it('requer confirmação quando o valor não foi extraído', () => {
    expect(
      avaliarVinculoGuiaSimples({
        tipo: 'DAS',
        valorUpload: null,
        vencimentoUpload: '2026-10-20',
        candidata,
      }).status,
    ).toBe('PENDENTE_CONFIRMACAO');
  });

  it('requer confirmação quando o vencimento diverge', () => {
    expect(
      avaliarVinculoGuiaSimples({
        tipo: 'DAS',
        valorUpload: '100.00',
        vencimentoUpload: '2026-10-21',
        candidata,
      }).status,
    ).toBe('PENDENTE_CONFIRMACAO');
  });

  it('distingue ausência de candidato, vínculo prévio e guia não aplicável', () => {
    expect(
      avaliarVinculoGuiaSimples({
        tipo: 'DAS',
        valorUpload: '100.00',
        vencimentoUpload: null,
        candidata: null,
      }).status,
    ).toBe('SEM_CANDIDATO');
    expect(
      avaliarVinculoGuiaSimples({
        tipo: 'DAS',
        valorUpload: '100.00',
        vencimentoUpload: null,
        candidata: { ...candidata, guiaUploadId: 'upload-1' },
      }).status,
    ).toBe('JA_VINCULADA');
    expect(
      avaliarVinculoGuiaSimples({
        tipo: 'DARF',
        valorUpload: '100.00',
        vencimentoUpload: null,
        candidata: null,
      }).status,
    ).toBe('NAO_APLICAVEL');
  });
});

describe('GuiasService - regime tributário', () => {
  it('bloqueia guia de ICMS para Simples Nacional sem apuração separada', async () => {
    const storage = { upload: jest.fn() };
    const service = new GuiasService(
      {} as never,
      storage as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await service.uploadGuia({
      actorUserId: 'user-1',
      client: {
        id: 'client-1',
        cnpj: '12345678000190',
        razaoSocial: 'Empresa Simples',
        emails: [],
        regimeTributario: 'SIMPLES_NACIONAL',
        apuraIcms: false,
      },
      bytes: Buffer.from('%PDF-1.4'),
      fileName: 'icms.pdf',
      tipo: 'ICMS',
      periodo: '08/2026',
      vencimento: null,
      valorNumerico: null,
      valorLabel: null,
      parcelaLabel: null,
      numeroParcelamento: null,
    });

    expect(result).toEqual({ ok: false, code: 'ICMS_NOT_APPLICABLE' });
    expect(storage.upload).not.toHaveBeenCalled();
  });
});

describe('GuiasService - busca por identificador', () => {
  it.each([
    ['12.345.678/0001-99', '%12345678000199%', true],
    ['ab.12c.d34/ef56-78', '%AB12CD34EF5678%', false],
    ['Empresa', null, false],
  ])(
    'aplica a busca por %s sem perder o contrato anterior',
    async (search, cnpjParam, buscaCpf) => {
      const whereClauses: SQL[] = [];
      let selectIndex = 0;
      const select = jest.fn(() => {
        const index = selectIndex++;
        const query = {
          from: () => query,
          leftJoin: () => query,
          where: (where: SQL) => {
            whereClauses.push(where);
            return index === 0 ? Promise.resolve([{ count: 0 }]) : query;
          },
          orderBy: () => query,
          limit: () => query,
          offset: () => Promise.resolve([]),
        };
        return query;
      });
      const service = new GuiasService(
        { db: { select } } as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );

      await service.listAdminGuias({
        type: '',
        status: '',
        search,
        pagination: { page: 1, pageSize: 15, limit: 15, offset: 0 },
      });

      expect(whereClauses).toHaveLength(2);
      const params = new PgDialect().sqlToQuery(whereClauses[0]).params;
      expect(params).toContain(`%${search}%`);
      if (cnpjParam) {
        expect(params).toContain(cnpjParam);
        expect(params.filter((param) => param === cnpjParam)).toHaveLength(
          buscaCpf ? 2 : 1,
        );
      } else {
        expect(params).not.toContain('%EMPRESA%');
      }
    },
  );
});
