import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Fase 3, tarefa 1.1 (R2.1/R2.2): a migração que introduz `fiscal_lancamentos`
// — a FONTE COMUM de créditos/débitos de livros, painéis e SPED — DEVE ser
// puramente aditiva, armazenar valores DECIMAIS (nunca `Number`), tornar
// natureza/sinal EXPLÍCITOS, carregar origem e competência, e ter uma CHAVE
// IDEMPOTENTE por fato/versão. Os testes são ESTÁTICOS (asserção sobre o SQL
// gerado), no mesmo padrão das demais specs de migração deste diretório.
describe('migração fiscal_lancamentos (0016)', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'drizzle/0016_fiscal_lancamentos.sql'),
    'utf8',
  );

  it('cria a tabela de lançamentos normalizados', () => {
    expect(sql).toContain('CREATE TABLE "fiscal_lancamentos"');
    expect(sql).toContain('"cliente_id" uuid NOT NULL');
    expect(sql).toContain('"origem" varchar(20) NOT NULL');
    expect(sql).toContain('"fato_chave" text NOT NULL');
    expect(sql).toContain('"competencia" date NOT NULL');
    expect(sql).toContain('"tributo" varchar(12) NOT NULL');
  });

  it('armazena valores DECIMAIS (numeric), nunca inteiros/float', () => {
    // Restrição da fase: decimais sem `Number`. O schema usa `numeric` para
    // magnitude, base e alíquota.
    expect(sql).toContain('"valor" numeric(15, 2) NOT NULL');
    expect(sql).toContain('"base_calculo" numeric(15, 2)');
    expect(sql).toContain('"aliquota" numeric(9, 4)');
    // Nenhuma coluna de valor fiscal deve nascer como real/double/float.
    expect(sql).not.toMatch(/"valor"\s+(real|double|float)/i);
  });

  it('torna natureza e sinal EXPLÍCITOS (não inferidos pelo valor)', () => {
    expect(sql).toContain('"natureza" varchar(7) NOT NULL');
    expect(sql).toContain('"sinal" integer DEFAULT 1 NOT NULL');
    expect(sql).toContain('chk_fiscal_lancamento_natureza');
    expect(sql).toContain("'DEBITO', 'CREDITO'");
    expect(sql).toContain('chk_fiscal_lancamento_sinal');
    expect(sql).toContain('"sinal" IN (-1, 1)');
    // Magnitude não-negativa: o efeito no saldo vem de natureza + sinal.
    expect(sql).toContain('chk_fiscal_lancamento_valor');
    expect(sql).toContain('"valor" >= 0');
  });

  it('restringe o domínio de origem para a ponte da conciliação (R2.2)', () => {
    expect(sql).toContain('chk_fiscal_lancamento_origem');
    expect(sql).toContain(
      "'DOCUMENTO', 'CIAP', 'AJUSTE', 'SALDO_ANTERIOR', 'APURACAO'",
    );
  });

  it('tem CHAVE IDEMPOTENTE por fato/versão (R2.1)', () => {
    // Reprocessar a mesma versão não duplica; nova versão gera novas linhas sem
    // sobrescrever as da versão anterior (reprodutibilidade do fechamento).
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "uidx_fiscal_lancamento_fato_versao"',
    );
    expect(sql).toContain(
      '"cliente_id","origem","fato_chave","fechamento_versao","tributo","natureza"',
    );
    expect(sql).toContain('"fechamento_versao" integer DEFAULT 1 NOT NULL');
    expect(sql).toContain('chk_fiscal_lancamento_versao');
    expect(sql).toContain('"fechamento_versao" >= 1');
  });

  it('fixa a competência no primeiro dia do mês (competência fiscal)', () => {
    expect(sql).toContain('chk_fiscal_lancamento_competencia_dia1');
    expect(sql).toContain("date_part('day', \"fiscal_lancamentos\".\"competencia\") = 1");
    // Índice de projeção por competência/versão (livros, painéis e SPED).
    expect(sql).toContain(
      'CREATE INDEX "idx_fiscal_lancamento_competencia"',
    );
    expect(sql).toContain('"cliente_id","competencia","fechamento_versao"');
  });

  it('vincula o lastro documental coerente para a ponte (R2.2)', () => {
    // Documento e item são opcionais; só origem DOCUMENTO os referencia e o
    // item exige o documento.
    expect(sql).toContain(
      'REFERENCES "public"."documentos_fiscais"("id")',
    );
    expect(sql).toContain(
      'REFERENCES "public"."documentos_fiscais_itens"("id")',
    );
    expect(sql).toContain('chk_fiscal_lancamento_item_exige_documento');
    expect(sql).toContain('chk_fiscal_lancamento_documento_origem');
    expect(sql).toContain('REFERENCES "public"."clientes"("id")');
  });

  it('é puramente ADITIVA: nunca altera nem remove estruturas existentes', () => {
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql).not.toMatch(/DROP\s+COLUMN/i);
    expect(sql).not.toMatch(/DROP\s+INDEX/i);
    expect(sql).not.toMatch(/ALTER\s+COLUMN/i);
    // Só altera a própria tabela nova (ADD CONSTRAINT de FK); não toca em
    // documentos_fiscais, documentos_fiscais_itens, clientes etc.
    const alvosAlterados = Array.from(
      sql.matchAll(/ALTER TABLE "([a-z_]+)"/gi),
    ).map((m) => m[1]);
    expect(new Set(alvosAlterados)).toEqual(new Set(['fiscal_lancamentos']));
  });
});
