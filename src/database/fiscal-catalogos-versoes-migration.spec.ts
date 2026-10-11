import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Migração 0015 (Fase 2 / tarefa 3.4, R2.6): catálogo de códigos estaduais de
// ajuste E111 do CIAP, versionado por vigência, substituindo o `${uf}02CIAP`
// fabricado em código. Os testes são ESTÁTICOS (asserção sobre o SQL gerado),
// no mesmo padrão das demais specs de migração deste diretório.
describe('migração do catálogo de códigos de ajuste (fiscal_catalogos_versoes)', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'drizzle/0015_fiscal_catalogos_versoes.sql'),
    'utf8',
  );

  it('cria a tabela de catálogo com vigência (código, uf, janela, ativo)', () => {
    expect(sql).toContain('CREATE TABLE "fiscal_catalogos_versoes"');
    expect(sql).toContain('"codigo" text NOT NULL');
    expect(sql).toContain('"uf" varchar(2) NOT NULL');
    expect(sql).toContain('"vigencia_inicio" date NOT NULL');
    expect(sql).toContain('"vigencia_fim" date');
    expect(sql).toContain('"ativo" boolean DEFAULT true NOT NULL');
    expect(sql).toContain('"fonte" varchar(60) NOT NULL');
  });

  it('é ADITIVA: só cria estruturas novas, nunca altera/dropa dados existentes', () => {
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql).not.toMatch(/DROP\s+COLUMN/i);
    expect(sql).not.toMatch(/ALTER\s+TABLE\s+"ciap_/i);
    expect(sql).not.toMatch(/ALTER\s+TABLE\s+"sped_ajustes_apuracao"/i);
  });

  it('garante uma única vigência por (tipo, uf, início) — novas vigências não sobrescrevem', () => {
    expect(sql).toContain('CREATE UNIQUE INDEX "uidx_fiscal_catalogo_vigencia"');
    expect(sql).toMatch(/"tipo","uf","vigencia_inicio"/);
  });

  it('restringe o código E111_CIAP ao leiaute do E111 de crédito (natureza 2)', () => {
    expect(sql).toContain('chk_fiscal_catalogo_codigo_e111_ciap');
    // Padrão UF + 02 (natureza 2 = crédito) + 4 alfanuméricos.
    expect(sql).toContain("'^[A-Z]{2}02[A-Z0-9]{4}$'");
  });

  it('valida vigência fechada (fim >= início) e UF em duas letras', () => {
    expect(sql).toContain('chk_fiscal_catalogo_vigencia');
    expect(sql).toContain('chk_fiscal_catalogo_uf');
  });

  it('semeia um DEFAULT por UF marcado como pendente de confirmação (pré-condição fiscal)', () => {
    expect(sql).toContain('INSERT INTO "fiscal_catalogos_versoes"');
    expect(sql).toContain("'default_pendente_confirmacao'");
    // Código default segue o leiaute E111 (uf || '02CIAP') e vigência a partir
    // das competências-alvo da fase (2026).
    expect(sql).toContain("uf || '02CIAP'");
    expect(sql).toContain("DATE '2026-01-01'");
  });

  it('o seed é idempotente e não sobrescreve um código oficial já cadastrado', () => {
    expect(sql).toContain(
      'ON CONFLICT ("tipo", "uf", "vigencia_inicio") DO NOTHING',
    );
  });

  it('cobre as 27 unidades federativas no seed default', () => {
    for (const uf of [
      'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA',
      'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN',
      'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
    ]) {
      expect(sql).toContain(`('${uf}')`);
    }
  });
});
