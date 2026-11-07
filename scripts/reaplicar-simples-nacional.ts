#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import postgres from 'postgres';
import {
  seedSimplesNacional,
  SIMPLES_TABELA_VERSAO,
  SIMPLES_UFS,
} from '../src/database/seeds/simples-nacional.seed';

interface Options {
  execute: boolean;
  expectDatabase?: string;
  expectHost?: string;
  snapshot?: string;
}

interface IdentityRow {
  database: string;
  usuario: string;
  servidor: string | null;
}

interface TabelaRow {
  id: string;
  versao: string;
  ativo: boolean;
  vigencia_inicio: Date;
  vigencia_fim: Date | null;
}

interface AnexoRow {
  id: string;
  tabela_id: string;
}

interface FaixaRow {
  anexo_id: string;
}

interface SublimiteRow {
  uf: string;
  ano_vigencia: number;
  valor_sublimite: string;
  ativo: boolean;
}

interface ReferenciaRow {
  tabela_id: string;
  apuracoes: number;
  fechadas: number;
}

function parseOptions(argv: string[]): Options {
  const options: Options = { execute: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--execute') {
      options.execute = true;
      continue;
    }
    const value = argv[++index];
    if (!value) throw new Error(`Falta o valor de ${arg}.`);
    if (arg === '--expect-database') options.expectDatabase = value;
    else if (arg === '--expect-host') options.expectHost = value;
    else if (arg === '--snapshot') options.snapshot = value;
    else throw new Error(`Argumento inválido: ${arg}.`);
  }
  return options;
}

function defaultSnapshotPath(host: string, database: string): string {
  const safeTarget = `${host}_${database}`.replace(/[^a-zA-Z0-9_-]/g, '_');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return join(
    homedir(),
    '.kontabb',
    'backups',
    'simples-nacional',
    `${safeTarget}_${timestamp}_${randomUUID().slice(0, 8)}.json`,
  );
}

