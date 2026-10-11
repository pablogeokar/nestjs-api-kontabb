import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Fase 5, tarefa 2.1 (R2.1): a migração que introduz `fiscal_entregas` — a
// ENTREGA de uma obrigação acessória amarrada à versão de apuração (fechamento
// da Fase 3) — DEVE ser puramente aditiva e persistir tudo o que R2.1 exige:
// ARQUIVO (`arquivo_key`), HASH, PVA UTILIZADO (programa + versão), VALIDAÇÃO
// (status + resultado), ASSINATURA, PROTOCOLO/RECIBO (número + `recibo_key`) e o
// VÍNCULO DE RETIFICAÇÃO (auto-FK para a entrega original). STORAGE SÓ COM KEYS:
// nunca URLs no banco (restrição da fase/SKILL). Os testes são ESTÁTICOS
// (asserção sobre o SQL gerado), no mesmo padrão das demais specs de migração
// deste diretório.
describe('migração fiscal_entregas (0025)', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'drizzle/0025_fase5_fiscal_entregas.sql'),
    'utf8',
  );

  it('cria a tabela de entrega escopada por cliente/obrigação/competência', () => {
    expect(sql).toContain('CREATE TABLE "fiscal_entregas"');
    expect(sql).toContain('"cliente_id" uuid NOT NULL');
    expect(sql).toContain('"obrigacao" varchar(20) NOT NULL');
    expect(sql).toContain('"competencia" date NOT NULL');
  });

  it('persiste o ARQUIVO só como key do storage — nunca URL (SKILL)', () => {
    expect(sql).toContain('"arquivo_key" text NOT NULL');
    // Nenhuma coluna de URL: só keys ficam no banco.
    expect(sql).not.toMatch(/"[a-z_]*url[a-z_]*"/i);
  });

  it('sela o conteúdo entregue com HASH SHA-256 (mesmo formato do fechamento/SPED)', () => {
    expect(sql).toContain('"hash_arquivo" varchar(64) NOT NULL');
    expect(sql).toContain('chk_fiscal_entrega_hash');
    expect(sql).toContain('"hash_arquivo" ~ \'^[0-9a-f]{64}$\'');
  });

  it('registra o PVA UTILIZADO: programa + versão operacional (R2.1/N05)', () => {
    expect(sql).toContain('"pva_programa" varchar(40) NOT NULL');
    expect(sql).toContain('"pva_versao" varchar(20) NOT NULL');
  });

  it('registra a VALIDAÇÃO: status do ciclo + resultado JSONB do PVA', () => {
    expect(sql).toContain(
      '"status_validacao" varchar(20) DEFAULT \'PENDENTE\' NOT NULL',
    );
    expect(sql).toContain(
      '"validacao_resultado" jsonb DEFAULT \'{}\'::jsonb NOT NULL',
    );
    // Ciclo da entrega: validação PVA, transmissão e falha de storage (R2.3).
    expect(sql).toContain('chk_fiscal_entrega_status');
    expect(sql).toContain(
      "'PENDENTE', 'VALIDADA', 'REJEITADA', 'TRANSMITIDA', 'FALHA_STORAGE'",
    );
  });

  it('registra a ASSINATURA e o PROTOCOLO/RECIBO (recibo só como key — SKILL)', () => {
    expect(sql).toContain('"assinatura_titular" text');
    expect(sql).toContain('"assinatura_em" timestamp with time zone');
    expect(sql).toContain('"protocolo_numero" text');
    expect(sql).toContain('"recibo_key" text');
  });

  it('registra o leiaute aplicado por vigência (2026 vs. 2027 — R2.5/N03/N04)', () => {
    expect(sql).toContain('"leiaute_versao" varchar(20) NOT NULL');
  });

  it('amarra a entrega à versão de apuração (fechamento) como FK opcional', () => {
    // Vincula recibo ↔ hash do fechamento (R2.4); `set null` em delete preserva
    // a entrega e seu histórico (append-only).
    expect(sql).toContain('"fechamento_id" uuid');
    expect(sql).toContain(
      'REFERENCES "public"."fiscal_fechamentos"("id") ON DELETE set null',
    );
    expect(sql).toContain('CREATE INDEX "idx_fiscal_entrega_fechamento"');
  });

  it('modela o VÍNCULO DE RETIFICAÇÃO como auto-FK sem sobrescrever (R2.1/R2.2)', () => {
    expect(sql).toContain('"entrega_original_id" uuid');
    // Auto-referência: `set null` preserva a retificadora se a original sumir.
    expect(sql).toContain('"fiscal_entregas_original_fk"');
    expect(sql).toContain(
      'REFERENCES "public"."fiscal_entregas"("id") ON DELETE set null',
    );
    expect(sql).toContain('CREATE INDEX "idx_fiscal_entrega_original"');
    // Uma entrega não retifica a si mesma.
    expect(sql).toContain('chk_fiscal_entrega_nao_autoretifica');
    // A diferença só existe numa entrega retificadora (com vínculo à original).
    expect(sql).toContain('chk_fiscal_entrega_retificacao_diferenca');
    expect(sql).toContain(
      '"entrega_original_id" IS NOT NULL OR "fiscal_entregas"."valor_diferenca" IS NULL',
    );
  });

  it('fixa a competência no primeiro dia do mês (competência fiscal)', () => {
    expect(sql).toContain('chk_fiscal_entrega_competencia_dia1');
    expect(sql).toContain(
      "date_part('day', \"fiscal_entregas\".\"competencia\") = 1",
    );
    // Índice de projeção por escopo/competência (painéis, livros, status).
    expect(sql).toContain('CREATE INDEX "idx_fiscal_entrega_competencia"');
    expect(sql).toContain('"cliente_id","competencia","obrigacao"');
  });

  it('restringe o domínio de obrigação acessória', () => {
    expect(sql).toContain('chk_fiscal_entrega_obrigacao');
    expect(sql).toContain(
      "'EFD_ICMS_IPI', 'EFD_CONTRIBUICOES', 'GIA', 'DAS', 'DAPI'",
    );
  });

  it('não usa real/double/float para nenhuma coluna (decimais via numeric)', () => {
    // A diferença da retificação é `numeric` (string decimal), nunca float.
    expect(sql).toContain('"valor_diferenca" numeric(15, 2)');
    expect(sql).not.toMatch(/\b(real|double precision|float)\b/i);
  });

  it('vincula o escopo a estruturas já existentes', () => {
    expect(sql).toContain('REFERENCES "public"."clientes"("id")');
    expect(sql).toContain('REFERENCES "public"."fiscal_fechamentos"("id")');
  });

  it('é puramente ADITIVA: nunca altera nem remove estruturas existentes', () => {
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql).not.toMatch(/DROP\s+COLUMN/i);
    expect(sql).not.toMatch(/DROP\s+INDEX/i);
    expect(sql).not.toMatch(/DROP\s+CONSTRAINT/i);
    expect(sql).not.toMatch(/ALTER\s+COLUMN/i);
    // Só altera a própria tabela nova (ADD CONSTRAINT de FK); não toca em
    // clientes, fiscal_fechamentos etc.
    const alvosAlterados = Array.from(
      sql.matchAll(/ALTER TABLE "([a-z_]+)"/gi),
    ).map((m) => m[1]);
    expect(new Set(alvosAlterados)).toEqual(new Set(['fiscal_entregas']));
  });
});
