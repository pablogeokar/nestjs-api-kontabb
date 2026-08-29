CREATE TABLE "documentos_fiscais_cte_escrituracao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"documento_fiscal_id" uuid NOT NULL,
	"cliente_id" uuid NOT NULL,
	"escrituravel" boolean NOT NULL,
	"motivo_nao_escrituravel" text,
	"tomador_cnpj_cpf" text NOT NULL,
	"tomador_papel" varchar(20) NOT NULL,
	"tipo_operacao_escriturada" varchar(10) DEFAULT 'ENTRADA' NOT NULL,
	"tp_cte" varchar(1) NOT NULL,
	"tp_serv" varchar(1) NOT NULL,
	"modal" varchar(2) NOT NULL,
	"cfop_xml" varchar(4) NOT NULL,
	"cfop" varchar(4) NOT NULL,
	"cfop_revisao_necessaria" boolean DEFAULT false NOT NULL,
	"revisao_necessaria" boolean DEFAULT false NOT NULL,
	"cst_icms" varchar(3),
	"csosn_icms" varchar(4),
	"valor_total_servico" numeric(15, 2) NOT NULL,
	"valor_receber" numeric(15, 2) NOT NULL,
	"valor_bc_icms" numeric(15, 2),
	"aliquota_icms" numeric(7, 4),
	"valor_icms" numeric(15, 2),
	"valor_icms_creditavel" numeric(15, 2) DEFAULT '0' NOT NULL,
	"valor_total_tributos" numeric(15, 2),
	"chave_cte_referenciado" text,
	"codigo_municipio_origem" varchar(7),
	"codigo_municipio_destino" varchar(7),
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chk_cte_escrituracao_motivo" CHECK (("documentos_fiscais_cte_escrituracao"."escrituravel" = true AND "documentos_fiscais_cte_escrituracao"."motivo_nao_escrituravel" IS NULL) OR ("documentos_fiscais_cte_escrituracao"."escrituravel" = false AND btrim(COALESCE("documentos_fiscais_cte_escrituracao"."motivo_nao_escrituravel", '')) <> '')),
	CONSTRAINT "chk_cte_escrituracao_tomador_documento" CHECK ("documentos_fiscais_cte_escrituracao"."tomador_cnpj_cpf" ~ '^[0-9]{11}([0-9]{3})?$'),
	CONSTRAINT "chk_cte_escrituracao_tomador_papel" CHECK ("documentos_fiscais_cte_escrituracao"."tomador_papel" IN ('REMETENTE', 'EXPEDIDOR', 'RECEBEDOR', 'DESTINATARIO', 'TERCEIRO')),
	CONSTRAINT "chk_cte_escrituracao_operacao" CHECK ("documentos_fiscais_cte_escrituracao"."tipo_operacao_escriturada" = 'ENTRADA'),
	CONSTRAINT "chk_cte_escrituracao_tp_cte" CHECK ("documentos_fiscais_cte_escrituracao"."tp_cte" IN ('0', '1', '2', '3')),
	CONSTRAINT "chk_cte_escrituracao_tp_serv" CHECK ("documentos_fiscais_cte_escrituracao"."tp_serv" IN ('0', '1', '2', '3', '4')),
	CONSTRAINT "chk_cte_escrituracao_modal" CHECK ("documentos_fiscais_cte_escrituracao"."modal" ~ '^[0-9]{2}$'),
	CONSTRAINT "chk_cte_escrituracao_cfop_xml" CHECK ("documentos_fiscais_cte_escrituracao"."cfop_xml" ~ '^[123567][0-9]{3}$'),
	CONSTRAINT "chk_cte_escrituracao_cfop" CHECK ("documentos_fiscais_cte_escrituracao"."cfop" ~ '^[123567][0-9]{3}$'),
	CONSTRAINT "chk_cte_escrituracao_referencia" CHECK ("documentos_fiscais_cte_escrituracao"."chave_cte_referenciado" IS NULL OR "documentos_fiscais_cte_escrituracao"."chave_cte_referenciado" ~ '^[0-9]{44}$'),
	CONSTRAINT "chk_cte_escrituracao_municipio_origem" CHECK ("documentos_fiscais_cte_escrituracao"."codigo_municipio_origem" IS NULL OR "documentos_fiscais_cte_escrituracao"."codigo_municipio_origem" ~ '^[0-9]{7}$'),
	CONSTRAINT "chk_cte_escrituracao_municipio_destino" CHECK ("documentos_fiscais_cte_escrituracao"."codigo_municipio_destino" IS NULL OR "documentos_fiscais_cte_escrituracao"."codigo_municipio_destino" ~ '^[0-9]{7}$')
);
--> statement-breakpoint
ALTER TABLE "documentos_fiscais_itens" DROP CONSTRAINT "documentos_fiscais_itens_documento_fiscal_id_documentos_fiscais_id_fk";
--> statement-breakpoint
ALTER TABLE "documentos_fiscais_itens" DROP CONSTRAINT "documentos_fiscais_itens_cliente_id_clientes_id_fk";
--> statement-breakpoint
ALTER TABLE "documentos_fiscais" ADD COLUMN "escriturado" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "documentos_fiscais" ADD COLUMN "escrituracao_status" varchar(24) DEFAULT 'NAO_ESCRITURAVEL' NOT NULL;--> statement-breakpoint
ALTER TABLE "documentos_fiscais_cte_escrituracao" ADD CONSTRAINT "documentos_fiscais_cte_escrituracao_documento_fiscal_id_documentos_fiscais_id_fk" FOREIGN KEY ("documento_fiscal_id") REFERENCES "public"."documentos_fiscais"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documentos_fiscais_cte_escrituracao" ADD CONSTRAINT "documentos_fiscais_cte_escrituracao_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_cte_escrituracao_documento" ON "documentos_fiscais_cte_escrituracao" USING btree ("documento_fiscal_id");--> statement-breakpoint
CREATE INDEX "idx_cte_escrituracao_cliente" ON "documentos_fiscais_cte_escrituracao" USING btree ("cliente_id");--> statement-breakpoint
CREATE INDEX "idx_cte_escrituracao_cfop" ON "documentos_fiscais_cte_escrituracao" USING btree ("cfop");--> statement-breakpoint
CREATE INDEX "idx_cte_escrituracao_apuracao" ON "documentos_fiscais_cte_escrituracao" USING btree ("cliente_id","escrituravel","cfop");--> statement-breakpoint
CREATE INDEX "idx_cte_escrituracao_referencia" ON "documentos_fiscais_cte_escrituracao" USING btree ("chave_cte_referenciado");--> statement-breakpoint
ALTER TABLE "documentos_fiscais_itens" ADD CONSTRAINT "fk_df_itens_documento_fiscal" FOREIGN KEY ("documento_fiscal_id") REFERENCES "public"."documentos_fiscais"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documentos_fiscais_itens" ADD CONSTRAINT "fk_df_itens_cliente" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documentos_fiscais" ADD CONSTRAINT "chk_docs_fiscais_escrituracao_status" CHECK ("documentos_fiscais"."escrituracao_status" IN ('ESCRITURADO', 'NAO_ESCRITURAVEL', 'PENDENTE_REVISAO'));--> statement-breakpoint
ALTER TABLE "documentos_fiscais" ADD CONSTRAINT "chk_docs_fiscais_escrituracao_coerencia" CHECK (("documentos_fiscais"."escriturado" = false AND "documentos_fiscais"."escrituracao_status" = 'NAO_ESCRITURAVEL') OR ("documentos_fiscais"."escriturado" = true AND "documentos_fiscais"."escrituracao_status" IN ('ESCRITURADO', 'PENDENTE_REVISAO')));