async function inspect(databaseUrl: string) {
  const db = postgres(databaseUrl, { max: 1 });
  try {
    const [identity] = await db<IdentityRow[]>`
      SELECT current_database() AS database, current_user AS usuario,
             inet_server_addr()::text AS servidor
    `;
    const [tabelas, anexos, faixas, sublimites] = await Promise.all([
      db<
        TabelaRow[]
      >`SELECT * FROM fiscal_simples_tabelas ORDER BY vigencia_inicio, versao`,
      db<
        AnexoRow[]
      >`SELECT * FROM fiscal_simples_anexos ORDER BY tabela_id, anexo`,
      db<
        FaixaRow[]
      >`SELECT * FROM fiscal_simples_faixas ORDER BY anexo_id, faixa`,
      db<
        SublimiteRow[]
      >`SELECT * FROM fiscal_simples_sublimites ORDER BY ano_vigencia, uf`,
    ]);
    const referencias = await db<ReferenciaRow[]>`
      SELECT tabela_id,
             count(*)::int AS apuracoes,
             count(*) FILTER (WHERE status = 'FECHADO')::int AS fechadas
      FROM fiscal_simples_apuracoes
      GROUP BY tabela_id
    `;
    const referenciasPorTabela = new Map(
      referencias.map((row) => [row.tabela_id, row]),
    );
    const ufs = new Set<string>(SIMPLES_UFS);
    const sublimitesCanonicos = sublimites.filter(
      (row) => [2025, 2026].includes(row.ano_vigencia) && ufs.has(row.uf),
    );
    const inicioCoberto = new Date('2018-01-01T00:00:00Z');
    const fimCoberto = new Date('2026-12-31T00:00:00Z');
    const resumo = {
      database: identity.database,
      usuario: identity.usuario,
      servidor: identity.servidor,
      versaoNova: SIMPLES_TABELA_VERSAO,
      versoesAtivasQueSeraoDesativadas: tabelas
        .filter(
          (row) =>
            row.ativo &&
            row.versao !== SIMPLES_TABELA_VERSAO &&
            row.vigencia_inicio <= fimCoberto &&
            (row.vigencia_fim === null || row.vigencia_fim >= inicioCoberto),
        )
        .map((row) => row.versao),
      tabelas: tabelas.map((row) => ({
        versao: row.versao,
        ativo: row.ativo,
        inicio: row.vigencia_inicio,
        fim: row.vigencia_fim,
        anexos: anexos.filter((item) => item.tabela_id === row.id).length,
        faixas: faixas.filter((item) =>
          anexos.some(
            (anexo) => anexo.tabela_id === row.id && anexo.id === item.anexo_id,
          ),
        ).length,
        apuracoes: referenciasPorTabela.get(row.id)?.apuracoes ?? 0,
        fechadas: referenciasPorTabela.get(row.id)?.fechadas ?? 0,
      })),
      sublimites2025e2026: {
        cadastrados: sublimitesCanonicos.length,
        divergentes: sublimitesCanonicos
          .filter((row) => !row.ativo || row.valor_sublimite !== '3600000.00')
          .map((row) => `${row.uf}/${row.ano_vigencia}`),
        ufsNaoReconhecidas: sublimites
          .filter(
            (row) =>
              [2025, 2026].includes(row.ano_vigencia) && !ufs.has(row.uf),
          )
          .map((row) => `${row.uf}/${row.ano_vigencia}`),
      },
    };
    return {
      resumo,
      snapshot: {
        criadoEm: new Date().toISOString(),
        identidade: identity,
        tabelas,
        anexos,
        faixas,
        sublimites,
      },
    };
  } finally {
    await db.end({ timeout: 5 });
  }
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL não configurada.');
  const host = new URL(databaseUrl).hostname;
  const antes = await inspect(databaseUrl);
  process.stdout.write(
    `${JSON.stringify({ host, ...antes.resumo }, null, 2)}\n`,
  );
  if (
    options.expectDatabase &&
    options.expectDatabase !== antes.resumo.database
  )
    throw new Error('O nome do banco não corresponde a --expect-database.');
  if (options.expectHost && options.expectHost !== host)
    throw new Error('O host não corresponde a --expect-host.');
  if (!options.execute) {
    process.stdout.write(
      'MODO PRÉVIA: nenhuma tabela foi alterada. Para aplicar a seed R2, execute novamente com --execute; a cópia será criada automaticamente.\n',
    );
    return;
  }

  const snapshotPath = options.snapshot
    ? resolve(options.snapshot)
    : defaultSnapshotPath(host, antes.resumo.database);
  await mkdir(dirname(snapshotPath), { recursive: true, mode: 0o700 });
  await writeFile(
    snapshotPath,
    `${JSON.stringify(antes.snapshot, null, 2)}\n`,
    { flag: 'wx', mode: 0o600 },
  );
  process.stdout.write(`Cópia dos parâmetros anteriores: ${snapshotPath}\n`);
  await seedSimplesNacional(databaseUrl);
  const depois = await inspect(databaseUrl);
  const nova = depois.resumo.tabelas.find(
    (row) => row.versao === SIMPLES_TABELA_VERSAO,
  );
  if (
    !nova?.ativo ||
    nova.anexos !== 5 ||
    nova.faixas !== 30 ||
    depois.resumo.versoesAtivasQueSeraoDesativadas.length > 0 ||
    depois.resumo.sublimites2025e2026.cadastrados !== 54 ||
    depois.resumo.sublimites2025e2026.divergentes.length > 0
  ) {
    throw new Error('A verificação pós-seed encontrou parâmetros incompletos.');
  }
  process.stdout.write(
    `Seed aplicada: ${nova.versao}, 5 anexos, 30 faixas e 54 sublimites oficiais. Apurações históricas preservadas.\n`,
  );
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `Falha ao reaplicar o Simples: ${error instanceof Error ? error.message : 'erro desconhecido'}\n`,
  );
  process.exitCode = 1;
});
