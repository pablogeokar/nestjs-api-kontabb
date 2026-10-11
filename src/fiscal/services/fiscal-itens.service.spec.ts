import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  FiscalItensService,
  projectC190FromItens,
  type C190ItemRow,
} from './fiscal-itens.service';
import {
  aggregateC190Analitico,
  type C190Analitico,
} from '../sped/fiscal-c190-aggregator';
import { fromScaledInteger } from '../sped/sped-decimal';

describe('FiscalItensService', () => {
  it('serializa filtros de período com os encoders dos timestamps', () => {
    const service = new FiscalItensService({} as never);
    const dataInicio = new Date('2026-08-01T03:00:00.000Z');
    const dataFim = new Date('2026-08-22T02:59:59.999Z');

    const where = (
      service as unknown as {
        buildWhere(input: { dataInicio: Date; dataFim: Date }): SQL;
      }
    ).buildWhere({ dataInicio, dataFim });
    const query = new PgDialect().sqlToQuery(where);

    expect(query.params).toEqual([
      dataInicio.toISOString(),
      dataFim.toISOString(),
    ]);
  });

  it('projeta o C190 pelo agregador comum, mantendo o CFOP XML para auditoria (R5.4)', async () => {
    // A UI deixa de agregar no SQL: busca as linhas por item e projeta pelo
    // mesmo agregador analítico do builder. O CFOP escriturado (1102) compõe a
    // chave; o CFOP XML (5102) é preservado como auditoria.
    const database = createC190Database([
      {
        documento_fiscal_id: 'doc-1',
        tipo_operacao: 'ENTRADA',
        cfop_xml: '5102',
        cstIcms: '00',
        csosnIcms: null,
        origemMercadoria: '0',
        cfop: '1102',
        aliquotaIcms: '18.00',
        percentualReducaoBcIcms: null,
        valorBrutoProduto: '100.00',
        valorDesconto: '0.00',
        valorFrete: '0.00',
        valorSeguro: '0.00',
        valorOutrasDespesas: '0.00',
        valorBcIcms: '100.00',
        valorIcms: '18.00',
        valorBcIcmsSt: '0.00',
        valorIcmsSt: '0.00',
        valorFcpSt: '0.00',
        valorIpi: '0.00',
      },
    ]);
    const service = new FiscalItensService(database as never);

    const report = await service.getC190({ clienteId: 'cliente-1' });

    expect(report.data).toEqual([
      expect.objectContaining({
        tipo_operacao: 'ENTRADA',
        documento_fiscal_id: 'doc-1',
        // R5.2: origem (0) + CST (00) prefixados uma única vez.
        cst_icms_csosn: '000',
        cfop: '1102',
        cfops_xml: ['5102'],
        vl_icms: '18.00',
      }),
    ]);
  });

  it('não duplica a origem quando o item já traz o CST composto (R5.2)', async () => {
    // O item vem com o CST já composto ('000') do banco. A projeção não deve
    // reprefixar a origem (nada de '0000'); e um item puro ('00') da mesma
    // origem/CFOP/alíquota agrega na MESMA linha analítica.
    const database = createC190Database([
      {
        documento_fiscal_id: 'doc-1',
        tipo_operacao: 'ENTRADA',
        cfop_xml: '5102',
        cstIcms: '000',
        csosnIcms: null,
        origemMercadoria: '0',
        cfop: '1102',
        aliquotaIcms: '18.00',
        percentualReducaoBcIcms: null,
        valorBrutoProduto: '100.00',
        valorDesconto: '0.00',
        valorFrete: '0.00',
        valorSeguro: '0.00',
        valorOutrasDespesas: '0.00',
        valorBcIcms: '100.00',
        valorIcms: '18.00',
        valorBcIcmsSt: '0.00',
        valorIcmsSt: '0.00',
        valorFcpSt: '0.00',
        valorIpi: '0.00',
      },
      {
        documento_fiscal_id: 'doc-1',
        tipo_operacao: 'ENTRADA',
        cfop_xml: '5102',
        cstIcms: '00',
        csosnIcms: null,
        origemMercadoria: '0',
        cfop: '1102',
        aliquotaIcms: '18.00',
        percentualReducaoBcIcms: null,
        valorBrutoProduto: '100.00',
        valorDesconto: '0.00',
        valorFrete: '0.00',
        valorSeguro: '0.00',
        valorOutrasDespesas: '0.00',
        valorBcIcms: '100.00',
        valorIcms: '18.00',
        valorBcIcmsSt: '0.00',
        valorIcmsSt: '0.00',
        valorFcpSt: '0.00',
        valorIpi: '0.00',
      },
    ]);
    const service = new FiscalItensService(database as never);

    const report = await service.getC190({ clienteId: 'cliente-1' });

    expect(report.data).toHaveLength(1);
    expect(report.data[0]).toMatchObject({
      cst_icms_csosn: '000',
      cfop: '1102',
      vl_bc_icms: '200.00',
      vl_icms: '36.00',
    });
    expect(report.data[0].cst_icms_csosn).not.toBe('0000');
  });

  it('escopa a agregação por documento mesmo com itens idênticos (R5.3)', async () => {
    // Mesma (CST, CFOP, alíquota) em dois documentos distintos: duas linhas
    // analíticas (uma por documento), nunca uma linha fundida entre documentos.
    const base = {
      tipo_operacao: 'ENTRADA',
      cfop_xml: '5102',
      cstIcms: '00',
      csosnIcms: null,
      origemMercadoria: '0',
      cfop: '1102',
      aliquotaIcms: '18.00',
      percentualReducaoBcIcms: null,
      valorBrutoProduto: '100.00',
      valorDesconto: '0.00',
      valorFrete: '0.00',
      valorSeguro: '0.00',
      valorOutrasDespesas: '0.00',
      valorBcIcms: '100.00',
      valorIcms: '18.00',
      valorBcIcmsSt: '0.00',
      valorIcmsSt: '0.00',
      valorFcpSt: '0.00',
      valorIpi: '0.00',
    };
    const database = createC190Database([
      { ...base, documento_fiscal_id: 'doc-1' },
      { ...base, documento_fiscal_id: 'doc-2' },
    ]);
    const service = new FiscalItensService(database as never);

    const report = await service.getC190({ clienteId: 'cliente-1' });

    expect(report.data).toHaveLength(2);
    expect(
      report.data.map((linha) => linha.documento_fiscal_id).sort(),
    ).toEqual(['doc-1', 'doc-2']);
  });

  it('rotula o C190 como resumo documental parcial (R7.3)', async () => {
    const database = createReportDatabase(jest.fn(), undefined, {
      regimeTributario: 'LUCRO_REAL',
      apuraIcms: true,
    });
    const service = new FiscalItensService(database as never);

    const report = await service.getC190({ clienteId: 'cliente-1' });

    expect(report.parcial).toBe(true);
    expect(report.observacao).toContain('Resumo documental parcial');
    expect(report.observacao).toContain('imposto final apurado a recolher');
  });

  it('zera a apuração do Simples Nacional sem ICMS separado', async () => {
    const reportSelect = jest.fn();
    const database = createReportDatabase(reportSelect, undefined, {
      regimeTributario: 'SIMPLES_NACIONAL',
      apuraIcms: false,
    });
    const service = new FiscalItensService(database as never);

    const result = await service.getApuracaoIcms({
      clienteId: 'cliente-1',
    });

    expect(result).toMatchObject({
      total_creditos: '0.00',
      total_debitos: '0.00',
      saldo_apurado: '0.00',
    });
    expect(result.observacao).toContain('ICMS recolhido via DAS');
    expect(reportSelect).not.toHaveBeenCalled();
  });

  it('mantém a apuração normal para Simples Nacional com ICMS separado', async () => {
    const database = createApuracaoDatabase(
      { regimeTributario: 'SIMPLES_NACIONAL', apuraIcms: true },
      {
        total_creditos: '15.00',
        total_debitos: '40.00',
        saldo_apurado: '25.00',
      },
    );
    const service = new FiscalItensService(database as never);

    const result = await service.getApuracaoIcms({
      clienteId: 'cliente-1',
    });

    expect(result).toMatchObject({
      total_creditos: '15.00',
      total_debitos: '40.00',
      saldo_apurado: '25.00',
      creditos_frete_cte: '0.00',
      parcial: true,
    });
    // R7.3: a apuração documental ainda é parcial (sem E111/saldo/CIAP) e não
    // deve se apresentar como imposto final a recolher.
    expect(result.observacao).toContain('Apuração parcial');
    expect(result.observacao).toContain('imposto final a recolher');
  });

  it('soma o crédito dos CT-e tomados à apuração de entradas', async () => {
    const database = createApuracaoDatabase(
      { regimeTributario: 'LUCRO_REAL', apuraIcms: true },
      {
        total_creditos: '15.00',
        total_debitos: '40.00',
        saldo_apurado: '25.00',
      },
    );
    const fiscalCte = {
      getTotalCreditoIcms: jest.fn().mockResolvedValue('5.25'),
    };
    const service = new FiscalItensService(
      database as never,
      fiscalCte as never,
    );

    await expect(
      service.getApuracaoIcms({ clienteId: 'cliente-1' }),
    ).resolves.toMatchObject({
      total_creditos: '20.25',
      total_debitos: '40.00',
      saldo_apurado: '19.75',
      creditos_frete_cte: '5.25',
    });
  });

  it('marca o C190 do Simples sem apuração como conferência', async () => {
    const database = createReportDatabase(jest.fn(), undefined, {
      regimeTributario: 'SIMPLES_NACIONAL',
      apuraIcms: false,
    });
    const service = new FiscalItensService(database as never);

    const report = await service.getC190({ clienteId: 'cliente-1' });

    expect(report.icms_compoe_apuracao).toBe(false);
    expect(report.observacao).toContain('apenas para conferência');
    // A advertência do Simples não deve suprimir o rótulo de parcial (R7.3).
    expect(report.parcial).toBe(true);
    expect(report.observacao).toContain('Resumo documental parcial');
  });

  it('separa crédito de entrada tributada e débito de saída nos livros', async () => {
    let selection: Record<string, SQL> = {};
    const database = createReportDatabase((value) => {
      selection = value as Record<string, SQL>;
    });
    const service = new FiscalItensService(database as never);

    await service.getResumoLivros({ clienteId: 'cliente-1' });

    const dialect = new PgDialect();
    const credito = dialect.sqlToQuery(selection.credito_icms).sql;
    const debito = dialect.sqlToQuery(selection.debito_icms).sql;
    expect(credito).toContain('tipo_operacao_escriturada');
    expect(credito).toContain('cst_icms');
    expect(credito).toContain('csosn_icms');
    expect(debito).toContain('tipo_operacao_escriturada');
    expect(selection).toHaveProperty('cfop');
    expect(selection).toHaveProperty('valor_contabil');
    expect(selection).toHaveProperty('isentas_nao_tributadas');
    expect(selection).toHaveProperty('outras');
  });

  it('aplica a vedação de crédito por CFOP compartilhada no crédito dos livros (R7.1, R7.2)', async () => {
    let selection: Record<string, SQL> = {};
    const database = createReportDatabase((value) => {
      selection = value as Record<string, SQL>;
    });
    const service = new FiscalItensService(database as never);

    await service.getResumoLivros({ clienteId: 'cliente-1' });

    const credito = new PgDialect().sqlToQuery(selection.credito_icms).sql;
    // A vedação por CFOP (uso/consumo, substituído, ativo) precisa estar no
    // crédito de ICMS do regime normal, como no builder SPED.
    expect(credito).toContain("'556'");
    expect(credito).toContain("'557'");
    expect(credito).toContain("'403'");
    expect(credito).toContain("'551'");
    // Só entradas (1/2/3) são vedadas por CFOP.
    expect(credito).toMatch(/LEFT\(.*cfop.*\) IN \('1', '2', '3'\)/i);
    // CSOSN do Simples permanece creditável (não sujeito à vedação por CFOP).
    expect(credito).toContain('csosn_icms');
  });

  it('a apuração de ICMS aplica a mesma vedação de crédito por CFOP (R7.2)', async () => {
    let capturedSelection: Record<string, SQL> = {};
    const database = createApuracaoSelectionDatabase((value) => {
      capturedSelection = value as Record<string, SQL>;
    });
    const service = new FiscalItensService(database as never);

    await service.getApuracaoIcms({ clienteId: 'cliente-1' });

    const dialect = new PgDialect();
    const totalCreditos = dialect.sqlToQuery(
      capturedSelection.total_creditos,
    ).sql;
    expect(totalCreditos).toContain("'556'");
    expect(totalCreditos).toContain("'403'");
    expect(totalCreditos).toMatch(/RIGHT\(.*cfop.*\) IN \(/i);
  });

  it('não leva créditos e débitos aos livros do Simples sem apuração separada', async () => {
    const groupBy = jest.fn().mockReturnValue({
      orderBy: jest.fn().mockResolvedValue([
        {
          tipo_operacao: 'ENTRADA',
          cfop: '1102',
          icms_creditado_debitado: '18.00',
          credito_icms: '18.00',
          debito_icms: '0.00',
        },
      ]),
    });
    const database = createReportDatabase(jest.fn(), groupBy, {
      regimeTributario: 'SIMPLES_NACIONAL',
      apuraIcms: false,
    });
    const service = new FiscalItensService(database as never);

    const rows = await service.getResumoLivros({ clienteId: 'cliente-1' });

    expect(rows[0]).toMatchObject({
      icms_creditado_debitado: '0.00',
      credito_icms: '0.00',
      debito_icms: '0.00',
    });
  });
});

// R5.4: UI e TXT DEVEM apresentar a mesma decomposição do C190. A projeção da
// UI (`projectC190FromItens`) e a agregação do builder (`aggregateC190Analitico`
// — a função que o builder EFD invoca por documento) atravessam o MESMO
// agregador comum. Estes testes conferem que, para os MESMOS itens, as duas
// produzem a mesma decomposição (CST, CFOP, alíquota, valores), evitando a
// divergência histórica (F16). Não é um teste de implementação do agregador
// (coberto em fiscal-c190-aggregator.spec.ts), e sim da conciliação dos dois
// pontos de consumo.
describe('C190 UI × builder — mesma decomposição (R5.4)', () => {
  function makeRow(overrides: Partial<C190ItemRow> = {}): C190ItemRow {
    return {
      documento_fiscal_id: 'doc-1',
      tipo_operacao: 'ENTRADA',
      cfop_xml: '5102',
      cstIcms: '00',
      csosnIcms: null,
      origemMercadoria: '0',
      cfop: '1102',
      aliquotaIcms: '18.00',
      percentualReducaoBcIcms: null,
      valorBrutoProduto: '100.00',
      valorDesconto: '0.00',
      valorFrete: '0.00',
      valorSeguro: '0.00',
      valorOutrasDespesas: '0.00',
      valorBcIcms: '100.00',
      valorIcms: '18.00',
      valorBcIcmsSt: '0.00',
      valorIcmsSt: '0.00',
      valorFcpSt: '0.00',
      valorIpi: '0.00',
      ...overrides,
    };
  }

  // Decompõe a saída do agregador do builder nos mesmos campos/strings que a
  // projeção da UI expõe, para comparar lado a lado (ambos usam
  // `fromScaledInteger` para formatar — o navegador não recalcula).
  function builderDecomposition(linha: C190Analitico) {
    return {
      cst_icms_csosn: linha.cst,
      cfop: linha.cfop,
      aliquota_icms: linha.aliquota,
      vl_opr: fromScaledInteger(linha.valorOperacao),
      vl_bc_icms: fromScaledInteger(linha.valorBcIcms),
      vl_icms: fromScaledInteger(linha.valorIcms),
      vl_bc_icms_st: fromScaledInteger(linha.valorBcIcmsSt),
      vl_icms_st: fromScaledInteger(linha.valorIcmsSt),
      vl_red_bc: fromScaledInteger(linha.valorReducaoBc),
      vl_ipi: fromScaledInteger(linha.valorIpi),
    };
  }

  // Projeção da UI reduzida aos mesmos campos de decomposição (sem metadados de
  // auditoria como cfops_xml/documento), para comparar com o builder.
  function uiDecomposition(linhas: ReturnType<typeof projectC190FromItens>) {
    return linhas.map((linha) => ({
      cst_icms_csosn: linha.cst_icms_csosn,
      cfop: linha.cfop,
      aliquota_icms: linha.aliquota_icms,
      vl_opr: linha.vl_opr,
      vl_bc_icms: linha.vl_bc_icms,
      vl_icms: linha.vl_icms,
      vl_bc_icms_st: linha.vl_bc_icms_st,
      vl_icms_st: linha.vl_icms_st,
      vl_red_bc: linha.vl_red_bc,
      vl_ipi: linha.vl_ipi,
    }));
  }

  it.each<{ nome: string; itens: C190ItemRow[] }>([
    {
      nome: 'linha simples de entrada tributada',
      itens: [makeRow()],
    },
    {
      nome: 'CST 40 isento sem redução (R5.1)',
      itens: [
        makeRow({
          cstIcms: '40',
          aliquotaIcms: '0.00',
          valorBcIcms: '0.00',
          valorIcms: '0.00',
          percentualReducaoBcIcms: null,
        }),
      ],
    },
    {
      nome: 'redução de base com percentual efetivo (R5.1)',
      itens: [
        makeRow({
          cstIcms: '20',
          aliquotaIcms: '18.00',
          percentualReducaoBcIcms: '40.00',
          valorBcIcms: '60.00',
          valorIcms: '10.80',
        }),
      ],
    },
    {
      nome: 'alíquotas 18 e 18.00 agregam na mesma linha (R5.3)',
      itens: [
        makeRow({ aliquotaIcms: '18' }),
        makeRow({ aliquotaIcms: '18.00' }),
      ],
    },
    {
      nome: 'origem/CST composto e puro na mesma linha (R5.2)',
      itens: [
        makeRow({ cstIcms: '000' }),
        makeRow({ cstIcms: '00', origemMercadoria: '0' }),
      ],
    },
    {
      nome: 'VL_OPR com ST, FCP ST e IPI',
      itens: [
        makeRow({
          valorBrutoProduto: '100.00',
          valorDesconto: '10.00',
          valorFrete: '5.00',
          valorSeguro: '2.00',
          valorOutrasDespesas: '3.00',
          valorIcmsSt: '8.00',
          valorFcpSt: '1.00',
          valorIpi: '4.00',
        }),
      ],
    },
  ])('projeção da UI = agregação do builder: $nome', ({ itens }) => {
    // Builder: todos os itens de um único documento passam pelo agregador.
    const builder = aggregateC190Analitico(itens).map(builderDecomposition);
    // UI: a projeção particiona por documento e usa o mesmo agregador.
    const ui = uiDecomposition(projectC190FromItens(itens));

    expect(ui).toEqual(builder);
  });

  it('mantém a igualdade com múltiplos documentos (escopo por documento, R5.3)', () => {
    const itens = [
      makeRow({ documento_fiscal_id: 'doc-1' }),
      makeRow({ documento_fiscal_id: 'doc-2', aliquotaIcms: '12.00' }),
    ];

    // Builder agrega por documento; concatenamos a decomposição de cada
    // documento na ordem dos documentos, como a projeção da UI faz.
    const builder = [
      ...aggregateC190Analitico(
        itens.filter((item) => item.documento_fiscal_id === 'doc-1'),
      ),
      ...aggregateC190Analitico(
        itens.filter((item) => item.documento_fiscal_id === 'doc-2'),
      ),
    ].map(builderDecomposition);
    const ui = uiDecomposition(projectC190FromItens(itens));

    expect(ui).toHaveLength(2);
    expect([...ui].sort(byKey)).toEqual([...builder].sort(byKey));
  });
});

function byKey(
  a: { cst_icms_csosn: string; cfop: string; aliquota_icms: string },
  b: { cst_icms_csosn: string; cfop: string; aliquota_icms: string },
) {
  return `${a.cst_icms_csosn}|${a.cfop}|${a.aliquota_icms}`.localeCompare(
    `${b.cst_icms_csosn}|${b.cfop}|${b.aliquota_icms}`,
  );
}

function createReportDatabase(
  capture: (selection: Record<string, unknown>) => void,
  groupBy = jest.fn().mockReturnValue({
    orderBy: jest.fn().mockResolvedValue([]),
  }),
  fiscalConfig: {
    regimeTributario: string | null;
    apuraIcms: boolean;
  } = { regimeTributario: null, apuraIcms: false },
) {
  return {
    db: {
      select: jest
        .fn()
        .mockImplementation((selection: Record<string, unknown>) => {
          if ('regimeTributario' in selection) {
            return {
              from: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue([fiscalConfig]),
                }),
              }),
            };
          }
          capture(selection);
          return {
            from: jest.fn().mockReturnValue({
              innerJoin: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  groupBy,
                  // getC190 projeta do agregador: termina em orderBy (sem
                  // agregação no SQL).
                  orderBy: jest.fn().mockResolvedValue([]),
                }),
              }),
            }),
          };
        }),
    },
  };
}

