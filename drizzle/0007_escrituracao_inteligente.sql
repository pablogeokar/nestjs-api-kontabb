CREATE TABLE "classificacao_destinacao_aprendizado" (
	"item_id" uuid PRIMARY KEY NOT NULL,
	"cliente_id" uuid NOT NULL,
	"fornecedor" text NOT NULL,
	"codigo_produto" text NOT NULL,
	"ncm" varchar(8) NOT NULL,
	"destinacao" varchar(20) NOT NULL,
	"ultima_confirmacao_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_aprendizado_destinacao" CHECK ("classificacao_destinacao_aprendizado"."destinacao" IN ('REVENDA', 'INDUSTRIALIZACAO', 'USO_CONSUMO', 'ATIVO_IMOBILIZADO')),
	CONSTRAINT "chk_aprendizado_ncm" CHECK ("classificacao_destinacao_aprendizado"."ncm" ~ '^[0-9]{8}$')
);
--> statement-breakpoint
ALTER TABLE "documentos_fiscais_itens" ADD COLUMN "destinacao_inferida" varchar(20);--> statement-breakpoint
ALTER TABLE "documentos_fiscais_itens" ADD COLUMN "destinacao_origem" varchar(20);--> statement-breakpoint
ALTER TABLE "documentos_fiscais_itens" ADD COLUMN "destinacao_confianca" numeric(4, 3);--> statement-breakpoint
ALTER TABLE "documentos_fiscais_itens" ADD COLUMN "destinacao_justificativa" text;--> statement-breakpoint
ALTER TABLE "documentos_fiscais_itens" ADD COLUMN "cfop_manual" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "documentos_fiscais_itens" ADD COLUMN "cfop_origem_resolucao" varchar(30);--> statement-breakpoint
ALTER TABLE "documentos_fiscais_itens" ADD COLUMN "cfop_motivo_resolucao" text;--> statement-breakpoint
ALTER TABLE "classificacao_destinacao_aprendizado" ADD CONSTRAINT "classificacao_destinacao_aprendizado_item_id_documentos_fiscais_itens_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."documentos_fiscais_itens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classificacao_destinacao_aprendizado" ADD CONSTRAINT "classificacao_destinacao_aprendizado_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_aprendizado_contexto" ON "classificacao_destinacao_aprendizado" USING btree ("cliente_id","fornecedor","codigo_produto","ncm");--> statement-breakpoint
ALTER TABLE "documentos_fiscais_itens" ADD CONSTRAINT "chk_item_destinacao_inferida" CHECK ("documentos_fiscais_itens"."destinacao_inferida" IS NULL OR "documentos_fiscais_itens"."destinacao_inferida" IN ('REVENDA', 'INDUSTRIALIZACAO', 'USO_CONSUMO', 'ATIVO_IMOBILIZADO'));--> statement-breakpoint
ALTER TABLE "documentos_fiscais_itens" ADD CONSTRAINT "chk_item_destinacao_confianca" CHECK ("documentos_fiscais_itens"."destinacao_confianca" IS NULL OR "documentos_fiscais_itens"."destinacao_confianca" BETWEEN 0 AND 1);--> statement-breakpoint
ALTER TABLE "documentos_fiscais_itens" ADD CONSTRAINT "chk_item_destinacao_origem" CHECK ("documentos_fiscais_itens"."destinacao_origem" IS NULL OR "documentos_fiscais_itens"."destinacao_origem" IN ('MANUAL', 'HISTORICO', 'NCM_PERFIL', 'HEURISTICA', 'INDETERMINADO'));