import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { SalvarIcmsRegrasDto } from '../dto/icms-regras.dto';
import {
  IcmsRegrasService,
  validarEnquadramentosIcms,
} from './icms-regras.service';

const row = {
  ncm: '19053100',
  cest: '1705302',
  regime: 'SIMPLES_NACIONAL',
  uf_origem: 'SE',
  origem_mercadoria: '0',
  tratamento: 'APLICAVEL',
  aliquota_interna: '20.5',
  aliquota_interestadual: '12',
  fundamento: 'RICMS-BA, art. 321, VII, b',
  confirmado_fiscalmente: true,
};

describe('cadastro de regras de ICMS', () => {
  it('exige identificação completa e decimal em texto', () => {
    const input = plainToInstance(SalvarIcmsRegrasDto, {
      uf: 'BA',
      competencia: '2026-10',
      fonte: 'RICMS-BA',
      expectedRevision: 1,
      enquadramentos: [row],
    });
    expect(validateSync(input)).toEqual([]);
    expect(
      validateSync(
        plainToInstance(SalvarIcmsRegrasDto, {
          ...input,
          enquadramentos: [{ ...row, ncm: '1905', aliquota_interna: 20.5 }],
        }),
      ),
    ).not.toEqual([]);
  });

  it('rejeita combinação duplicada e alíquotas inconsistentes', () => {
    expect(() => validarEnquadramentosIcms([row, row])).toThrow(
      BadRequestException,
    );
    expect(() =>
      validarEnquadramentosIcms([{ ...row, aliquota_interna: '7' }]),
    ).toThrow(BadRequestException);
    expect(() =>
      validarEnquadramentosIcms([{ ...row, uf_origem: 'ZZ' }]),
    ).toThrow(BadRequestException);
  });

  it('permite usar o ICMS destacado do XML no regime normal', () => {
    expect(() =>
      validarEnquadramentosIcms(
        [{ ...row, regime: 'LUCRO_REAL', aliquota_interestadual: undefined }],
        true,
      ),
    ).not.toThrow();
  });

  it('não permite classificar ST sem CEST identificado', () => {
    expect(() =>
      validarEnquadramentosIcms([
        { ...row, cest: null, tratamento: 'ICMS_ST' },
      ]),
    ).toThrow('informe o CEST');
  });

  it('exige fundamento para a decisão sobre IPI', () => {
    expect(() =>
      validarEnquadramentosIcms([{ ...row, ipi_na_base: 'INCLUIR' }]),
    ).toThrow('fundamente a decisão sobre o IPI');
    expect(() =>
      validarEnquadramentosIcms([
        {
          ...row,
          ipi_na_base: 'EXCLUIR',
          fundamento_ipi: 'Lei 7.014/96, art. 17, § 2º',
        },
      ]),
    ).not.toThrow();
  });

  it('não homologa pendência ou linha sem fundamento', () => {
    expect(() =>
      validarEnquadramentosIcms(
        [{ ...row, tratamento: 'CONFERIR', motivo: 'Revisar CEST' }],
        true,
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      validarEnquadramentosIcms([{ ...row, fundamento: '' }], true),
    ).toThrow(BadRequestException);
    expect(() =>
      validarEnquadramentosIcms(
        [{ ...row, confirmado_fiscalmente: false }],
        true,
      ),
    ).toThrow(BadRequestException);
    expect(() => validarEnquadramentosIcms([row], true)).not.toThrow();
  });

  it('aprova uma linha completa sem exigir que outra linha esteja pronta', () => {
    expect(() =>
      validarEnquadramentosIcms([
        row,
        {
          ...row,
          cest: '1705301',
          tratamento: 'CONFERIR',
          motivo: '',
          fundamento: '',
          confirmado_fiscalmente: false,
        },
      ]),
    ).not.toThrow();
    expect(() =>
      validarEnquadramentosIcms([{ ...row, fundamento: '' }]),
    ).toThrow('informe o fundamento normativo');
    expect(() =>
      validarEnquadramentosIcms([
        { ...row, tratamento: 'CONFERIR', motivo: '' },
      ]),
    ).toThrow('resolva a conferência fiscal');
  });
});
describe('salvamento de um enquadramento por vez', () => {
  function criarServico(
    catalogo: Record<string, unknown> | null,
    regra: Record<string, unknown> | null,
  ) {
    const inserts: Record<string, unknown>[] = [];
    const respostas = [catalogo ? [catalogo] : [], regra ? [regra] : []];
    const tx = {
      execute: jest.fn(),
      select: () => {
        const chain: Record<string, unknown> = {};
        chain.from = () => chain;
        chain.where = () => chain;
        chain.orderBy = () => chain;
        chain.limit = () => Promise.resolve(respostas.shift() ?? []);
        return chain;
      },
      insert: () => ({
        values: (value: Record<string, unknown>) => {
          inserts.push(value);
          return {
            returning: () => Promise.resolve([{ id: 'cat-1', ...value }]),
          };
        },
      }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    };
    const service = new IcmsRegrasService({
      db: { transaction: (fn: (t: typeof tx) => unknown) => fn(tx) },
    } as never);
    return { service, inserts };
  }
  const catalogo = {
    id: 'cat-1',
    escopoAprovado: false,
    vigenciaInicio: '2026-01-01',
    vigenciaFim: '2026-12-31',
    fonte: 'RICMS-BA',
    fonteUrl: 'https://x.gov.br',
  };
  const query = { uf: 'BA', competencia: '2026-11' };

  it('inclui a linha nova sem reenviar as demais e aumenta a revisão', async () => {
    const { service, inserts } = criarServico(catalogo, {
      revisao: 3,
      fonte: 'RICMS-BA',
      fonteUrl: 'https://x.gov.br',
      escopoAprovado: null,
      conteudo: { enquadramentos: [row], reducao_me_epp: '20' },
    });
    const nova = { ...row, ncm: '61121100', cest: null };
    const result = await service.salvarEnquadramento(
      { ...query, expectedRevision: 3, enquadramento: nova } as never,
      'user-1',
    );
    expect(result.revisao).toBe(4);
    expect(result.enquadramentos).toHaveLength(2);
    expect(inserts[0]).toMatchObject({ revisao: 4, escopoAprovado: false });
    expect(
      (inserts[0].conteudo as Record<string, unknown>).reducao_me_epp,
    ).toBe('20');
  });

  it('mantém aprovadas as linhas de uma revisão homologada em bloco', async () => {
    const { service } = criarServico(catalogo, {
      revisao: 1,
      fonte: 'RICMS-BA',
      fonteUrl: 'https://x.gov.br',
      escopoAprovado: true,
      conteudo: {
        enquadramentos: [{ ...row, confirmado_fiscalmente: undefined }],
      },
    });
    const nova = {
      ...row,
      ncm: '61121100',
      cest: null,
      tratamento: 'CONFERIR',
      confirmado_fiscalmente: false,
      fundamento: undefined,
    };
    const result = await service.salvarEnquadramento(
      { ...query, expectedRevision: 1, enquadramento: nova } as never,
      'user-1',
    );
    expect(result.enquadramentos[0].confirmado_fiscalmente).toBe(true);
    expect(result.enquadramentos[1].confirmado_fiscalmente).toBe(false);
  });

  it('aceita outra UF e rejeita origem igual à UF de apuração', async () => {
    const { service, inserts } = criarServico(catalogo, {
      revisao: 0,
      fonte: 'RICMS-PE',
      fonteUrl: 'https://x.gov.br',
      escopoAprovado: null,
      conteudo: { enquadramentos: [] },
    });
    const pe = { ...row, uf_origem: 'BA' };
    const result = await service.salvarEnquadramento(
      {
        uf: 'PE',
        competencia: '2026-11',
        expectedRevision: 0,
        enquadramento: pe,
      } as never,
      'user-1',
    );
    expect(result.enquadramentos).toHaveLength(1);
    expect(inserts[0]).toBeDefined();
    await expect(
      criarServico(catalogo, null).service.salvarEnquadramento(
        {
          uf: 'PE',
          competencia: '2026-11',
          expectedRevision: 0,
          enquadramento: { ...row, uf_origem: 'PE' },
        } as never,
        'user-1',
      ),
    ).rejects.toThrow(/interestadual/);
  });

  it('rejeita revisão desatualizada e chave duplicada', async () => {
    const regra = {
      revisao: 2,
      fonte: 'RICMS-BA',
      fonteUrl: 'https://x.gov.br',
      escopoAprovado: null,
      conteudo: { enquadramentos: [row] },
    };
    await expect(
      criarServico(catalogo, regra).service.salvarEnquadramento(
        { ...query, expectedRevision: 1, enquadramento: row } as never,
        'u',
      ),
    ).rejects.toThrow(/outro usuário/);
    await expect(
      criarServico(catalogo, regra).service.salvarEnquadramento(
        {
          ...query,
          expectedRevision: 2,
          enquadramento: { ...row, ncm: '61121100' },
          chaveAnterior: { ...row, ncm: '61121100' },
        } as never,
        'u',
      ),
    ).resolves.toBeDefined();
  });
});
