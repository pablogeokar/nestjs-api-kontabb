CREATE TABLE "fiscal_lancamentos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"fechamento_versao" integer DEFAULT 1 NOT NULL,
	"origem" varchar(20) NOT NULL,
	"fato_chave" text NOT NULL,
	"competencia" date NOT NULL,
	"tributo" varchar(12) NOT NULL,
	"natureza" varchar(7) NOT NULL,
	"sinal" integer DEFAULT 1 NOT NULL,
	"valor" numeric(15, 2) NOT NULL,
	"base_calculo" numeric(15, 2),
	"aliquota" numeric(9, 4),
	"documento_fiscal_id" uuid,
	"documento_fiscal_item_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_fiscal_lancamento_origem" CHECK ("fiscal_lancamentos"."origem" IN ('DOCUMENTO', 'CIAP', 'AJUSTE', 'SALDO_ANTERIOR', 'APURACAO')),
	CONSTRAINT "chk_fiscal_lancamento_tributo" CHECK ("fiscal_lancamentos"."tributo" IN ('ICMS', 'ICMS_ST', 'IPI', 'PIS', 'COFINS', 'FCP', 'DIFAL')),
	CONSTRAINT "chk_fiscal_lancamento_natureza" CHECK ("fiscal_lancamentos"."natureza" IN ('DEBITO', 'CREDITO')),
	CONSTRAINT "chk_fiscal_lancamento_sinal" CHECK ("fiscal_lancamentos"."sinal" IN (-1, 1)),
	CONSTRAINT "chk_fiscal_lancamento_versao" CHECK ("fiscal_lancamentos"."fechamento_versao" >= 1),
	CONSTRAINT "chk_fiscal_lancamento_valor" CHECK ("fiscal_lancamentos"."valor" >= 0),
	CONSTRAINT "chk_fiscal_lancamento_base" CHECK ("fiscal_lancamentos"."base_calculo" IS NULL OR "fiscal_lancamentos"."base_calculo" >= 0),
	CONSTRAINT "chk_fiscal_lancamento_aliquota" CHECK ("fiscal_lancamentos"."aliquota" IS NULL OR "fiscal_lancamentos"."aliquota" >= 0),
	CONSTRAINT "chk_fiscal_lancamento_competencia_dia1" CHECK (date_part('day', "fiscal_lancamentos"."competencia") = 1),
	CONSTRAINT "chk_fiscal_lancamento_item_exige_documento" CHECK ("fiscal_lancamentos"."documento_fiscal_item_id" IS NULL OR "fiscal_lancamentos"."documento_fiscal_id" IS NOT NULL),
	CONSTRAINT "chk_fiscal_lancamento_documento_origem" CHECK ("fiscal_lancamentos"."documento_fiscal_id" IS NULL OR "fiscal_lancamentos"."origem" = 'DOCUMENTO')
);
--> statement-breakpoint
ALTER TABLE "fiscal_lancamentos" ADD CONSTRAINT "fiscal_lancamentos_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_lancamentos" ADD CONSTRAINT "fiscal_lancamentos_documento_fiscal_id_documentos_fiscais_id_fk" FOREIGN KEY ("documento_fiscal_id") REFERENCES "public"."documentos_fiscais"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_lancamentos" ADD CONSTRAINT "fiscal_lancamentos_documento_fiscal_item_id_documentos_fiscais_itens_id_fk" FOREIGN KEY ("documento_fiscal_item_id") REFERENCES "public"."documentos_fiscais_itens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_fiscal_lancamento_fato_versao" ON "fiscal_lancamentos" USING btree ("cliente_id","origem","fato_chave","fechamento_versao","tributo","natureza");--> statement-breakpoint
CREATE INDEX "idx_fiscal_lancamento_competencia" ON "fiscal_lancamentos" USING btree ("cliente_id","competencia","fechamento_versao");--> statement-breakpoint
CREATE INDEX "idx_fiscal_lancamento_documento" ON "fiscal_lancamentos" USING btree ("documento_fiscal_id");