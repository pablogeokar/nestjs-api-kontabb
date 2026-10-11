import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Fase 5, tarefa 1.4 (R1.4): a migração que habilita o CANCELAMENTO LÓGICO de
// guias em vez de delete físico. Acrescenta a `fiscal_apuracoes_guias` o flag
// `cancelada`, a data `cancelada_em` e o `motivo_cancelamento`, preservando a
// linha (e toda a trilha de pagamentos vinculada) ao "remover" uma guia. DEVE
// ser puramente aditiva e garantir, no banco, que uma guia cancelada tenha a
// data do cancelamento. Testes ESTÁTICOS sobre o SQL gerado, no mesmo padrão
// das demais specs de migração deste diretório.
describe('migração fiscal_apuracoes_guias — cancelamento lógico (0022)', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'drizzle/0022_fase5_guias_cancelamento_logico.sql'),
    'utf8',
  );

  it('adiciona o FLAG de cancelamento com default false (preserva guias legadas)', () => {
    // Default false mantém a coluna NOT NULL compatível com linhas existentes:
    // nenhuma guia antiga aparece cancelada por efeito da migração.
    expect(sql).toContain(
      'ADD COLUMN "cancelada" boolean DEFAULT false NOT NULL',
    );
  });

  it('adiciona a DATA e o MOTIVO do cancelamento como colunas opcionais', () => {
    // Nullable: só preenchidas quando a guia é de fato cancelada; o motivo é
    // opcional (rastro mínimo). Preservam o histórico do cancelamento (R1.4).
    expect(sql).toContain('ADD COLUMN "cancelada_em" timestamp');
    expect(sql).toContain('ADD COLUMN "motivo_cancelamento" text');
  });

  it('garante, no banco, que guia cancelada tenha a data do cancelamento', () => {
    // Última linha de defesa: cancelada = true ⇒ cancelada_em preenchida.
    expect(sql).toContain('chk_fiscal_guias_cancelamento');
    expect(sql).toContain(
      '"fiscal_apuracoes_guias"."cancelada" = false OR "fiscal_apuracoes_guias"."cancelada_em" IS NOT NULL',
    );
  });

  it('é puramente ADITIVA: nunca altera nem remove estruturas existentes', () => {
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql).not.toMatch(/DROP\s+COLUMN/i);
    expect(sql).not.toMatch(/DROP\s+INDEX/i);
    expect(sql).not.toMatch(/DROP\s+CONSTRAINT/i);
    expect(sql).not.toMatch(/ALTER\s+COLUMN/i);
    // Nenhum DELETE físico de dados é parte desta migração: o cancelamento é
    // lógico, nunca remoção de linhas (R1.4).
    expect(sql).not.toMatch(/DELETE\s+FROM/i);
    // Só toca a própria tabela de guias (ADD COLUMN/CONSTRAINT).
    const alvosAlterados = Array.from(
      sql.matchAll(/ALTER TABLE "([a-z_]+)"/gi),
    ).map((m) => m[1]);
    expect(new Set(alvosAlterados)).toEqual(
      new Set(['fiscal_apuracoes_guias']),
    );
  });
});
