import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Fase 5, tarefa 1.3 (R1.2): a migração que adiciona a SINALIZAÇÃO de guia
// divergente da obrigação apurada a `fiscal_apuracoes_guias`. Acrescenta o
// flag `divergente_obrigacao` e o `valor_obrigacao` congelado (total da
// obrigação contra o qual a guia foi comparada). DEVE ser puramente aditiva e
// garantir, no banco, que apenas guia de origem APURAÇÃO carregue divergência/
// valor de obrigação (guia MANUAL não tem do que divergir). Testes ESTÁTICOS
// sobre o SQL gerado, no mesmo padrão das demais specs de migração.
describe('migração fiscal_apuracoes_guias — divergência da obrigação (0021)', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'drizzle/0021_fase5_guias_divergencia_obrigacao.sql'),
    'utf8',
  );

  it('adiciona o FLAG de divergência com default false (preserva guias legadas)', () => {
    // Default false torna a coluna NOT NULL compatível com linhas existentes:
    // nenhuma guia antiga passa a aparecer divergente por efeito da migração.
    expect(sql).toContain(
      'ADD COLUMN "divergente_obrigacao" boolean DEFAULT false NOT NULL',
    );
  });

  it('adiciona o VALOR da obrigação comparado como coluna opcional', () => {
    // Nullable: só é preenchido para guia APURAÇÃO; guia MANUAL não tem
    // obrigação apurada. Congela o valor comparado para auditoria (R1.2).
    expect(sql).toContain('ADD COLUMN "valor_obrigacao" numeric(15, 2)');
  });

  it('restringe divergência/valor de obrigação à guia de origem APURAÇÃO (R1.2)', () => {
    // Última linha de defesa no banco: guia MANUAL não pode ser marcada
    // divergente nem carregar valor de obrigação (não há do que divergir).
    expect(sql).toContain('chk_fiscal_guias_divergencia_apuracao');
    expect(sql).toContain(
      '"origem" = \'APURACAO\' OR ("fiscal_apuracoes_guias"."divergente_obrigacao" = false AND "fiscal_apuracoes_guias"."valor_obrigacao" IS NULL)',
    );
  });

  it('é puramente ADITIVA: nunca altera nem remove estruturas existentes', () => {
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql).not.toMatch(/DROP\s+COLUMN/i);
    expect(sql).not.toMatch(/DROP\s+INDEX/i);
    expect(sql).not.toMatch(/DROP\s+CONSTRAINT/i);
    expect(sql).not.toMatch(/ALTER\s+COLUMN/i);
    // Só toca a própria tabela de guias (ADD COLUMN/CONSTRAINT); não altera
    // fiscal_fechamentos nem qualquer outra estrutura existente.
    const alvosAlterados = Array.from(
      sql.matchAll(/ALTER TABLE "([a-z_]+)"/gi),
    ).map((m) => m[1]);
    expect(new Set(alvosAlterados)).toEqual(
      new Set(['fiscal_apuracoes_guias']),
    );
  });
});
