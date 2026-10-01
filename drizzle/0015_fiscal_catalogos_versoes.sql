CREATE TABLE "fiscal_catalogos_versoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tipo" varchar(20) NOT NULL,
	"uf" varchar(2) NOT NULL,
	"codigo" text NOT NULL,
	"descricao" text,
	"fonte" varchar(60) NOT NULL,
	"vigencia_inicio" date NOT NULL,
	"vigencia_fim" date,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chk_fiscal_catalogo_uf" CHECK ("fiscal_catalogos_versoes"."uf" ~ '^[A-Z]{2}$'),
	CONSTRAINT "chk_fiscal_catalogo_tipo" CHECK ("fiscal_catalogos_versoes"."tipo" IN ('E111_CIAP')),
	CONSTRAINT "chk_fiscal_catalogo_vigencia" CHECK ("fiscal_catalogos_versoes"."vigencia_fim" IS NULL OR "fiscal_catalogos_versoes"."vigencia_fim" >= "fiscal_catalogos_versoes"."vigencia_inicio"),
	CONSTRAINT "chk_fiscal_catalogo_codigo_e111_ciap" CHECK ("fiscal_catalogos_versoes"."tipo" <> 'E111_CIAP' OR "fiscal_catalogos_versoes"."codigo" ~ '^[A-Z]{2}02[A-Z0-9]{4}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_fiscal_catalogo_vigencia" ON "fiscal_catalogos_versoes" USING btree ("tipo","uf","vigencia_inicio");--> statement-breakpoint
CREATE INDEX "idx_fiscal_catalogo_tipo_uf" ON "fiscal_catalogos_versoes" USING btree ("tipo","uf");
--> statement-breakpoint
-- Seed ADITIVO do catálogo de códigos de ajuste E111 do CIAP (Fase 2 / tarefa
-- 3.4, R2.6). PRÉ-CONDIÇÃO FISCAL BLOQUEANTE: os códigos ESTADUAIS REAIS por UF
-- ainda dependem de confirmação do responsável fiscal (requirements,
-- "Pré-condições fiscais"). Enquanto isso, carrega-se um DEFAULT DOCUMENTADO e
-- explicitamente marcado como `default_pendente_confirmacao` por UF, para que o
-- mecanismo de lookup/validação de código+vigência funcione sem emitir código
-- fabricado em CÓDIGO (o `${uf}02CIAP` antigo). A `fonte` deixa o estado real
-- EXPLÍCITO e permite substituir o código homologado por UF sem alterar schema
-- nem código — basta inserir a vigência oficial e inativar/encerrar o default.
--
-- Vigência aberta a partir de 2026-01-01 (competências-alvo da fase, N03). O
-- código default `${uf}02CIAP` respeita o leiaute do E111 (natureza 2 =
-- crédito), coerente com os checks de `sped_ajustes_apuracao`. É IDEMPOTENTE:
-- o unique (tipo, uf, vigencia_inicio) + ON CONFLICT DO NOTHING evita duplicar
-- em reexecuções e NÃO sobrescreve um código oficial já cadastrado.
INSERT INTO "fiscal_catalogos_versoes"
  ("tipo", "uf", "codigo", "descricao", "fonte", "vigencia_inicio", "vigencia_fim", "ativo")
SELECT
  'E111_CIAP',
  uf,
  uf || '02CIAP',
  'Crédito de ICMS do ativo permanente (CIAP - 1/48) — código DEFAULT pendente de confirmação do código estadual oficial.',
  'default_pendente_confirmacao',
  DATE '2026-01-01',
  NULL,
  true
FROM (VALUES
  ('AC'),('AL'),('AP'),('AM'),('BA'),('CE'),('DF'),('ES'),('GO'),('MA'),
  ('MT'),('MS'),('MG'),('PA'),('PB'),('PR'),('PE'),('PI'),('RJ'),('RN'),
  ('RS'),('RO'),('RR'),('SC'),('SP'),('SE'),('TO')
) AS ufs(uf)
ON CONFLICT ("tipo", "uf", "vigencia_inicio") DO NOTHING;
