import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import {
  codSituacaoSpedCte,
  decidirEscrituracaoCte,
  FiscalCteService,
} from './fiscal-cte.service';
import { documentosFiscaisCteEscrituracao } from '../../database/schema';

describe('FiscalCteService', () => {
  const baseDecision = {
    clienteCnpjCpf: '12.345.678/0001-95',
    regimeTributario: 'LUCRO_REAL' as const,
    apuraIcms: true,
    emitenteCnpjCpf: '98765432000110',
    tomadorCnpjCpf: '12345678000195',
    situacao: 'AUTORIZADA' as const,
    tpCte: '0',
    tpServ: '0',
    cstIcms: '00',
    csosnIcms: null,
  };

  it('escritura como entrada e permite crédito quando o cliente é o tomador', () => {
    expect(decidirEscrituracaoCte(baseDecision)).toEqual({
      escrituravel: true,
      motivoNaoEscrituravel: null,
      tipoOperacao: 'ENTRADA',
      papelCliente: 'TOMADOR',
      creditaIcms: true,
      debitaIcms: false,
      revisaoNecessaria: false,
    });
  });

  it('escritura como saída (prestação) quando o cliente é o emitente/prestador', () => {
    expect(
      decidirEscrituracaoCte({
        ...baseDecision,
        // Transportadora: o cliente é o próprio emitente do CT-e.
        emitenteCnpjCpf: '12345678000195',
        tomadorCnpjCpf: '98765432000110',
      }),
    ).toEqual({
      escrituravel: true,
      motivoNaoEscrituravel: null,
      tipoOperacao: 'SAIDA',
      papelCliente: 'PRESTADOR',
      creditaIcms: false,
      debitaIcms: true,
      revisaoNecessaria: false,
    });
  });

  it('mantém armazenado, mas fora da escrituração, quando o cliente não é tomador nem prestador', () => {
    expect(
      decidirEscrituracaoCte({
        ...baseDecision,
        emitenteCnpjCpf: '11111111000111',
        tomadorCnpjCpf: '98765432000110',
      }),
    ).toMatchObject({
      escrituravel: false,
      motivoNaoEscrituravel: 'CLIENTE_NAO_E_TOMADOR_NEM_PRESTADOR',
      papelCliente: 'NENHUM',
      creditaIcms: false,
    });
  });

  it('zera o crédito do Simples Nacional sem apuração separada', () => {
    expect(
      decidirEscrituracaoCte({
        ...baseDecision,
        regimeTributario: 'SIMPLES_NACIONAL',
        apuraIcms: false,
      }),
    ).toMatchObject({ escrituravel: true, creditaIcms: false });
  });

  it('envia subcontratação e redespacho para revisão sem crédito automático', () => {
    for (const tpServ of ['1', '2', '3']) {
      expect(decidirEscrituracaoCte({ ...baseDecision, tpServ })).toMatchObject(
        {
          escrituravel: true,
          creditaIcms: false,
          revisaoNecessaria: true,
        },
      );
    }
  });

  it('registra cancelado e denegado sem crédito e com COD_SIT correto', () => {
    expect(
      decidirEscrituracaoCte({ ...baseDecision, situacao: 'CANCELADA' }),
    ).toMatchObject({ escrituravel: true, creditaIcms: false });
    expect(codSituacaoSpedCte('CANCELADA', '0')).toBe('02');
    expect(codSituacaoSpedCte('DENEGADA', '0')).toBe('04');
    expect(codSituacaoSpedCte('AUTORIZADA', '1')).toBe('06');
  });

  it.each([
    ['1', '150.75'],
    ['2', '-150.75'],
    ['3', '150.75'],
  ])(
    'prepara CT-e tipo %s com o sinal fiscal esperado',
    async (tpCte, expectedValue) => {
      const service = createService();
      const preparada = await service.prepararEscrituracao({
        clienteId: 'cliente-1',
        clienteCnpjCpf: '12345678000195',
        regimeTributario: 'LUCRO_REAL',
        apuraIcms: true,
        situacao: 'AUTORIZADA',
        cte: cteData(tpCte as '1' | '2' | '3'),
      });

      expect(preparada.values.valorTotalServico).toBe(expectedValue);
      expect(preparada.values.chaveCteReferenciado).toHaveLength(44);
    },
  );

  it('marca fallback de CFOP para revisão', async () => {
    const service = createService({
      cfop: '1949',
      revisaoNecessaria: true,
      origemResolucao: 'FALLBACK',
    });
    const preparada = await service.prepararEscrituracao({
      clienteId: 'cliente-1',
      clienteCnpjCpf: '12345678000195',
      regimeTributario: 'LUCRO_REAL',
      apuraIcms: true,
      situacao: 'AUTORIZADA',
      cte: cteData('0'),
    });

    expect(preparada.values.cfop).toBe('1949');
    expect(preparada.values.cfopRevisaoNecessaria).toBe(true);
    expect(preparada.escrituracaoStatus).toBe('PENDENTE_REVISAO');
  });

  it('D190 força os filtros de escriturável e autorizado', async () => {
    let where: SQL | undefined;
    const database = {
      db: {
        select: jest.fn().mockReturnValue({
          from: jest.fn().mockReturnValue({
            innerJoin: jest.fn().mockReturnValue({
              where: jest.fn((condition: SQL) => {
                where = condition;
                return {
                  groupBy: jest.fn().mockReturnValue({
                    orderBy: jest.fn().mockResolvedValue([]),
                  }),
                };
              }),
            }),
          }),
        }),
      },
    };
    const service = new FiscalCteService(database as never, {} as never);

    await service.getD190({ clienteId: 'cliente-1' });

    const query = new PgDialect().sqlToQuery(where!);
    expect(query.sql).toContain('escrituravel');
    expect(query.sql).toContain('situacao');
    expect(query.params).toEqual(expect.arrayContaining([true, 'AUTORIZADA']));
  });

  it('reprocessa a mesma escrituração por upsert sem criar uma segunda linha', async () => {
    const service = createService();
    const preparada = await service.prepararEscrituracao({
      clienteId: 'cliente-1',
      clienteCnpjCpf: '12345678000195',
      regimeTributario: 'LUCRO_REAL',
      apuraIcms: true,
      situacao: 'AUTORIZADA',
      cte: cteData('0'),
    });
    const onConflictDoUpdate = jest.fn().mockResolvedValue(undefined);
    const insert = jest.fn(() => ({
      values: jest.fn().mockReturnValue({ onConflictDoUpdate }),
    }));
    const executor = {
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
      insert,
      update: jest.fn().mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue(undefined),
        }),
      }),
    };
    const input = {
      documentoFiscalId: 'documento-1',
      clienteId: 'cliente-1',
      chaveAcesso: '1'.repeat(44),
      preparada,
    };

    await service.persistirEscrituracao(executor as never, input);
    await service.persistirEscrituracao(executor as never, input);

    expect(insert).toHaveBeenNthCalledWith(1, documentosFiscaisCteEscrituracao);
    expect(onConflictDoUpdate).toHaveBeenCalledTimes(2);
    expect(onConflictDoUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        target: documentosFiscaisCteEscrituracao.documentoFiscalId,
      }),
    );
  });
});

function createService(
  cfop = {
    cfop: '1352',
    revisaoNecessaria: false,
    origemResolucao: 'GLOBAL',
  },
) {
  return new FiscalCteService(
    {} as never,
    {
      resolverCfopEquivalenteDetalhado: jest.fn().mockResolvedValue(cfop),
    } as never,
  );
}

function cteData(tpCte: '0' | '1' | '2' | '3') {
  return {
    emitenteCnpjCpf: '98765432000110',
    tomadorCnpjCpf: '12345678000195',
    tomadorPapel: 'REMETENTE' as const,
    tpCte,
    tpServ: '0' as const,
    modal: '01',
    cfop: '5352',
    valorTotalServico: '150.75',
    valorReceber: '145.00',
    cstIcms: '00',
    csosnIcms: null,
    valorBcIcms: '150.75',
    aliquotaIcms: '12.0000',
    valorIcms: '18.09',
    valorTotalTributos: '18.09',
    chaveCteReferenciado:
      tpCte === '0' ? null : '29260812345678000195570010000001231123456785',
    codigoMunicipioOrigem: '2927408',
    codigoMunicipioDestino: '2910800',
  };
}
