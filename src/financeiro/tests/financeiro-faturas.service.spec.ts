import { eq } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service';
import {
  financeiroContratos,
  financeiroFaturas,
  financeiroLancamentos,
  financeiroTiposLancamento,
} from '../../database/schema';
import { FinanceiroFaturasService } from '../services/financeiro-faturas.service';
import { FinanceiroLancamentosService } from '../services/financeiro-lancamentos.service';
import {
  criarClienteTeste,
  createTestDatabase,
  limparClientes,
  loadDatabaseUrl,
  prepararTipos,
  testLogger,
} from './financeiro-test-db';

const url = loadDatabaseUrl();
const describeDb = url ? describe : describe.skip;

describeDb('FinanceiroFaturasService (banco)', () => {
  let database: DatabaseService;
  let faturas: FinanceiroFaturasService;
  let lancamentos: FinanceiroLancamentosService;
  const clienteIds: string[] = [];

  async function novoClienteComContrato(valor = '500.00') {
    const clienteId = await criarClienteTeste(database);
    clienteIds.push(clienteId);
    await database.db.insert(financeiroContratos).values({
      clienteId,
      valorMensalidade: valor,
      diaVencimento: 10,
      gera13o: true,
      mes13o: 12,
    });
    return clienteId;
  }

  async function tipoId(codigo: string) {
    const [tipo] = await database.db
      .select()
      .from(financeiroTiposLancamento)
      .where(eq(financeiroTiposLancamento.codigo, codigo));
    return tipo.id;
  }

  async function faturasDoCliente(clienteId: string) {
    return database.db
      .select()
      .from(financeiroFaturas)
      .where(eq(financeiroFaturas.clienteId, clienteId));
  }

  beforeAll(async () => {
    await prepararTipos(url as string);
    database = createTestDatabase(url as string);
    faturas = new FinanceiroFaturasService(database, testLogger as never);
    lancamentos = new FinanceiroLancamentosService(database);
  });

  afterAll(async () => {
    await limparClientes(database, clienteIds);
    await database.onModuleDestroy();
  });

  it('gera a fatura mensal com base no contrato do cliente', async () => {
    const clienteId = await novoClienteComContrato();

    const resumo = await faturas.gerarFaturasCompetencia({
      competencia: '03/2031',
      clienteIds: [clienteId],
    });

    expect(resumo).toMatchObject({
      totalProcessados: 1,
      totalGeradas: 1,
      totalPuladas: 0,
    });
    const [fatura] = await faturasDoCliente(clienteId);
    expect(fatura.valorLiquido).toBe('500.00');
    expect(fatura.status).toBe('PENDENTE');
    expect(fatura.dataVencimento).toBe('2031-04-10');
    expect(fatura.numero).toMatch(/^FAT-203103-\d{4}$/);
  });

  it('inclui lançamentos pendentes avulsos e os marca como FATURADO', async () => {
    const clienteId = await novoClienteComContrato();
    for (const [codigo, valor] of [
      ['EMISSAO_CERTIDOES', 80],
      ['ABERTURA_EMPRESAS', 300],
    ] as const) {
      await lancamentos.create(
        {
          clienteId,
          tipoLancamentoId: await tipoId(codigo),
          competencia: '03/2031',
          descricao: `Serviço ${codigo}`,
          valor,
        },
        null as never,
      );
    }

    await faturas.gerarFaturasCompetencia({
      competencia: '03/2031',
      clienteIds: [clienteId],
    });

    const [fatura] = await faturasDoCliente(clienteId);
    expect(fatura.valorBruto).toBe('880.00');
    expect(fatura.valorLiquido).toBe('880.00');
    const itens = await database.db
      .select()
      .from(financeiroLancamentos)
      .where(eq(financeiroLancamentos.faturaId, fatura.id));
    expect(itens).toHaveLength(3);
    expect(itens.every((item) => item.status === 'FATURADO')).toBe(true);
  });

  it('aplica créditos e descontos ao valor líquido', async () => {
    const clienteId = await novoClienteComContrato();
    await lancamentos.create(
      {
        clienteId,
        tipoLancamentoId: await tipoId('DESCONTO_ABATIMENTO'),
        competencia: '03/2031',
        descricao: 'Desconto comercial',
        valor: 100,
      },
      null as never,
    );

    await faturas.gerarFaturasCompetencia({
      competencia: '03/2031',
      clienteIds: [clienteId],
    });

    const [fatura] = await faturasDoCliente(clienteId);
    expect(fatura.valorBruto).toBe('500.00');
    expect(fatura.valorDescontos).toBe('100.00');
    expect(fatura.valorLiquido).toBe('400.00');
  });

  it('é idempotente: não duplica fatura para a mesma competência', async () => {
    const clienteId = await novoClienteComContrato();
    const dto = { competencia: '03/2031', clienteIds: [clienteId] };

    const primeira = await faturas.gerarFaturasCompetencia(dto);
    const segunda = await faturas.gerarFaturasCompetencia(dto);

    expect(primeira.totalGeradas).toBe(1);
    expect(segunda).toMatchObject({ totalGeradas: 0, totalPuladas: 1 });
    expect(await faturasDoCliente(clienteId)).toHaveLength(1);
    const lancs = await database.db
      .select()
      .from(financeiroLancamentos)
      .where(eq(financeiroLancamentos.clienteId, clienteId));
    expect(lancs).toHaveLength(1);
  });

  it('adiciona o 13º no mês configurado no contrato', async () => {
    const clienteId = await novoClienteComContrato();

    await faturas.gerarFaturasCompetencia({
      competencia: '12/2031',
      clienteIds: [clienteId],
    });

    const [fatura] = await faturasDoCliente(clienteId);
    expect(fatura.valorLiquido).toBe('1000.00');
    expect(fatura.dataVencimento).toBe('2032-01-10');
  });

  it('cancelar libera os lançamentos e permite refaturar sem duplicar a mensalidade', async () => {
    const clienteId = await novoClienteComContrato();
    const dto = { competencia: '03/2031', clienteIds: [clienteId] };
    await faturas.gerarFaturasCompetencia(dto);
    const [original] = await faturasDoCliente(clienteId);

    await faturas.cancelar(
      original.id,
      { motivo: 'Teste de cancelamento' },
      null as never,
    );
    const refeita = await faturas.gerarFaturasCompetencia(dto);

    expect(refeita.totalGeradas).toBe(1);
    const todas = await faturasDoCliente(clienteId);
    expect(todas.filter((f) => f.status !== 'CANCELADA')).toHaveLength(1);
    expect(todas.find((f) => f.status !== 'CANCELADA')?.valorLiquido).toBe(
      '500.00',
    );
  });
});