function createC190Database(
  itens: Array<Record<string, unknown>>,
  fiscalConfig: { regimeTributario: string | null; apuraIcms: boolean } = {
    regimeTributario: 'LUCRO_REAL',
    apuraIcms: true,
  },
) {
  return {
    db: {
      select: jest
        .fn()
        .mockImplementation((selection: Record<string, unknown>) => {
          if ('regimeTributario' in selection) {
            return {
              from: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue([fiscalConfig]),
                }),
              }),
            };
          }
          return {
            from: jest.fn().mockReturnValue({
              innerJoin: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  orderBy: jest.fn().mockResolvedValue(itens),
                }),
              }),
            }),
          };
        }),
    },
  };
}

function createApuracaoSelectionDatabase(
  capture: (selection: Record<string, unknown>) => void,
  fiscalConfig: { regimeTributario: string | null; apuraIcms: boolean } = {
    regimeTributario: 'LUCRO_REAL',
    apuraIcms: true,
  },
) {
  return {
    db: {
      select: jest
        .fn()
        .mockImplementation((selection: Record<string, unknown>) => {
          if ('regimeTributario' in selection) {
            return {
              from: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue([fiscalConfig]),
                }),
              }),
            };
          }
          capture(selection);
          return {
            from: jest.fn().mockReturnValue({
              innerJoin: jest.fn().mockReturnValue({
                where: jest.fn().mockResolvedValue([
                  {
                    total_creditos: '0',
                    total_debitos: '0',
                    saldo_apurado: '0',
                  },
                ]),
              }),
            }),
          };
        }),
    },
  };
}

function createApuracaoDatabase(
  fiscalConfig: { regimeTributario: string | null; apuraIcms: boolean },
  apuracao: {
    total_creditos: string;
    total_debitos: string;
    saldo_apurado: string;
  },
) {
  return {
    db: {
      select: jest
        .fn()
        .mockImplementation((selection: Record<string, unknown>) => {
          if ('regimeTributario' in selection) {
            return {
              from: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue([fiscalConfig]),
                }),
              }),
            };
          }
          return {
            from: jest.fn().mockReturnValue({
              innerJoin: jest.fn().mockReturnValue({
                where: jest.fn().mockResolvedValue([apuracao]),
              }),
            }),
          };
        }),
    },
  };
}
