CREATE TABLE "financeiro_contratos_aditivos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contrato_id" uuid NOT NULL,
	"numero" integer NOT NULL,
	"tipo" varchar(20) NOT NULL,
	"competencia_inicio" varchar(7) NOT NULL,
	"motivo" text NOT NULL,
	"percentual" numeric(9, 4),
	"data_assinatura" date NOT NULL,
	"local_assinatura" text NOT NULL,
	"anterior" jsonb NOT NULL,
	"posterior" jsonb NOT NULL,
	"alteracoes" jsonb NOT NULL,
	"criado_por" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_fin_aditivos_numero" CHECK ("financeiro_contratos_aditivos"."numero" > 0),
	CONSTRAINT "chk_fin_aditivos_tipo" CHECK ("financeiro_contratos_aditivos"."tipo" IN ('ALTERACAO', 'REAJUSTE_ANUAL')),
	CONSTRAINT "chk_fin_aditivos_vigencia" CHECK ("financeiro_contratos_aditivos"."competencia_inicio" ~ '^(0[1-9]|1[0-2])/[0-9]{4}$'),
	CONSTRAINT "chk_fin_aditivos_motivo" CHECK (length(btrim("financeiro_contratos_aditivos"."motivo")) >= 3),
	CONSTRAINT "chk_fin_aditivos_local" CHECK (btrim("financeiro_contratos_aditivos"."local_assinatura") <> ''),
	CONSTRAINT "chk_fin_aditivos_percentual" CHECK (("financeiro_contratos_aditivos"."tipo" = 'REAJUSTE_ANUAL' AND "financeiro_contratos_aditivos"."percentual" IS NOT NULL AND "financeiro_contratos_aditivos"."percentual" > 0 AND "financeiro_contratos_aditivos"."percentual" <= 1000) OR ("financeiro_contratos_aditivos"."tipo" = 'ALTERACAO' AND "financeiro_contratos_aditivos"."percentual" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "financeiro_contratos_itens" ADD COLUMN "removido_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "financeiro_contratos" ADD COLUMN "versao" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "financeiro_contratos" ADD COLUMN "competencia_vigencia" varchar(7);--> statement-breakpoint
ALTER TABLE "financeiro_contratos" ADD COLUMN "data_ultimo_reajuste" date;--> statement-breakpoint
ALTER TABLE "financeiro_contratos_aditivos" ADD CONSTRAINT "fin_aditivos_contrato_fk" FOREIGN KEY ("contrato_id") REFERENCES "public"."financeiro_contratos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financeiro_contratos_aditivos" ADD CONSTRAINT "fin_aditivos_autor_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_fin_aditivos_numero" ON "financeiro_contratos_aditivos" USING btree ("contrato_id","numero");--> statement-breakpoint
CREATE INDEX "idx_fin_aditivos_vigencia" ON "financeiro_contratos_aditivos" USING btree ("contrato_id","competencia_inicio");--> statement-breakpoint
ALTER TABLE "financeiro_contratos" ADD CONSTRAINT "chk_fin_contratos_versao" CHECK ("financeiro_contratos"."versao" > 0);--> statement-breakpoint
ALTER TABLE "financeiro_contratos" ADD CONSTRAINT "chk_fin_contratos_vigencia" CHECK ("financeiro_contratos"."competencia_vigencia" IS NULL OR "financeiro_contratos"."competencia_vigencia" ~ '^(0[1-9]|1[0-2])/[0-9]{4}$');