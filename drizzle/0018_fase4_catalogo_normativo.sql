CREATE TABLE "fiscal_perfis_vigencia" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"uf" varchar(2) NOT NULL,
	"regime" varchar(20) NOT NULL,
	"obrigacao" varchar(20) NOT NULL,
	"vigencia_inicio" date NOT NULL,
	"vigencia_fim" date,
	"fonte" varchar(60) NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_fiscal_perfil_uf" CHECK ("fiscal_perfis_vigencia"."uf" ~ '^[A-Z]{2}$'),
	CONSTRAINT "chk_fiscal_perfil_regime" CHECK ("fiscal_perfis_vigencia"."regime" IN ('SIMPLES_NACIONAL', 'LUCRO_PRESUMIDO', 'LUCRO_REAL')),
	CONSTRAINT "chk_fiscal_perfil_obrigacao" CHECK ("fiscal_perfis_vigencia"."obrigacao" IN ('EFD_ICMS_IPI', 'EFD_CONTRIBUICOES', 'GIA', 'DAS', 'DAPI')),
	CONSTRAINT "chk_fiscal_perfil_vigencia" CHECK ("fiscal_perfis_vigencia"."vigencia_fim" IS NULL OR "fiscal_perfis_vigencia"."vigencia_fim" >= "fiscal_perfis_vigencia"."vigencia_inicio")
);
--> statement-breakpoint
CREATE TABLE "fiscal_regras_versoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"catalogo_versao_id" uuid NOT NULL,
	"chave" text NOT NULL,
	"revisao" integer DEFAULT 1 NOT NULL,
	"conteudo" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"fonte" varchar(60) NOT NULL,
	"fonte_url" text,
	"responsavel_por" text,
	"vigencia_inicio" date NOT NULL,
	"vigencia_fim" date,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_fiscal_regra_revisao" CHECK ("fiscal_regras_versoes"."revisao" >= 1),
	CONSTRAINT "chk_fiscal_regra_vigencia" CHECK ("fiscal_regras_versoes"."vigencia_fim" IS NULL OR "fiscal_regras_versoes"."vigencia_fim" >= "fiscal_regras_versoes"."vigencia_inicio")
);
--> statement-breakpoint
ALTER TABLE "fiscal_catalogos_versoes" DROP CONSTRAINT "chk_fiscal_catalogo_tipo";--> statement-breakpoint
ALTER TABLE "fiscal_catalogos_versoes" ADD COLUMN "fonte_url" text;--> statement-breakpoint
ALTER TABLE "fiscal_catalogos_versoes" ADD COLUMN "hash_conteudo" varchar(64);--> statement-breakpoint
ALTER TABLE "fiscal_catalogos_versoes" ADD COLUMN "conteudo" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "fiscal_catalogos_versoes" ADD COLUMN "escopo_aprovado" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "fiscal_catalogos_versoes" ADD COLUMN "aprovado_por" text;--> statement-breakpoint
ALTER TABLE "fiscal_catalogos_versoes" ADD COLUMN "data_carga" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "fiscal_perfis_vigencia" ADD CONSTRAINT "fiscal_perfis_vigencia_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_regras_versoes" ADD CONSTRAINT "fiscal_regras_versoes_catalogo_versao_id_fiscal_catalogos_versoes_id_fk" FOREIGN KEY ("catalogo_versao_id") REFERENCES "public"."fiscal_catalogos_versoes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_regras_versoes" ADD CONSTRAINT "fiscal_regras_versoes_responsavel_por_user_id_fk" FOREIGN KEY ("responsavel_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_fiscal_perfil_vigencia" ON "fiscal_perfis_vigencia" USING btree ("cliente_id","uf","obrigacao","vigencia_inicio");--> statement-breakpoint
CREATE INDEX "idx_fiscal_perfil_lookup" ON "fiscal_perfis_vigencia" USING btree ("cliente_id","uf","obrigacao","vigencia_inicio");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_fiscal_regra_revisao" ON "fiscal_regras_versoes" USING btree ("catalogo_versao_id","chave","revisao");--> statement-breakpoint
CREATE INDEX "idx_fiscal_regra_lookup" ON "fiscal_regras_versoes" USING btree ("catalogo_versao_id","chave","vigencia_inicio");--> statement-breakpoint
ALTER TABLE "fiscal_catalogos_versoes" ADD CONSTRAINT "fiscal_catalogos_versoes_aprovado_por_user_id_fk" FOREIGN KEY ("aprovado_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_catalogos_versoes" ADD CONSTRAINT "chk_fiscal_catalogo_hash" CHECK ("fiscal_catalogos_versoes"."hash_conteudo" IS NULL OR "fiscal_catalogos_versoes"."hash_conteudo" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "fiscal_catalogos_versoes" ADD CONSTRAINT "chk_fiscal_catalogo_aprovacao" CHECK ("fiscal_catalogos_versoes"."escopo_aprovado" = ("fiscal_catalogos_versoes"."aprovado_por" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "fiscal_catalogos_versoes" ADD CONSTRAINT "chk_fiscal_catalogo_tipo" CHECK ("fiscal_catalogos_versoes"."tipo" IN ('E111_CIAP', 'DIFAL', 'ST_FCP', 'PIS_COFINS'));