import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Fase 5, tarefa 1.6 (R1.6): a migração que habilita a DEDUPLICAÇÃO POR CHAVE DE
// IDEMPOTÊNCIA na criação de guias. Acrescenta a `fiscal_apuracoes_guias` a
// coluna `idempotency_key` e um ÍNDICE ÚNICO PARCIAL escopado por cliente, que
// só vale quando há chave. O efeito é duplo: um RETRY com a mesma chave não cria
// guia duplicada, mas múltiplas obrigações LEGÍTIMAS do mesmo tributo/período/UF
// (chaves distintas, ou sem chave) permanecem permitidas — a chave é a fronteira
// de dedupe, NUNCA uma unicidade por tributo/período/UF. DEVE ser puramente
// aditiva. Testes ESTÁTICOS sobre o SQL gerado, no mesmo padrão das demais specs
// de migração deste diretório.
describe('migração fiscal_apuracoes_guias — idempotency key (0024)', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'drizzle/0024_fase5_guias_idempotency_key.sql'),
    'utf8',
  );

  it('adiciona a CHAVE de idempotência como coluna opcional (preserva guias legadas)', () => {
    // Nullable: guias sem chave ficam fora do índice único parcial e não são
    // bloqueadas — a migração não deduplica retroativamente nada (R1.6).
    expect(sql).toContain('ADD COLUMN "idempotency_key" text');
    // Não é NOT NULL: a chave é opcional, por requisição.
    expect(sql).not.toMatch(/ADD COLUMN "idempotency_key" text[^;]*NOT NULL/i);
  });

  it('cria índice ÚNICO PARCIAL escopado por cliente, válido só quando há chave', () => {
    // Unicidade por (cliente_id, idempotency_key): o RETRY com a mesma chave
    // colide aqui (última linha de defesa contra corrida), mas múltiplas
    // obrigações legítimas do mesmo tributo/período/UF seguem permitidas.
    expect(sql).toContain('CREATE UNIQUE INDEX');
    expect(sql).toContain('uidx_fiscal_guias_cliente_idempotency');
    expect(sql).toContain('"cliente_id","idempotency_key"');
    // PARCIAL: só linhas com chave participam da unicidade (aditivo p/ legadas).
    expect(sql).toMatch(/WHERE[\s\S]*"idempotency_key" IS NOT NULL/i);
  });

  it('a unicidade NÃO é por tributo/período/UF (não impede obrigações legítimas)', () => {
    // Garante que a migração não introduziu unicidade sobre tributo/competência/
    // uf_favorecida, que impediria duas obrigações legítimas do mesmo escopo.
    expect(sql).not.toMatch(/tributo/i);
    expect(sql).not.toMatch(/competencia/i);
    expect(sql).not.toMatch(/uf_favorecida/i);
  });

  it('é puramente ADITIVA: nunca altera nem remove estruturas existentes', () => {
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql).not.toMatch(/DROP\s+COLUMN/i);
    expect(sql).not.toMatch(/DROP\s+INDEX/i);
    expect(sql).not.toMatch(/DROP\s+CONSTRAINT/i);
    expect(sql).not.toMatch(/ALTER\s+COLUMN/i);
    expect(sql).not.toMatch(/DELETE\s+FROM/i);
    // Só toca a própria tabela de guias (ADD COLUMN + CREATE INDEX nela).
    const alvosAlterados = Array.from(
      sql.matchAll(/ALTER TABLE "([a-z_]+)"/gi),
    ).map((m) => m[1]);
    expect(new Set(alvosAlterados)).toEqual(
      new Set(['fiscal_apuracoes_guias']),
    );
  });
});
