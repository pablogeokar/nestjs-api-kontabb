CREATE TABLE "rescisao_documentos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rescisao_id" uuid NOT NULL,
	"tipo_documento" text NOT NULL,
	"arquivo_key" text NOT NULL,
	"arquivo_nome" text NOT NULL,
	"uploadado_por" text,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chk_rescisao_documentos_tipo" CHECK ("rescisao_documentos"."tipo_documento" IN ('TRCT', 'AVISO_PREVIO', 'EXAME_DEMISSIONAL', 'GUIA_SEGURO_DESEMPREGO', 'CARTA_RECOMENDACAO', 'HISTORICO_INSS', 'OUTRO')),
	CONSTRAINT "chk_rescisao_documentos_arquivo_key" CHECK (btrim("rescisao_documentos"."arquivo_key") <> '')
);
--> statement-breakpoint
CREATE TABLE "rescisoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"folha_id" uuid NOT NULL,
	"cliente_id" uuid NOT NULL,
	"funcionario_nome" text NOT NULL,
	"funcionario_cpf" text NOT NULL,
	"data_admissao" date NOT NULL,
	"data_desligamento" date NOT NULL,
	"causa_afastamento" text,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chk_rescisoes_cpf" CHECK ("rescisoes"."funcionario_cpf" ~ '^[0-9]{11}$'),
	CONSTRAINT "chk_rescisoes_nome" CHECK (btrim("rescisoes"."funcionario_nome") <> '')
);
--> statement-breakpoint
ALTER TABLE "folhas_pagamento" DROP CONSTRAINT "chk_folhas_tipo";--> statement-breakpoint
ALTER TABLE "rescisao_documentos" ADD CONSTRAINT "rescisao_documentos_rescisao_id_rescisoes_id_fk" FOREIGN KEY ("rescisao_id") REFERENCES "public"."rescisoes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rescisao_documentos" ADD CONSTRAINT "rescisao_documentos_uploadado_por_user_id_fk" FOREIGN KEY ("uploadado_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rescisoes" ADD CONSTRAINT "rescisoes_folha_id_folhas_pagamento_id_fk" FOREIGN KEY ("folha_id") REFERENCES "public"."folhas_pagamento"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rescisoes" ADD CONSTRAINT "rescisoes_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_rescisao_documentos_tipo" ON "rescisao_documentos" USING btree ("rescisao_id","tipo_documento") WHERE "rescisao_documentos"."tipo_documento" <> 'OUTRO';--> statement-breakpoint
CREATE INDEX "idx_rescisao_documentos_rescisao_id" ON "rescisao_documentos" USING btree ("rescisao_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_rescisoes_folha" ON "rescisoes" USING btree ("folha_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_rescisoes_cliente_cpf_desligamento" ON "rescisoes" USING btree ("cliente_id","funcionario_cpf","data_desligamento");--> statement-breakpoint
CREATE INDEX "idx_rescisoes_cliente_id" ON "rescisoes" USING btree ("cliente_id");--> statement-breakpoint
ALTER TABLE "folhas_pagamento" ADD CONSTRAINT "chk_folhas_tipo" CHECK ("folhas_pagamento"."tipo" IN ('FOLHA_MENSAL', 'FERIAS', 'ADIANTAMENTO_13', 'RESCISAO'));