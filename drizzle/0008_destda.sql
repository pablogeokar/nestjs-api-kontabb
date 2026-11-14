CREATE TABLE "destda_arquivos_gerados" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"competencia" date NOT NULL,
	"finalidade" varchar(1) NOT NULL,
	"cod_versao" varchar(4) NOT NULL,
	"status" varchar(12) NOT NULL,
	"hash_sha256" varchar(64),
	"arquivo_key" text,
	"arquivo_nome" text,
	"tamanho_bytes" bigint,
	"contadores" jsonb,
	"totais" jsonb,
	"inconsistencias" jsonb,
	"erro" text,
	"gerado_por" text,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"concluido_em" timestamp,
	CONSTRAINT "chk_destda_arquivo_finalidade" CHECK ("destda_arquivos_gerados"."finalidade" IN ('0', '1')),
	CONSTRAINT "chk_destda_arquivo_status" CHECK ("destda_arquivos_gerados"."status" IN ('PROCESSANDO', 'GERADO', 'FALHOU')),
	CONSTRAINT "chk_destda_arquivo_hash" CHECK ("destda_arquivos_gerados"."hash_sha256" IS NULL OR "destda_arquivos_gerados"."hash_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "chk_destda_arquivo_tamanho" CHECK ("destda_arquivos_gerados"."tamanho_bytes" IS NULL OR "destda_arquivos_gerados"."tamanho_bytes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "destda_configuracoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"codigo_municipio_ibge" varchar(7),
	"nome_fantasia" text,
	"inscricao_municipal" text,
	"suframa" text,
	"nire" varchar(11),
	"telefone" text,
	"fax" text,
	"responsavel_nome" text,
	"responsavel_cpf" varchar(11),
	"responsavel_cod_assinante" varchar(3) DEFAULT '801' NOT NULL,
	"inscricoes_substituto" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"perfil" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"atualizado_por" text,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chk_destda_config_codigo_municipio" CHECK ("destda_configuracoes"."codigo_municipio_ibge" IS NULL OR "destda_configuracoes"."codigo_municipio_ibge" ~ '^[0-9]{7}$'),
	CONSTRAINT "chk_destda_config_nire" CHECK ("destda_configuracoes"."nire" IS NULL OR "destda_configuracoes"."nire" ~ '^[0-9]{11}$'),
	CONSTRAINT "chk_destda_config_resp_cpf" CHECK ("destda_configuracoes"."responsavel_cpf" IS NULL OR "destda_configuracoes"."responsavel_cpf" ~ '^[0-9]{11}$'),
	CONSTRAINT "chk_destda_config_cod_assinante" CHECK ("destda_configuracoes"."responsavel_cod_assinante" ~ '^[0-9]{3}$'),
	CONSTRAINT "chk_destda_config_inscricoes" CHECK (jsonb_typeof("destda_configuracoes"."inscricoes_substituto") = 'array'),
	CONSTRAINT "chk_destda_config_perfil" CHECK (jsonb_typeof("destda_configuracoes"."perfil") = 'object')
);
--> statement-breakpoint
ALTER TABLE "destda_arquivos_gerados" ADD CONSTRAINT "destda_arquivos_gerados_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "destda_arquivos_gerados" ADD CONSTRAINT "destda_arquivos_gerados_gerado_por_user_id_fk" FOREIGN KEY ("gerado_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "destda_configuracoes" ADD CONSTRAINT "destda_configuracoes_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "destda_configuracoes" ADD CONSTRAINT "destda_configuracoes_atualizado_por_user_id_fk" FOREIGN KEY ("atualizado_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_destda_arquivo_cliente_competencia" ON "destda_arquivos_gerados" USING btree ("cliente_id","competencia","criado_em");--> statement-breakpoint
CREATE INDEX "idx_destda_arquivo_status" ON "destda_arquivos_gerados" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_destda_config_cliente" ON "destda_configuracoes" USING btree ("cliente_id");