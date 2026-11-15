import { BadRequestException } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service';
import {
  financeiroBaixas,
  financeiroContratos,
  financeiroFaturas,
} from '../../database/schema';
import { getBahiaDate } from '../../common/document-status';
import { FinanceiroBaixasService } from '../services/financeiro-baixas.service';
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

describeDb('FinanceiroBaixasService (banco)', () => {
  let database: DatabaseService;
  let faturas: FinanceiroFaturasService;
  let baixas: FinanceiroBaixasService;
  const clienteIds: string[] = [];

  async function novaFatura() {
    const clienteId = await criarClienteTeste(database);
    clienteIds.push(clienteId);
    await database.db.insert(financeiroContratos).values({
      clienteId,
      valorMensalidade: '500.00',
      diaVencimento: 10,
    });
    const { faturasIds } = await faturas.gerarFaturasCompetencia({
      competencia: '05/2031',
      clienteIds: [clienteId],
    });
    return faturasIds[0];
  }

  async function carregar(id: string) {
    const [fatura] = await database.db
      .select()
      .from(financeiroFaturas)
      .where(eq(financeiroFaturas.id, id));
    return fatura;
  }

  const baixaDto = (valorRecebido: number) => ({
    valorRecebido,
    dataPagamento: getBahiaDate(),
    formaPagamento: 'PIX' as const,
  });

  beforeAll(async () => {
    await prepararTipos(url as string);
    database = createTestDatabase(url as string);
    faturas = new FinanceiroFaturasService(database, testLogger as never);
    baixas = new FinanceiroBaixasService(database, testLogger as never);
  });

  afterAll(async () => {
    await limparClientes(database, clienteIds);
    await database.onModuleDestroy();
  });

  it('dá baixa parcial e muda o status para PARCIALMENTE_PAGA', async () => {
    const faturaId = await novaFatura();

    await baixas.registrarBaixa(faturaId, baixaDto(200), null as never);

    const fatura = await carregar(faturaId);
    expect(fatura.status).toBe('PARCIALMENTE_PAGA');
    expect(fatura.valorPago).toBe('200.00');
    expect((await faturas.getById(faturaId)).saldoAberto).toBe('300.00');

    await expect(
      baixas.registrarBaixa(faturaId, baixaDto(300.01), null as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect((await faturas.getById(faturaId)).saldoAberto).toBe('300.00');
  });

  it('abate o principal correto em pagamentos parciais com encargos e desconto', async () => {
    const faturaId = await novaFatura();
    await baixas.registrarBaixa(
      faturaId,
      { ...baixaDto(210), valorMulta: 10, valorJuros: 5, valorDesconto: 5 },
      null as never,
    );

    const parcial = await faturas.getById(faturaId);
    expect(parcial.status).toBe('PARCIALMENTE_PAGA');
    expect(parcial.saldoAberto).toBe('300.00');

    await baixas.registrarBaixa(faturaId, baixaDto(300), null as never);
    const quitada = await faturas.getById(faturaId);
    expect(quitada.status).toBe('PAGA');
    expect(quitada.saldoAberto).toBe('0.00');
    expect(quitada.valorPago).toBe('510.00');
  });

  it('dá baixa total e muda o status para PAGA', async () => {
    const faturaId = await novaFatura();

    await baixas.registrarBaixa(faturaId, baixaDto(200), null as never);
    await baixas.registrarBaixa(faturaId, baixaDto(300), null as never);

    const fatura = await carregar(faturaId);
    expect(fatura.status).toBe('PAGA');
    expect(fatura.valorPago).toBe('500.00');
    await expect(
      baixas.registrarBaixa(faturaId, baixaDto(10), null as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejeita valor acima do saldo em aberto', async () => {
    const faturaId = await novaFatura();

    await expect(
      baixas.registrarBaixa(faturaId, baixaDto(500.01), null as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect((await carregar(faturaId)).status).toBe('PENDENTE');
  });

  it('estorna a baixa e recalcula o saldo restante', async () => {
    const faturaId = await novaFatura();
    await baixas.registrarBaixa(faturaId, baixaDto(200), null as never);
    await baixas.registrarBaixa(faturaId, baixaDto(300), null as never);
    const [, ultima] = await database.db
      .select()
      .from(financeiroBaixas)
      .where(eq(financeiroBaixas.faturaId, faturaId))
      .orderBy(asc(financeiroBaixas.criadoEm));

    await baixas.estornarBaixa(
      ultima.id,
      { motivo: 'Pagamento devolvido' },
      null as never,
    );

    const fatura = await carregar(faturaId);
    expect(fatura.status).toBe('PARCIALMENTE_PAGA');
    expect(fatura.valorPago).toBe('200.00');
    await expect(
      baixas.estornarBaixa(ultima.id, { motivo: 'Repetido' }, null as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('estornar todas as baixas devolve a fatura para PENDENTE', async () => {
    const faturaId = await novaFatura();
    await baixas.registrarBaixa(faturaId, baixaDto(100), null as never);
    const [unica] = await database.db
      .select()
      .from(financeiroBaixas)
      .where(eq(financeiroBaixas.faturaId, faturaId))
      .orderBy(asc(financeiroBaixas.criadoEm));

    await baixas.estornarBaixa(
      unica.id,
      { motivo: 'Erro de digitação' },
      null as never,
    );

    const fatura = await carregar(faturaId);
    expect(fatura.status).toBe('PENDENTE');
    expect(fatura.valorPago).toBe('0.00');
  });
});
