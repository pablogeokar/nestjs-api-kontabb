import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { E111_CIAP_DEFAULT_SEED } from './seeds/fiscal-catalogos.seed';

const baselineSql = readFileSync(
  resolve(process.cwd(), 'drizzle/0000_baseline_kontabb.sql'),
  'utf8',
);
const schemaSource = readFileSync(
  resolve(process.cwd(), 'src/database/schema.ts'),
  'utf8',
);

describe('baseline do banco', () => {
  it('cria todas as tabelas declaradas pelo schema atual', () => {
    const tableNames = Array.from(
      schemaSource.matchAll(/pgTable\(\s*'([^']+)'/g),
      (match) => match[1],
    );

    expect(tableNames).toHaveLength(57);
    for (const tableName of tableNames) {
      expect(baselineSql).toContain(`CREATE TABLE "${tableName}"`);
    }
  });

  it('inclui as estruturas fiscais e de RH que a API usa', () => {
    for (const fragment of [
      'CREATE TABLE "fiscal_entregas"',
      'CREATE TABLE "fiscal_lancamentos"',
      'CREATE TABLE "fiscal_fechamentos"',
      'CREATE TABLE "fiscal_catalogos_versoes"',
      'CREATE TABLE "fiscal_simples_tabelas"',
      'CREATE TABLE "ciap_ativo_permanente"',
      'CREATE TABLE "documentos_fiscais_cte_escrituracao"',
      'CREATE TABLE "folhas_pagamento"',
      'CREATE TABLE "funcionarios_rh"',
      '"token_version" integer DEFAULT 0 NOT NULL',
      '"tipo" IN (\'FOLHA_MENSAL\', \'FERIAS\', \'ADIANTAMENTO_13\')',
      '"tipo_documento" IN (\'NFE\', \'CTE\', \'NFCE\', \'NFSE\')',
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
});
