import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('migração do catálogo de contadores', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'drizzle/0001_contadores_catalogo_sped.sql'),
    'utf8',
  );

  it('preserva e deduplica os contabilistas legados antes de criar o vínculo', () => {
    expect(sql).toContain('FROM "sped_contabilistas"');
    expect(sql).toContain('ON CONFLICT DO NOTHING');
    expect(sql).toContain('UPDATE "clientes" cliente');
    expect(sql).toContain('WHERE cliente."contador_id" IS NULL');
  });

  it('remove a unicidade legada e protege a integridade do novo vínculo', () => {
    expect(sql).toContain('DROP INDEX "uidx_sped_contabilista_cliente"');
    expect(sql).toContain('ON DELETE set null');
    expect(sql).toContain('uidx_contadores_cpf_crc');
    expect(sql).toContain('uidx_contadores_cnpj_crc');
  });
});
