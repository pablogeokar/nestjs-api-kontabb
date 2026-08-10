CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"reset_at" bigint NOT NULL,
	CONSTRAINT "chk_app_rate_limits_count" CHECK ("app_rate_limits"."count" >= 0),
	CONSTRAINT "chk_app_rate_limits_reset_at" CHECK ("app_rate_limits"."reset_at" > 0)
);
--> statement-breakpoint
CREATE TABLE "clientes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tipo_pessoa" text DEFAULT 'PJ' NOT NULL,
	"cnpj" text NOT NULL,
	"cpf" text,
	"razao_social" text NOT NULL,
	"emails" text[] DEFAULT '{}' NOT NULL,
	"cep" text,
	"logradouro" text,
	"numero" text,
	"complemento" text,
	"bairro" text,
	"municipio" text,
	"uf" text,
	"cnae_principal_codigo" text,
	"cnae_principal_descricao" text,
	"cnaes_secundarios" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"primeiro_login" boolean DEFAULT true NOT NULL,
	"user_id" text,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "clientes_cnpj_unique" UNIQUE("cnpj"),
	CONSTRAINT "clientes_cpf_unique" UNIQUE("cpf"),
	CONSTRAINT "chk_clientes_tipo_pessoa" CHECK ("clientes"."tipo_pessoa" IN ('PF', 'PJ')),
	CONSTRAINT "chk_clientes_cep" CHECK ("clientes"."cep" IS NULL OR "clientes"."cep" ~ '^[0-9]{8}$'),
	CONSTRAINT "chk_clientes_uf" CHECK ("clientes"."uf" IS NULL OR "clientes"."uf" ~ '^[A-Z]{2}$'),
	CONSTRAINT "chk_clientes_cnae_principal" CHECK ("clientes"."cnae_principal_codigo" IS NULL OR "clientes"."cnae_principal_codigo" ~ '^[0-9]{7}$'),
	CONSTRAINT "chk_clientes_cnaes_secundarios" CHECK (jsonb_typeof("clientes"."cnaes_secundarios") = 'array'),
	CONSTRAINT "chk_clientes_documento_por_tipo" CHECK (("clientes"."tipo_pessoa" = 'PJ' AND "clientes"."cnpj" ~ '^[0-9]{14}$' AND "clientes"."cpf" IS NULL) OR ("clientes"."tipo_pessoa" = 'PF' AND "clientes"."cnpj" ~ '^[0-9]{11}$' AND "clientes"."cpf" = "clientes"."cnpj"))
);
--> statement-breakpoint
CREATE TABLE "documentos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"periodo" text NOT NULL,
	"vencimento" date,
	"valor" numeric(12, 2),
	"arquivo_key" text NOT NULL,
	"arquivo_nome" text NOT NULL,
	"status" text DEFAULT 'PENDENTE' NOT NULL,
	"pago_em" timestamp,
	"pagamento_confirmado_por" text,
	"observacao_pagamento" text,
	"comprovante_key" text,
	"email_status" text DEFAULT 'NAO_ENVIADO' NOT NULL,
	"email_erro" text,
	"numero_parcelamento" text,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_documentos_identidade" UNIQUE NULLS NOT DISTINCT("cliente_id","tipo","periodo","numero_parcelamento"),
	CONSTRAINT "chk_documentos_tipo" CHECK ("documentos"."tipo" IN ('FGTS', 'DARF', 'DAS', 'DAS-COMPL', 'DAS-PARCSN', 'DAS-PGFN', 'INSS', 'ISS', 'ICMS', 'PIS', 'COFINS', 'CSLL', 'IRPJ', 'DAE', 'PGFN-SISPAR', 'TAXA-ASSISTENCIAL', 'OUTROS', 'FOLHA-PAGAMENTO')),
	CONSTRAINT "chk_documentos_status" CHECK ("documentos"."status" IN ('PENDENTE', 'PAGO')),
	CONSTRAINT "chk_documentos_email_status" CHECK ("documentos"."email_status" IN ('NAO_ENVIADO', 'PENDENTE', 'ENVIADO', 'FALHOU', 'SEM_EMAIL')),
	CONSTRAINT "chk_documentos_periodo" CHECK ("documentos"."periodo" ~ '^(0[1-9]|1[0-2])/[0-9]{4}$'),
	CONSTRAINT "chk_documentos_arquivo_key" CHECK (btrim("documentos"."arquivo_key") <> ''),
	CONSTRAINT "chk_documentos_arquivo_nome" CHECK (btrim("documentos"."arquivo_nome") <> ''),
	CONSTRAINT "chk_documentos_valor" CHECK ("documentos"."valor" IS NULL OR "documentos"."valor" >= 0),
	CONSTRAINT "chk_documentos_pagamento" CHECK (("documentos"."status" = 'PENDENTE' AND "documentos"."pago_em" IS NULL) OR ("documentos"."status" = 'PAGO' AND "documentos"."pago_em" IS NOT NULL)),
	CONSTRAINT "chk_documentos_numero_parcelamento" CHECK ("documentos"."numero_parcelamento" IS NULL OR btrim("documentos"."numero_parcelamento") <> '')
);
--> statement-breakpoint
CREATE TABLE "eventos_auditoria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ator_user_id" text,
	"acao" text NOT NULL,
	"entidade_tipo" text NOT NULL,
	"entidade_id" text NOT NULL,
	"dados" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"criado_em" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "folhas_pagamento" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"documento_id" uuid,
	"arquivo_key" text NOT NULL,
	"arquivo_nome" text NOT NULL,
	"competencia" text NOT NULL,
	"periodo_inicio" date NOT NULL,
	"periodo_fim" date NOT NULL,
	"total_bruto" numeric(12, 2) NOT NULL,
	"total_descontos" numeric(12, 2) NOT NULL,
	"total_liquido" numeric(12, 2) NOT NULL,
	"total_funcionarios" integer NOT NULL,
	"total_inss" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_fgts" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_irrf" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_salario_familia" numeric(12, 2) DEFAULT '0' NOT NULL,
	"uploadado_por" text,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_folhas_id_cliente" UNIQUE("id","cliente_id"),
	CONSTRAINT "chk_folhas_competencia" CHECK ("folhas_pagamento"."competencia" ~ '^(0[1-9]|1[0-2])/[0-9]{4}$'),
	CONSTRAINT "chk_folhas_periodo" CHECK ("folhas_pagamento"."periodo_inicio" <= "folhas_pagamento"."periodo_fim"),
	CONSTRAINT "chk_folhas_totais" CHECK ("folhas_pagamento"."total_bruto" >= 0 AND "folhas_pagamento"."total_descontos" >= 0 AND "folhas_pagamento"."total_liquido" >= 0 AND "folhas_pagamento"."total_funcionarios" >= 0 AND "folhas_pagamento"."total_inss" >= 0 AND "folhas_pagamento"."total_fgts" >= 0 AND "folhas_pagamento"."total_irrf" >= 0 AND "folhas_pagamento"."total_salario_familia" >= 0),
	CONSTRAINT "chk_folhas_arquivo_key" CHECK (btrim("folhas_pagamento"."arquivo_key") <> ''),
	CONSTRAINT "chk_folhas_arquivo_nome" CHECK (btrim("folhas_pagamento"."arquivo_nome") <> '')
);
--> statement-breakpoint
CREATE TABLE "funcionarios_rh" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"codigo_funcionario" text NOT NULL,
	"nome_completo" text NOT NULL,
	"cpf" text,
	"data_admissao" date,
	"cargo" text,
	"departamento" text,
	"ativo" boolean DEFAULT true NOT NULL,
	"senha_hash" text,
	"primeiro_acesso" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_funcionarios_id_cliente" UNIQUE("id","cliente_id"),
	CONSTRAINT "chk_funcionarios_codigo" CHECK (btrim("funcionarios_rh"."codigo_funcionario") <> ''),
	CONSTRAINT "chk_funcionarios_nome" CHECK (btrim("funcionarios_rh"."nome_completo") <> ''),
	CONSTRAINT "chk_funcionarios_cpf" CHECK ("funcionarios_rh"."cpf" IS NULL OR "funcionarios_rh"."cpf" ~ '^[0-9]{11}$')
);
--> statement-breakpoint
CREATE TABLE "itens_folha_pagamento" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"folha_id" uuid NOT NULL,
	"funcionario_id" uuid NOT NULL,
	"cliente_id" uuid NOT NULL,
	"salario_base" numeric(12, 2) NOT NULL,
	"total_proventos" numeric(12, 2) NOT NULL,
	"total_descontos" numeric(12, 2) NOT NULL,
	"salario_liquido" numeric(12, 2) NOT NULL,
	"base_inss" numeric(12, 2),
	"aliquota_inss" numeric(6, 4),
	"valor_inss" numeric(12, 2),
	"base_fgts" numeric(12, 2),
	"valor_fgts" numeric(12, 2),
	"base_irrf" numeric(12, 2),
	"valor_irrf" numeric(12, 2),
	"referencia" text,
	"codigo_folha" text,
	"dependentes_ir" integer DEFAULT 0,
	"dependentes_sf" integer DEFAULT 0,
	"rubricas" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chk_itens_dependentes" CHECK (COALESCE("itens_folha_pagamento"."dependentes_ir", 0) >= 0 AND COALESCE("itens_folha_pagamento"."dependentes_sf", 0) >= 0),
	CONSTRAINT "chk_itens_rubricas" CHECK (jsonb_typeof("itens_folha_pagamento"."rubricas") = 'array')
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "storage_cleanup_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"object_key" text NOT NULL,
	"entidade_tipo" text NOT NULL,
	"entidade_id" text NOT NULL,
	"status" text DEFAULT 'PENDENTE' NOT NULL,
	"tentativas" integer DEFAULT 0 NOT NULL,
	"ultimo_erro" text,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL,
	"concluido_em" timestamp,
	CONSTRAINT "storage_cleanup_jobs_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "chk_storage_cleanup_status" CHECK ("storage_cleanup_jobs"."status" IN ('PENDENTE', 'PROCESSANDO', 'FALHOU', 'CONCLUIDO')),
	CONSTRAINT "chk_storage_cleanup_object_key" CHECK (btrim("storage_cleanup_jobs"."object_key") <> ''),
	CONSTRAINT "chk_storage_cleanup_tentativas" CHECK ("storage_cleanup_jobs"."tentativas" >= 0),
	CONSTRAINT "chk_storage_cleanup_conclusao" CHECK (("storage_cleanup_jobs"."status" = 'CONCLUIDO' AND "storage_cleanup_jobs"."concluido_em" IS NOT NULL) OR ("storage_cleanup_jobs"."status" <> 'CONCLUIDO' AND "storage_cleanup_jobs"."concluido_em" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" text DEFAULT 'CLIENTE' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email"),
	CONSTRAINT "chk_user_role" CHECK ("user"."role" IN ('ADMIN', 'COLABORADOR', 'CLIENTE'))
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "visualizacoes_documentos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"documento_id" uuid NOT NULL,
	"user_id" text,
	"visualizado_em" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visualizacoes_folhas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"folha_id" uuid NOT NULL,
	"user_id" text,
	"visualizado_em" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clientes" ADD CONSTRAINT "clientes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documentos" ADD CONSTRAINT "documentos_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documentos" ADD CONSTRAINT "documentos_pagamento_confirmado_por_user_id_fk" FOREIGN KEY ("pagamento_confirmado_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eventos_auditoria" ADD CONSTRAINT "eventos_auditoria_ator_user_id_user_id_fk" FOREIGN KEY ("ator_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folhas_pagamento" ADD CONSTRAINT "folhas_pagamento_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folhas_pagamento" ADD CONSTRAINT "folhas_pagamento_documento_id_documentos_id_fk" FOREIGN KEY ("documento_id") REFERENCES "public"."documentos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folhas_pagamento" ADD CONSTRAINT "folhas_pagamento_uploadado_por_user_id_fk" FOREIGN KEY ("uploadado_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funcionarios_rh" ADD CONSTRAINT "funcionarios_rh_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itens_folha_pagamento" ADD CONSTRAINT "itens_folha_pagamento_folha_id_folhas_pagamento_id_fk" FOREIGN KEY ("folha_id") REFERENCES "public"."folhas_pagamento"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itens_folha_pagamento" ADD CONSTRAINT "itens_folha_pagamento_funcionario_id_funcionarios_rh_id_fk" FOREIGN KEY ("funcionario_id") REFERENCES "public"."funcionarios_rh"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itens_folha_pagamento" ADD CONSTRAINT "itens_folha_pagamento_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itens_folha_pagamento" ADD CONSTRAINT "fk_itens_folha_cliente" FOREIGN KEY ("folha_id","cliente_id") REFERENCES "public"."folhas_pagamento"("id","cliente_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itens_folha_pagamento" ADD CONSTRAINT "fk_itens_funcionario_cliente" FOREIGN KEY ("funcionario_id","cliente_id") REFERENCES "public"."funcionarios_rh"("id","cliente_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visualizacoes_documentos" ADD CONSTRAINT "visualizacoes_documentos_documento_id_documentos_id_fk" FOREIGN KEY ("documento_id") REFERENCES "public"."documentos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visualizacoes_documentos" ADD CONSTRAINT "visualizacoes_documentos_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visualizacoes_folhas" ADD CONSTRAINT "visualizacoes_folhas_folha_id_folhas_pagamento_id_fk" FOREIGN KEY ("folha_id") REFERENCES "public"."folhas_pagamento"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visualizacoes_folhas" ADD CONSTRAINT "visualizacoes_folhas_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_account_provider_account" ON "account" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_account_user_provider" ON "account" USING btree ("user_id","provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_clientes_user_id" ON "clientes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_documentos_cliente_id" ON "documentos" USING btree ("cliente_id");--> statement-breakpoint
CREATE INDEX "idx_documentos_tipo" ON "documentos" USING btree ("tipo");--> statement-breakpoint
CREATE INDEX "idx_documentos_periodo" ON "documentos" USING btree ("periodo");--> statement-breakpoint
CREATE INDEX "idx_documentos_status" ON "documentos" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_documentos_pagamento_confirmado_por" ON "documentos" USING btree ("pagamento_confirmado_por");--> statement-breakpoint
CREATE INDEX "idx_eventos_auditoria_entidade" ON "eventos_auditoria" USING btree ("entidade_tipo","entidade_id","criado_em");--> statement-breakpoint
CREATE INDEX "idx_eventos_auditoria_ator" ON "eventos_auditoria" USING btree ("ator_user_id","criado_em");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_folhas_cliente_competencia" ON "folhas_pagamento" USING btree ("cliente_id","competencia");--> statement-breakpoint
CREATE INDEX "idx_folhas_cliente_id" ON "folhas_pagamento" USING btree ("cliente_id");--> statement-breakpoint
CREATE INDEX "idx_folhas_competencia" ON "folhas_pagamento" USING btree ("competencia");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_funcionarios_cliente_codigo" ON "funcionarios_rh" USING btree ("cliente_id","codigo_funcionario");--> statement-breakpoint
CREATE INDEX "idx_funcionarios_cliente_id" ON "funcionarios_rh" USING btree ("cliente_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_itens_folha_funcionario" ON "itens_folha_pagamento" USING btree ("folha_id","funcionario_id");--> statement-breakpoint
CREATE INDEX "idx_itens_folha_id" ON "itens_folha_pagamento" USING btree ("folha_id");--> statement-breakpoint
CREATE INDEX "idx_itens_funcionario_id" ON "itens_folha_pagamento" USING btree ("funcionario_id");--> statement-breakpoint
CREATE INDEX "idx_itens_cliente_id" ON "itens_folha_pagamento" USING btree ("cliente_id");--> statement-breakpoint
CREATE INDEX "idx_storage_cleanup_status_criado_em" ON "storage_cleanup_jobs" USING btree ("status","criado_em");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_verification_identifier" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_verification_value" ON "verification" USING btree ("value");--> statement-breakpoint
CREATE INDEX "idx_visualizacoes_documento" ON "visualizacoes_documentos" USING btree ("documento_id");--> statement-breakpoint
CREATE INDEX "idx_visualizacoes_user" ON "visualizacoes_documentos" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_visualizacoes_folha" ON "visualizacoes_folhas" USING btree ("folha_id");--> statement-breakpoint
CREATE INDEX "idx_visualizacoes_folha_user" ON "visualizacoes_folhas" USING btree ("user_id");