CREATE TABLE "fiscal_fechamentos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"obrigacao" varchar(20) NOT NULL,
	"competencia" date NOT NULL,
	"versao" integer DEFAULT 1 NOT NULL,
	"estado" varchar(10) DEFAULT 'RASCUNHO' NOT NULL,
	"corrente" boolean DEFAULT false NOT NULL,
	"motor_versao" varchar(40) NOT NULL,
	"hash_entradas" varchar(64) NOT NULL,
	"documentos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"decisoes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"regras" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"parametros" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"saldos" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"aprovado_por" text,
	"fechado_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_fiscal_fechamento_obrigacao" CHECK ("fiscal_fechamentos"."obrigacao" IN ('EFD_ICMS_IPI', 'EFD_CONTRIBUICOES', 'GIA', 'DAS', 'DAPI')),
	CONSTRAINT "chk_fiscal_fechamento_estado" CHECK ("fiscal_fechamentos"."estado" IN ('RASCUNHO', 'PENDENTE', 'REVISADO', 'FECHADO')),
	CONSTRAINT "chk_fiscal_fechamento_versao" CHECK ("fiscal_fechamentos"."versao" >= 1),
	CONSTRAINT "chk_fiscal_fechamento_corrente_fechado" CHECK ("fiscal_fechamentos"."corrente" = false OR "fiscal_fechamentos"."estado" = 'FECHADO'),
	CONSTRAINT "chk_fiscal_fechamento_hash" CHECK ("fiscal_fechamentos"."hash_entradas" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "chk_fiscal_fechamento_competencia_dia1" CHECK (date_part('day', "fiscal_fechamentos"."competencia") = 1),
	CONSTRAINT "chk_fiscal_fechamento_fechado_em" CHECK (("fiscal_fechamentos"."estado" = 'FECHADO') = ("fiscal_fechamentos"."fechado_em" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "fiscal_fechamentos" ADD CONSTRAINT "fiscal_fechamentos_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_fechamentos" ADD CONSTRAINT "fiscal_fechamentos_aprovado_por_user_id_fk" FOREIGN KEY ("aprovado_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_fiscal_fechamento_versao" ON "fiscal_fechamentos" USING btree ("cliente_id","obrigacao","competencia","versao");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_fiscal_fechamento_corrente" ON "fiscal_fechamentos" USING btree ("cliente_id","obrigacao","competencia") WHERE "fiscal_fechamentos"."corrente" = true;--> statement-breakpoint
CREATE INDEX "idx_fiscal_fechamento_competencia" ON "fiscal_fechamentos" USING btree ("cliente_id","competencia","obrigacao");