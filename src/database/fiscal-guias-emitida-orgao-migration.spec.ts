import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Fase 5, tarefa 1.5 (R1.5): a migração que torna explícita a distinção
// REGISTRAR ≠ EMITIDA no órgão arrecadador. Acrescenta a `fiscal_apuracoes_guias`
// o flag `emitida_orgao` (default false) e a data `emitida_orgao_em`, mais um
// check garantindo que guia marcada como emitida tenha a data da emissão. DEVE
// ser puramente aditiva. Testes ESTÁTICOS sobre o SQL gerado, no mesmo padrão
// das demais specs de migração deste diretório.
describe('migração fiscal_apuracoes_guias — emitida no órgão (0023)', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'drizzle/0023_fase5_guias_emitida_orgao.sql'),
    'utf8',
  );

  it('adiciona o FLAG emitida_orgao com default false (preserva guias legadas)', () => {
    // Default false mantém a coluna NOT NULL compatível com linhas existentes:
    // registrar uma guia nunca a marca, por si só, como emitida no órgão (R1.5).
    expect(sql).toContain(
      'ADD COLUMN "emitida_orgao" boolean DEFAULT false NOT NULL',
    );
  });

  it('adiciona a DATA da emissão no órgão como coluna opcional', () => {
    // Nullable: só preenchida quando a guia é de fato emitida/transmitida no
    // órgão. Preserva o rastro de QUANDO a emissão ocorreu (R1.5).
    expect(sql).toContain('ADD COLUMN "emitida_orgao_em" timestamp');
  });

  it('garante, no banco, que guia emitida no órgão tenha a data da emissão', () => {
    // Última linha de defesa: emitida_orgao = true ⇒ emitida_orgao_em preenchida.
    expect(sql).toContain('chk_fiscal_guias_emissao_orgao');
    expect(sql).toContain(
      '"fiscal_apuracoes_guias"."emitida_orgao" = false OR "fiscal_apuracoes_guias"."emitida_orgao_em" IS NOT NULL',
    );
  });

  it('é puramente ADITIVA: nunca altera nem remove estruturas existentes', () => {
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql).not.toMatch(/DROP\s+COLUMN/i);
    expect(sql).not.toMatch(/DROP\s+INDEX/i);
    expect(sql).not.toMatch(/DROP\s+CONSTRAINT/i);
    expect(sql).not.toMatch(/ALTER\s+COLUMN/i);
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
