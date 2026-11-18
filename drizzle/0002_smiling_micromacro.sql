CREATE TABLE "fiscal_simples_beneficios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"codigo" varchar(80) NOT NULL,
	"versao" integer DEFAULT 1 NOT NULL,
	"atual" boolean DEFAULT true NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"uf" varchar(2) NOT NULL,
	"descricao" text NOT NULL,
	"tipo" varchar(10) NOT NULL,
	"atividades" text[] NOT NULL,
	"criterio_receita" varchar(20) NOT NULL,
	"receita_de" numeric(15, 2) DEFAULT '0.00' NOT NULL,
	"receita_ate" numeric(15, 2) NOT NULL,
	"percentual_reducao" numeric(5, 4) NOT NULL,
	"somente_me" boolean DEFAULT false NOT NULL,
	"vigencia_inicio" date NOT NULL,
	"vigencia_fim" date NOT NULL,
	"fundamento_legal" text NOT NULL,
	"fonte_url" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_simples_beneficio_uf" CHECK ("fiscal_simples_beneficios"."uf" IN ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO')),
	CONSTRAINT "chk_simples_beneficio_codigo" CHECK ("fiscal_simples_beneficios"."codigo" ~ '^[A-Z0-9_]{3,80}$' AND "fiscal_simples_beneficios"."versao" >= 1),
	CONSTRAINT "chk_simples_beneficio_tipo" CHECK ("fiscal_simples_beneficios"."tipo" IN ('ISENCAO','REDUCAO') AND "fiscal_simples_beneficios"."percentual_reducao" > 0 AND "fiscal_simples_beneficios"."percentual_reducao" <= 1 AND ("fiscal_simples_beneficios"."tipo" <> 'ISENCAO' OR "fiscal_simples_beneficios"."percentual_reducao" = 1)),
	CONSTRAINT "chk_simples_beneficio_atividades" CHECK (cardinality("fiscal_simples_beneficios"."atividades") > 0 AND array_position("fiscal_simples_beneficios"."atividades", NULL) IS NULL AND "fiscal_simples_beneficios"."atividades" <@ ARRAY['ANEXO_I','ANEXO_II']::text[]),
	CONSTRAINT "chk_simples_beneficio_criterio" CHECK ("fiscal_simples_beneficios"."criterio_receita" IN ('RBT12_FAIXA','RBT12_REAL','RBA_ATUAL','RBA_ANTERIOR')),
	CONSTRAINT "chk_simples_beneficio_receita" CHECK ("fiscal_simples_beneficios"."receita_de" >= 0 AND "fiscal_simples_beneficios"."receita_ate" >= "fiscal_simples_beneficios"."receita_de"),
	CONSTRAINT "chk_simples_beneficio_vigencia" CHECK ("fiscal_simples_beneficios"."vigencia_fim" >= "fiscal_simples_beneficios"."vigencia_inicio" AND extract(day FROM "fiscal_simples_beneficios"."vigencia_inicio") = 1 AND extract(day FROM "fiscal_simples_beneficios"."vigencia_fim") = 1 AND "fiscal_simples_beneficios"."vigencia_inicio" >= '2018-01-01'::date),
	CONSTRAINT "chk_simples_beneficio_fundamento" CHECK (length(btrim("fiscal_simples_beneficios"."descricao")) >= 3 AND length(btrim("fiscal_simples_beneficios"."fundamento_legal")) >= 3 AND "fiscal_simples_beneficios"."fonte_url" ~ '^https://[^[:space:]]+$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_simples_beneficio_versao" ON "fiscal_simples_beneficios" USING btree ("codigo","versao");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_simples_beneficio_atual" ON "fiscal_simples_beneficios" USING btree ("codigo") WHERE "fiscal_simples_beneficios"."atual" = true;--> statement-breakpoint
CREATE INDEX "idx_simples_beneficio_uf_vigencia" ON "fiscal_simples_beneficios" USING btree ("uf","vigencia_inicio","vigencia_fim");