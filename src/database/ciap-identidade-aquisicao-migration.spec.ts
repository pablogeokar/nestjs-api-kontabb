import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Fase 2, tarefa 1.4 (R2.1/R2.2): a migração que introduz a identidade
// patrimonial POR AQUISIÇÃO DEVE ser puramente aditiva (não destruir dados das
// fichas existentes) e o backfill DEVE classificar as fichas sem inventar
// histórico.
describe('migração identidade por aquisição do CIAP (0014)', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'drizzle/0014_ciap_identidade_aquisicao.sql'),
    'utf8',
  );

  it('adiciona as colunas aditivas de identidade por aquisição', () => {
    expect(sql).toContain(
      'ALTER TABLE "ciap_ativo_permanente" ADD COLUMN "chave_aquisicao" varchar(120)',
    );
    expect(sql).toContain(
      'ADD COLUMN "origem_identidade" varchar(30) DEFAULT \'sku_legado\' NOT NULL',
    );
    expect(sql).toContain(
      'ADD COLUMN "saneamento_pendente" boolean DEFAULT false NOT NULL',
    );
  });

  it('cria o unique PARCIAL por (cliente, chave) para conviver com fichas legadas', () => {
    // Duas aquisições do mesmo SKU recebem chaves distintas; o unique garante
    // uma ficha por (cliente, chave) sem derrubar fichas ainda não migradas
    // (chave nula fica fora do índice parcial).
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "uidx_ciap_cliente_chave_aquisicao"',
    );
    expect(sql).toContain('("cliente_id","chave_aquisicao")');
    expect(sql).toContain(
      'WHERE "ciap_ativo_permanente"."chave_aquisicao" IS NOT NULL',
    );
  });

  it('restringe o domínio da procedência da identidade', () => {
    expect(sql).toContain('chk_ciap_origem_identidade');
    expect(sql).toContain(
      "'sku_legado', 'aquisicao', 'reconstruido_nao_comprovado'",
    );
  });

  it('backfill comprovado: fichas com documento+item recebem chave do par e origem "aquisicao"', () => {
    expect(sql).toContain(
      '"chave_aquisicao" = "documento_fiscal_id" || \':\' || "documento_fiscal_item_id"',
    );
    expect(sql).toContain('"origem_identidade" = \'aquisicao\'');
    // Só toca fichas ainda não migradas (idempotência) e com lastro completo.
    expect(sql).toContain('WHERE "chave_aquisicao" IS NULL');
    expect(sql).toContain('"documento_fiscal_id" IS NOT NULL');
    expect(sql).toContain('"documento_fiscal_item_id" IS NOT NULL');
  });

  it('backfill não comprovado: fichas sem item usam o próprio UUID e NÃO inventam histórico', () => {
    expect(sql).toContain('"chave_aquisicao" = "id"::text');
    expect(sql).toContain(
      '"origem_identidade" = \'reconstruido_nao_comprovado\'',
    );
    // Não deriva competência/parcela do contador acumulado: `parcelas_apropriadas`
    // não é LIDA numa expressão nem ATRIBUÍDA pelo backfill (só pode aparecer em
    // comentário). A ausência de atribuição é verificada no teste de aditividade.
    expect(sql).not.toMatch(/=\s*[^;]*parcelas_apropriadas/i);
    expect(sql).not.toMatch(/parcelas_apropriadas\s*=/i);
  });

  it('marca saneamento assistido para SKUs com mais de uma aquisição escriturada (R2.1)', () => {
    expect(sql).toContain('"saneamento_pendente" = true');
    expect(sql).toContain("i.\"cfop\" IN ('1551', '2551', '3551')");
    expect(sql).toContain('HAVING COUNT(DISTINCT i."id") > 1');
  });

  it('é puramente aditiva: nunca altera/remove colunas ou tabelas existentes', () => {
    expect(sql).not.toMatch(/DROP COLUMN/i);
    expect(sql).not.toMatch(/DROP TABLE/i);
    expect(sql).not.toMatch(/DROP INDEX/i);
    expect(sql).not.toMatch(/ALTER COLUMN/i);
    // Não ATRIBUI codigo_bem, valores de ICMS, parcelas, saldo ou status das
    // fichas — só as colunas de identidade novas. Um alvo de atribuição aparece
    // logo após `SET ` ou após uma vírgula de continuação; a comparação em
    // WHERE/FROM (ex.: `WHERE bem."codigo_bem" = a.codigo_bem`) não conta.
    const atribuicoes = Array.from(
      sql.matchAll(/(?:SET\s+|,\s*)"([a-z_]+)"\s*=/gi),
    ).map((m) => m[1]);
    expect(atribuicoes).not.toContain('codigo_bem');
    expect(atribuicoes).not.toContain('valor_icms_total');
    expect(atribuicoes).not.toContain('valor_icms_frete');
    expect(atribuicoes).not.toContain('valor_icms_difal');
    expect(atribuicoes).not.toContain('saldo_credor_restante');
    expect(atribuicoes).not.toContain('parcelas_apropriadas');
    expect(atribuicoes).not.toContain('quantidade_parcelas');
    expect(atribuicoes).not.toContain('status');
    // As únicas colunas atribuídas pelo backfill são as de identidade.
    expect(new Set(atribuicoes)).toEqual(
      new Set(['chave_aquisicao', 'origem_identidade', 'saneamento_pendente']),
    );
  });
});
