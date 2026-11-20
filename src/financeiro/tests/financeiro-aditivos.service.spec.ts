import { and, eq } from 'drizzle-orm';
import { execFileSync } from 'node:child_process';
import { DatabaseService } from '../../database/database.service';
import {
  clientes,
  contadores,
  financeiroContratosItens,
  financeiroFaturas,
  financeiroTiposLancamento,
} from '../../database/schema';
import { FinanceiroContratosService } from '../services/financeiro-contratos.service';
import { FinanceiroFaturasService } from '../services/financeiro-faturas.service';
import { FinanceiroAditivoDocumentoService } from '../services/financeiro-aditivo-documento.service';
import { competenciaDeData } from '../financeiro.utils';
import { getBahiaDate } from '../../common/document-status';
import {
  createTestDatabase,
  criarClienteTeste,
  limparClientes,
  prepararTipos,
  testLogger,
} from './financeiro-test-db';

const url = process.env.TEST_DATABASE_URL;
if (url && !new URL(url).pathname.endsWith('_test'))
  throw new Error('Use um banco isolado terminado em _test.');
const describeDb = url ? describe : describe.skip;

describeDb('reajustes e aditivos contratuais (banco isolado)', () => {
  let db: DatabaseService;
  let contratos: FinanceiroContratosService;
  let faturas: FinanceiroFaturasService;
  const ids: string[] = [];
  let contadorPadrao: string;
  const hoje = getBahiaDate();
  const competencia = competenciaDeData(hoje);
  const futuro = new Date(`${hoje.slice(0, 7)}-01T12:00:00Z`);
  futuro.setUTCMonth(futuro.getUTCMonth() + 1);
  const proxima = competenciaDeData(futuro.toISOString().slice(0, 10));
  const base = {
    valorMensalidade: 300,
    diaVencimento: 10,
    diaFechamento: 25,
    gera13o: false,
    dataInicio: '2024-01-01',
    dataAssinatura: '2024-01-01',
    localAssinatura: 'Salvador/BA',
    servicos: [
      { codigo: 'DEPARTAMENTO_PESSOAL' as const, valorMensal: 100 },
      { codigo: 'ESOCIAL_DOMESTICO' as const, valorMensal: 200 },
    ],
  };
  const reajuste = {
    percentual: 10,
    competenciaInicio: competencia,
    motivo: 'IPCA revisado pelas partes',
    versaoEsperada: 1,
  };

  beforeAll(async () => {
    await prepararTipos(url!);
    db = createTestDatabase(url!);
    contratos = new FinanceiroContratosService(db);
    faturas = new FinanceiroFaturasService(db, testLogger as never);
    const [contador] = await db.db
      .insert(contadores)
      .values({
        nome: 'Contador Teste',
        cpf: '99999999999',
        crc: `TEST-${Date.now()}`,
        codigoMunicipioIbge: '2927408',
      })
      .returning();
    contadorPadrao = contador.id;
  });
  afterAll(async () => {
    await limparClientes(db, ids);
    await db.db.delete(contadores).where(eq(contadores.id, contadorPadrao));
    await db.onModuleDestroy();
  });
  async function novo() {
    const id = await criarClienteTeste(db);
    ids.push(id);
    await db.db
      .update(clientes)
      .set({
        contadorId: contadorPadrao,
        responsavelNome: 'Maria Representante',
      })
      .where(eq(clientes.id, id));
    await contratos.upsert(id, base, null as never);
    return id;
  }
  async function faturar(clienteId: string, alvo: string) {
    await faturas.gerarFaturasCompetencia({
      competencia: alvo,
      clienteIds: [clienteId],
    });
    const [fatura] = await db.db
      .select()
      .from(financeiroFaturas)
      .where(
        and(
          eq(financeiroFaturas.clienteId, clienteId),
          eq(financeiroFaturas.competencia, alvo),
        ),
      );
    return fatura;
  }

  it('mostra a prévia sem alterar o contrato e registra o reajuste confirmado com os serviços reconciliados', async () => {
    const id = await novo();
    expect((await contratos.previaReajuste(id, reajuste)).valorNovo).toBe(
      '330.00',
    );
    expect((await contratos.getByCliente(id)).valorMensalidade).toBe('300.00');
    expect(await contratos.listarAditivos(id)).toHaveLength(0);
    const salvo = await contratos.reajustar(id, reajuste, null as never);
    expect(salvo.valorMensalidade).toBe('330.00');
    expect(salvo.servicosContratados.map((s) => s.valorMensal)).toEqual([
      '110.00',
      '220.00',
    ]);
    expect(salvo.versao).toBe(2);
    expect((await contratos.obterOriginal(id))?.contrato.valorMensalidade).toBe(
      '300.00',
    );
    const historico = await contratos.listarAditivos(id);
    expect(historico).toHaveLength(1);
    expect(historico[0]).toMatchObject({
      numero: 1,
      tipo: 'REAJUSTE_ANUAL',
      valorAnterior: '300.00',
      valorNovo: '330.00',
    });
    expect((await faturar(id, competencia)).valorLiquido).toBe('330.00');
    await expect(
      contratos.previaReajuste(id, { ...reajuste, versaoEsperada: 2 }),
    ).rejects.toThrow('próximo reajuste');
  });

  it('respeita a vigência futura nos valores, descontos removidos e dias de fechamento', async () => {
    const id = await novo();
    const [tipo] = await db.db
      .select()
      .from(financeiroTiposLancamento)
      .where(eq(financeiroTiposLancamento.codigo, 'DESCONTO_ABATIMENTO'));
    // Monta o estado inicial antes de qualquer alteração contratual.
    await db.db.insert(financeiroContratosItens).values({
      contratoId: (await contratos.getByCliente(id)).id,
      tipoLancamentoId: tipo.id,
      descricao: 'Desconto permanente',
      valor: '20.00',
    });
    await contratos.upsert(
      id,
      {
        ...base,
        valorMensalidade: 360,
        servicos: [
          { codigo: 'DEPARTAMENTO_PESSOAL', valorMensal: 120 },
          { codigo: 'ESOCIAL_DOMESTICO', valorMensal: 240 },
        ],
        diaFechamento: 31,
        competenciaInicioAditivo: proxima,
        versaoEsperada: 1,
        motivoAditivo: 'Ampliação do escopo',
        itens: [],
      },
      null as never,
    );
    expect((await faturar(id, competencia)).valorLiquido).toBe('280.00');
    expect((await faturar(id, proxima)).valorLiquido).toBe('360.00');
    expect((await contratos.getByCliente(id)).itens).toHaveLength(0);
    const [preservado] = await db.db
      .select()
      .from(financeiroContratosItens)
      .where(
        eq(
          financeiroContratosItens.contratoId,
          (await contratos.getByCliente(id)).id,
        ),
      );
    expect(preservado.removidoEm).not.toBeNull();
  });

  it('bloqueia alteração de competência já faturada e reverte a transação inteira', async () => {
    const id = await novo();
    const original = await faturar(id, competencia);
    await expect(
      contratos.reajustar(id, reajuste, null as never),
    ).rejects.toThrow('Já existe fatura');
    expect((await contratos.getByCliente(id)).valorMensalidade).toBe('300.00');
    expect(await contratos.listarAditivos(id)).toHaveLength(0);
    expect((await faturar(id, competencia)).id).toBe(original.id);
    expect(
      (
        await contratos.reajustar(
          id,
          { ...reajuste, competenciaInicio: proxima },
          null as never,
        )
      ).valorMensalidade,
    ).toBe('330.00');
  });

  it('seleciona o fechamento vigente e mostra o total com adicionais futuros na listagem', async () => {
    const id = await novo();
    const [tipo] = await db.db
      .select()
      .from(financeiroTiposLancamento)
      .where(eq(financeiroTiposLancamento.codigo, 'TAXAS_ORGAOS_PUBLICOS'));
    await contratos.upsert(
      id,
      {
        ...base,
        diaFechamento: 31,
        competenciaInicioAditivo: proxima,
        versaoEsperada: 1,
        motivoAditivo: 'Novo fechamento e adicional',
        itens: [
          {
            tipoLancamentoId: tipo.id,
            descricao: 'Adicional futuro',
            valor: 50,
            competenciaInicio: proxima,
          },
        ],
      },
      null as never,
    );
    const lista = await contratos.list({
      pagination: { page: 1, pageSize: 100, limit: 100, offset: 0 },
    });
    expect(
      lista.data.find((c) => c.clienteId === id)?.valorMensalidadeTotal,
    ).toBe('350.00');
    const gerar = jest
      .spyOn(faturas, 'gerarFaturasCompetencia')
      .mockResolvedValue({
        totalProcessados: 0,
        totalGeradas: 0,
        totalPuladas: 0,
        totalFalhas: 0,
        faturasIds: [],
      });
    try {
      await faturas.gerarFaturasFechamentoDoDia(`${hoje.slice(0, 7)}-25`);
      expect(gerar.mock.calls.at(-1)?.[0].clienteIds).toContain(id);
      gerar.mockClear();
      const ultimoAtual = new Date(
        Date.UTC(Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7)), 0),
      ).getUTCDate();
      await faturas.gerarFaturasFechamentoDoDia(
        `${hoje.slice(0, 7)}-${ultimoAtual}`,
      );
      expect(
        gerar.mock.calls.flatMap((c) => c[0].clienteIds ?? []),
      ).not.toContain(id);
      gerar.mockClear();
      const [mes, ano] = proxima.split('/').map(Number);
      const ultimoFuturo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
      await faturas.gerarFaturasFechamentoDoDia(
        `${ano}-${String(mes).padStart(2, '0')}-${ultimoFuturo}`,
      );
      expect(gerar.mock.calls.at(-1)?.[0].clienteIds).toContain(id);
    } finally {
      gerar.mockRestore();
    }
  });

  it('serializa confirmações simultâneas e impede reajuste duplicado', async () => {
    const id = await novo();
    const results = await Promise.allSettled([
      contratos.reajustar(id, reajuste, null as never),
      contratos.reajustar(id, reajuste, null as never),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await contratos.listarAditivos(id)).toHaveLength(1);
    expect((await contratos.getByCliente(id)).valorMensalidade).toBe('330.00');
  });

  it('não gera aditivo ao salvar sem alterações nem em mudanças de observações internas', async () => {
    const id = await novo();
    await contratos.upsert(
      id,
      { ...base, versaoEsperada: 1, observacoes: 'Anotação interna' },
      null as never,
    );
    expect(await contratos.listarAditivos(id)).toHaveLength(0);
    expect((await contratos.getByCliente(id)).versao).toBe(1);
  });

  it('emite o PDF de um aditivo com as partes preservadas e impede acesso por outro cliente', async () => {
    const id = await novo();
    const [contador] = await db.db
      .insert(contadores)
      .values({
        nome: 'Contador do Aditivo',
        cpf: '12345678901',
        crc: `TEST-${id.slice(0, 8)}`,
        codigoMunicipioIbge: '2927408',
        logradouro: 'Rua do Escritório',
      })
      .returning();
    await db.db
      .update(clientes)
      .set({ contadorId: contador.id, responsavelNome: 'Maria Representante' })
      .where(eq(clientes.id, id));
    await contratos.reajustar(id, reajuste, null as never);
    await db.db
      .update(clientes)
      .set({ razaoSocial: 'Nome alterado posteriormente' })
      .where(eq(clientes.id, id));
    const [aditivo] = await contratos.listarAditivos(id);
    const documento = new FinanceiroAditivoDocumentoService(db);
    const pdf = await documento.gerarPdf(id, aditivo.id);
    const paginas = JSON.parse(
      execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          "import {extractText} from 'unpdf'; const chunks=[];for await(const c of process.stdin) chunks.push(c);process.stdout.write(JSON.stringify((await extractText(new Uint8Array(Buffer.concat(chunks)),{mergePages:false})).text));",
        ],
        { input: pdf, encoding: 'utf8' },
      ),
    ) as string[];
    expect(paginas).toHaveLength(1);
    expect(paginas[0]).toContain('Página 1 de 1');
    const texto = paginas.join(' ');
    expect(texto).toContain('ADITIVO CONTRATUAL');
    expect(texto).toContain('330,00');
    expect(texto).toContain('Maria Representante');
    expect(texto).not.toContain('Nome alterado posteriormente');
    await expect(documento.gerarPdf(await novo(), aditivo.id)).rejects.toThrow(
      'não encontrado',
    );
    // Remove apenas o contador criado por este teste, após desvincular o cliente.
    await db.db
      .update(clientes)
      .set({ contadorId: null })
      .where(eq(clientes.id, id));
    await db.db.delete(contadores).where(eq(contadores.id, contador.id));
  });
});
