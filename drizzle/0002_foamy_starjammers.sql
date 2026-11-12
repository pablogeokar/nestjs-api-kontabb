CREATE TABLE "financeiro_contratos_itens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contrato_id" uuid NOT NULL,
	"tipo_lancamento_id" uuid NOT NULL,
	"descricao" text NOT NULL,
	"valor" numeric(12, 2) NOT NULL,
	"competencia_inicio" varchar(7),
	"competencia_fim" varchar(7),
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chk_fin_contr_itens_valor" CHECK ("financeiro_contratos_itens"."valor" > 0),
	CONSTRAINT "chk_fin_contr_itens_descricao" CHECK (btrim("financeiro_contratos_itens"."descricao") <> ''),
	CONSTRAINT "chk_fin_contr_itens_inicio" CHECK ("financeiro_contratos_itens"."competencia_inicio" IS NULL OR "financeiro_contratos_itens"."competencia_inicio" ~ '^(0[1-9]|1[0-2])/[0-9]{4}$'),
	CONSTRAINT "chk_fin_contr_itens_fim" CHECK ("financeiro_contratos_itens"."competencia_fim" IS NULL OR "financeiro_contratos_itens"."competencia_fim" ~ '^(0[1-9]|1[0-2])/[0-9]{4}$')
);
--> statement-breakpoint
ALTER TABLE "financeiro_lancamentos" ADD COLUMN "contrato_item_id" uuid;--> statement-breakpoint
ALTER TABLE "financeiro_contratos_itens" ADD CONSTRAINT "fin_contr_itens_contrato_id_fk" FOREIGN KEY ("contrato_id") REFERENCES "public"."financeiro_contratos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financeiro_contratos_itens" ADD CONSTRAINT "fin_contr_itens_tipo_id_fk" FOREIGN KEY ("tipo_lancamento_id") REFERENCES "public"."financeiro_tipos_lancamento"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_fin_contr_itens_contrato" ON "financeiro_contratos_itens" USING btree ("contrato_id");--> statement-breakpoint
ALTER TABLE "financeiro_lancamentos" ADD CONSTRAINT "fin_lanc_contrato_item_id_fk" FOREIGN KEY ("contrato_item_id") REFERENCES "public"."financeiro_contratos_itens"("id") ON DELETE set null ON UPDATE no action;