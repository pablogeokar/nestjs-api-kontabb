CREATE TABLE "ciap_movimentos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"bem_id" uuid NOT NULL,
	"tipo" varchar(20) NOT NULL,
	"data_movimento" date NOT NULL,
	"documento_fiscal_id" uuid,
	"documento_fiscal_item_id" uuid,
	"valor_icms_passivel" numeric(15, 2) NOT NULL,
	"movimento_anterior_id" uuid,
	"motivo_baixa" varchar(2),
	"observacao" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_ciap_mov_tipo" CHECK ("ciap_movimentos"."tipo" IN ('aquisicao', 'imobilizacao', 'baixa', 'transferencia', 'correcao')),
	CONSTRAINT "chk_ciap_mov_motivo_baixa" CHECK ("ciap_movimentos"."motivo_baixa" IS NULL OR "ciap_movimentos"."motivo_baixa" IN ('01', '02', '03')),
	CONSTRAINT "chk_ciap_mov_correcao" CHECK ("ciap_movimentos"."movimento_anterior_id" IS NULL OR "ciap_movimentos"."tipo" = 'correcao')
);
--> statement-breakpoint
ALTER TABLE "ciap_movimentos" ADD CONSTRAINT "ciap_movimentos_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ciap_movimentos" ADD CONSTRAINT "ciap_movimentos_bem_id_ciap_ativo_permanente_id_fk" FOREIGN KEY ("bem_id") REFERENCES "public"."ciap_ativo_permanente"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ciap_movimentos" ADD CONSTRAINT "ciap_movimentos_documento_fiscal_id_documentos_fiscais_id_fk" FOREIGN KEY ("documento_fiscal_id") REFERENCES "public"."documentos_fiscais"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ciap_movimentos" ADD CONSTRAINT "ciap_movimentos_documento_fiscal_item_id_documentos_fiscais_itens_id_fk" FOREIGN KEY ("documento_fiscal_item_id") REFERENCES "public"."documentos_fiscais_itens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ciap_movimentos" ADD CONSTRAINT "ciap_movimentos_movimento_anterior_id_fk" FOREIGN KEY ("movimento_anterior_id") REFERENCES "public"."ciap_movimentos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ciap_mov_cliente" ON "ciap_movimentos" USING btree ("cliente_id");--> statement-breakpoint
CREATE INDEX "idx_ciap_mov_bem" ON "ciap_movimentos" USING btree ("bem_id");--> statement-breakpoint
CREATE INDEX "idx_ciap_mov_bem_data" ON "ciap_movimentos" USING btree ("bem_id","data_movimento");