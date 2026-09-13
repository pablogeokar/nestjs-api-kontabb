import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Task 3.2 (F05 / R3.2, R3.4): a migração que cria o embrião de
// `fiscal_decisoes_item` DEVE ser puramente aditiva e preservar o
// `valor_icms` original do XML em `documentos_fiscais_itens`.
describe('migração fiscal_decisoes_item (0009)', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'drizzle/0009_fiscal_decisoes_item.sql'),
    'utf8',
  );

  it('cria a tabela fiscal_decisoes_item com o crédito admitido separado', () => {
    expect(sql).toContain('CREATE TABLE "fiscal_decisoes_item"');
    // Crédito admitido é uma coluna PRÓPRIA da nova tabela — não sobrescreve
    // o valor_icms do XML (R3.2).
    expect(sql).toContain('"valor_credito_admitido" numeric(15, 2)');
    expect(sql).toContain('"decisao" varchar(20)');
    expect(sql).toContain('"motivo" varchar(40)');
    expect(sql).toContain('"regra_versao_id" text');
  });

  it('chaveia por item + versão da regra para não sobrescrever versões (R3.4)', () => {
    expect(sql).toContain(
      'PRIMARY KEY("item_id","regra_versao_id")',
    );
  });

  it('vincula item e cliente por chave estrangeira (propriedade)', () => {
    expect(sql).toContain(
      'REFERENCES "public"."documentos_fiscais_itens"("id")',
    );
    expect(sql).toContain('REFERENCES "public"."clientes"("id")');
  });

  it('restringe os domínios de decisão e motivo e proíbe crédito negativo', () => {
    expect(sql).toContain('chk_fiscal_decisao');
    expect(sql).toContain("'ADMITIDO', 'VEDADO', 'EXIGE_REVISAO'");
    expect(sql).toContain('chk_fiscal_decisao_motivo');
    expect(sql).toContain('chk_fiscal_decisao_credito_nao_negativo');
    expect(sql).toContain('"valor_credito_admitido" >= 0');
  });

  it('é puramente aditiva: nunca altera nem remove colunas existentes', () => {
    // Não pode tocar no valor_icms original nem em qualquer coluna existente.
    expect(sql).not.toMatch(/ALTER TABLE "documentos_fiscais_itens"/);
    expect(sql).not.toMatch(/DROP COLUMN/i);
    expect(sql).not.toMatch(/DROP TABLE/i);
    expect(sql).not.toMatch(/ALTER COLUMN/i);
    expect(sql).not.toMatch(/\bvalor_icms\b/);
  });
});
