ALTER TABLE "documentos_fiscais" DROP CONSTRAINT "chk_docs_fiscais_chave";--> statement-breakpoint
ALTER TABLE "documentos_fiscais" DROP CONSTRAINT "chk_docs_fiscais_tipo";--> statement-breakpoint
ALTER TABLE "documentos_fiscais" DROP CONSTRAINT "chk_docs_fiscais_modelo";--> statement-breakpoint
ALTER TABLE "documentos_fiscais" DROP CONSTRAINT "chk_docs_fiscais_tipo_modelo";--> statement-breakpoint
ALTER TABLE "documentos_fiscais" ADD COLUMN "codigo_verificacao" varchar(32);--> statement-breakpoint
ALTER TABLE "documentos_fiscais" ADD COLUMN "competencia_declarada" date;--> statement-breakpoint
ALTER TABLE "documentos_fiscais" ADD COLUMN "municipio_incidencia" varchar(7);--> statement-breakpoint
ALTER TABLE "documentos_fiscais" ADD COLUMN "regime_especial_tributacao" varchar(10);--> statement-breakpoint
ALTER TABLE "documentos_fiscais" ADD COLUMN "optante_simples_nacional_xml" boolean;--> statement-breakpoint
ALTER TABLE "documentos_fiscais" ADD COLUMN "nfse_dados" jsonb;--> statement-breakpoint
ALTER TABLE "documentos_fiscais_itens" ADD COLUMN "valor_bc_iss" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "documentos_fiscais_itens" ADD COLUMN "aliquota_iss" numeric(7, 4);--> statement-breakpoint
ALTER TABLE "documentos_fiscais_itens" ADD COLUMN "valor_iss" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "documentos_fiscais_itens" ADD COLUMN "iss_retido" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "documentos_fiscais_itens" ADD COLUMN "item_lista_servico" varchar(10);--> statement-breakpoint
ALTER TABLE "documentos_fiscais_itens" ADD COLUMN "cnae" varchar(7);--> statement-breakpoint
ALTER TABLE "documentos_fiscais_itens" ADD COLUMN "codigo_tributacao_municipio" varchar(20);--> statement-breakpoint
ALTER TABLE "documentos_fiscais_itens" ADD COLUMN "exigibilidade_iss" varchar(1);--> statement-breakpoint
ALTER TABLE "documentos_fiscais_itens" ADD COLUMN "municipio_incidencia" varchar(7);--> statement-breakpoint
CREATE INDEX "idx_docs_fiscais_cliente_competencia_nfse" ON "documentos_fiscais" USING btree ("cliente_id","competencia_declarada","id");--> statement-breakpoint
CREATE INDEX "idx_item_servico_lc116" ON "documentos_fiscais_itens" USING btree ("item_lista_servico");--> statement-breakpoint
CREATE INDEX "idx_item_cnae" ON "documentos_fiscais_itens" USING btree ("cnae");--> statement-breakpoint
ALTER TABLE "documentos_fiscais" ADD CONSTRAINT "chk_docs_fiscais_municipio_incidencia" CHECK ("documentos_fiscais"."municipio_incidencia" IS NULL OR "documentos_fiscais"."municipio_incidencia" ~ '^[0-9]{7}$');--> statement-breakpoint
ALTER TABLE "documentos_fiscais" ADD CONSTRAINT "chk_docs_fiscais_chave" CHECK ((("documentos_fiscais"."tipo_documento" IN ('NFE', 'CTE', 'NFCE') AND length("documentos_fiscais"."chave_acesso") = 44) OR ("documentos_fiscais"."tipo_documento" = 'NFSE' AND length("documentos_fiscais"."chave_acesso") BETWEEN 14 AND 50)));--> statement-breakpoint
ALTER TABLE "documentos_fiscais" ADD CONSTRAINT "chk_docs_fiscais_tipo" CHECK ("documentos_fiscais"."tipo_documento" IN ('NFE', 'CTE', 'NFCE', 'NFSE'));--> statement-breakpoint
ALTER TABLE "documentos_fiscais" ADD CONSTRAINT "chk_docs_fiscais_modelo" CHECK ("documentos_fiscais"."modelo" IN ('55', '57', '65', 'NFSE'));--> statement-breakpoint
ALTER TABLE "documentos_fiscais" ADD CONSTRAINT "chk_docs_fiscais_tipo_modelo" CHECK (("documentos_fiscais"."tipo_documento" = 'NFE' AND "documentos_fiscais"."modelo" = '55') OR ("documentos_fiscais"."tipo_documento" = 'CTE' AND "documentos_fiscais"."modelo" = '57') OR ("documentos_fiscais"."tipo_documento" = 'NFCE' AND "documentos_fiscais"."modelo" = '65') OR ("documentos_fiscais"."tipo_documento" = 'NFSE' AND "documentos_fiscais"."modelo" = 'NFSE'));--> statement-breakpoint
ALTER TABLE "documentos_fiscais_itens" ADD CONSTRAINT "chk_item_cnae" CHECK ("documentos_fiscais_itens"."cnae" IS NULL OR "documentos_fiscais_itens"."cnae" ~ '^[0-9]{7}$');--> statement-breakpoint
ALTER TABLE "documentos_fiscais_itens" ADD CONSTRAINT "chk_item_municipio_incidencia" CHECK ("documentos_fiscais_itens"."municipio_incidencia" IS NULL OR "documentos_fiscais_itens"."municipio_incidencia" ~ '^[0-9]{7}$');