CREATE TABLE "fiscal_simples_historicos_mensais" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"competencia" date NOT NULL,
	"receita_bruta" numeric(15, 2),
	"folha_salarios_encargos" numeric(15, 2),
	"observacao" text,
	"informado_por" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_simples_historico_cliente_competencia" UNIQUE("cliente_id","competencia"),
	CONSTRAINT "chk_simples_historico_competencia" CHECK (date_part('day', "fiscal_simples_historicos_mensais"."competencia") = 1),
	CONSTRAINT "chk_simples_historico_preenchido" CHECK ("fiscal_simples_historicos_mensais"."receita_bruta" IS NOT NULL OR "fiscal_simples_historicos_mensais"."folha_salarios_encargos" IS NOT NULL),
	CONSTRAINT "chk_simples_historico_valores" CHECK (("fiscal_simples_historicos_mensais"."receita_bruta" IS NULL OR "fiscal_simples_historicos_mensais"."receita_bruta" >= 0) AND ("fiscal_simples_historicos_mensais"."folha_salarios_encargos" IS NULL OR "fiscal_simples_historicos_mensais"."folha_salarios_encargos" >= 0))
);
--> statement-breakpoint
ALTER TABLE "fiscal_simples_historicos_mensais" ADD CONSTRAINT "fiscal_simples_historicos_mensais_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_simples_historicos_mensais" ADD CONSTRAINT "fiscal_simples_historicos_mensais_informado_por_user_id_fk" FOREIGN KEY ("informado_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_simples_historico_cliente_competencia" ON "fiscal_simples_historicos_mensais" USING btree ("cliente_id","competencia");