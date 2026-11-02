import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { E111_CIAP_DEFAULT_SEED } from './seeds/fiscal-catalogos.seed';

const journal = JSON.parse(
  readFileSync(resolve(process.cwd(), 'drizzle/meta/_journal.json'), 'utf8'),
) as { entries: Array<{ idx: number; tag: string }> };
const baselineTag = journal.entries[0].tag;
const baselineSql = readFileSync(
  resolve(process.cwd(), `drizzle/${baselineTag}.sql`),
  'utf8',
);
const baselineSnapshot = JSON.parse(
  readFileSync(
    resolve(process.cwd(), 'drizzle/meta/0000_snapshot.json'),
    'utf8',
  ),
) as { tables: Record<string, { name: string }> };

describe('nova baseline do banco', () => {
  it('cria as 54 tabelas atuais em banco vazio', () => {
    expect(journal.entries[0].idx).toBe(0);
    const tables = Object.values(baselineSnapshot.tables).map(
      (table) => table.name,
    );
    expect(tables).toHaveLength(54);
    for (const table of tables) {
      expect(baselineSql).toContain(`CREATE TABLE "${table}"`);
    }
    for (const oldTable of [
      'fiscal_lancamentos',
      'fiscal_perfis_vigencia',
      'sped_contabilistas',
    ]) {
      expect(tables).not.toContain(oldTable);
    }
  });

  it('preserva as estruturas fiscais e de RH usadas pela API', () => {
    for (const fragment of [
      'CREATE TABLE "fiscal_entregas"',
      'CREATE TABLE "fiscal_fechamentos"',
      'CREATE TABLE "fiscal_simples_tabelas"',
      'CREATE TABLE "ciap_ativo_permanente"',
      'CREATE TABLE "documentos_fiscais_cte_escrituracao"',
      'CREATE TABLE "folhas_pagamento"',
      'CREATE TABLE "funcionarios_rh"',
      '"token_version" integer DEFAULT 0 NOT NULL',
      '"fiscal_entregas_original_fk"',
      '"uidx_ciap_cliente_chave_aquisicao"',
    ]) {
      expect(baselineSql).toContain(fragment);
    }
  });

  it('usa nomes de foreign keys que o PostgreSQL não truncará', () => {
    const names = Array.from(
      baselineSql.matchAll(/ADD CONSTRAINT "([^"]+)" FOREIGN KEY/g),
      (match) => match[1],
    );
    expect(names).toHaveLength(98);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(Buffer.byteLength(name, 'utf8')).toBeLessThanOrEqual(63);
    }
  });

  it('contém somente DDL; dados obrigatórios vêm dos seeds', () => {
    expect(baselineSql).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|DROP)\b/im);
  });

  it('mantém o catálogo E111 inicial em seed idempotente', () => {
    expect(E111_CIAP_DEFAULT_SEED).toHaveLength(27);
    expect(E111_CIAP_DEFAULT_SEED).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tipo: 'E111_CIAP',
          uf: 'BA',
          codigo: 'BA02CIAP',
          vigenciaInicio: '2026-01-01',
          fonte: 'default_pendente_confirmacao',
        }),
      ]),
    );
  });
});
