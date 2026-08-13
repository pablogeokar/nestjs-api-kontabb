CREATE TABLE "certificados_digitais" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"cnpj" text NOT NULL,
	"razao_social" text NOT NULL,
	"arquivo_key" text NOT NULL,
	"senha_criptografada" text NOT NULL,
	"thumbprint" text,
	"emissor" text,
	"validade_inicio" timestamp NOT NULL,
	"validade_fim" timestamp NOT NULL,
	"status" text DEFAULT 'ATIVO' NOT NULL,
	"uploadado_por" text,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chk_certificados_status" CHECK ("certificados_digitais"."status" IN ('ATIVO', 'EXPIRADO', 'PRESTES_A_EXPIRAR', 'REVOGADO')),
	CONSTRAINT "chk_certificados_cnpj" CHECK ("certificados_digitais"."cnpj" ~ '^[0-9]{14}$'),
	CONSTRAINT "chk_certificados_validade" CHECK ("certificados_digitais"."validade_inicio" < "certificados_digitais"."validade_fim"),
	CONSTRAINT "chk_certificados_arquivo_key" CHECK (btrim("certificados_digitais"."arquivo_key") <> '')
);
--> statement-breakpoint
CREATE TABLE "controle_nsu" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"cnpj" text NOT NULL,
	"tipo_documento" text NOT NULL,
	"ultimo_nsu" bigint DEFAULT 0 NOT NULL,
	"max_nsu" bigint DEFAULT 0 NOT NULL,
	"status_sefaz" integer,
	"motivo_sefaz" text,
	"ultima_consulta_em" timestamp,
	"proxima_consulta_em" timestamp,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chk_controle_nsu_tipo" CHECK ("controle_nsu"."tipo_documento" IN ('NFE', 'CTE')),
	CONSTRAINT "chk_controle_nsu_ultimo" CHECK ("controle_nsu"."ultimo_nsu" >= 0),
	CONSTRAINT "chk_controle_nsu_max" CHECK ("controle_nsu"."max_nsu" >= 0)
);
--> statement-breakpoint
CREATE TABLE "documentos_fiscais" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"chave_acesso" text NOT NULL,
	"nsu" bigint NOT NULL,
	"tipo_documento" text NOT NULL,
	"modelo" text NOT NULL,
	"serie" text,
	"numero_documento" text NOT NULL,
	"emitente_cnpj_cpf" text NOT NULL,
	"emitente_razao_social" text,
	"destinatario_cnpj_cpf" text NOT NULL,
	"destinatario_razao_social" text,
	"data_emissao" timestamp NOT NULL,
	"valor_total" numeric(14, 2) NOT NULL,
	"situacao" text DEFAULT 'AUTORIZADA' NOT NULL,
	"manifestacao_status" text DEFAULT 'SEM_MANIFESTACAO' NOT NULL,
	"xml_key" text NOT NULL,
	"danfe_key" text,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "documentos_fiscais_chave_acesso_unique" UNIQUE("chave_acesso"),
	CONSTRAINT "chk_docs_fiscais_chave" CHECK (length("documentos_fiscais"."chave_acesso") = 44),
	CONSTRAINT "chk_docs_fiscais_tipo" CHECK ("documentos_fiscais"."tipo_documento" IN ('NFE', 'CTE', 'NFCE')),
	CONSTRAINT "chk_docs_fiscais_modelo" CHECK ("documentos_fiscais"."modelo" IN ('55', '57', '65')),
	CONSTRAINT "chk_docs_fiscais_situacao" CHECK ("documentos_fiscais"."situacao" IN ('AUTORIZADA', 'CANCELADA', 'DENEGADA', 'RESUMIDA')),
	CONSTRAINT "chk_docs_fiscais_manifestacao" CHECK ("documentos_fiscais"."manifestacao_status" IN ('SEM_MANIFESTACAO', 'CIENCIA', 'CONFIRMADA', 'DESCONHECIDA', 'NAO_REALIZADA')),
	CONSTRAINT "chk_docs_fiscais_valor" CHECK ("documentos_fiscais"."valor_total" >= 0),
	CONSTRAINT "chk_docs_fiscais_xml_key" CHECK (btrim("documentos_fiscais"."xml_key") <> '')
);
--> statement-breakpoint
CREATE TABLE "eventos_fiscais" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"documento_fiscal_id" uuid NOT NULL,
	"tipo_evento" text NOT NULL,
	"codigo_evento" text NOT NULL,
	"sequencia_evento" integer DEFAULT 1 NOT NULL,
	"descricao" text,
	"protocolo" text,
	"status_sefaz" integer,
	"motivo_sefaz" text,
	"data_evento" timestamp DEFAULT now() NOT NULL,
	"xml_evento_key" text,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chk_eventos_fiscais_tipo" CHECK ("eventos_fiscais"."tipo_evento" IN ('MANIFESTACAO_CIENCIA', 'MANIFESTACAO_CONFIRMACAO', 'MANIFESTACAO_DESCONHECIMENTO', 'MANIFESTACAO_NAO_REALIZADA', 'CANCELAMENTO', 'CCE')),
	CONSTRAINT "chk_eventos_fiscais_sequencia" CHECK ("eventos_fiscais"."sequencia_evento" >= 1)
);
--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "logo_key" text;--> statement-breakpoint
ALTER TABLE "certificados_digitais" ADD CONSTRAINT "certificados_digitais_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificados_digitais" ADD CONSTRAINT "certificados_digitais_uploadado_por_user_id_fk" FOREIGN KEY ("uploadado_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "controle_nsu" ADD CONSTRAINT "controle_nsu_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documentos_fiscais" ADD CONSTRAINT "documentos_fiscais_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eventos_fiscais" ADD CONSTRAINT "eventos_fiscais_documento_fiscal_id_documentos_fiscais_id_fk" FOREIGN KEY ("documento_fiscal_id") REFERENCES "public"."documentos_fiscais"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_certificados_cliente_id" ON "certificados_digitais" USING btree ("cliente_id");--> statement-breakpoint
CREATE INDEX "idx_certificados_cnpj" ON "certificados_digitais" USING btree ("cnpj");--> statement-breakpoint
CREATE INDEX "idx_certificados_status" ON "certificados_digitais" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_certificados_validade_fim" ON "certificados_digitais" USING btree ("validade_fim");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_certificados_cliente_ativo" ON "certificados_digitais" USING btree ("cliente_id") WHERE status IN ('ATIVO', 'PRESTES_A_EXPIRAR');--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_controle_nsu_cliente_tipo" ON "controle_nsu" USING btree ("cliente_id","tipo_documento");--> statement-breakpoint
CREATE INDEX "idx_controle_nsu_cliente_id" ON "controle_nsu" USING btree ("cliente_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_docs_fiscais_chave" ON "documentos_fiscais" USING btree ("chave_acesso");--> statement-breakpoint
CREATE INDEX "idx_docs_fiscais_cliente_id" ON "documentos_fiscais" USING btree ("cliente_id");--> statement-breakpoint
CREATE INDEX "idx_docs_fiscais_tipo" ON "documentos_fiscais" USING btree ("tipo_documento");--> statement-breakpoint
CREATE INDEX "idx_docs_fiscais_data_emissao" ON "documentos_fiscais" USING btree ("data_emissao");--> statement-breakpoint
CREATE INDEX "idx_docs_fiscais_nsu" ON "documentos_fiscais" USING btree ("nsu");--> statement-breakpoint
CREATE INDEX "idx_docs_fiscais_destinatario" ON "documentos_fiscais" USING btree ("destinatario_cnpj_cpf");--> statement-breakpoint
CREATE INDEX "idx_docs_fiscais_emitente" ON "documentos_fiscais" USING btree ("emitente_cnpj_cpf");--> statement-breakpoint
CREATE INDEX "idx_eventos_fiscais_doc" ON "eventos_fiscais" USING btree ("documento_fiscal_id");--> statement-breakpoint
CREATE INDEX "idx_eventos_fiscais_tipo" ON "eventos_fiscais" USING btree ("tipo_evento");--> statement-breakpoint
CREATE INDEX "idx_eventos_fiscais_data" ON "eventos_fiscais" USING btree ("data_evento");