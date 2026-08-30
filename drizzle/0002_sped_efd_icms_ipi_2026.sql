CREATE TABLE "sped_ajustes_apuracao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"competencia" date NOT NULL,
	"registro" varchar(4) NOT NULL,
	"codigo_ajuste" text NOT NULL,
	"descricao" text,
	"valor" numeric(15, 2) NOT NULL,
	"indicador" varchar(24) NOT NULL,
	"uf" varchar(2),
	"numero_documento" text,
	"atualizado_por" text,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chk_sped_ajuste_registro" CHECK ("sped_ajustes_apuracao"."registro" IN ('E111', 'E220', 'E311', 'E530')),
	CONSTRAINT "chk_sped_ajuste_indicador" CHECK ("sped_ajustes_apuracao"."indicador" IN ('DEBITO', 'CREDITO', 'ESTORNO_DEBITO', 'ESTORNO_CREDITO', 'DEDUCAO', 'DEBITO_ESPECIAL')),
	CONSTRAINT "chk_sped_ajuste_valor" CHECK ("sped_ajustes_apuracao"."valor" >= 0),
	CONSTRAINT "chk_sped_ajuste_uf" CHECK ("sped_ajustes_apuracao"."uf" IS NULL OR "sped_ajustes_apuracao"."uf" ~ '^[A-Z]{2}$'),
	CONSTRAINT "chk_sped_ajuste_coerencia" CHECK ((
        ("sped_ajustes_apuracao"."registro" = 'E111' AND "sped_ajustes_apuracao"."uf" IS NULL AND "sped_ajustes_apuracao"."codigo_ajuste" ~ '^[A-Z]{2}0[0-5][A-Z0-9]{4}$')
        OR ("sped_ajustes_apuracao"."registro" = 'E220' AND "sped_ajustes_apuracao"."uf" IS NOT NULL AND "sped_ajustes_apuracao"."codigo_ajuste" ~ ('^' || "sped_ajustes_apuracao"."uf" || '1[0-5][A-Z0-9]{4}$'))
        OR ("sped_ajustes_apuracao"."registro" = 'E311' AND "sped_ajustes_apuracao"."uf" IS NOT NULL AND "sped_ajustes_apuracao"."codigo_ajuste" ~ ('^' || "sped_ajustes_apuracao"."uf" || '[23][0-5][A-Z0-9]{4}$'))
        OR ("sped_ajustes_apuracao"."registro" = 'E530' AND "sped_ajustes_apuracao"."uf" IS NULL AND "sped_ajustes_apuracao"."codigo_ajuste" ~ '^[A-Z0-9]{1,3}$' AND "sped_ajustes_apuracao"."indicador" IN ('DEBITO', 'CREDITO'))
      )),
	CONSTRAINT "chk_sped_ajuste_natureza_indicador" CHECK ("sped_ajustes_apuracao"."registro" = 'E530' OR CASE substring("sped_ajustes_apuracao"."codigo_ajuste" FROM 4 FOR 1)
        WHEN '0' THEN "sped_ajustes_apuracao"."indicador" = 'DEBITO'
        WHEN '1' THEN "sped_ajustes_apuracao"."indicador" = 'ESTORNO_CREDITO'
        WHEN '2' THEN "sped_ajustes_apuracao"."indicador" = 'CREDITO'
        WHEN '3' THEN "sped_ajustes_apuracao"."indicador" = 'ESTORNO_DEBITO'
        WHEN '4' THEN "sped_ajustes_apuracao"."indicador" = 'DEDUCAO'
        WHEN '5' THEN "sped_ajustes_apuracao"."indicador" = 'DEBITO_ESPECIAL'
        ELSE false
      END)
);
--> statement-breakpoint
CREATE TABLE "sped_arquivos_gerados" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"competencia" date NOT NULL,
	"finalidade" varchar(1) NOT NULL,
	"cod_versao" varchar(3) NOT NULL,
	"perfil" varchar(1) NOT NULL,
	"status" varchar(12) NOT NULL,
	"hash_sha256" varchar(64),
	"arquivo_key" text,
	"arquivo_nome" text,
	"tamanho_bytes" bigint,
	"contadores" jsonb,
	"inconsistencias" jsonb,
	"erro" text,
	"gerado_por" text,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"concluido_em" timestamp,
	CONSTRAINT "chk_sped_arquivo_finalidade" CHECK ("sped_arquivos_gerados"."finalidade" IN ('0', '1')),
	CONSTRAINT "chk_sped_arquivo_perfil" CHECK ("sped_arquivos_gerados"."perfil" IN ('A', 'B', 'C')),
	CONSTRAINT "chk_sped_arquivo_status" CHECK ("sped_arquivos_gerados"."status" IN ('PROCESSANDO', 'GERADO', 'FALHOU')),
	CONSTRAINT "chk_sped_arquivo_hash" CHECK ("sped_arquivos_gerados"."hash_sha256" IS NULL OR "sped_arquivos_gerados"."hash_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "chk_sped_arquivo_tamanho" CHECK ("sped_arquivos_gerados"."tamanho_bytes" IS NULL OR "sped_arquivos_gerados"."tamanho_bytes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sped_configuracoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"obrigado_efd_icms_ipi" boolean DEFAULT false NOT NULL,
	"perfil_efd" varchar(1),
	"ind_ativ" varchar(1),
	"classificacao_estabelecimento_industrial" varchar(2),
	"codigo_municipio_ibge" varchar(7),
	"nome_fantasia" text,
	"inscricao_municipal" text,
	"suframa" text,
	"telefone" text,
	"fax" text,
	"inventario_obrigatorio" boolean DEFAULT false NOT NULL,
	"mes_entrega_inventario" integer DEFAULT 2 NOT NULL,
	"bloco_k_com_movimento" boolean DEFAULT false NOT NULL,
	"tipo_item_padrao" varchar(2) DEFAULT '00' NOT NULL,
	"indicadores_1010" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"atualizado_por" text,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chk_sped_config_perfil" CHECK ("sped_configuracoes"."perfil_efd" IS NULL OR "sped_configuracoes"."perfil_efd" IN ('A', 'B', 'C')),
	CONSTRAINT "chk_sped_config_ind_ativ" CHECK ("sped_configuracoes"."ind_ativ" IS NULL OR "sped_configuracoes"."ind_ativ" IN ('0', '1')),
	CONSTRAINT "chk_sped_config_clas_estab_ind" CHECK ("sped_configuracoes"."classificacao_estabelecimento_industrial" IS NULL OR "sped_configuracoes"."classificacao_estabelecimento_industrial" ~ '^[0-9]{2}$'),
	CONSTRAINT "chk_sped_config_codigo_municipio" CHECK ("sped_configuracoes"."codigo_municipio_ibge" IS NULL OR "sped_configuracoes"."codigo_municipio_ibge" ~ '^[0-9]{7}$'),
	CONSTRAINT "chk_sped_config_tipo_item_padrao" CHECK ("sped_configuracoes"."tipo_item_padrao" ~ '^[0-9]{2}$'),
	CONSTRAINT "chk_sped_config_mes_inventario" CHECK ("sped_configuracoes"."mes_entrega_inventario" BETWEEN 1 AND 12),
	CONSTRAINT "chk_sped_config_indicadores_1010" CHECK (jsonb_typeof("sped_configuracoes"."indicadores_1010") = 'object')
);
--> statement-breakpoint
CREATE TABLE "sped_contabilistas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"cpf" varchar(11),
	"crc" text NOT NULL,
	"cnpj" varchar(14),
	"cep" varchar(8),
	"logradouro" text,
	"numero" text,
	"complemento" text,
	"bairro" text,
	"telefone" text,
	"fax" text,
	"email" text,
	"codigo_municipio_ibge" varchar(7) NOT NULL,
	"atualizado_por" text,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chk_sped_contabilista_documento" CHECK (("sped_contabilistas"."cpf" IS NOT NULL AND "sped_contabilistas"."cpf" ~ '^[0-9]{11}$') OR ("sped_contabilistas"."cnpj" IS NOT NULL AND "sped_contabilistas"."cnpj" ~ '^[0-9A-Z]{12}[0-9]{2}$')),
	CONSTRAINT "chk_sped_contabilista_cep" CHECK ("sped_contabilistas"."cep" IS NULL OR "sped_contabilistas"."cep" ~ '^[0-9]{8}$'),
	CONSTRAINT "chk_sped_contabilista_codigo_municipio" CHECK ("sped_contabilistas"."codigo_municipio_ibge" ~ '^[0-9]{7}$')
);
--> statement-breakpoint
CREATE TABLE "sped_inventario_itens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inventario_id" uuid NOT NULL,
	"sped_item_id" uuid NOT NULL,
	"unidade" varchar(6) NOT NULL,
	"quantidade" numeric(15, 3) NOT NULL,
	"valor_unitario" numeric(21, 6) NOT NULL,
	"valor_item" numeric(15, 2) NOT NULL,
	"indicador_propriedade" varchar(1) DEFAULT '0' NOT NULL,
	"participante_id" uuid,
	"texto_complementar" text,
	"codigo_conta" text,
	"valor_item_ir" numeric(15, 2),
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_sped_inventario_item_participante" UNIQUE NULLS NOT DISTINCT("inventario_id","sped_item_id","indicador_propriedade","participante_id"),
	CONSTRAINT "chk_sped_inventario_item_qtd" CHECK ("sped_inventario_itens"."quantidade" >= 0),
	CONSTRAINT "chk_sped_inventario_item_valor_unitario" CHECK ("sped_inventario_itens"."valor_unitario" >= 0),
	CONSTRAINT "chk_sped_inventario_item_valor" CHECK ("sped_inventario_itens"."valor_item" >= 0),
	CONSTRAINT "chk_sped_inventario_item_calculo" CHECK ("sped_inventario_itens"."valor_item" = round("sped_inventario_itens"."quantidade" * "sped_inventario_itens"."valor_unitario", 2)),
	CONSTRAINT "chk_sped_inventario_item_unidade" CHECK ("sped_inventario_itens"."unidade" ~ '^[0-9A-Z]{1,6}$'),
	CONSTRAINT "chk_sped_inventario_item_ind_prop" CHECK ("sped_inventario_itens"."indicador_propriedade" IN ('0', '1', '2')),
	CONSTRAINT "chk_sped_inventario_item_participante" CHECK (("sped_inventario_itens"."indicador_propriedade" = '0' AND "sped_inventario_itens"."participante_id" IS NULL) OR ("sped_inventario_itens"."indicador_propriedade" IN ('1', '2') AND "sped_inventario_itens"."participante_id" IS NOT NULL)),
	CONSTRAINT "chk_sped_inventario_item_valor_ir" CHECK ("sped_inventario_itens"."valor_item_ir" IS NULL OR "sped_inventario_itens"."valor_item_ir" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sped_inventarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"data_inventario" date NOT NULL,
	"motivo" varchar(2) NOT NULL,
	"valor_total" numeric(15, 2) NOT NULL,
	"status" varchar(12) DEFAULT 'RASCUNHO' NOT NULL,
	"atualizado_por" text,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chk_sped_inventario_motivo" CHECK ("sped_inventarios"."motivo" IN ('01', '02', '03', '04', '05', '06')),
	CONSTRAINT "chk_sped_inventario_status" CHECK ("sped_inventarios"."status" IN ('RASCUNHO', 'FECHADO')),
	CONSTRAINT "chk_sped_inventario_valor" CHECK ("sped_inventarios"."valor_total" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sped_itens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"participante_origem_id" uuid,
	"codigo" varchar(60) NOT NULL,
	"codigo_externo" text NOT NULL,
	"descricao" text NOT NULL,
	"codigo_barras" text,
	"unidade_id" uuid NOT NULL,
	"tipo_item" varchar(2) DEFAULT '00' NOT NULL,
	"tipo_item_inferido" boolean DEFAULT true NOT NULL,
	"ncm" varchar(8),
	"ex_ipi" varchar(3),
	"codigo_genero" varchar(2),
	"codigo_servico" text,
	"aliquota_icms" numeric(7, 4),
	"cest" varchar(7),
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_sped_item_origem_externo" UNIQUE NULLS NOT DISTINCT("cliente_id","participante_origem_id","codigo_externo"),
	CONSTRAINT "chk_sped_item_tipo" CHECK ("sped_itens"."tipo_item" ~ '^[0-9]{2}$'),
	CONSTRAINT "chk_sped_item_ncm" CHECK ("sped_itens"."ncm" IS NULL OR "sped_itens"."ncm" ~ '^[0-9]{8}$'),
	CONSTRAINT "chk_sped_item_cest" CHECK ("sped_itens"."cest" IS NULL OR "sped_itens"."cest" ~ '^[0-9]{7}$')
);
--> statement-breakpoint
CREATE TABLE "sped_obrigacoes_recolhimento" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"competencia" date NOT NULL,
	"tipo" varchar(20) NOT NULL,
	"uf" varchar(2),
	"codigo_obrigacao" text NOT NULL,
	"valor" numeric(15, 2) NOT NULL,
	"data_vencimento" date NOT NULL,
	"codigo_receita" text,
	"numero_processo" text,
	"indicador_processo" varchar(1),
	"processo" text,
	"texto_complementar" text,
	"mes_referencia" varchar(6),
	"atualizado_por" text,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_sped_obrigacao_competencia" UNIQUE NULLS NOT DISTINCT("cliente_id","competencia","tipo","uf"),
	CONSTRAINT "chk_sped_obrigacao_tipo" CHECK ("sped_obrigacoes_recolhimento"."tipo" IN ('ICMS_PROPRIO', 'ICMS_ST', 'DIFAL_FCP')),
	CONSTRAINT "chk_sped_obrigacao_valor" CHECK ("sped_obrigacoes_recolhimento"."valor" >= 0),
	CONSTRAINT "chk_sped_obrigacao_uf" CHECK ("sped_obrigacoes_recolhimento"."uf" IS NULL OR "sped_obrigacoes_recolhimento"."uf" ~ '^[A-Z]{2}$'),
	CONSTRAINT "chk_sped_obrigacao_mes_referencia" CHECK ("sped_obrigacoes_recolhimento"."mes_referencia" IS NULL OR "sped_obrigacoes_recolhimento"."mes_referencia" ~ '^[0-9]{6}$')
);
--> statement-breakpoint
CREATE TABLE "sped_participantes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"codigo" varchar(60) NOT NULL,
	"documento" varchar(14) NOT NULL,
	"tipo_documento" varchar(4) NOT NULL,
	"nome" text NOT NULL,
	"codigo_pais" varchar(5) DEFAULT '01058' NOT NULL,
	"inscricao_estadual" text,
	"codigo_municipio_ibge" varchar(7),
	"suframa" text,
	"logradouro" text,
	"numero" text,
	"complemento" text,
	"bairro" text,
	"cep" varchar(8),
	"fonte_ultimo_documento_id" uuid,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chk_sped_participante_tipo_documento" CHECK ("sped_participantes"."tipo_documento" IN ('CNPJ', 'CPF')),
	CONSTRAINT "chk_sped_participante_documento" CHECK (("sped_participantes"."tipo_documento" = 'CPF' AND "sped_participantes"."documento" ~ '^[0-9]{11}$') OR ("sped_participantes"."tipo_documento" = 'CNPJ' AND "sped_participantes"."documento" ~ '^[0-9A-Z]{12}[0-9]{2}$')),
	CONSTRAINT "chk_sped_participante_codigo_pais" CHECK ("sped_participantes"."codigo_pais" ~ '^[0-9]{5}$'),
	CONSTRAINT "chk_sped_participante_codigo_municipio" CHECK ("sped_participantes"."codigo_municipio_ibge" IS NULL OR "sped_participantes"."codigo_municipio_ibge" ~ '^[0-9]{7}$')
);
--> statement-breakpoint
CREATE TABLE "sped_responsabilidades_tributarias" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"tipo" varchar(20) NOT NULL,
	"uf" varchar(2) NOT NULL,
	"vigencia_inicio" date NOT NULL,
	"vigencia_fim" date,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chk_sped_responsabilidade_tipo" CHECK ("sped_responsabilidades_tributarias"."tipo" IN ('ICMS_ST', 'DIFAL_FCP')),
	CONSTRAINT "chk_sped_responsabilidade_uf" CHECK ("sped_responsabilidades_tributarias"."uf" ~ '^[A-Z]{2}$'),
	CONSTRAINT "chk_sped_responsabilidade_vigencia" CHECK ("sped_responsabilidades_tributarias"."vigencia_fim" IS NULL OR "sped_responsabilidades_tributarias"."vigencia_fim" >= "sped_responsabilidades_tributarias"."vigencia_inicio")
);
--> statement-breakpoint
CREATE TABLE "sped_saldos_apuracao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"competencia" date NOT NULL,
	"tipo" varchar(20) NOT NULL,
	"uf" varchar(2),
	"saldo_credor_anterior" numeric(15, 2) DEFAULT '0' NOT NULL,
	"atualizado_por" text,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_sped_saldo_competencia" UNIQUE NULLS NOT DISTINCT("cliente_id","competencia","tipo","uf"),
	CONSTRAINT "chk_sped_saldo_tipo" CHECK ("sped_saldos_apuracao"."tipo" IN ('ICMS_PROPRIO', 'ICMS_ST', 'IPI')),
	CONSTRAINT "chk_sped_saldo_uf" CHECK ("sped_saldos_apuracao"."uf" IS NULL OR "sped_saldos_apuracao"."uf" ~ '^[A-Z]{2}$'),
	CONSTRAINT "chk_sped_saldo_valor" CHECK ("sped_saldos_apuracao"."saldo_credor_anterior" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sped_unidades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"codigo" varchar(6) NOT NULL,
	"descricao" text NOT NULL,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chk_sped_unidade_codigo" CHECK (btrim("sped_unidades"."codigo") <> '')
);
--> statement-breakpoint
ALTER TABLE "clientes" DROP CONSTRAINT "chk_clientes_documento_por_tipo";--> statement-breakpoint
ALTER TABLE "documentos_fiscais_cte_escrituracao" DROP CONSTRAINT "chk_cte_escrituracao_tomador_documento";--> statement-breakpoint
ALTER TABLE "documentos_fiscais_cte_escrituracao" DROP CONSTRAINT "chk_cte_escrituracao_referencia";--> statement-breakpoint
ALTER TABLE "documentos_fiscais" ADD COLUMN "data_emissao_fiscal" date;--> statement-breakpoint
ALTER TABLE "documentos_fiscais" ADD COLUMN "data_entrada_saida" timestamp;--> statement-breakpoint
ALTER TABLE "documentos_fiscais" ADD COLUMN "data_entrada_saida_fiscal" date;--> statement-breakpoint
ALTER TABLE "documentos_fiscais" ADD COLUMN "valor_total_declarado_xml" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "documentos_fiscais" ADD COLUMN "totais_declarados_xml" jsonb;--> statement-breakpoint
ALTER TABLE "documentos_fiscais" ADD COLUMN "quantidade_itens_declarada_xml" integer;--> statement-breakpoint
ALTER TABLE "documentos_fiscais" ADD COLUMN "integridade_conferida" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "documentos_fiscais" ADD COLUMN "integridade_status" varchar(20) DEFAULT 'NAO_CONFERIDA' NOT NULL;--> statement-breakpoint
ALTER TABLE "documentos_fiscais" ADD COLUMN "integridade_detalhes" jsonb;--> statement-breakpoint
ALTER TABLE "documentos_fiscais" ADD COLUMN "cod_situacao_sped" varchar(2);--> statement-breakpoint
ALTER TABLE "documentos_fiscais" ADD COLUMN "modalidade_frete" varchar(1);--> statement-breakpoint
ALTER TABLE "documentos_fiscais" ADD COLUMN "informacoes_complementares" text;--> statement-breakpoint
ALTER TABLE "documentos_fiscais" ADD COLUMN "emitente_dados" jsonb;--> statement-breakpoint
ALTER TABLE "documentos_fiscais" ADD COLUMN "destinatario_dados" jsonb;--> statement-breakpoint
ALTER TABLE "documentos_fiscais_itens" ADD COLUMN "cod_obs_sped" varchar(6);--> statement-breakpoint
ALTER TABLE "documentos_fiscais_itens" ADD COLUMN "cod_cta_sped" text;--> statement-breakpoint
ALTER TABLE "sped_ajustes_apuracao" ADD CONSTRAINT "sped_ajustes_apuracao_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sped_ajustes_apuracao" ADD CONSTRAINT "sped_ajustes_apuracao_atualizado_por_user_id_fk" FOREIGN KEY ("atualizado_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sped_arquivos_gerados" ADD CONSTRAINT "sped_arquivos_gerados_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sped_arquivos_gerados" ADD CONSTRAINT "sped_arquivos_gerados_gerado_por_user_id_fk" FOREIGN KEY ("gerado_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sped_configuracoes" ADD CONSTRAINT "sped_configuracoes_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sped_configuracoes" ADD CONSTRAINT "sped_configuracoes_atualizado_por_user_id_fk" FOREIGN KEY ("atualizado_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sped_contabilistas" ADD CONSTRAINT "sped_contabilistas_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sped_contabilistas" ADD CONSTRAINT "sped_contabilistas_atualizado_por_user_id_fk" FOREIGN KEY ("atualizado_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sped_inventario_itens" ADD CONSTRAINT "sped_inventario_itens_inventario_id_sped_inventarios_id_fk" FOREIGN KEY ("inventario_id") REFERENCES "public"."sped_inventarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sped_inventario_itens" ADD CONSTRAINT "sped_inventario_itens_sped_item_id_sped_itens_id_fk" FOREIGN KEY ("sped_item_id") REFERENCES "public"."sped_itens"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sped_inventario_itens" ADD CONSTRAINT "sped_inventario_itens_participante_id_sped_participantes_id_fk" FOREIGN KEY ("participante_id") REFERENCES "public"."sped_participantes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sped_inventarios" ADD CONSTRAINT "sped_inventarios_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sped_inventarios" ADD CONSTRAINT "sped_inventarios_atualizado_por_user_id_fk" FOREIGN KEY ("atualizado_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sped_itens" ADD CONSTRAINT "sped_itens_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sped_itens" ADD CONSTRAINT "sped_itens_participante_origem_id_sped_participantes_id_fk" FOREIGN KEY ("participante_origem_id") REFERENCES "public"."sped_participantes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sped_itens" ADD CONSTRAINT "sped_itens_unidade_id_sped_unidades_id_fk" FOREIGN KEY ("unidade_id") REFERENCES "public"."sped_unidades"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sped_obrigacoes_recolhimento" ADD CONSTRAINT "sped_obrigacoes_recolhimento_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sped_obrigacoes_recolhimento" ADD CONSTRAINT "sped_obrigacoes_recolhimento_atualizado_por_user_id_fk" FOREIGN KEY ("atualizado_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sped_participantes" ADD CONSTRAINT "sped_participantes_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sped_participantes" ADD CONSTRAINT "sped_participantes_fonte_ultimo_documento_id_documentos_fiscais_id_fk" FOREIGN KEY ("fonte_ultimo_documento_id") REFERENCES "public"."documentos_fiscais"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sped_responsabilidades_tributarias" ADD CONSTRAINT "sped_responsabilidades_tributarias_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sped_saldos_apuracao" ADD CONSTRAINT "sped_saldos_apuracao_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sped_saldos_apuracao" ADD CONSTRAINT "sped_saldos_apuracao_atualizado_por_user_id_fk" FOREIGN KEY ("atualizado_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sped_unidades" ADD CONSTRAINT "sped_unidades_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_sped_ajuste_cliente_competencia" ON "sped_ajustes_apuracao" USING btree ("cliente_id","competencia");--> statement-breakpoint
CREATE INDEX "idx_sped_arquivo_cliente_competencia" ON "sped_arquivos_gerados" USING btree ("cliente_id","competencia","criado_em");--> statement-breakpoint
CREATE INDEX "idx_sped_arquivo_status" ON "sped_arquivos_gerados" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_sped_config_cliente" ON "sped_configuracoes" USING btree ("cliente_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_sped_contabilista_cliente" ON "sped_contabilistas" USING btree ("cliente_id");--> statement-breakpoint
CREATE INDEX "idx_sped_inventario_item_inventario" ON "sped_inventario_itens" USING btree ("inventario_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_sped_inventario_cliente_data_motivo" ON "sped_inventarios" USING btree ("cliente_id","data_inventario","motivo");--> statement-breakpoint
CREATE INDEX "idx_sped_inventario_cliente_data" ON "sped_inventarios" USING btree ("cliente_id","data_inventario");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_sped_item_codigo" ON "sped_itens" USING btree ("cliente_id","codigo");--> statement-breakpoint
CREATE INDEX "idx_sped_item_cliente" ON "sped_itens" USING btree ("cliente_id");--> statement-breakpoint
CREATE INDEX "idx_sped_obrigacao_cliente_competencia" ON "sped_obrigacoes_recolhimento" USING btree ("cliente_id","competencia");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_sped_participante_codigo" ON "sped_participantes" USING btree ("cliente_id","codigo");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_sped_participante_documento" ON "sped_participantes" USING btree ("cliente_id","documento");--> statement-breakpoint
CREATE INDEX "idx_sped_participante_cliente" ON "sped_participantes" USING btree ("cliente_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_sped_responsabilidade_vigencia" ON "sped_responsabilidades_tributarias" USING btree ("cliente_id","tipo","uf","vigencia_inicio");--> statement-breakpoint
CREATE INDEX "idx_sped_responsabilidade_cliente" ON "sped_responsabilidades_tributarias" USING btree ("cliente_id");--> statement-breakpoint
CREATE INDEX "idx_sped_saldo_cliente_competencia" ON "sped_saldos_apuracao" USING btree ("cliente_id","competencia");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_sped_unidade_codigo" ON "sped_unidades" USING btree ("cliente_id","codigo");--> statement-breakpoint
CREATE INDEX "idx_sped_unidade_cliente" ON "sped_unidades" USING btree ("cliente_id");--> statement-breakpoint
CREATE INDEX "idx_docs_fiscais_cliente_competencia" ON "documentos_fiscais" USING btree ("cliente_id","data_emissao_fiscal","id");--> statement-breakpoint
ALTER TABLE "clientes" ADD CONSTRAINT "chk_clientes_documento_por_tipo" CHECK (("clientes"."tipo_pessoa" = 'PJ' AND "clientes"."cnpj" ~ '^[0-9A-Z]{12}[0-9]{2}$' AND "clientes"."cpf" IS NULL) OR ("clientes"."tipo_pessoa" = 'PF' AND "clientes"."cnpj" ~ '^[0-9]{11}$' AND "clientes"."cpf" = "clientes"."cnpj"));--> statement-breakpoint
ALTER TABLE "documentos_fiscais" ADD CONSTRAINT "chk_docs_fiscais_valor_declarado" CHECK ("documentos_fiscais"."valor_total_declarado_xml" IS NULL OR "documentos_fiscais"."valor_total_declarado_xml" >= 0);--> statement-breakpoint
ALTER TABLE "documentos_fiscais" ADD CONSTRAINT "chk_docs_fiscais_quantidade_itens_declarada" CHECK ("documentos_fiscais"."quantidade_itens_declarada_xml" IS NULL OR "documentos_fiscais"."quantidade_itens_declarada_xml" >= 0);--> statement-breakpoint
ALTER TABLE "documentos_fiscais" ADD CONSTRAINT "chk_docs_fiscais_integridade_status" CHECK ("documentos_fiscais"."integridade_status" IN ('NAO_CONFERIDA', 'OK', 'DIVERGENTE'));--> statement-breakpoint
ALTER TABLE "documentos_fiscais" ADD CONSTRAINT "chk_docs_fiscais_integridade_coerencia" CHECK (("documentos_fiscais"."integridade_conferida" = false AND "documentos_fiscais"."integridade_status" = 'NAO_CONFERIDA') OR ("documentos_fiscais"."integridade_conferida" = true AND "documentos_fiscais"."integridade_status" IN ('OK', 'DIVERGENTE')));--> statement-breakpoint
ALTER TABLE "documentos_fiscais" ADD CONSTRAINT "chk_docs_fiscais_cod_situacao_sped" CHECK ("documentos_fiscais"."cod_situacao_sped" IS NULL OR "documentos_fiscais"."cod_situacao_sped" ~ '^[0-9]{2}$');--> statement-breakpoint
ALTER TABLE "documentos_fiscais" ADD CONSTRAINT "chk_docs_fiscais_modalidade_frete" CHECK ("documentos_fiscais"."modalidade_frete" IS NULL OR "documentos_fiscais"."modalidade_frete" ~ '^[0-9]$');--> statement-breakpoint
ALTER TABLE "documentos_fiscais_cte_escrituracao" ADD CONSTRAINT "chk_cte_escrituracao_tomador_documento" CHECK ("documentos_fiscais_cte_escrituracao"."tomador_cnpj_cpf" ~ '^[0-9]{11}$|^[0-9A-Z]{12}[0-9]{2}$');--> statement-breakpoint
ALTER TABLE "documentos_fiscais_cte_escrituracao" ADD CONSTRAINT "chk_cte_escrituracao_referencia" CHECK ("documentos_fiscais_cte_escrituracao"."chave_cte_referenciado" IS NULL OR "documentos_fiscais_cte_escrituracao"."chave_cte_referenciado" ~ '^[0-9A-Z]{44}$');