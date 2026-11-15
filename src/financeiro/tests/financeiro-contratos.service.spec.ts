import { BadRequestException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service';
import {
  financeiroFaturas,
  financeiroTiposLancamento,
} from '../../database/schema';
import { FinanceiroContratosService } from '../services/financeiro-contratos.service';
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

describeDb('Itens fixos do contrato (banco)', () => {
  let database: DatabaseService;
  let contratos: FinanceiroContratosService;
  let faturas: FinanceiroFaturasService;
  const clienteIds: string[] = [];

  const contratoBase = {
    valorMensalidade: 500,
    diaVencimento: 10,
  };

  async function tipoId(codigo: string) {
    const [tipo] = await database.db
      .select()
      .from(financeiroTiposLancamento)
      .where(eq(financeiroTiposLancamento.codigo, codigo));
    return tipo.id;
  }

  async function novoCliente() {
    const id = await criarClienteTeste(database);
    clienteIds.push(id);
    return id;
  }

  async function gerar(clienteId: string, competencia: string) {
    await faturas.gerarFaturasCompetencia({
      competencia,
      clienteIds: [clienteId],
    });
    const rows = await database.db
      .select()
      .from(financeiroFaturas)
      .where(eq(financeiroFaturas.clienteId, clienteId));
    return rows.filter((f) => f.competencia === competencia);
  }

  beforeAll(async () => {
    await prepararTipos(url as string);
    database = createTestDatabase(url as string);
    contratos = new FinanceiroContratosService(database);
    faturas = new FinanceiroFaturasService(database, testLogger as never);
  });

  afterAll(async () => {
    await limparClientes(database, clienteIds);
    await database.onModuleDestroy();
  });

  it('aplica mensalidade e desconto fixo na mesma fatura, mês a mês', async () => {
    const clienteId = await novoCliente();
    await contratos.upsert(
      clienteId,
      {
        ...contratoBase,
        itens: [
          {
            tipoLancamentoId: await tipoId('DESCONTO_ABATIMENTO'),
            descricao: 'Desconto comercial fixo',
            valor: 50,
          },
        ],
      },
      null as never,
    );

    const [marco] = await gerar(clienteId, '03/2031');
    const [abril] = await gerar(clienteId, '04/2031');

    for (const fatura of [marco, abril]) {
      expect(fatura.valorBruto).toBe('500.00');
      expect(fatura.valorDescontos).toBe('50.00');
      expect(fatura.valorLiquido).toBe('450.00');
    }
  });

  it('respeita a vigência do item fixo', async () => {
    const clienteId = await novoCliente();
    await contratos.upsert(
      clienteId,
      {
        ...contratoBase,
        itens: [
          {
            tipoLancamentoId: await tipoId('DESCONTO_ABATIMENTO'),
            descricao: 'Desconto promocional',
            valor: 100,
            competenciaInicio: '04/2031',
            competenciaFim: '05/2031',
          },
        ],
      },
      null as never,
    );

    expect((await gerar(clienteId, '03/2031'))[0].valorLiquido).toBe('500.00');
    expect((await gerar(clienteId, '04/2031'))[0].valorLiquido).toBe('400.00');
    expect((await gerar(clienteId, '06/2031'))[0].valorLiquido).toBe('500.00');
  });

  it('não duplica o item ao refaturar após cancelamento', async () => {
    const clienteId = await novoCliente();
    await contratos.upsert(
      clienteId,
      {
        ...contratoBase,
        itens: [
          {
            tipoLancamentoId: await tipoId('TAXAS_ORGAOS_PUBLICOS'),
            descricao: 'Taxa fixa',
            valor: 30,
          },
        ],
      },
      null as never,
    );
    const [original] = await gerar(clienteId, '03/2031');
    expect(original.valorLiquido).toBe('530.00');

    await faturas.cancelar(original.id, { motivo: 'Refaturar' }, null as never);
    const ativas = (await gerar(clienteId, '03/2031')).filter(
      (f) => f.status !== 'CANCELADA',
    );

    expect(ativas).toHaveLength(1);
    expect(ativas[0].valorLiquido).toBe('530.00');
  });

  it('fatura cliente sem mensalidade que só tem item fixo', async () => {
    const clienteId = await novoCliente();
    await contratos.upsert(
      clienteId,
      {
        valorMensalidade: 0,
        diaVencimento: 5,
        itens: [
          {
            tipoLancamentoId: await tipoId('DECLARACOES_DIVERSAS'),
            descricao: 'Serviço recorrente',
            valor: 120,
          },
        ],
      },
      null as never,
    );

    const [fatura] = await gerar(clienteId, '03/2031');
    expect(fatura.valorLiquido).toBe('120.00');
  });

  it('substitui, atualiza e remove itens no upsert', async () => {
    const clienteId = await novoCliente();
    const tipo = await tipoId('DESCONTO_ABATIMENTO');
    const criado = await contratos.upsert(
      clienteId,
      {
        ...contratoBase,
        itens: [
          { tipoLancamentoId: tipo, descricao: 'Primeiro', valor: 10 },
          { tipoLancamentoId: tipo, descricao: 'Segundo', valor: 20 },
        ],
      },
      null as never,
    );
    expect(criado.itens).toHaveLength(2);

    const [primeiro] = criado.itens;
    const atualizado = await contratos.upsert(
      clienteId,
      {
        ...contratoBase,
        itens: [
          {
            id: primeiro.id,
            tipoLancamentoId: tipo,
            descricao: 'Primeiro',
            valor: 15,
          },
        ],
      },
      null as never,
    );
    expect(atualizado.itens).toHaveLength(1);
    expect(atualizado.itens[0].valor).toBe('15.00');

    const mantido = await contratos.upsert(
      clienteId,
      contratoBase,
      null as never,
    );
    expect(mantido.itens).toHaveLength(1);
  });

  it('rejeita tipos gerados pelo contrato e vigência invertida', async () => {
    const clienteId = await novoCliente();
    await expect(
      contratos.upsert(
        clienteId,
        {
          ...contratoBase,
          itens: [
            {
              tipoLancamentoId: await tipoId('MENSALIDADE'),
              descricao: 'Mensalidade duplicada',
              valor: 10,
            },
          ],
        },
        null as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      contratos.upsert(
        clienteId,
        {
          ...contratoBase,
          itens: [
            {
              tipoLancamentoId: await tipoId('DESCONTO_ABATIMENTO'),
              descricao: 'Vigência inválida',
              valor: 10,
              competenciaInicio: '06/2031',
              competenciaFim: '05/2031',
            },
          ],
        },
        null as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
