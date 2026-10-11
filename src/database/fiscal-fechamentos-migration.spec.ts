import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Fase 3, tarefa 3.1 (R1.1): a migração que introduz `fiscal_fechamentos` — a
// MEMÓRIA DE CÁLCULO VERSIONADA de que livros, painéis e SPED passam a projetar
// (F20) — DEVE ser puramente aditiva, garantir UNICIDADE DE VERSÃO por
// estabelecimento/competência/obrigação, admitir SOMENTE UMA versão corrente
// aprovada (índice único parcial), congelar os snapshots (documentos, decisões,
// regras, parâmetros, saldos) e selar as entradas com `motorVersao`/
// `hashEntradas`. Os testes são ESTÁTICOS (asserção sobre o SQL gerado), no
// mesmo padrão das demais specs de migração deste diretório.
describe('migração fiscal_fechamentos (0017)', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'drizzle/0017_fiscal_fechamentos.sql'),
    'utf8',
  );

  it('cria a tabela de fechamento versionado escopada por cliente/obrigação', () => {
    expect(sql).toContain('CREATE TABLE "fiscal_fechamentos"');
    expect(sql).toContain('"cliente_id" uuid NOT NULL');
    expect(sql).toContain('"obrigacao" varchar(20) NOT NULL');
    expect(sql).toContain('"competencia" date NOT NULL');
    expect(sql).toContain('"versao" integer DEFAULT 1 NOT NULL');
  });

  it('tem UNICIDADE DE VERSÃO por estabelecimento/competência/obrigação (R1.1)', () => {
    // Não pode haver duas linhas para a mesma versão do mesmo escopo.
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "uidx_fiscal_fechamento_versao"',
    );
    expect(sql).toContain('"cliente_id","obrigacao","competencia","versao"');
    expect(sql).toContain('chk_fiscal_fechamento_versao');
    expect(sql).toContain('"versao" >= 1');
  });

  it('admite SOMENTE UMA versão corrente aprovada (índice único PARCIAL)', () => {
    // Muitas versões históricas podem coexistir, mas apenas uma corrente por
    // (cliente, obrigação, competência) — enforçado por um unique parcial.
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "uidx_fiscal_fechamento_corrente"',
    );
    expect(sql).toContain('"cliente_id","obrigacao","competencia"');
    expect(sql).toContain('WHERE "fiscal_fechamentos"."corrente" = true');
    // A corrente é a versão aprovada: só pode existir quando FECHADO.
    expect(sql).toContain('chk_fiscal_fechamento_corrente_fechado');
    expect(sql).toContain(
      '"corrente" = false OR "fiscal_fechamentos"."estado" = \'FECHADO\'',
    );
  });

  it('modela os estados RASCUNHO → PENDENTE → REVISADO → FECHADO com CHECK', () => {
    expect(sql).toContain('"estado" varchar(10) DEFAULT \'RASCUNHO\' NOT NULL');
    expect(sql).toContain('chk_fiscal_fechamento_estado');
    expect(sql).toContain("'RASCUNHO', 'PENDENTE', 'REVISADO', 'FECHADO'");
    // FECHADO ⇔ `fechado_em` preenchido (estados não-finais não têm data).
    expect(sql).toContain('chk_fiscal_fechamento_fechado_em');
    expect(sql).toContain('"fechado_em" timestamp with time zone');
  });

  it('restringe o domínio de obrigação acessória', () => {
    expect(sql).toContain('chk_fiscal_fechamento_obrigacao');
    expect(sql).toContain(
      "'EFD_ICMS_IPI', 'EFD_CONTRIBUICOES', 'GIA', 'DAS', 'DAPI'",
    );
  });

  it('sela as entradas para reprodutibilidade: motorVersao + hashEntradas (R1.1/R1.2)', () => {
    expect(sql).toContain('"motor_versao" varchar(40) NOT NULL');
    expect(sql).toContain('"hash_entradas" varchar(64) NOT NULL');
    // Mesmo formato SHA-256 dos arquivos SPED (`sped_arquivos_gerados`).
    expect(sql).toContain('chk_fiscal_fechamento_hash');
    expect(sql).toContain('"hash_entradas" ~ \'^[0-9a-f]{64}$\'');
  });

  it('congela os snapshots do fechamento como JSONB imutáveis (R1.1)', () => {
    // Documentos, decisões, regras, parâmetros e saldos vigentes no fechamento
    // — a fotografia das entradas, não o estado atual (que pode ter mudado).
    expect(sql).toContain('"documentos" jsonb DEFAULT \'[]\'::jsonb NOT NULL');
    expect(sql).toContain('"decisoes" jsonb DEFAULT \'[]\'::jsonb NOT NULL');
    expect(sql).toContain('"regras" jsonb DEFAULT \'[]\'::jsonb NOT NULL');
    expect(sql).toContain('"parametros" jsonb DEFAULT \'{}\'::jsonb NOT NULL');
    expect(sql).toContain('"saldos" jsonb DEFAULT \'{}\'::jsonb NOT NULL');
  });

  it('fixa a competência no primeiro dia do mês (competência fiscal)', () => {
    expect(sql).toContain('chk_fiscal_fechamento_competencia_dia1');
    expect(sql).toContain(
      'date_part(\'day\', "fiscal_fechamentos"."competencia") = 1',
    );
    // Índice de projeção por escopo/competência (livros, painéis e SPED).
    expect(sql).toContain('CREATE INDEX "idx_fiscal_fechamento_competencia"');
    expect(sql).toContain('"cliente_id","competencia","obrigacao"');
  });

  it('não usa real/double/float para nenhuma coluna (decimais fora dos snapshots)', () => {
    // O fechamento guarda totais apenas dentro dos snapshots JSONB (strings
    // decimais); nenhuma coluna escalar de valor pode nascer como float.
    expect(sql).not.toMatch(/\b(real|double precision|float)\b/i);
  });

  it('vincula o escopo e o aprovador a estruturas já existentes', () => {
    expect(sql).toContain('REFERENCES "public"."clientes"("id")');
    expect(sql).toContain('REFERENCES "public"."user"("id")');
  });

  it('é puramente ADITIVA: nunca altera nem remove estruturas existentes', () => {
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql).not.toMatch(/DROP\s+COLUMN/i);
    expect(sql).not.toMatch(/DROP\s+INDEX/i);
    expect(sql).not.toMatch(/ALTER\s+COLUMN/i);
    // Só altera a própria tabela nova (ADD CONSTRAINT de FK); não toca em
    // clientes, user etc.
    const alvosAlterados = Array.from(
      sql.matchAll(/ALTER TABLE "([a-z_]+)"/gi),
    ).map((m) => m[1]);
    expect(new Set(alvosAlterados)).toEqual(new Set(['fiscal_fechamentos']));
  });
});
