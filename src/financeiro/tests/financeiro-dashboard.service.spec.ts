import { DatabaseService } from '../../database/database.service';
import { financeiroContratos } from '../../database/schema';
import { getBahiaDate } from '../../common/document-status';
import { FinanceiroBaixasService } from '../services/financeiro-baixas.service';
import { FinanceiroDashboardService } from '../services/financeiro-dashboard.service';
import { FinanceiroFaturasService } from '../services/financeiro-faturas.service';
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

describeDb('FinanceiroDashboardService (banco)', () => {
  let database: DatabaseService;
  const clienteIds: string[] = [];

  beforeAll(async () => {
    await prepararTipos(url as string);
    database = createTestDatabase(url as string);
  });

  afterAll(async () => {
    await limparClientes(database, clienteIds);
    await database.onModuleDestroy();
  });

  it('consolida faturado, recebido, em aberto e inadimplência da competência', async () => {
    const faturas = new FinanceiroFaturasService(database, testLogger as never);
    const baixas = new FinanceiroBaixasService(database, testLogger as never);
    const dashboard = new FinanceiroDashboardService(database);
    const clienteId = await criarClienteTeste(database);
    clienteIds.push(clienteId);
    await database.db.insert(financeiroContratos).values({
      clienteId,
      valorMensalidade: '500.00',
      diaVencimento: 10,
    });
    // Competência antiga: a fatura nasce vencida (vencimento no passado).
    const competencia = '01/2020';
    const { faturasIds } = await faturas.gerarFaturasCompetencia({
      competencia,
      clienteIds: [clienteId],
    });
    await baixas.registrarBaixa(
      faturasIds[0],
      {
        valorRecebido: 200,
        dataPagamento: getBahiaDate(),
        formaPagamento: 'PIX',
      },
      null as never,
    );

    const resultado = await dashboard.getDashboard(competencia);

    expect(resultado.totalFaturado).toBe('500.00');
    expect(resultado.totalRecebido).toBe('200.00');
    expect(resultado.totalEmAberto).toBe('300.00');
    expect(resultado.inadimplencia).toMatchObject({
      faturasVencidas: 1,
      valor: '300.00',
      percentual: 60,
    });
    expect(
      resultado.rankingDevedores.find((d) => d.clienteId === clienteId),
    ).toMatchObject({ valorDevido: '300.00', faturasVencidas: 1 });
  });
});
