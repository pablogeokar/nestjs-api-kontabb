import { randomUUID } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq } from 'drizzle-orm';
import * as schema from '../../database/schema';
import { seedSimplesNacional } from '../../database/seeds/simples-nacional.seed';
import { seedSimplesBeneficios } from '../../database/seeds/simples-beneficios.seed';
import { SimplesBeneficiosService } from './simples-beneficios.service';
import { SimplesNacionalService } from './simples-nacional.service';
import { SimplesCalculadorService } from './simples-calculador.service';
import { BENEFICIO_BA_2026 } from './simples-beneficios';

// Nunca usa DATABASE_URL: somente banco descartável local, com nome fixo de teste.
const url = process.env.SIMPLES_BENEFICIOS_TEST_URL;
const suite = url ? describe : describe.skip;
suite('benefícios do Simples com PostgreSQL isolado', () => {
  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle>;
  let service: SimplesBeneficiosService;
  let baselineDir: string;
  const clienteId = randomUUID();
  const actorId = 'contador-beneficios-test';
  let apuracaoAntigaId: string;
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (
      !['127.0.0.1', 'localhost'].includes(parsed.hostname) ||
      parsed.pathname !== '/kontabb_beneficios_test'
    )
      throw new Error(
        'Use exclusivamente PostgreSQL local descartável kontabb_beneficios_test.',
      );
    client = postgres(url!, { max: 4 });
    db = drizzle(client, { schema });
    baselineDir = mkdtempSync(join(tmpdir(), 'kontabb-beneficios-migration-'));
    mkdirSync(join(baselineDir, 'meta'));
    const journal = JSON.parse(
      readFileSync(resolve('drizzle/meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ tag: string }> };
    const anteriores = { ...journal, entries: journal.entries.slice(0, 2) };
    for (const entry of anteriores.entries)
      copyFileSync(
        resolve(`drizzle/${entry.tag}.sql`),
        join(baselineDir, `${entry.tag}.sql`),
      );
    writeFileSync(
      join(baselineDir, 'meta/_journal.json'),
      JSON.stringify(anteriores),
    );
    await migrate(db, { migrationsFolder: baselineDir });
    await seedSimplesNacional(url!);
    await db.insert(schema.user).values({
      id: actorId,
      name: 'Contador Teste',
      email: 'beneficios@test.invalid',
      role: 'COLABORADOR',
    });
    await db.insert(schema.clientes).values({
      id: clienteId,
      cnpj: '12345678000195',
      razaoSocial: 'Empresa Teste',
      uf: 'BA',
      regimeTributario: 'SIMPLES_NACIONAL',
      dataAberturaCnpj: '2020-01-01',
    });
    const [tabela] = await db
      .select()
      .from(schema.fiscalSimplesTabelas)
      .where(eq(schema.fiscalSimplesTabelas.ativo, true));
    const [antiga] = await db
      .insert(schema.fiscalSimplesApuracoes)
      .values({
        clienteId,
        tabelaId: tabela.id,
        competencia: '2026-09-01',
        rbt12: '10000.00',
        receitaBrutaMes: '1000.00',
        valorTotalDas: '40.00',
        status: 'FECHADO',
        corrente: true,
        memoriaCalculo: { motorVersao: 'simples-nacional@13' },
      })
      .returning();
    apuracaoAntigaId = antiga.id;
    await migrate(db, { migrationsFolder: resolve('drizzle') });
    service = new SimplesBeneficiosService({ db } as never);
  }, 30000);
  afterAll(async () => {
    if (client) await client.end();
    if (baselineDir) rmSync(baselineDir, { recursive: true, force: true });
  });

  it('migra banco existente preservando apuração fechada e semeia a regra idempotentemente', async () => {
    await seedSimplesBeneficios(url!);
    await seedSimplesBeneficios(url!);
    expect(await service.listar()).toHaveLength(1);
    const [antiga] = await db
      .select()
      .from(schema.fiscalSimplesApuracoes)
      .where(eq(schema.fiscalSimplesApuracoes.id, apuracaoAntigaId));
    expect(antiga).toMatchObject({
      status: 'FECHADO',
      valorTotalDas: '40.00',
      memoriaCalculo: { motorVersao: 'simples-nacional@13' },
    });
  });
  it('versiona, audita, rejeita edição obsoleta e preserva parametrização ao repetir seed', async () => {
    const nova = await service.salvar(
      {
        ...BENEFICIO_BA_2026,
        tipo: 'ISENCAO',
        ativo: false,
        versaoAnterior: 1,
      },
      actorId,
    );
    expect(nova.versao).toBe(2);
    await seedSimplesBeneficios(url!);
    expect((await service.listar())[0]).toMatchObject({
      versao: 2,
      ativo: false,
    });
    const antigas = await db
      .select()
      .from(schema.fiscalSimplesBeneficios)
      .where(
        eq(schema.fiscalSimplesBeneficios.codigo, BENEFICIO_BA_2026.codigo),
      );
    expect(antigas).toHaveLength(2);
    expect(antigas.find((row) => row.versao === 1)).toMatchObject({
      ativo: true,
      atual: false,
    });
    expect(
      await db
        .select()
        .from(schema.eventosAuditoria)
        .where(eq(schema.eventosAuditoria.entidadeId, nova.id)),
    ).toHaveLength(1);
    await expect(
      service.salvar(
        { ...BENEFICIO_BA_2026, tipo: 'ISENCAO', versaoAnterior: 1 },
        actorId,
      ),
    ).rejects.toThrow('alterado');
  });
  it('serializa cadastros concorrentes e impede regras sobrepostas', async () => {
    const input = {
      ...BENEFICIO_BA_2026,
      tipo: 'REDUCAO' as const,
      uf: 'SP',
      percentualReducao: '0.5000',
      versaoAnterior: 0,
    };
    const results = await Promise.allSettled(
      ['SP_A', 'SP_B'].map((codigo) =>
        service.salvar({ ...input, codigo }, actorId),
      ),
    );
    expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(
      1,
    );
    expect(results.filter((item) => item.status === 'rejected')).toHaveLength(
      1,
    );
  });
  it('mantém invariantes no PostgreSQL mesmo sem validação do DTO', async () => {
    await expect(
      db.insert(schema.fiscalSimplesBeneficios).values({
        ...BENEFICIO_BA_2026,
        codigo: 'INVALID_PERCENT',
        percentualReducao: '1.1000',
      }),
    ).rejects.toThrow();
    await expect(
      db
        .insert(schema.fiscalSimplesBeneficios)
        .values({ ...BENEFICIO_BA_2026, codigo: 'INVALID_UF', uf: 'XX' }),
    ).rejects.toThrow();
    await expect(
      db.insert(schema.fiscalSimplesBeneficios).values({
        ...BENEFICIO_BA_2026,
        codigo: 'INVALID_ACTIVITY',
        atividades: ['ANEXO_III'],
      }),
    ).rejects.toThrow();
  });
  it('apura e persiste a isenção, e bloqueia fechar após mudança dos parâmetros', async () => {
    await service.salvar(
      { ...BENEFICIO_BA_2026, tipo: 'ISENCAO', versaoAnterior: 2 },
      actorId,
    );
    await db.insert(schema.fiscalSimplesHistoricosMensais).values({
      clienteId,
      competencia: '2026-09-01',
      receitaBruta: '10000.00',
    });
    const [doc] = await db
      .insert(schema.documentosFiscais)
      .values({
        clienteId,
        chaveAcesso: '29261012345678000195550010000000011000000011',
        nsu: 1,
        tipoDocumento: 'NFE',
        modelo: '55',
        numeroDocumento: '1',
        emitenteCnpjCpf: '12345678000195',
        destinatarioCnpjCpf: '98765432000110',
        dataEmissao: new Date('2026-10-10T12:00:00Z'),
        dataEmissaoFiscal: '2026-10-10',
        valorTotal: '10000.00',
        tipoOperacaoEscriturada: 'SAIDA',
        tpNfXml: '1',
        xmlKey: 'test.xml',
      })
      .returning();
    await db.insert(schema.documentosFiscaisItens).values({
      clienteId,
      documentoFiscalId: doc.id,
      numeroItem: 1,
      codigoProduto: 'P1',
      descricao: 'Mercadoria',
      cfop: '5102',
      cfopXml: '5102',
      tipoOperacaoEscriturada: 'SAIDA',
      unidadeComercial: 'UN',
      quantidadeComercial: '1',
      valorUnitarioComercial: '10000.00',
      valorBrutoProduto: '10000.00',
      indTotal: '1',
      csosnIcms: '102',
    });
    const motor = new SimplesNacionalService(
      { db } as never,
      new SimplesCalculadorService(),
      null!,
      null!,
    );
    const apuracao = await motor.apurar({ clienteId, competencia: '2026-10' });
    expect(apuracao).toMatchObject({
      valor_total_das: '264.00',
      receita_bruta_mes: '10000.00',
      rbt12: '10000.00',
      memoria_calculo: { pendencias: [] },
    });
    expect(apuracao.itens[0]).toMatchObject({
      segregacao: 'ICMS_ISENTO',
      tributos_partilhados: { icms: '0.00' },
    });
    await service.salvar(
      {
        ...BENEFICIO_BA_2026,
        tipo: 'ISENCAO',
        ativo: false,
        versaoAnterior: 3,
      },
      actorId,
    );
    await expect(
      motor.fechar({
        clienteId,
        competencia: '2026-10',
        actorUserId: actorId,
        apuracaoId: apuracao.id,
      }),
    ).rejects.toMatchObject({
      response: { code: 'APURACAO_SIMPLES_BENEFICIOS_ALTERADOS' },
    });
    expect(
      (await motor.obterApuracao(clienteId, '2026-10')).valor_total_das,
    ).toBe('264.00');
  });
});
