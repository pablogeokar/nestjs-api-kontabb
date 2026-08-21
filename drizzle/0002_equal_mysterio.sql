CREATE TABLE "cfop_equivalencias" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid,
	"cfop_origem" varchar(4) NOT NULL,
	"cfop_destino" varchar(4) NOT NULL,
	"tipo_operacao" varchar(20) DEFAULT 'SAIDA_PARA_ENTRADA' NOT NULL,
	"descricao" text,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uidx_cfop_eq_cliente_origem" UNIQUE NULLS NOT DISTINCT("cliente_id","cfop_origem"),
	CONSTRAINT "chk_cfop_eq_tipo" CHECK ("cfop_equivalencias"."tipo_operacao" IN ('SAIDA_PARA_ENTRADA', 'ENTRADA_PARA_SAIDA')),
	CONSTRAINT "chk_cfop_eq_destino_diferente" CHECK ("cfop_equivalencias"."cfop_origem" <> "cfop_equivalencias"."cfop_destino")
);
--> statement-breakpoint
CREATE TABLE "cfops" (
	"codigo" varchar(4) PRIMARY KEY NOT NULL,
	"descricao" text NOT NULL,
	"tipo_operacao" varchar(10) NOT NULL,
	"abrangencia" varchar(15) NOT NULL,
	"grupo" text,
	"descricao_detalhada" text,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chk_cfops_codigo" CHECK ("cfops"."codigo" ~ '^[123567][0-9]{3}$'),
	CONSTRAINT "chk_cfops_tipo" CHECK ("cfops"."tipo_operacao" IN ('ENTRADA', 'SAIDA')),
	CONSTRAINT "chk_cfops_abrangencia" CHECK ("cfops"."abrangencia" IN ('ESTADUAL', 'INTERESTADUAL', 'EXTERIOR'))
);
--> statement-breakpoint
ALTER TABLE "documentos_fiscais" ADD COLUMN "tipo_operacao_escriturada" varchar(10) DEFAULT 'ENTRADA' NOT NULL;--> statement-breakpoint
ALTER TABLE "documentos_fiscais" ADD COLUMN "tp_nf_xml" varchar(1);--> statement-breakpoint
ALTER TABLE "documentos_fiscais_itens" ADD COLUMN "cfop_xml" varchar(4);--> statement-breakpoint
ALTER TABLE "documentos_fiscais_itens" ADD COLUMN "tipo_operacao_escriturada" varchar(10) DEFAULT 'ENTRADA' NOT NULL;--> statement-breakpoint
ALTER TABLE "documentos_fiscais_itens" ADD COLUMN "cfop_revisao_necessaria" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cfop_equivalencias" ADD CONSTRAINT "cfop_equivalencias_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cfop_equivalencias" ADD CONSTRAINT "cfop_equivalencias_cfop_origem_cfops_codigo_fk" FOREIGN KEY ("cfop_origem") REFERENCES "public"."cfops"("codigo") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cfop_equivalencias" ADD CONSTRAINT "cfop_equivalencias_cfop_destino_cfops_codigo_fk" FOREIGN KEY ("cfop_destino") REFERENCES "public"."cfops"("codigo") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_cfop_eq_origem" ON "cfop_equivalencias" USING btree ("cfop_origem");--> statement-breakpoint
CREATE INDEX "idx_cfop_eq_cliente" ON "cfop_equivalencias" USING btree ("cliente_id");--> statement-breakpoint
CREATE INDEX "idx_cfops_tipo" ON "cfops" USING btree ("tipo_operacao");--> statement-breakpoint
CREATE INDEX "idx_cfops_abrangencia" ON "cfops" USING btree ("abrangencia");--> statement-breakpoint
CREATE INDEX "idx_item_cfop_xml" ON "documentos_fiscais_itens" USING btree ("cfop_xml");--> statement-breakpoint
CREATE INDEX "idx_item_operacao_escriturada" ON "documentos_fiscais_itens" USING btree ("tipo_operacao_escriturada");--> statement-breakpoint
ALTER TABLE "documentos_fiscais" ADD CONSTRAINT "chk_docs_fiscais_operacao_escriturada" CHECK ("documentos_fiscais"."tipo_operacao_escriturada" IN ('ENTRADA', 'SAIDA'));--> statement-breakpoint
ALTER TABLE "documentos_fiscais" ADD CONSTRAINT "chk_docs_fiscais_tp_nf_xml" CHECK ("documentos_fiscais"."tp_nf_xml" IS NULL OR "documentos_fiscais"."tp_nf_xml" IN ('0', '1'));--> statement-breakpoint
ALTER TABLE "documentos_fiscais_itens" ADD CONSTRAINT "chk_item_cfop_xml" CHECK ("documentos_fiscais_itens"."cfop_xml" IS NULL OR "documentos_fiscais_itens"."cfop_xml" ~ '^[1-7][0-9]{3}$');--> statement-breakpoint
ALTER TABLE "documentos_fiscais_itens" ADD CONSTRAINT "chk_item_operacao_escriturada" CHECK ("documentos_fiscais_itens"."tipo_operacao_escriturada" IN ('ENTRADA', 'SAIDA'));