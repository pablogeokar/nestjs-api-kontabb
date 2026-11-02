import { RhService } from './rh.service';
import type { DadosFolhaPagamento } from '../common/pdf-extraction-rh';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

function makeDados(): DadosFolhaPagamento {
  return {
    cnpj: '12.345.678/0001-90',
    razaoSocial: 'Empresa Teste',
    competencia: '08/2026',
    periodoInicio: '2026-08-01',
    periodoFim: '2026-08-31',
    totalBruto: 1000,
    totalDescontos: 100,
    totalLiquido: 900,
    totalFuncionarios: 1,
    totalInss: 75,
    totalFgts: 80,
    totalIrrf: 0,
    totalSalarioFamilia: 0,
    funcionarios: [
      {
        codigoFuncionario: '000001',
        nomeCompleto: 'FUNCIONARIO TESTE',
        referencia: '220:00',
        codigoFolha: '0000001',
        dataAdmissao: '01/01/2026',
        dependentesIr: 0,
        dependentesSf: 0,
        cargo: 'TESTE',
        salarioBase: 1000,
        totalProventos: 1000,
        totalDescontos: 100,
        salarioLiquido: 900,
        baseInss: 1000,
        aliquotaInss: 7.5,
        valorInss: 75,
        baseFgts: 1000,
        valorFgts: 80,
        baseIrrf: 900,
        valorIrrf: 0,
        rubricas: [],
      },
    ],
  };
}

describe('RhService', () => {
  it('rejeita folha quando o total informado diverge dos itens extraidos', async () => {
    const execute = jest.fn();
    const warn = jest.fn();
    const service = new RhService(
      { db: { execute } } as never,
      {} as never,
      {} as never,
      { warn } as never,
    );
    const dados = makeDados();
    dados.totalFuncionarios = 2;

    const result = await service.processarFolhaPagamento({
      dados,
      clienteId: crypto.randomUUID(),
      r2Key: 'rh/teste/folha.pdf',
      fileName: 'folha.pdf',
      actorUserId: crypto.randomUUID(),
    });

    expect(result).toEqual({ ok: false, code: 'DADOS_INCONSISTENTES' });
    expect(execute).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      'rh_folha_inconsistent_employee_count',
      expect.objectContaining({ totalInformado: 2, totalExtraido: 1 }),
    );
  });

  it('rejeita codigos de funcionario duplicados antes de persistir', async () => {
    const execute = jest.fn();
    const service = new RhService(
      { db: { execute } } as never,
      {} as never,
      {} as never,
      { warn: jest.fn() } as never,
    );
    const dados = makeDados();
    dados.funcionarios.push({ ...dados.funcionarios[0] });
    dados.totalFuncionarios = 2;

    const result = await service.processarFolhaPagamento({
      dados,
      clienteId: crypto.randomUUID(),
      r2Key: 'rh/teste/folha.pdf',
      fileName: 'folha.pdf',
      actorUserId: crypto.randomUUID(),
    });

    expect(result).toEqual({ ok: false, code: 'DADOS_INCONSISTENTES' });
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('RhService - busca de folhas', () => {
  it('preserva letras do CNPJ na consulta administrativa', async () => {
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
    const service = new RhService(
      { db: { select } } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.listFolhas({
      search: 'ab.12c.d34/ef56-78',
      pagination: { page: 1, pageSize: 15, limit: 15, offset: 0 },
    });

    expect(whereClauses).toHaveLength(2);
    const params = new PgDialect().sqlToQuery(whereClauses[0]).params;
    expect(params).toContain('%AB12CD34EF5678%');
  });
});
