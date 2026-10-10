import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Fase 5, tarefa 2.3 (R2.3): quando o storage falha APÓS o snapshot, o sistema
// registra status de falha, compensa e permite RETRY RASTREÁVEL. A geração do
// snapshot usa transação no banco; o upload externo (R2) NÃO participa dela.
// Esta migração acrescenta ao `fiscal_entregas` o rastro do retry amarrado ao
// MESMO snapshot: `tentativas_storage` (contagem) e `ultimo_erro_storage`
// (último erro). DEVE ser puramente ADITIVA (só ADD COLUMN). Testes ESTÁTICOS,
// no mesmo padrão das demais specs de migração deste diretório.
describe('migração fiscal_entregas retry/storage (0026)', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'drizzle/0026_fase5_fiscal_entregas_retry_storage.sql',
    ),
    'utf8',
  );

  it('acrescenta o CONTADOR de tentativas de upload (default 0, NOT NULL)', () => {
    expect(sql).toContain(
      'ADD COLUMN "tentativas_storage" integer DEFAULT 0 NOT NULL',
    );
  });

  it('acrescenta o RASTRO do último erro de storage (texto, opcional)', () => {
    expect(sql).toContain('ADD COLUMN "ultimo_erro_storage" text');
  });

  it('só toca `fiscal_entregas` — não altera outras estruturas', () => {
    const alvosAlterados = Array.from(
      sql.matchAll(/ALTER TABLE "([a-z_]+)"/gi),
    ).map((m) => m[1]);
    expect(new Set(alvosAlterados)).toEqual(new Set(['fiscal_entregas']));
  });

  it('é puramente ADITIVA: só ADD COLUMN; nenhum DROP/ALTER destrutivo', () => {
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql).not.toMatch(/DROP\s+COLUMN/i);
    expect(sql).not.toMatch(/DROP\s+CONSTRAINT/i);
    expect(sql).not.toMatch(/ALTER\s+COLUMN/i);
    // Toda alteração é um ADD COLUMN.
    const alteracoes = Array.from(
      sql.matchAll(/ALTER TABLE "[a-z_]+" ([A-Z ]+?)"/g),
    ).map((m) => m[1].trim());
    expect(alteracoes.every((a) => a === 'ADD COLUMN')).toBe(true);
  });

  it('não usa real/double/float (o contador é integer)', () => {
    expect(sql).not.toMatch(/\b(real|double precision|float)\b/i);
  });
});
