CREATE TABLE "fiscal_decisoes_item" (
	"item_id" uuid NOT NULL,
	"cliente_id" uuid NOT NULL,
	"regra_versao_id" text DEFAULT 'SEM_REGRA' NOT NULL,
	"valor_credito_admitido" numeric(15, 2) DEFAULT '0' NOT NULL,
	"decisao" varchar(20) NOT NULL,
	"motivo" varchar(40) NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiscal_decisoes_item_pk" PRIMARY KEY("item_id","regra_versao_id"),
	CONSTRAINT "chk_fiscal_decisao" CHECK ("fiscal_decisoes_item"."decisao" IN ('ADMITIDO', 'VEDADO', 'EXIGE_REVISAO')),
	CONSTRAINT "chk_fiscal_decisao_motivo" CHECK ("fiscal_decisoes_item"."motivo" IN ('SEM_VALOR_DESTACADO', 'CST_AUTORIZA_CREDITO', 'CSOSN_PERMITE_CREDITO', 'CFOP_VEDA_CREDITO', 'REGRA_VEDA_CREDITO', 'CST_NAO_AUTORIZADO')),
	CONSTRAINT "chk_fiscal_decisao_credito_nao_negativo" CHECK ("fiscal_decisoes_item"."valor_credito_admitido" >= 0)
);
--> statement-breakpoint
ALTER TABLE "fiscal_decisoes_item" ADD CONSTRAINT "fiscal_decisoes_item_item_id_documentos_fiscais_itens_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."documentos_fiscais_itens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_decisoes_item" ADD CONSTRAINT "fiscal_decisoes_item_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_fiscal_decisoes_item_cliente" ON "fiscal_decisoes_item" USING btree ("cliente_id");