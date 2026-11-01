import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { E111_CIAP_DEFAULT_SEED } from './seeds/fiscal-catalogos.seed';

const baselineSql = readFileSync(
  resolve(process.cwd(), 'drizzle/0000_baseline_kontabb.sql'),
  'utf8',
);
const baselineSnapshot = JSON.parse(
  readFileSync(
    resolve(process.cwd(), 'drizzle/meta/0000_snapshot.json'),
    'utf8',
  ),
) as { tables: Record<string, { name: string }> };
const schemaSource = readFileSync(
  resolve(process.cwd(), 'src/database/schema.ts'),
  'utf8',
);
const cleanupSql = readFileSync(
  resolve(process.cwd(), 'drizzle/0004_remove_unused_tables.sql'),
  'utf8',
);

describe('baseline do banco', () => {
  it('preserva as 57 tabelas da baseline histórica e separa as três removidas do schema atual', () => {
    const baselineTables = Object.values(baselineSnapshot.tables).map(
      (table) => table.name,
    );
    const currentTables = Array.from(
      schemaSource.matchAll(/pgTable\(\s*'([^']+)'/g),
      (match) => match[1],
    );

    expect(baselineTables).toHaveLength(57);
    expect(currentTables).toHaveLength(54);
    for (const tableName of baselineTables) {
      expect(baselineSql).toContain(`CREATE TABLE "${tableName}"`);
    }
    expect(
      baselineTables.filter((name) => !currentTables.includes(name)).sort(),
    ).toEqual([
      'fiscal_lancamentos',
      'fiscal_perfis_vigencia',
      'sped_contabilistas',
    ]);
    expect(currentTables.every((name) => baselineTables.includes(name))).toBe(
      true,
    );
  });

  it('inclui as estruturas fiscais e de RH que a API usa', () => {
    for (const fragment of [
      'CREATE TABLE "fiscal_entregas"',
      'CREATE TABLE "fiscal_fechamentos"',
      'CREATE TABLE "fiscal_catalogos_versoes"',
      'CREATE TABLE "fiscal_simples_tabelas"',
      'CREATE TABLE "ciap_ativo_permanente"',
      'CREATE TABLE "documentos_fiscais_cte_escrituracao"',
      'CREATE TABLE "folhas_pagamento"',
      'CREATE TABLE "funcionarios_rh"',
      '"token_version" integer DEFAULT 0 NOT NULL',
      "\"tipo\" IN ('FOLHA_MENSAL', 'FERIAS', 'ADIANTAMENTO_13')",
      "\"tipo_documento\" IN ('NFE', 'CTE', 'NFCE', 'NFSE')",
      '"fiscal_entregas_original_fk"',
      '"uidx_ciap_cliente_chave_aquisicao"',
    ]) {
      expect(baselineSql).toContain(fragment);
    }
  });

  it('contém somente DDL; dados obrigatórios são tratados pelos seeds', () => {
    expect(baselineSql).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|DROP)\b/im);
  });

  it('mantém o catálogo E111 inicial fora da baseline, em um seed idempotente', () => {
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

  it('a 0004 exige vazio e dependências livres antes de remover as três tabelas', () => {
    expect(cleanupSql).toContain('IN ACCESS EXCLUSIVE MODE');
    for (const tableName of [
      'fiscal_lancamentos',
      'fiscal_perfis_vigencia',
      'sped_contabilistas',
    ]) {
      expect(cleanupSql).toContain(`SELECT 1 FROM public.${tableName}`);
      expect(cleanupSql).toContain(`DROP TABLE public.${tableName} RESTRICT`);
    }
    expect(cleanupSql).not.toMatch(/\bCASCADE\b/i);
  });
});
