import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('migração de suporte à NFS-e WebISS', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'drizzle/0030_optimal_toro.sql'),
    'utf8',
  );

  it('adiciona os metadados municipais sem tornar colunas legadas obrigatórias', () => {
    expect(sql).toContain('"competencia_declarada" date');
    expect(sql).toContain('"nfse_dados" jsonb');
    expect(sql).toContain('"valor_bc_iss" numeric(15, 2)');
    expect(sql).toContain('"iss_retido" boolean DEFAULT false NOT NULL');
  });

  it('aceita o par NFSE/NFSE e identificadores de até 50 caracteres', () => {
    expect(sql).toContain("'NFSE' AND length");
    expect(sql).toContain('BETWEEN 14 AND 50');
    expect(sql).toContain(
      `"tipo_documento" = 'NFSE' AND "documentos_fiscais"."modelo" = 'NFSE'`,
    );
  });
});
