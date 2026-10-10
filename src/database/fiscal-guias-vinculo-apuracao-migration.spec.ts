import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Fase 5, tarefa 1.2 (R1.1 / R1.7): a migração que SEPARA os quatro conceitos
// no mundo das guias — obrigação calculada, guia emitida, pagamento e
// conciliação — adicionando a `fiscal_apuracoes_guias` a ORIGEM da guia e o
// VÍNCULO com a versão de apuração (fechamento da Fase 3). A migração DEVE ser
// puramente aditiva, restringir o domínio de origem e garantir, no banco, que
// uma guia CALCULADA (origem APURACAO) nunca exista sem o fechamento que a
// originou. Os testes são ESTÁTICOS (asserção sobre o SQL gerado), no mesmo
// padrão das demais specs de migração deste diretório.
describe('migração fiscal_apuracoes_guias — vínculo com a apuração (0020)', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'drizzle/0020_fase5_guias_vinculo_apuracao.sql'),
    'utf8',
  );

  it('adiciona a ORIGEM da guia com default MANUAL (preserva guias legadas)', () => {
    // Default 'MANUAL' torna a coluna NOT NULL compatível com linhas já
    // existentes — nenhuma guia antiga passa a violar a nova coluna.
    expect(sql).toContain(
      'ADD COLUMN "origem" varchar(20) DEFAULT \'MANUAL\' NOT NULL',
    );
  });

  it('adiciona o VÍNCULO com a versão de apuração (fechamento) como FK opcional', () => {
    // Nullable mantém a migração aditiva (guias manuais legadas não têm
    // fechamento); `set null` em delete preserva a guia e seu histórico.
    expect(sql).toContain('ADD COLUMN "fechamento_id" uuid');
    expect(sql).toContain(
      'REFERENCES "public"."fiscal_fechamentos"("id") ON DELETE set null',
    );
    // Índice de projeção para a conciliação guia ↔ apuração (R1.7).
    expect(sql).toContain('CREATE INDEX "idx_fiscal_guias_fechamento"');
    expect(sql).toContain('"fechamento_id"');
  });

  it('restringe o domínio de origem a APURACAO/MANUAL (R1.1)', () => {
    expect(sql).toContain('chk_fiscal_guias_origem');
    expect(sql).toContain("'APURACAO', 'MANUAL'");
  });

  it('EXIGE vínculo com a apuração quando a guia é CALCULADA (R1.7)', () => {
    // Última linha de defesa no banco: guia de origem APURACAO sem fechamento é
    // impossível. Guia MANUAL permanece sem exigência de fechamento.
    expect(sql).toContain('chk_fiscal_guias_apuracao_vinculo');
    expect(sql).toContain(
      '"origem" <> \'APURACAO\' OR "fiscal_apuracoes_guias"."fechamento_id" IS NOT NULL',
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
