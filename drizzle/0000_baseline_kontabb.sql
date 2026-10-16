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
	CONSTRAINT "chk_certificados_cnpj" CHECK ("certificados_digitais"."cnpj" ~ '^[0-9A-Z]{12}[0-9]{2}$'),
	CONSTRAINT "chk_certificados_validade" CHECK ("certificados_digitais"."validade_inicio" < "certificados_digitais"."validade_fim"),
	CONSTRAINT "chk_certificados_arquivo_key" CHECK (btrim("certificados_digitais"."arquivo_key") <> '')
);
--> statement-breakpoint
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
	"categoria_fiscal" varchar(30) DEFAULT 'OUTRAS' NOT NULL,
	"gera_credito_icms_padrao" boolean DEFAULT false NOT NULL,
	"descricao_detalhada" text,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chk_cfops_codigo" CHECK ("cfops"."codigo" ~ '^[123567][0-9]{3}$'),
	CONSTRAINT "chk_cfops_tipo" CHECK ("cfops"."tipo_operacao" IN ('ENTRADA', 'SAIDA')),
	CONSTRAINT "chk_cfops_abrangencia" CHECK ("cfops"."abrangencia" IN ('ESTADUAL', 'INTERESTADUAL', 'EXTERIOR')),
	CONSTRAINT "chk_cfops_categoria" CHECK ("cfops"."categoria_fiscal" IN ('COMPRA_REVENDA', 'COMPRA_INSUMO', 'USO_CONSUMO', 'ATIVO_IMOBILIZADO', 'DEVOLUCAO', 'TRANSFERENCIA', 'REMESSA_RETORNO', 'PRESTACAO_SERVICO', 'OUTRAS'))
);
--> statement-breakpoint
CREATE TABLE "ciap_apropriacoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"bem_id" uuid NOT NULL,
	"competencia" date NOT NULL,
	"versao" integer DEFAULT 1 NOT NULL,
	"ativa" boolean DEFAULT true NOT NULL,
	"numero_parcela" integer NOT NULL,
	"base_controle" numeric(15, 2) NOT NULL,
	"parcela_passivel" numeric(15, 2) NOT NULL,
	"coeficiente" numeric(9, 4) NOT NULL,
	"coeficiente_fonte" varchar(40) NOT NULL,
	"parcela_admitida" numeric(15, 2) NOT NULL,
	"parcela_vedada" numeric(15, 2) NOT NULL,
	"movimento_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_ciap_aprop_versao" CHECK ("ciap_apropriacoes"."versao" >= 1),
	CONSTRAINT "chk_ciap_aprop_numero_parcela" CHECK ("ciap_apropriacoes"."numero_parcela" >= 1),
	CONSTRAINT "chk_ciap_aprop_coeficiente" CHECK ("ciap_apropriacoes"."coeficiente" >= 0 AND "ciap_apropriacoes"."coeficiente" <= 1),
	CONSTRAINT "chk_ciap_aprop_decomposicao" CHECK ("ciap_apropriacoes"."parcela_admitida" + "ciap_apropriacoes"."parcela_vedada" = "ciap_apropriacoes"."parcela_passivel")
);
--> statement-breakpoint
CREATE TABLE "ciap_ativo_permanente" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"documento_fiscal_id" uuid,
	"documento_fiscal_item_id" uuid,
	"codigo_bem" varchar(60) NOT NULL,
	"identificacao_bem" text NOT NULL,
	"chave_aquisicao" varchar(120),
	"origem_identidade" varchar(30) DEFAULT 'sku_legado' NOT NULL,
	"saneamento_pendente" boolean DEFAULT false NOT NULL,
	"data_entrada" date NOT NULL,
	"valor_icms_total" numeric(15, 2) NOT NULL,
	"valor_icms_frete" numeric(15, 2) DEFAULT '0',
	"valor_icms_difal" numeric(15, 2) DEFAULT '0',
	"quantidade_parcelas" integer DEFAULT 48 NOT NULL,
	"parcelas_apropriadas" integer DEFAULT 0 NOT NULL,
	"saldo_credor_restante" numeric(15, 2) NOT NULL,
	"status" varchar(20) DEFAULT 'ATIVO' NOT NULL,
	"data_baixa" date,
	"motivo_baixa" varchar(2),
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chk_ciap_status" CHECK ("ciap_ativo_permanente"."status" IN ('ATIVO', 'BAIXADO', 'CONCLUIDO')),
	CONSTRAINT "chk_ciap_origem_identidade" CHECK ("ciap_ativo_permanente"."origem_identidade" IN ('sku_legado', 'aquisicao', 'reconstruido_nao_comprovado')),
	CONSTRAINT "chk_ciap_parcelas" CHECK ("ciap_ativo_permanente"."quantidade_parcelas" > 0 AND "ciap_ativo_permanente"."parcelas_apropriadas" >= 0 AND "ciap_ativo_permanente"."parcelas_apropriadas" <= "ciap_ativo_permanente"."quantidade_parcelas"),
	CONSTRAINT "chk_ciap_motivo_baixa" CHECK ("ciap_ativo_permanente"."motivo_baixa" IS NULL OR "ciap_ativo_permanente"."motivo_baixa" IN ('01', '02', '03'))
);
--> statement-breakpoint
CREATE TABLE "ciap_competencias_apropriadas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"bem_id" uuid NOT NULL,
	"competencia" date NOT NULL,
	"aplicado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
	"regime_tributario" text,
	"apura_icms" boolean DEFAULT false NOT NULL,
	"inscricao_estadual" text,
	"tipo_contribuinte_icms" text,
	"optante_simples_nacional" boolean,
	"simples_nacional_fonte" text,
	"simples_nacional_consultado_em" timestamp with time zone,
	"logo_key" text,
	"primeiro_login" boolean DEFAULT true NOT NULL,
	"suspenso" boolean DEFAULT false NOT NULL,
	"suspenso_em" timestamp with time zone,
	"user_id" text,
	"contador_id" uuid,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "clientes_cnpj_unique" UNIQUE("cnpj"),
	CONSTRAINT "clientes_cpf_unique" UNIQUE("cpf"),
	CONSTRAINT "chk_clientes_tipo_pessoa" CHECK ("clientes"."tipo_pessoa" IN ('PF', 'PJ')),
	CONSTRAINT "chk_clientes_cep" CHECK ("clientes"."cep" IS NULL OR "clientes"."cep" ~ '^[0-9]{8}$'),
	CONSTRAINT "chk_clientes_uf" CHECK ("clientes"."uf" IS NULL OR "clientes"."uf" ~ '^[A-Z]{2}$'),
	CONSTRAINT "chk_clientes_cnae_principal" CHECK ("clientes"."cnae_principal_codigo" IS NULL OR "clientes"."cnae_principal_codigo" ~ '^[0-9]{7}$'),
	CONSTRAINT "chk_clientes_cnaes_secundarios" CHECK (jsonb_typeof("clientes"."cnaes_secundarios") = 'array'),
	CONSTRAINT "chk_clientes_regime_tributario" CHECK ("clientes"."regime_tributario" IS NULL OR "clientes"."regime_tributario" IN ('SIMPLES_NACIONAL', 'LUCRO_PRESUMIDO', 'LUCRO_REAL')),
	CONSTRAINT "chk_clientes_tipo_contribuinte_icms" CHECK ("clientes"."tipo_contribuinte_icms" IS NULL OR "clientes"."tipo_contribuinte_icms" IN ('CONTRIBUINTE', 'ISENTO', 'NAO_CONTRIBUINTE')),
	CONSTRAINT "chk_clientes_inscricao_estadual" CHECK ("clientes"."inscricao_estadual" IS NULL OR "clientes"."inscricao_estadual" ~ '^[0-9A-Z./-]{2,20}$'),
	CONSTRAINT "chk_clientes_apura_icms_coerencia" CHECK (("clientes"."tipo_pessoa" = 'PF' AND "clientes"."regime_tributario" IS NULL) OR ("clientes"."tipo_pessoa" = 'PJ' AND "clientes"."regime_tributario" IN ('LUCRO_PRESUMIDO', 'LUCRO_REAL') AND "clientes"."apura_icms" = true) OR ("clientes"."tipo_pessoa" = 'PJ' AND "clientes"."regime_tributario" = 'SIMPLES_NACIONAL') OR ("clientes"."tipo_pessoa" = 'PJ' AND "clientes"."regime_tributario" IS NULL)),
	CONSTRAINT "chk_clientes_consulta_simples_coerencia" CHECK ((
        ("clientes"."optante_simples_nacional" IS NULL AND "clientes"."simples_nacional_fonte" IS NULL AND "clientes"."simples_nacional_consultado_em" IS NULL)
        OR
        ("clientes"."optante_simples_nacional" IS NOT NULL AND "clientes"."simples_nacional_fonte" IN ('OPEN_CNPJ', 'RECEITA_WS') AND "clientes"."simples_nacional_consultado_em" IS NOT NULL)
      )
      AND ("clientes"."tipo_pessoa" = 'PJ' OR "clientes"."optante_simples_nacional" IS NULL)
      AND ("clientes"."optante_simples_nacional" IS DISTINCT FROM true OR "clientes"."regime_tributario" = 'SIMPLES_NACIONAL')
      AND ("clientes"."optante_simples_nacional" IS DISTINCT FROM false OR "clientes"."regime_tributario" IS DISTINCT FROM 'SIMPLES_NACIONAL')),
	CONSTRAINT "chk_clientes_documento_por_tipo" CHECK (("clientes"."tipo_pessoa" = 'PJ' AND "clientes"."cnpj" ~ '^[0-9A-Z]{12}[0-9]{2}$' AND "clientes"."cpf" IS NULL) OR ("clientes"."tipo_pessoa" = 'PF' AND "clientes"."cnpj" ~ '^[0-9]{11}$' AND "clientes"."cpf" = "clientes"."cnpj")),
	CONSTRAINT "chk_clientes_suspensao_coerencia" CHECK (("clientes"."suspenso" = true AND "clientes"."suspenso_em" IS NOT NULL) OR ("clientes"."suspenso" = false AND "clientes"."suspenso_em" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "contadores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
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
	CONSTRAINT "chk_contadores_documento" CHECK (("contadores"."cpf" IS NOT NULL AND "contadores"."cpf" ~ '^[0-9]{11}$') OR ("contadores"."cnpj" IS NOT NULL AND "contadores"."cnpj" ~ '^[0-9A-Z]{12}[0-9]{2}$')),
	CONSTRAINT "chk_contadores_cep" CHECK ("contadores"."cep" IS NULL OR "contadores"."cep" ~ '^[0-9]{8}$'),
	CONSTRAINT "chk_contadores_codigo_municipio" CHECK ("contadores"."codigo_municipio_ibge" ~ '^[0-9]{7}$'),
	CONSTRAINT "chk_contadores_nome" CHECK (char_length(btrim("contadores"."nome")) BETWEEN 2 AND 100),
	CONSTRAINT "chk_contadores_crc" CHECK (char_length(btrim("contadores"."crc")) BETWEEN 2 AND 30)
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
	"sincronizacao_id" uuid,
	"sincronizacao_iniciada_em" timestamp with time zone,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chk_controle_nsu_tipo" CHECK ("controle_nsu"."tipo_documento" IN ('NFE', 'CTE')),
	CONSTRAINT "chk_controle_nsu_ultimo" CHECK ("controle_nsu"."ultimo_nsu" >= 0),
	CONSTRAINT "chk_controle_nsu_max" CHECK ("controle_nsu"."max_nsu" >= 0),
	CONSTRAINT "chk_controle_nsu_sincronizacao_coerencia" CHECK (("controle_nsu"."sincronizacao_id" IS NULL AND "controle_nsu"."sincronizacao_iniciada_em" IS NULL) OR ("controle_nsu"."sincronizacao_id" IS NOT NULL AND "controle_nsu"."sincronizacao_iniciada_em" IS NOT NULL))
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
	"data_emissao_fiscal" date,
	"data_entrada_saida" timestamp,
	"data_entrada_saida_fiscal" date,
	"valor_total" numeric(14, 2) NOT NULL,
	"valor_total_declarado_xml" numeric(15, 2),
	"totais_declarados_xml" jsonb,
	"quantidade_itens_declarada_xml" integer,
	"integridade_conferida" boolean DEFAULT false NOT NULL,
	"integridade_status" varchar(20) DEFAULT 'NAO_CONFERIDA' NOT NULL,
	"integridade_detalhes" jsonb,
	"cod_situacao_sped" varchar(2),
	"modalidade_frete" varchar(1),
	"informacoes_complementares" text,
	"emitente_dados" jsonb,
	"destinatario_dados" jsonb,
	"codigo_verificacao" varchar(32),
	"competencia_declarada" date,
	"municipio_incidencia" varchar(7),
	"regime_especial_tributacao" varchar(10),
	"optante_simples_nacional_xml" boolean,
	"nfse_dados" jsonb,
	"documentos_referenciados" jsonb,
	"situacao" text DEFAULT 'AUTORIZADA' NOT NULL,
	"manifestacao_status" text DEFAULT 'SEM_MANIFESTACAO' NOT NULL,
	"tipo_operacao_escriturada" varchar(10) DEFAULT 'ENTRADA' NOT NULL,
	"tp_nf_xml" varchar(1),
	"escriturado" boolean DEFAULT false NOT NULL,
	"escrituracao_status" varchar(24) DEFAULT 'NAO_ESCRITURAVEL' NOT NULL,
	"xml_key" text NOT NULL,
	"danfe_key" text,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chk_docs_fiscais_chave" CHECK ((("documentos_fiscais"."tipo_documento" IN ('NFE', 'CTE', 'NFCE') AND length("documentos_fiscais"."chave_acesso") = 44) OR ("documentos_fiscais"."tipo_documento" = 'NFSE' AND length("documentos_fiscais"."chave_acesso") BETWEEN 14 AND 50))),
	CONSTRAINT "chk_docs_fiscais_tipo" CHECK ("documentos_fiscais"."tipo_documento" IN ('NFE', 'CTE', 'NFCE', 'NFSE')),
	CONSTRAINT "chk_docs_fiscais_modelo" CHECK ("documentos_fiscais"."modelo" IN ('55', '57', '65', 'NFSE')),
	CONSTRAINT "chk_docs_fiscais_tipo_modelo" CHECK (("documentos_fiscais"."tipo_documento" = 'NFE' AND "documentos_fiscais"."modelo" = '55') OR ("documentos_fiscais"."tipo_documento" = 'CTE' AND "documentos_fiscais"."modelo" = '57') OR ("documentos_fiscais"."tipo_documento" = 'NFCE' AND "documentos_fiscais"."modelo" = '65') OR ("documentos_fiscais"."tipo_documento" = 'NFSE' AND "documentos_fiscais"."modelo" = 'NFSE')),
	CONSTRAINT "chk_docs_fiscais_situacao" CHECK ("documentos_fiscais"."situacao" IN ('AUTORIZADA', 'CANCELADA', 'DENEGADA', 'RESUMIDA')),
	CONSTRAINT "chk_docs_fiscais_manifestacao" CHECK ("documentos_fiscais"."manifestacao_status" IN ('SEM_MANIFESTACAO', 'CIENCIA', 'CONFIRMADA', 'DESCONHECIDA', 'NAO_REALIZADA')),
	CONSTRAINT "chk_docs_fiscais_operacao_escriturada" CHECK ("documentos_fiscais"."tipo_operacao_escriturada" IN ('ENTRADA', 'SAIDA')),
	CONSTRAINT "chk_docs_fiscais_tp_nf_xml" CHECK ("documentos_fiscais"."tp_nf_xml" IS NULL OR "documentos_fiscais"."tp_nf_xml" IN ('0', '1')),
	CONSTRAINT "chk_docs_fiscais_escrituracao_status" CHECK ("documentos_fiscais"."escrituracao_status" IN ('ESCRITURADO', 'NAO_ESCRITURAVEL', 'PENDENTE_REVISAO')),
	CONSTRAINT "chk_docs_fiscais_escrituracao_coerencia" CHECK (("documentos_fiscais"."escriturado" = false AND "documentos_fiscais"."escrituracao_status" = 'NAO_ESCRITURAVEL') OR ("documentos_fiscais"."escriturado" = true AND "documentos_fiscais"."escrituracao_status" IN ('ESCRITURADO', 'PENDENTE_REVISAO'))),
	CONSTRAINT "chk_docs_fiscais_valor" CHECK ("documentos_fiscais"."valor_total" >= 0),
	CONSTRAINT "chk_docs_fiscais_valor_declarado" CHECK ("documentos_fiscais"."valor_total_declarado_xml" IS NULL OR "documentos_fiscais"."valor_total_declarado_xml" >= 0),
	CONSTRAINT "chk_docs_fiscais_quantidade_itens_declarada" CHECK ("documentos_fiscais"."quantidade_itens_declarada_xml" IS NULL OR "documentos_fiscais"."quantidade_itens_declarada_xml" >= 0),
	CONSTRAINT "chk_docs_fiscais_integridade_status" CHECK ("documentos_fiscais"."integridade_status" IN ('NAO_CONFERIDA', 'OK', 'DIVERGENTE')),
	CONSTRAINT "chk_docs_fiscais_integridade_coerencia" CHECK (("documentos_fiscais"."integridade_conferida" = false AND "documentos_fiscais"."integridade_status" = 'NAO_CONFERIDA') OR ("documentos_fiscais"."integridade_conferida" = true AND "documentos_fiscais"."integridade_status" IN ('OK', 'DIVERGENTE'))),
	CONSTRAINT "chk_docs_fiscais_cod_situacao_sped" CHECK ("documentos_fiscais"."cod_situacao_sped" IS NULL OR "documentos_fiscais"."cod_situacao_sped" ~ '^[0-9]{2}$'),
	CONSTRAINT "chk_docs_fiscais_modalidade_frete" CHECK ("documentos_fiscais"."modalidade_frete" IS NULL OR "documentos_fiscais"."modalidade_frete" ~ '^[0-9]$'),
	CONSTRAINT "chk_docs_fiscais_municipio_incidencia" CHECK ("documentos_fiscais"."municipio_incidencia" IS NULL OR "documentos_fiscais"."municipio_incidencia" ~ '^[0-9]{7}$'),
	CONSTRAINT "chk_docs_fiscais_xml_key" CHECK (btrim("documentos_fiscais"."xml_key") <> '')
);
--> statement-breakpoint
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
	CONSTRAINT "chk_cte_escrituracao_tomador_documento" CHECK ("documentos_fiscais_cte_escrituracao"."tomador_cnpj_cpf" ~ '^[0-9]{11}$|^[0-9A-Z]{12}[0-9]{2}$'),
	CONSTRAINT "chk_cte_escrituracao_tomador_papel" CHECK ("documentos_fiscais_cte_escrituracao"."tomador_papel" IN ('REMETENTE', 'EXPEDIDOR', 'RECEBEDOR', 'DESTINATARIO', 'TERCEIRO')),
	CONSTRAINT "chk_cte_escrituracao_operacao" CHECK ("documentos_fiscais_cte_escrituracao"."tipo_operacao_escriturada" IN ('ENTRADA', 'SAIDA')),
	CONSTRAINT "chk_cte_escrituracao_tp_cte" CHECK ("documentos_fiscais_cte_escrituracao"."tp_cte" IN ('0', '1', '2', '3')),
	CONSTRAINT "chk_cte_escrituracao_tp_serv" CHECK ("documentos_fiscais_cte_escrituracao"."tp_serv" IN ('0', '1', '2', '3', '4')),
	CONSTRAINT "chk_cte_escrituracao_modal" CHECK ("documentos_fiscais_cte_escrituracao"."modal" ~ '^[0-9]{2}$'),
	CONSTRAINT "chk_cte_escrituracao_cfop_xml" CHECK ("documentos_fiscais_cte_escrituracao"."cfop_xml" ~ '^[123567][0-9]{3}$'),
	CONSTRAINT "chk_cte_escrituracao_cfop" CHECK ("documentos_fiscais_cte_escrituracao"."cfop" ~ '^[123567][0-9]{3}$'),
	CONSTRAINT "chk_cte_escrituracao_referencia" CHECK ("documentos_fiscais_cte_escrituracao"."chave_cte_referenciado" IS NULL OR "documentos_fiscais_cte_escrituracao"."chave_cte_referenciado" ~ '^[0-9A-Z]{44}$'),
	CONSTRAINT "chk_cte_escrituracao_municipio_origem" CHECK ("documentos_fiscais_cte_escrituracao"."codigo_municipio_origem" IS NULL OR "documentos_fiscais_cte_escrituracao"."codigo_municipio_origem" ~ '^[0-9]{7}$'),
	CONSTRAINT "chk_cte_escrituracao_municipio_destino" CHECK ("documentos_fiscais_cte_escrituracao"."codigo_municipio_destino" IS NULL OR "documentos_fiscais_cte_escrituracao"."codigo_municipio_destino" ~ '^[0-9]{7}$')
);
--> statement-breakpoint
CREATE TABLE "documentos_fiscais_itens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"documento_fiscal_id" uuid NOT NULL,
	"cliente_id" uuid NOT NULL,
	"numero_item" integer NOT NULL,
	"codigo_produto" text NOT NULL,
	"codigo_ean" text,
	"descricao" text NOT NULL,
	"ncm" varchar(8),
	"nve" text,
	"cest" varchar(7),
	"ind_escala" varchar(1),
	"cnpj_fabricante" varchar(14),
	"codigo_beneficio_fiscal" text,
	"cfop_xml" varchar(4),
	"cfop" varchar(4) NOT NULL,
	"tipo_operacao_escriturada" varchar(10) DEFAULT 'ENTRADA' NOT NULL,
	"cfop_revisao_necessaria" boolean DEFAULT false NOT NULL,
	"destinacao_mercadoria" varchar(20),
	"destinacao_inferida" varchar(20),
	"destinacao_origem" varchar(20),
	"destinacao_confianca" numeric(4, 3),
	"destinacao_justificativa" text,
	"cfop_manual" boolean DEFAULT false NOT NULL,
	"cfop_origem_resolucao" varchar(30),
	"cfop_motivo_resolucao" text,
	"unidade_comercial" varchar(10) NOT NULL,
	"quantidade_comercial" numeric(15, 4) NOT NULL,
	"valor_unitario_comercial" numeric(21, 10) NOT NULL,
	"valor_bruto_produto" numeric(15, 2) NOT NULL,
	"codigo_ean_tributavel" text,
	"unidade_tributavel" varchar(10),
	"quantidade_tributavel" numeric(15, 4),
	"valor_unitario_tributavel" numeric(21, 10),
	"valor_frete" numeric(15, 2),
	"valor_seguro" numeric(15, 2),
	"valor_desconto" numeric(15, 2),
	"valor_outras_despesas" numeric(15, 2),
	"ind_total" varchar(1) NOT NULL,
	"numero_pedido_compra" text,
	"item_pedido_compra" text,
	"informacoes_adicionais" text,
	"cod_obs_sped" varchar(6),
	"cod_cta_sped" text,
	"origem_mercadoria" varchar(1),
	"cst_icms" varchar(3),
	"csosn_icms" varchar(4),
	"modalidade_bc_icms" varchar(1),
	"percentual_reducao_bc_icms" numeric(7, 4),
	"valor_bc_icms" numeric(15, 2),
	"aliquota_icms" numeric(7, 4),
	"valor_icms" numeric(15, 2),
	"modalidade_bc_icms_st" varchar(1),
	"percentual_mva_st" numeric(7, 4),
	"percentual_reducao_bc_icms_st" numeric(7, 4),
	"valor_bc_icms_st" numeric(15, 2),
	"aliquota_icms_st" numeric(7, 4),
	"valor_icms_st" numeric(15, 2),
	"valor_bc_fcp" numeric(15, 2),
	"aliquota_fcp" numeric(7, 4),
	"valor_fcp" numeric(15, 2),
	"valor_bc_fcp_st" numeric(15, 2),
	"aliquota_fcp_st" numeric(7, 4),
	"valor_fcp_st" numeric(15, 2),
	"motivo_desoneracao_icms" varchar(2),
	"valor_icms_desonerado" numeric(15, 2),
	"percentual_diferimento" numeric(7, 4),
	"valor_icms_diferido" numeric(15, 2),
	"valor_icms_operacao" numeric(15, 2),
	"aliquota_credito_sn" numeric(7, 4),
	"valor_credito_icms_sn" numeric(15, 2),
	"valor_bc_icms_st_retido" numeric(15, 2),
	"aliquota_icms_st_retido" numeric(7, 4),
	"valor_icms_st_retido" numeric(15, 2),
	"valor_bc_icms_uf_dest" numeric(15, 2),
	"valor_bc_fcp_uf_dest" numeric(15, 2),
	"percentual_fcp_uf_dest" numeric(7, 4),
	"aliquota_icms_uf_dest" numeric(7, 4),
	"aliquota_icms_interestadual" numeric(7, 4),
	"percentual_provisorio_partilha" numeric(7, 4),
	"valor_fcp_uf_dest" numeric(15, 2),
	"valor_icms_uf_dest" numeric(15, 2),
	"valor_icms_uf_remetente" numeric(15, 2),
	"cst_ipi" varchar(2),
	"classe_enquadramento_ipi" varchar(5),
	"codigo_enquadramento_ipi" varchar(3),
	"cnpj_produtor_ipi" varchar(14),
	"valor_bc_ipi" numeric(15, 2),
	"aliquota_ipi" numeric(7, 4),
	"quantidade_unidade_ipi" numeric(15, 4),
	"valor_unidade_ipi" numeric(15, 4),
	"valor_ipi" numeric(15, 2),
	"cst_pis" varchar(2),
	"valor_bc_pis" numeric(15, 2),
	"aliquota_pis_percentual" numeric(7, 4),
	"quantidade_bc_pis" numeric(15, 4),
	"aliquota_pis_reais" numeric(15, 4),
	"valor_pis" numeric(15, 2),
	"valor_bc_pis_st" numeric(15, 2),
	"aliquota_pis_st_percentual" numeric(7, 4),
	"valor_pis_st" numeric(15, 2),
	"cst_cofins" varchar(2),
	"valor_bc_cofins" numeric(15, 2),
	"aliquota_cofins_percentual" numeric(7, 4),
	"quantidade_bc_cofins" numeric(15, 4),
	"aliquota_cofins_reais" numeric(15, 4),
	"valor_cofins" numeric(15, 2),
	"valor_bc_cofins_st" numeric(15, 2),
	"aliquota_cofins_st_percentual" numeric(7, 4),
	"valor_cofins_st" numeric(15, 2),
	"valor_bc_ii" numeric(15, 2),
	"valor_despesa_aduaneira" numeric(15, 2),
	"valor_imposto_importacao" numeric(15, 2),
	"valor_iof" numeric(15, 2),
	"valor_tributos_aproximados" numeric(15, 2),
	"valor_bc_iss" numeric(15, 2),
	"aliquota_iss" numeric(7, 4),
	"valor_iss" numeric(15, 2),
	"iss_retido" boolean DEFAULT false NOT NULL,
	"item_lista_servico" varchar(10),
	"cnae" varchar(7),
	"codigo_tributacao_municipio" varchar(20),
	"exigibilidade_iss" varchar(1),
	"municipio_incidencia" varchar(7),
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chk_item_destinacao_inferida" CHECK ("documentos_fiscais_itens"."destinacao_inferida" IS NULL OR "documentos_fiscais_itens"."destinacao_inferida" IN ('REVENDA', 'INDUSTRIALIZACAO', 'USO_CONSUMO', 'ATIVO_IMOBILIZADO')),
	CONSTRAINT "chk_item_destinacao_confianca" CHECK ("documentos_fiscais_itens"."destinacao_confianca" IS NULL OR "documentos_fiscais_itens"."destinacao_confianca" BETWEEN 0 AND 1),
	CONSTRAINT "chk_item_destinacao_origem" CHECK ("documentos_fiscais_itens"."destinacao_origem" IS NULL OR "documentos_fiscais_itens"."destinacao_origem" IN ('MANUAL', 'HISTORICO', 'NCM_PERFIL', 'HEURISTICA', 'INDETERMINADO')),
	CONSTRAINT "chk_item_numero" CHECK ("documentos_fiscais_itens"."numero_item" BETWEEN 1 AND 990),
	CONSTRAINT "chk_item_ind_escala" CHECK ("documentos_fiscais_itens"."ind_escala" IS NULL OR "documentos_fiscais_itens"."ind_escala" IN ('S', 'N')),
	CONSTRAINT "chk_item_ind_total" CHECK ("documentos_fiscais_itens"."ind_total" IN ('0', '1')),
	CONSTRAINT "chk_item_origem" CHECK ("documentos_fiscais_itens"."origem_mercadoria" IS NULL OR "documentos_fiscais_itens"."origem_mercadoria" ~ '^[0-8]$'),
	CONSTRAINT "chk_item_cfop" CHECK ("documentos_fiscais_itens"."cfop" ~ '^[1-7][0-9]{3}$'),
	CONSTRAINT "chk_item_cfop_xml" CHECK ("documentos_fiscais_itens"."cfop_xml" IS NULL OR "documentos_fiscais_itens"."cfop_xml" ~ '^[1-7][0-9]{3}$'),
	CONSTRAINT "chk_item_operacao_escriturada" CHECK ("documentos_fiscais_itens"."tipo_operacao_escriturada" IN ('ENTRADA', 'SAIDA')),
	CONSTRAINT "chk_item_destinacao" CHECK ("documentos_fiscais_itens"."destinacao_mercadoria" IS NULL OR "documentos_fiscais_itens"."destinacao_mercadoria" IN ('REVENDA', 'INDUSTRIALIZACAO', 'USO_CONSUMO', 'ATIVO_IMOBILIZADO')),
	CONSTRAINT "chk_item_cnae" CHECK ("documentos_fiscais_itens"."cnae" IS NULL OR "documentos_fiscais_itens"."cnae" ~ '^[0-9]{7}$'),
	CONSTRAINT "chk_item_municipio_incidencia" CHECK ("documentos_fiscais_itens"."municipio_incidencia" IS NULL OR "documentos_fiscais_itens"."municipio_incidencia" ~ '^[0-9]{7}$')
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
CREATE TABLE "fiscal_apuracoes_guias" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"competencia" date NOT NULL,
	"tributo" varchar(20) NOT NULL,
	"uf_favorecida" varchar(2) NOT NULL,
	"tipo_guia" varchar(10) NOT NULL,
	"codigo_receita" text NOT NULL,
	"data_vencimento" date NOT NULL,
	"valor_principal" numeric(15, 2) NOT NULL,
	"valor_multa" numeric(15, 2) DEFAULT '0',
	"valor_juros" numeric(15, 2) DEFAULT '0',
	"valor_total" numeric(15, 2) NOT NULL,
	"codigo_barras" text,
	"linha_digitavel" text,
	"status_pagamento" varchar(20) DEFAULT 'PENDENTE' NOT NULL,
	"arquivo_guia_key" text,
	"guia_upload_id" uuid,
	"guia_upload_vinculada_em" timestamp with time zone,
	"guia_upload_diferenca" numeric(15, 2),
	"origem" varchar(20) DEFAULT 'MANUAL' NOT NULL,
	"fechamento_id" uuid,
	"divergente_obrigacao" boolean DEFAULT false NOT NULL,
	"valor_obrigacao" numeric(15, 2),
	"cancelada" boolean DEFAULT false NOT NULL,
	"cancelada_em" timestamp,
	"motivo_cancelamento" text,
	"emitida_orgao" boolean DEFAULT false NOT NULL,
	"emitida_orgao_em" timestamp,
	"idempotency_key" text,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chk_fiscal_guias_tributo" CHECK ("fiscal_apuracoes_guias"."tributo" IN ('ICMS_PROPRIO', 'ICMS_ST', 'DIFAL_ENTRADA', 'DIFAL_SAIDA', 'FCP', 'IPI', 'PIS', 'COFINS', 'DAS_SIMPLES')),
	CONSTRAINT "chk_fiscal_guias_tipo" CHECK ("fiscal_apuracoes_guias"."tipo_guia" IN ('DAE', 'GNRE', 'DARF', 'DAS')),
	CONSTRAINT "chk_fiscal_guias_status" CHECK ("fiscal_apuracoes_guias"."status_pagamento" IN ('PENDENTE', 'PAGO', 'VENCIDO')),
	CONSTRAINT "chk_fiscal_guias_uf" CHECK ("fiscal_apuracoes_guias"."uf_favorecida" ~ '^[A-Z]{2}$'),
	CONSTRAINT "chk_fiscal_guias_origem" CHECK ("fiscal_apuracoes_guias"."origem" IN ('APURACAO', 'MANUAL')),
	CONSTRAINT "chk_fiscal_guias_apuracao_vinculo" CHECK ("fiscal_apuracoes_guias"."origem" <> 'APURACAO' OR "fiscal_apuracoes_guias"."fechamento_id" IS NOT NULL),
	CONSTRAINT "chk_fiscal_guias_divergencia_apuracao" CHECK ("fiscal_apuracoes_guias"."origem" = 'APURACAO' OR ("fiscal_apuracoes_guias"."divergente_obrigacao" = false AND "fiscal_apuracoes_guias"."valor_obrigacao" IS NULL)),
	CONSTRAINT "chk_fiscal_guias_cancelamento" CHECK ("fiscal_apuracoes_guias"."cancelada" = false OR "fiscal_apuracoes_guias"."cancelada_em" IS NOT NULL),
	CONSTRAINT "chk_fiscal_guias_emissao_orgao" CHECK ("fiscal_apuracoes_guias"."emitida_orgao" = false OR "fiscal_apuracoes_guias"."emitida_orgao_em" IS NOT NULL),
	CONSTRAINT "chk_fiscal_guias_upload_vinculo" CHECK (("fiscal_apuracoes_guias"."guia_upload_id" IS NULL AND "fiscal_apuracoes_guias"."guia_upload_vinculada_em" IS NULL AND "fiscal_apuracoes_guias"."guia_upload_diferenca" IS NULL) OR ("fiscal_apuracoes_guias"."guia_upload_id" IS NOT NULL AND "fiscal_apuracoes_guias"."guia_upload_vinculada_em" IS NOT NULL AND "fiscal_apuracoes_guias"."guia_upload_diferenca" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "fiscal_catalogos_versoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tipo" varchar(20) NOT NULL,
	"uf" varchar(2) NOT NULL,
	"codigo" text NOT NULL,
	"descricao" text,
	"fonte" varchar(60) NOT NULL,
	"vigencia_inicio" date NOT NULL,
	"vigencia_fim" date,
	"ativo" boolean DEFAULT true NOT NULL,
	"fonte_url" text,
	"hash_conteudo" varchar(64),
	"conteudo" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"escopo_aprovado" boolean DEFAULT false NOT NULL,
	"aprovado_por" text,
	"data_carga" timestamp with time zone DEFAULT now() NOT NULL,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chk_fiscal_catalogo_uf" CHECK ("fiscal_catalogos_versoes"."uf" ~ '^[A-Z]{2}$'),
	CONSTRAINT "chk_fiscal_catalogo_tipo" CHECK ("fiscal_catalogos_versoes"."tipo" IN ('E111_CIAP', 'DIFAL', 'ST_FCP', 'PIS_COFINS')),
	CONSTRAINT "chk_fiscal_catalogo_vigencia" CHECK ("fiscal_catalogos_versoes"."vigencia_fim" IS NULL OR "fiscal_catalogos_versoes"."vigencia_fim" >= "fiscal_catalogos_versoes"."vigencia_inicio"),
	CONSTRAINT "chk_fiscal_catalogo_codigo_e111_ciap" CHECK ("fiscal_catalogos_versoes"."tipo" <> 'E111_CIAP' OR "fiscal_catalogos_versoes"."codigo" ~ '^[A-Z]{2}02[A-Z0-9]{4}$'),
	CONSTRAINT "chk_fiscal_catalogo_hash" CHECK ("fiscal_catalogos_versoes"."hash_conteudo" IS NULL OR "fiscal_catalogos_versoes"."hash_conteudo" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "chk_fiscal_catalogo_aprovacao" CHECK ("fiscal_catalogos_versoes"."escopo_aprovado" = ("fiscal_catalogos_versoes"."aprovado_por" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "fiscal_decisoes_item" (
	"item_id" uuid NOT NULL,
	"cliente_id" uuid NOT NULL,
	"regra_versao_id" text DEFAULT 'SEM_REGRA' NOT NULL,
	"valor_credito_admitido" numeric(15, 2) DEFAULT '0' NOT NULL,
	"decisao" varchar(20) NOT NULL,
	"motivo" varchar(40) NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiscal_decisoes_item_pk" PRIMARY KEY("item_id","regra_versao_id"),
	CONSTRAINT "chk_fiscal_decisao" CHECK ("fiscal_decisoes_item"."decisao" IN ('ADMITIDO', 'VEDADO', 'EXIGE_REVISAO')),
	CONSTRAINT "chk_fiscal_decisao_motivo" CHECK ("fiscal_decisoes_item"."motivo" IN ('SEM_VALOR_DESTACADO', 'CST_AUTORIZA_CREDITO', 'CSOSN_PERMITE_CREDITO', 'CFOP_VEDA_CREDITO', 'REGRA_VEDA_CREDITO', 'CST_NAO_AUTORIZADO')),
	CONSTRAINT "chk_fiscal_decisao_credito_nao_negativo" CHECK ("fiscal_decisoes_item"."valor_credito_admitido" >= 0)
);
--> statement-breakpoint
CREATE TABLE "fiscal_entregas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"fechamento_id" uuid,
	"obrigacao" varchar(20) NOT NULL,
	"competencia" date NOT NULL,
	"arquivo_key" text NOT NULL,
	"hash_arquivo" varchar(64) NOT NULL,
	"pva_programa" varchar(40) NOT NULL,
	"pva_versao" varchar(20) NOT NULL,
	"status_validacao" varchar(20) DEFAULT 'PENDENTE' NOT NULL,
	"validacao_resultado" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"assinatura_titular" text,
	"assinatura_em" timestamp with time zone,
	"protocolo_numero" text,
	"recibo_key" text,
	"entrega_original_id" uuid,
	"valor_diferenca" numeric(15, 2),
	"leiaute_versao" varchar(20) NOT NULL,
	"transmitida_em" timestamp with time zone,
	"tentativas_storage" integer DEFAULT 0 NOT NULL,
	"ultimo_erro_storage" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_fiscal_entrega_obrigacao" CHECK ("fiscal_entregas"."obrigacao" IN ('EFD_ICMS_IPI', 'EFD_CONTRIBUICOES', 'GIA', 'DAS', 'DAPI')),
	CONSTRAINT "chk_fiscal_entrega_competencia_dia1" CHECK (date_part('day', "fiscal_entregas"."competencia") = 1),
	CONSTRAINT "chk_fiscal_entrega_hash" CHECK ("fiscal_entregas"."hash_arquivo" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "chk_fiscal_entrega_status" CHECK ("fiscal_entregas"."status_validacao" IN ('PENDENTE', 'VALIDADA', 'REJEITADA', 'TRANSMITIDA', 'FALHA_STORAGE')),
	CONSTRAINT "chk_fiscal_entrega_retificacao_diferenca" CHECK ("fiscal_entregas"."entrega_original_id" IS NOT NULL OR "fiscal_entregas"."valor_diferenca" IS NULL),
	CONSTRAINT "chk_fiscal_entrega_nao_autoretifica" CHECK ("fiscal_entregas"."entrega_original_id" IS NULL OR "fiscal_entregas"."entrega_original_id" <> "fiscal_entregas"."id")
);
--> statement-breakpoint
CREATE TABLE "fiscal_fechamentos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"obrigacao" varchar(20) NOT NULL,
	"competencia" date NOT NULL,
	"versao" integer DEFAULT 1 NOT NULL,
	"estado" varchar(10) DEFAULT 'RASCUNHO' NOT NULL,
	"corrente" boolean DEFAULT false NOT NULL,
	"motor_versao" varchar(40) NOT NULL,
	"hash_entradas" varchar(64) NOT NULL,
	"documentos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"decisoes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"regras" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"parametros" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"saldos" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"aprovado_por" text,
	"fechado_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_fiscal_fechamento_obrigacao" CHECK ("fiscal_fechamentos"."obrigacao" IN ('EFD_ICMS_IPI', 'EFD_CONTRIBUICOES', 'GIA', 'DAS', 'DAPI')),
	CONSTRAINT "chk_fiscal_fechamento_estado" CHECK ("fiscal_fechamentos"."estado" IN ('RASCUNHO', 'PENDENTE', 'REVISADO', 'FECHADO')),
	CONSTRAINT "chk_fiscal_fechamento_versao" CHECK ("fiscal_fechamentos"."versao" >= 1),
	CONSTRAINT "chk_fiscal_fechamento_corrente_fechado" CHECK ("fiscal_fechamentos"."corrente" = false OR "fiscal_fechamentos"."estado" = 'FECHADO'),
	CONSTRAINT "chk_fiscal_fechamento_hash" CHECK ("fiscal_fechamentos"."hash_entradas" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "chk_fiscal_fechamento_competencia_dia1" CHECK (date_part('day', "fiscal_fechamentos"."competencia") = 1),
	CONSTRAINT "chk_fiscal_fechamento_fechado_em" CHECK (("fiscal_fechamentos"."estado" = 'FECHADO') = ("fiscal_fechamentos"."fechado_em" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "fiscal_lancamentos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"fechamento_versao" integer DEFAULT 1 NOT NULL,
	"origem" varchar(20) NOT NULL,
	"fato_chave" text NOT NULL,
	"competencia" date NOT NULL,
	"tributo" varchar(12) NOT NULL,
	"natureza" varchar(7) NOT NULL,
	"sinal" integer DEFAULT 1 NOT NULL,
	"valor" numeric(15, 2) NOT NULL,
	"base_calculo" numeric(15, 2),
	"aliquota" numeric(9, 4),
	"documento_fiscal_id" uuid,
	"documento_fiscal_item_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_fiscal_lancamento_origem" CHECK ("fiscal_lancamentos"."origem" IN ('DOCUMENTO', 'CIAP', 'AJUSTE', 'SALDO_ANTERIOR', 'APURACAO')),
	CONSTRAINT "chk_fiscal_lancamento_tributo" CHECK ("fiscal_lancamentos"."tributo" IN ('ICMS', 'ICMS_ST', 'IPI', 'PIS', 'COFINS', 'FCP', 'DIFAL')),
	CONSTRAINT "chk_fiscal_lancamento_natureza" CHECK ("fiscal_lancamentos"."natureza" IN ('DEBITO', 'CREDITO')),
	CONSTRAINT "chk_fiscal_lancamento_sinal" CHECK ("fiscal_lancamentos"."sinal" IN (-1, 1)),
	CONSTRAINT "chk_fiscal_lancamento_versao" CHECK ("fiscal_lancamentos"."fechamento_versao" >= 1),
	CONSTRAINT "chk_fiscal_lancamento_valor" CHECK ("fiscal_lancamentos"."valor" >= 0),
	CONSTRAINT "chk_fiscal_lancamento_base" CHECK ("fiscal_lancamentos"."base_calculo" IS NULL OR "fiscal_lancamentos"."base_calculo" >= 0),
	CONSTRAINT "chk_fiscal_lancamento_aliquota" CHECK ("fiscal_lancamentos"."aliquota" IS NULL OR "fiscal_lancamentos"."aliquota" >= 0),
	CONSTRAINT "chk_fiscal_lancamento_competencia_dia1" CHECK (date_part('day', "fiscal_lancamentos"."competencia") = 1),
	CONSTRAINT "chk_fiscal_lancamento_item_exige_documento" CHECK ("fiscal_lancamentos"."documento_fiscal_item_id" IS NULL OR "fiscal_lancamentos"."documento_fiscal_id" IS NOT NULL),
	CONSTRAINT "chk_fiscal_lancamento_documento_origem" CHECK ("fiscal_lancamentos"."documento_fiscal_id" IS NULL OR "fiscal_lancamentos"."origem" = 'DOCUMENTO')
);
--> statement-breakpoint
CREATE TABLE "fiscal_pagamentos_eventos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"guia_id" uuid NOT NULL,
	"fechamento_id" uuid,
	"tipo" varchar(20) NOT NULL,
	"origem" varchar(20) NOT NULL,
	"valor" numeric(15, 2) NOT NULL,
	"sinal" integer DEFAULT 1 NOT NULL,
	"data_evento" date NOT NULL,
	"comprovante_key" text,
	"declaracao_manual" boolean DEFAULT false NOT NULL,
	"documento_externo" text,
	"evento_estornado_id" uuid,
	"observacao" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_fiscal_pagamento_evento_tipo" CHECK ("fiscal_pagamentos_eventos"."tipo" IN ('PAGAMENTO', 'PAGAMENTO_PARCIAL', 'ESTORNO')),
	CONSTRAINT "chk_fiscal_pagamento_evento_origem" CHECK ("fiscal_pagamentos_eventos"."origem" IN ('MANUAL', 'IMPORTACAO', 'CONCILIACAO')),
	CONSTRAINT "chk_fiscal_pagamento_evento_sinal" CHECK ("fiscal_pagamentos_eventos"."sinal" IN (-1, 1)),
	CONSTRAINT "chk_fiscal_pagamento_evento_valor" CHECK ("fiscal_pagamentos_eventos"."valor" > 0),
	CONSTRAINT "chk_fiscal_pagamento_evento_estorno" CHECK (("fiscal_pagamentos_eventos"."tipo" = 'ESTORNO') = ("fiscal_pagamentos_eventos"."sinal" = -1)),
	CONSTRAINT "chk_fiscal_pagamento_evento_estorno_ref" CHECK ("fiscal_pagamentos_eventos"."tipo" <> 'ESTORNO' OR "fiscal_pagamentos_eventos"."evento_estornado_id" IS NOT NULL),
	CONSTRAINT "chk_fiscal_pagamento_evento_estorno_ref_tipo" CHECK ("fiscal_pagamentos_eventos"."tipo" = 'ESTORNO' OR "fiscal_pagamentos_eventos"."evento_estornado_id" IS NULL),
	CONSTRAINT "chk_fiscal_pagamento_evento_evidencia" CHECK ("fiscal_pagamentos_eventos"."tipo" = 'ESTORNO' OR "fiscal_pagamentos_eventos"."comprovante_key" IS NOT NULL OR "fiscal_pagamentos_eventos"."declaracao_manual" = true)
);
--> statement-breakpoint
CREATE TABLE "fiscal_perfis_vigencia" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"uf" varchar(2) NOT NULL,
	"regime" varchar(20) NOT NULL,
	"obrigacao" varchar(20) NOT NULL,
	"vigencia_inicio" date NOT NULL,
	"vigencia_fim" date,
	"fonte" varchar(60) NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_fiscal_perfil_uf" CHECK ("fiscal_perfis_vigencia"."uf" ~ '^[A-Z]{2}$'),
	CONSTRAINT "chk_fiscal_perfil_regime" CHECK ("fiscal_perfis_vigencia"."regime" IN ('SIMPLES_NACIONAL', 'LUCRO_PRESUMIDO', 'LUCRO_REAL')),
	CONSTRAINT "chk_fiscal_perfil_obrigacao" CHECK ("fiscal_perfis_vigencia"."obrigacao" IN ('EFD_ICMS_IPI', 'EFD_CONTRIBUICOES', 'GIA', 'DAS', 'DAPI')),
	CONSTRAINT "chk_fiscal_perfil_vigencia" CHECK ("fiscal_perfis_vigencia"."vigencia_fim" IS NULL OR "fiscal_perfis_vigencia"."vigencia_fim" >= "fiscal_perfis_vigencia"."vigencia_inicio")
);
--> statement-breakpoint
CREATE TABLE "fiscal_regras_versoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"catalogo_versao_id" uuid NOT NULL,
	"chave" text NOT NULL,
	"revisao" integer DEFAULT 1 NOT NULL,
	"conteudo" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"fonte" varchar(60) NOT NULL,
	"fonte_url" text,
	"responsavel_por" text,
	"vigencia_inicio" date NOT NULL,
	"vigencia_fim" date,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_fiscal_regra_revisao" CHECK ("fiscal_regras_versoes"."revisao" >= 1),
	CONSTRAINT "chk_fiscal_regra_vigencia" CHECK ("fiscal_regras_versoes"."vigencia_fim" IS NULL OR "fiscal_regras_versoes"."vigencia_fim" >= "fiscal_regras_versoes"."vigencia_inicio")
);
--> statement-breakpoint
CREATE TABLE "fiscal_simples_anexos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tabela_id" uuid NOT NULL,
	"anexo" varchar(20) NOT NULL,
	"descricao" text NOT NULL,
	"tipo_atividade" varchar(30) NOT NULL,
	"permite_fator_r" boolean DEFAULT false NOT NULL,
	"recolhe_cpp_no_das" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_simples_anexos_tabela_anexo" UNIQUE("tabela_id","anexo"),
	CONSTRAINT "chk_simples_anexos_anexo" CHECK ("fiscal_simples_anexos"."anexo" IN ('ANEXO_I', 'ANEXO_II', 'ANEXO_III', 'ANEXO_IV', 'ANEXO_V')),
	CONSTRAINT "chk_simples_anexos_atividade" CHECK ("fiscal_simples_anexos"."tipo_atividade" IN ('COMERCIO', 'INDUSTRIA', 'SERVICOS', 'LOCACAO'))
);
--> statement-breakpoint
CREATE TABLE "fiscal_simples_apuracao_itens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"apuracao_id" uuid NOT NULL,
	"anexo" varchar(20) NOT NULL,
	"faixa_enquadrada" integer NOT NULL,
	"aliquota_nominal" numeric(7, 4) NOT NULL,
	"parcela_deduzir" numeric(15, 2) NOT NULL,
	"aliquota_efetiva" numeric(7, 4) NOT NULL,
	"receita_bruta_atividade" numeric(15, 2) NOT NULL,
	"segregacao" varchar(40) DEFAULT 'TRIBUTACAO_INTEGRAL' NOT NULL,
	"aliquota_efetiva_apos_deducoes" numeric(7, 4) NOT NULL,
	"valor_devido" numeric(15, 2) NOT NULL,
	"tributos_partilhados" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "chk_simples_apuracao_item_anexo" CHECK ("fiscal_simples_apuracao_itens"."anexo" IN ('ANEXO_I', 'ANEXO_II', 'ANEXO_III', 'ANEXO_IV', 'ANEXO_V')),
	CONSTRAINT "chk_simples_apuracao_item_faixa" CHECK ("fiscal_simples_apuracao_itens"."faixa_enquadrada" BETWEEN 1 AND 6),
	CONSTRAINT "chk_simples_apuracao_item_segregacao" CHECK ("fiscal_simples_apuracao_itens"."segregacao" IN ('TRIBUTACAO_INTEGRAL', 'ICMS_ST', 'ICMS_ISENTO', 'ISS_RETIDO', 'PIS_COFINS_MONOFASICO')),
	CONSTRAINT "chk_simples_apuracao_item_valores" CHECK ("fiscal_simples_apuracao_itens"."aliquota_nominal" >= 0 AND "fiscal_simples_apuracao_itens"."parcela_deduzir" >= 0 AND "fiscal_simples_apuracao_itens"."aliquota_efetiva" >= 0 AND "fiscal_simples_apuracao_itens"."receita_bruta_atividade" >= 0 AND "fiscal_simples_apuracao_itens"."aliquota_efetiva_apos_deducoes" >= 0 AND "fiscal_simples_apuracao_itens"."valor_devido" >= 0)
);
--> statement-breakpoint
CREATE TABLE "fiscal_simples_apuracoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"tabela_id" uuid NOT NULL,
	"competencia" date NOT NULL,
	"versao" integer DEFAULT 1 NOT NULL,
	"corrente" boolean DEFAULT false NOT NULL,
	"rbt12" numeric(15, 2) NOT NULL,
	"rbt12_proporcional" boolean DEFAULT false NOT NULL,
	"receita_bruta_mes" numeric(15, 2) NOT NULL,
	"folha_salarios_12m" numeric(15, 2) DEFAULT '0.00' NOT NULL,
	"fator_r" numeric(7, 4),
	"valor_total_das" numeric(15, 2) NOT NULL,
	"status" varchar(20) DEFAULT 'RASCUNHO' NOT NULL,
	"fechamento_id" uuid,
	"guia_id" uuid,
	"origens" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"memoria_calculo" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_simples_apuracao_versao" CHECK ("fiscal_simples_apuracoes"."versao" >= 1),
	CONSTRAINT "chk_simples_apuracao_competencia" CHECK (date_part('day', "fiscal_simples_apuracoes"."competencia") = 1),
	CONSTRAINT "chk_simples_status" CHECK ("fiscal_simples_apuracoes"."status" IN ('RASCUNHO', 'FECHADO', 'RETIFICADO')),
	CONSTRAINT "chk_simples_apuracao_corrente_fechada" CHECK ("fiscal_simples_apuracoes"."corrente" = false OR "fiscal_simples_apuracoes"."status" = 'FECHADO'),
	CONSTRAINT "chk_simples_apuracao_valores" CHECK ("fiscal_simples_apuracoes"."rbt12" >= 0 AND "fiscal_simples_apuracoes"."receita_bruta_mes" >= 0 AND "fiscal_simples_apuracoes"."folha_salarios_12m" >= 0 AND "fiscal_simples_apuracoes"."valor_total_das" >= 0),
	CONSTRAINT "chk_simples_apuracao_fator_r" CHECK ("fiscal_simples_apuracoes"."fator_r" IS NULL OR ("fiscal_simples_apuracoes"."fator_r" >= 0 AND "fiscal_simples_apuracoes"."fator_r" <= 9.9999))
);
--> statement-breakpoint
CREATE TABLE "fiscal_simples_faixas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"anexo_id" uuid NOT NULL,
	"faixa" integer NOT NULL,
	"rbt12_de" numeric(15, 2) NOT NULL,
	"rbt12_ate" numeric(15, 2) NOT NULL,
	"aliquota_nominal" numeric(7, 4) NOT NULL,
	"parcela_deduzir" numeric(15, 2) NOT NULL,
	"percentual_irpj" numeric(7, 4) DEFAULT '0' NOT NULL,
	"percentual_csll" numeric(7, 4) DEFAULT '0' NOT NULL,
	"percentual_cofins" numeric(7, 4) DEFAULT '0' NOT NULL,
	"percentual_pis" numeric(7, 4) DEFAULT '0' NOT NULL,
	"percentual_cpp" numeric(7, 4) DEFAULT '0' NOT NULL,
	"percentual_ipi" numeric(7, 4) DEFAULT '0' NOT NULL,
	"percentual_icms" numeric(7, 4) DEFAULT '0' NOT NULL,
	"percentual_iss" numeric(7, 4) DEFAULT '0' NOT NULL,
	CONSTRAINT "uq_simples_faixa_anexo" UNIQUE("anexo_id","faixa"),
	CONSTRAINT "chk_simples_faixa_num" CHECK ("fiscal_simples_faixas"."faixa" BETWEEN 1 AND 6),
	CONSTRAINT "chk_simples_faixa_limites" CHECK ("fiscal_simples_faixas"."rbt12_de" >= 0 AND "fiscal_simples_faixas"."rbt12_ate" >= "fiscal_simples_faixas"."rbt12_de"),
	CONSTRAINT "chk_simples_faixa_valores" CHECK ("fiscal_simples_faixas"."aliquota_nominal" >= 0 AND "fiscal_simples_faixas"."parcela_deduzir" >= 0),
	CONSTRAINT "chk_simples_faixa_partilha" CHECK ("fiscal_simples_faixas"."percentual_irpj" + "fiscal_simples_faixas"."percentual_csll" + "fiscal_simples_faixas"."percentual_cofins" + "fiscal_simples_faixas"."percentual_pis" + "fiscal_simples_faixas"."percentual_cpp" + "fiscal_simples_faixas"."percentual_ipi" + "fiscal_simples_faixas"."percentual_icms" + "fiscal_simples_faixas"."percentual_iss" = 1.0000)
);
--> statement-breakpoint
CREATE TABLE "fiscal_simples_historicos_mensais" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"competencia" date NOT NULL,
	"receita_bruta" numeric(15, 2),
	"folha_salarios_encargos" numeric(15, 2),
	"observacao" text,
	"informado_por" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_simples_historico_cliente_competencia" UNIQUE("cliente_id","competencia"),
	CONSTRAINT "chk_simples_historico_competencia" CHECK (date_part('day', "fiscal_simples_historicos_mensais"."competencia") = 1),
	CONSTRAINT "chk_simples_historico_preenchido" CHECK ("fiscal_simples_historicos_mensais"."receita_bruta" IS NOT NULL OR "fiscal_simples_historicos_mensais"."folha_salarios_encargos" IS NOT NULL),
	CONSTRAINT "chk_simples_historico_valores" CHECK (("fiscal_simples_historicos_mensais"."receita_bruta" IS NULL OR "fiscal_simples_historicos_mensais"."receita_bruta" >= 0) AND ("fiscal_simples_historicos_mensais"."folha_salarios_encargos" IS NULL OR "fiscal_simples_historicos_mensais"."folha_salarios_encargos" >= 0))
);
--> statement-breakpoint
CREATE TABLE "fiscal_simples_sublimites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"uf" varchar(2) NOT NULL,
	"ano_vigencia" integer NOT NULL,
	"valor_sublimite" numeric(15, 2) DEFAULT '3600000.00' NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	CONSTRAINT "uq_simples_sublimite_uf_ano" UNIQUE("uf","ano_vigencia"),
	CONSTRAINT "chk_simples_sublimite_uf" CHECK ("fiscal_simples_sublimites"."uf" ~ '^[A-Z]{2}$'),
	CONSTRAINT "chk_simples_sublimite_valor" CHECK ("fiscal_simples_sublimites"."ano_vigencia" >= 2018 AND "fiscal_simples_sublimites"."valor_sublimite" > 0)
);
--> statement-breakpoint
CREATE TABLE "fiscal_simples_tabelas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"versao" varchar(30) NOT NULL,
	"descricao" text NOT NULL,
	"vigencia_inicio" date NOT NULL,
	"vigencia_fim" date,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_simples_tabelas_versao" UNIQUE("versao"),
	CONSTRAINT "chk_simples_tabelas_vigencia" CHECK ("fiscal_simples_tabelas"."vigencia_fim" IS NULL OR "fiscal_simples_tabelas"."vigencia_fim" >= "fiscal_simples_tabelas"."vigencia_inicio")
);
--> statement-breakpoint
CREATE TABLE "folhas_pagamento" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"documento_id" uuid,
	"arquivo_key" text NOT NULL,
	"arquivo_nome" text NOT NULL,
	"tipo" text DEFAULT 'FOLHA_MENSAL' NOT NULL,
	"competencia" text NOT NULL,
	"periodo_inicio" date NOT NULL,
	"periodo_fim" date NOT NULL,
	"periodo_aquisitivo_inicio" date,
	"periodo_aquisitivo_fim" date,
	"dias_ferias" integer,
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
	CONSTRAINT "chk_folhas_tipo" CHECK ("folhas_pagamento"."tipo" IN ('FOLHA_MENSAL', 'FERIAS', 'ADIANTAMENTO_13')),
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
	"token_version" integer DEFAULT 0 NOT NULL,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_funcionarios_id_cliente" UNIQUE("id","cliente_id"),
	CONSTRAINT "chk_funcionarios_codigo" CHECK (btrim("funcionarios_rh"."codigo_funcionario") <> ''),
	CONSTRAINT "chk_funcionarios_nome" CHECK (btrim("funcionarios_rh"."nome_completo") <> ''),
	CONSTRAINT "chk_funcionarios_cpf" CHECK ("funcionarios_rh"."cpf" IS NULL OR "funcionarios_rh"."cpf" ~ '^[0-9]{11}$')
);
--> statement-breakpoint
CREATE TABLE "guias" (
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
	CONSTRAINT "uq_guias_identidade" UNIQUE NULLS NOT DISTINCT("cliente_id","tipo","periodo","numero_parcelamento"),
	CONSTRAINT "chk_guias_tipo" CHECK ("guias"."tipo" IN ('FGTS', 'DARF', 'DAS', 'DAS-COMPL', 'DAS-PARCSN', 'DAS-PGFN', 'INSS', 'ISS', 'ICMS', 'PIS', 'COFINS', 'CSLL', 'IRPJ', 'DAE', 'PGFN-SISPAR', 'TAXA-ASSISTENCIAL', 'OUTROS', 'FOLHA-PAGAMENTO')),
	CONSTRAINT "chk_guias_status" CHECK ("guias"."status" IN ('PENDENTE', 'PAGO')),
	CONSTRAINT "chk_guias_email_status" CHECK ("guias"."email_status" IN ('NAO_ENVIADO', 'PENDENTE', 'ENVIADO', 'FALHOU', 'SEM_EMAIL', 'SUSPENSO')),
	CONSTRAINT "chk_guias_periodo" CHECK ("guias"."periodo" ~ '^(0[1-9]|1[0-2])/[0-9]{4}$'),
	CONSTRAINT "chk_guias_arquivo_key" CHECK (btrim("guias"."arquivo_key") <> ''),
	CONSTRAINT "chk_guias_arquivo_nome" CHECK (btrim("guias"."arquivo_nome") <> ''),
	CONSTRAINT "chk_guias_valor" CHECK ("guias"."valor" IS NULL OR "guias"."valor" >= 0),
	CONSTRAINT "chk_guias_pagamento" CHECK (("guias"."status" = 'PENDENTE' AND "guias"."pago_em" IS NULL) OR ("guias"."status" = 'PAGO' AND "guias"."pago_em" IS NOT NULL)),
	CONSTRAINT "chk_guias_numero_parcelamento" CHECK ("guias"."numero_parcelamento" IS NULL OR btrim("guias"."numero_parcelamento") <> '')
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
CREATE TABLE "regras_fiscais" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid,
	"prioridade" integer DEFAULT 100 NOT NULL,
	"nome_regra" text NOT NULL,
	"tipo_operacao_origem" varchar(10),
	"cfop_origem" varchar(4),
	"ncm" varchar(8),
	"cst_icms_origem" varchar(3),
	"csosn_origem" varchar(4),
	"fornecedor_cnpj_cpf" text,
	"uf_origem" varchar(2),
	"destinacao_mercadoria" varchar(20),
	"cfop_destino" varchar(4) NOT NULL,
	"cst_icms_destino" varchar(3),
	"csosn_destino" varchar(4),
	"apropria_credito_icms" boolean DEFAULT false NOT NULL,
	"percentual_reducao_bc_icms" numeric(7, 4),
	"apropria_credito_ipi" boolean DEFAULT false NOT NULL,
	"apropria_credito_pis_cofins" boolean DEFAULT false NOT NULL,
	"cst_pis_destino" varchar(2),
	"cst_cofins_destino" varchar(2),
	"exige_ciap" boolean DEFAULT false NOT NULL,
	"exige_difal_entrada" boolean DEFAULT false NOT NULL,
	"observacao_fiscal" text,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chk_regras_fiscais_tipo_origem" CHECK ("regras_fiscais"."tipo_operacao_origem" IS NULL OR "regras_fiscais"."tipo_operacao_origem" IN ('ENTRADA', 'SAIDA')),
	CONSTRAINT "chk_regras_fiscais_destinacao" CHECK ("regras_fiscais"."destinacao_mercadoria" IS NULL OR "regras_fiscais"."destinacao_mercadoria" IN ('REVENDA', 'INDUSTRIALIZACAO', 'USO_CONSUMO', 'ATIVO_IMOBILIZADO')),
	CONSTRAINT "chk_regras_fiscais_prioridade" CHECK ("regras_fiscais"."prioridade" >= 0)
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
CREATE TABLE "visualizacoes_folhas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"folha_id" uuid NOT NULL,
	"user_id" text,
	"visualizado_em" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visualizacoes_guias" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guia_id" uuid NOT NULL,
	"user_id" text,
	"visualizado_em" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificados_digitais" ADD CONSTRAINT "certificados_digitais_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificados_digitais" ADD CONSTRAINT "certificados_digitais_uploadado_por_user_id_fk" FOREIGN KEY ("uploadado_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cfop_equivalencias" ADD CONSTRAINT "cfop_equivalencias_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cfop_equivalencias" ADD CONSTRAINT "cfop_equivalencias_cfop_origem_cfops_codigo_fk" FOREIGN KEY ("cfop_origem") REFERENCES "public"."cfops"("codigo") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cfop_equivalencias" ADD CONSTRAINT "cfop_equivalencias_cfop_destino_cfops_codigo_fk" FOREIGN KEY ("cfop_destino") REFERENCES "public"."cfops"("codigo") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ciap_apropriacoes" ADD CONSTRAINT "ciap_apropriacoes_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ciap_apropriacoes" ADD CONSTRAINT "ciap_apropriacoes_bem_id_ciap_ativo_permanente_id_fk" FOREIGN KEY ("bem_id") REFERENCES "public"."ciap_ativo_permanente"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ciap_apropriacoes" ADD CONSTRAINT "ciap_apropriacoes_movimento_id_ciap_movimentos_id_fk" FOREIGN KEY ("movimento_id") REFERENCES "public"."ciap_movimentos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ciap_ativo_permanente" ADD CONSTRAINT "ciap_ativo_permanente_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ciap_ativo_permanente" ADD CONSTRAINT "ciap_ativo_permanente_documento_fiscal_id_documentos_fiscais_id_fk" FOREIGN KEY ("documento_fiscal_id") REFERENCES "public"."documentos_fiscais"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ciap_ativo_permanente" ADD CONSTRAINT "ciap_ativo_permanente_documento_fiscal_item_id_documentos_fiscais_itens_id_fk" FOREIGN KEY ("documento_fiscal_item_id") REFERENCES "public"."documentos_fiscais_itens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ciap_competencias_apropriadas" ADD CONSTRAINT "ciap_competencias_apropriadas_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ciap_competencias_apropriadas" ADD CONSTRAINT "ciap_competencias_apropriadas_bem_id_ciap_ativo_permanente_id_fk" FOREIGN KEY ("bem_id") REFERENCES "public"."ciap_ativo_permanente"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ciap_movimentos" ADD CONSTRAINT "ciap_movimentos_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ciap_movimentos" ADD CONSTRAINT "ciap_movimentos_bem_id_ciap_ativo_permanente_id_fk" FOREIGN KEY ("bem_id") REFERENCES "public"."ciap_ativo_permanente"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ciap_movimentos" ADD CONSTRAINT "ciap_movimentos_documento_fiscal_id_documentos_fiscais_id_fk" FOREIGN KEY ("documento_fiscal_id") REFERENCES "public"."documentos_fiscais"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ciap_movimentos" ADD CONSTRAINT "ciap_movimentos_documento_fiscal_item_id_documentos_fiscais_itens_id_fk" FOREIGN KEY ("documento_fiscal_item_id") REFERENCES "public"."documentos_fiscais_itens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ciap_movimentos" ADD CONSTRAINT "ciap_movimentos_movimento_anterior_id_fk" FOREIGN KEY ("movimento_anterior_id") REFERENCES "public"."ciap_movimentos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classificacao_destinacao_aprendizado" ADD CONSTRAINT "classificacao_destinacao_aprendizado_item_id_documentos_fiscais_itens_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."documentos_fiscais_itens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classificacao_destinacao_aprendizado" ADD CONSTRAINT "classificacao_destinacao_aprendizado_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clientes" ADD CONSTRAINT "clientes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clientes" ADD CONSTRAINT "clientes_contador_id_contadores_id_fk" FOREIGN KEY ("contador_id") REFERENCES "public"."contadores"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contadores" ADD CONSTRAINT "contadores_atualizado_por_user_id_fk" FOREIGN KEY ("atualizado_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "controle_nsu" ADD CONSTRAINT "controle_nsu_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documentos_fiscais" ADD CONSTRAINT "documentos_fiscais_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documentos_fiscais_cte_escrituracao" ADD CONSTRAINT "documentos_fiscais_cte_escrituracao_documento_fiscal_id_documentos_fiscais_id_fk" FOREIGN KEY ("documento_fiscal_id") REFERENCES "public"."documentos_fiscais"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documentos_fiscais_cte_escrituracao" ADD CONSTRAINT "documentos_fiscais_cte_escrituracao_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documentos_fiscais_itens" ADD CONSTRAINT "fk_df_itens_documento_fiscal" FOREIGN KEY ("documento_fiscal_id") REFERENCES "public"."documentos_fiscais"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documentos_fiscais_itens" ADD CONSTRAINT "fk_df_itens_cliente" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eventos_auditoria" ADD CONSTRAINT "eventos_auditoria_ator_user_id_user_id_fk" FOREIGN KEY ("ator_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eventos_fiscais" ADD CONSTRAINT "eventos_fiscais_documento_fiscal_id_documentos_fiscais_id_fk" FOREIGN KEY ("documento_fiscal_id") REFERENCES "public"."documentos_fiscais"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_apuracoes_guias" ADD CONSTRAINT "fiscal_apuracoes_guias_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_apuracoes_guias" ADD CONSTRAINT "fiscal_apuracoes_guias_guia_upload_id_guias_id_fk" FOREIGN KEY ("guia_upload_id") REFERENCES "public"."guias"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_apuracoes_guias" ADD CONSTRAINT "fiscal_apuracoes_guias_fechamento_id_fiscal_fechamentos_id_fk" FOREIGN KEY ("fechamento_id") REFERENCES "public"."fiscal_fechamentos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_catalogos_versoes" ADD CONSTRAINT "fiscal_catalogos_versoes_aprovado_por_user_id_fk" FOREIGN KEY ("aprovado_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_decisoes_item" ADD CONSTRAINT "fiscal_decisoes_item_item_id_documentos_fiscais_itens_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."documentos_fiscais_itens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_decisoes_item" ADD CONSTRAINT "fiscal_decisoes_item_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_entregas" ADD CONSTRAINT "fiscal_entregas_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_entregas" ADD CONSTRAINT "fiscal_entregas_fechamento_id_fiscal_fechamentos_id_fk" FOREIGN KEY ("fechamento_id") REFERENCES "public"."fiscal_fechamentos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_entregas" ADD CONSTRAINT "fiscal_entregas_original_fk" FOREIGN KEY ("entrega_original_id") REFERENCES "public"."fiscal_entregas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_fechamentos" ADD CONSTRAINT "fiscal_fechamentos_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_fechamentos" ADD CONSTRAINT "fiscal_fechamentos_aprovado_por_user_id_fk" FOREIGN KEY ("aprovado_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_lancamentos" ADD CONSTRAINT "fiscal_lancamentos_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_lancamentos" ADD CONSTRAINT "fiscal_lancamentos_documento_fiscal_id_documentos_fiscais_id_fk" FOREIGN KEY ("documento_fiscal_id") REFERENCES "public"."documentos_fiscais"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_lancamentos" ADD CONSTRAINT "fiscal_lancamentos_documento_fiscal_item_id_documentos_fiscais_itens_id_fk" FOREIGN KEY ("documento_fiscal_item_id") REFERENCES "public"."documentos_fiscais_itens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_pagamentos_eventos" ADD CONSTRAINT "fiscal_pagamentos_eventos_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_pagamentos_eventos" ADD CONSTRAINT "fiscal_pagamentos_eventos_guia_id_fiscal_apuracoes_guias_id_fk" FOREIGN KEY ("guia_id") REFERENCES "public"."fiscal_apuracoes_guias"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_pagamentos_eventos" ADD CONSTRAINT "fiscal_pagamentos_eventos_fechamento_id_fiscal_fechamentos_id_fk" FOREIGN KEY ("fechamento_id") REFERENCES "public"."fiscal_fechamentos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_pagamentos_eventos" ADD CONSTRAINT "fiscal_pagamentos_eventos_estornado_fk" FOREIGN KEY ("evento_estornado_id") REFERENCES "public"."fiscal_pagamentos_eventos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_perfis_vigencia" ADD CONSTRAINT "fiscal_perfis_vigencia_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_regras_versoes" ADD CONSTRAINT "fiscal_regras_versoes_catalogo_versao_id_fiscal_catalogos_versoes_id_fk" FOREIGN KEY ("catalogo_versao_id") REFERENCES "public"."fiscal_catalogos_versoes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_regras_versoes" ADD CONSTRAINT "fiscal_regras_versoes_responsavel_por_user_id_fk" FOREIGN KEY ("responsavel_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_simples_anexos" ADD CONSTRAINT "fiscal_simples_anexos_tabela_id_fiscal_simples_tabelas_id_fk" FOREIGN KEY ("tabela_id") REFERENCES "public"."fiscal_simples_tabelas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_simples_apuracao_itens" ADD CONSTRAINT "fiscal_simples_apuracao_itens_apuracao_id_fiscal_simples_apuracoes_id_fk" FOREIGN KEY ("apuracao_id") REFERENCES "public"."fiscal_simples_apuracoes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_simples_apuracoes" ADD CONSTRAINT "fiscal_simples_apuracoes_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_simples_apuracoes" ADD CONSTRAINT "fiscal_simples_apuracoes_tabela_id_fiscal_simples_tabelas_id_fk" FOREIGN KEY ("tabela_id") REFERENCES "public"."fiscal_simples_tabelas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_simples_apuracoes" ADD CONSTRAINT "fiscal_simples_apuracoes_fechamento_id_fiscal_fechamentos_id_fk" FOREIGN KEY ("fechamento_id") REFERENCES "public"."fiscal_fechamentos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_simples_apuracoes" ADD CONSTRAINT "fiscal_simples_apuracoes_guia_id_fiscal_apuracoes_guias_id_fk" FOREIGN KEY ("guia_id") REFERENCES "public"."fiscal_apuracoes_guias"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_simples_faixas" ADD CONSTRAINT "fiscal_simples_faixas_anexo_id_fiscal_simples_anexos_id_fk" FOREIGN KEY ("anexo_id") REFERENCES "public"."fiscal_simples_anexos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_simples_historicos_mensais" ADD CONSTRAINT "fiscal_simples_historicos_mensais_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_simples_historicos_mensais" ADD CONSTRAINT "fiscal_simples_historicos_mensais_informado_por_user_id_fk" FOREIGN KEY ("informado_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folhas_pagamento" ADD CONSTRAINT "folhas_pagamento_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folhas_pagamento" ADD CONSTRAINT "folhas_pagamento_documento_id_guias_id_fk" FOREIGN KEY ("documento_id") REFERENCES "public"."guias"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folhas_pagamento" ADD CONSTRAINT "folhas_pagamento_uploadado_por_user_id_fk" FOREIGN KEY ("uploadado_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funcionarios_rh" ADD CONSTRAINT "funcionarios_rh_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guias" ADD CONSTRAINT "guias_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guias" ADD CONSTRAINT "guias_pagamento_confirmado_por_user_id_fk" FOREIGN KEY ("pagamento_confirmado_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itens_folha_pagamento" ADD CONSTRAINT "itens_folha_pagamento_folha_id_folhas_pagamento_id_fk" FOREIGN KEY ("folha_id") REFERENCES "public"."folhas_pagamento"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itens_folha_pagamento" ADD CONSTRAINT "itens_folha_pagamento_funcionario_id_funcionarios_rh_id_fk" FOREIGN KEY ("funcionario_id") REFERENCES "public"."funcionarios_rh"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itens_folha_pagamento" ADD CONSTRAINT "itens_folha_pagamento_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itens_folha_pagamento" ADD CONSTRAINT "fk_itens_folha_cliente" FOREIGN KEY ("folha_id","cliente_id") REFERENCES "public"."folhas_pagamento"("id","cliente_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itens_folha_pagamento" ADD CONSTRAINT "fk_itens_funcionario_cliente" FOREIGN KEY ("funcionario_id","cliente_id") REFERENCES "public"."funcionarios_rh"("id","cliente_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regras_fiscais" ADD CONSTRAINT "regras_fiscais_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regras_fiscais" ADD CONSTRAINT "regras_fiscais_cfop_destino_cfops_codigo_fk" FOREIGN KEY ("cfop_destino") REFERENCES "public"."cfops"("codigo") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "visualizacoes_folhas" ADD CONSTRAINT "visualizacoes_folhas_folha_id_folhas_pagamento_id_fk" FOREIGN KEY ("folha_id") REFERENCES "public"."folhas_pagamento"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visualizacoes_folhas" ADD CONSTRAINT "visualizacoes_folhas_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visualizacoes_guias" ADD CONSTRAINT "visualizacoes_guias_guia_id_guias_id_fk" FOREIGN KEY ("guia_id") REFERENCES "public"."guias"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visualizacoes_guias" ADD CONSTRAINT "visualizacoes_guias_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_account_provider_account" ON "account" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_account_user_provider" ON "account" USING btree ("user_id","provider_id");--> statement-breakpoint
CREATE INDEX "idx_certificados_cliente_id" ON "certificados_digitais" USING btree ("cliente_id");--> statement-breakpoint
CREATE INDEX "idx_certificados_cnpj" ON "certificados_digitais" USING btree ("cnpj");--> statement-breakpoint
CREATE INDEX "idx_certificados_status" ON "certificados_digitais" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_certificados_validade_fim" ON "certificados_digitais" USING btree ("validade_fim");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_certificados_cliente" ON "certificados_digitais" USING btree ("cliente_id");--> statement-breakpoint
CREATE INDEX "idx_cfop_eq_origem" ON "cfop_equivalencias" USING btree ("cfop_origem");--> statement-breakpoint
CREATE INDEX "idx_cfop_eq_cliente" ON "cfop_equivalencias" USING btree ("cliente_id");--> statement-breakpoint
CREATE INDEX "idx_cfops_tipo" ON "cfops" USING btree ("tipo_operacao");--> statement-breakpoint
CREATE INDEX "idx_cfops_abrangencia" ON "cfops" USING btree ("abrangencia");--> statement-breakpoint
CREATE INDEX "idx_cfops_categoria" ON "cfops" USING btree ("categoria_fiscal");--> statement-breakpoint
CREATE INDEX "idx_ciap_aprop_cliente" ON "ciap_apropriacoes" USING btree ("cliente_id");--> statement-breakpoint
CREATE INDEX "idx_ciap_aprop_bem" ON "ciap_apropriacoes" USING btree ("bem_id");--> statement-breakpoint
CREATE INDEX "idx_ciap_aprop_cliente_competencia" ON "ciap_apropriacoes" USING btree ("cliente_id","competencia");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_ciap_aprop_bem_competencia_versao" ON "ciap_apropriacoes" USING btree ("bem_id","competencia","versao");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_ciap_aprop_bem_competencia_ativa" ON "ciap_apropriacoes" USING btree ("bem_id","competencia") WHERE "ciap_apropriacoes"."ativa";--> statement-breakpoint
CREATE INDEX "idx_ciap_cliente" ON "ciap_ativo_permanente" USING btree ("cliente_id");--> statement-breakpoint
CREATE INDEX "idx_ciap_status" ON "ciap_ativo_permanente" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_ciap_cliente_codigo_bem" ON "ciap_ativo_permanente" USING btree ("cliente_id","codigo_bem");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_ciap_cliente_chave_aquisicao" ON "ciap_ativo_permanente" USING btree ("cliente_id","chave_aquisicao") WHERE "ciap_ativo_permanente"."chave_aquisicao" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_ciap_competencia_bem" ON "ciap_competencias_apropriadas" USING btree ("cliente_id","competencia","bem_id");--> statement-breakpoint
CREATE INDEX "idx_ciap_competencia_cliente" ON "ciap_competencias_apropriadas" USING btree ("cliente_id","competencia");--> statement-breakpoint
CREATE INDEX "idx_ciap_mov_cliente" ON "ciap_movimentos" USING btree ("cliente_id");--> statement-breakpoint
CREATE INDEX "idx_ciap_mov_bem" ON "ciap_movimentos" USING btree ("bem_id");--> statement-breakpoint
CREATE INDEX "idx_ciap_mov_bem_data" ON "ciap_movimentos" USING btree ("bem_id","data_movimento");--> statement-breakpoint
CREATE INDEX "idx_aprendizado_contexto" ON "classificacao_destinacao_aprendizado" USING btree ("cliente_id","fornecedor","codigo_produto","ncm");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_clientes_user_id" ON "clientes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_clientes_regime_tributario" ON "clientes" USING btree ("regime_tributario") WHERE "clientes"."regime_tributario" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_clientes_contador_id" ON "clientes" USING btree ("contador_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_contadores_cpf_crc" ON "contadores" USING btree ("cpf","crc") WHERE "contadores"."cpf" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_contadores_cnpj_crc" ON "contadores" USING btree ("cnpj","crc") WHERE "contadores"."cnpj" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_contadores_nome" ON "contadores" USING btree ("nome");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_controle_nsu_cliente_tipo" ON "controle_nsu" USING btree ("cliente_id","tipo_documento");--> statement-breakpoint
CREATE INDEX "idx_controle_nsu_cliente_id" ON "controle_nsu" USING btree ("cliente_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_docs_fiscais_cliente_chave" ON "documentos_fiscais" USING btree ("cliente_id","chave_acesso");--> statement-breakpoint
CREATE INDEX "idx_docs_fiscais_cliente_id" ON "documentos_fiscais" USING btree ("cliente_id");--> statement-breakpoint
CREATE INDEX "idx_docs_fiscais_tipo" ON "documentos_fiscais" USING btree ("tipo_documento");--> statement-breakpoint
CREATE INDEX "idx_docs_fiscais_data_emissao" ON "documentos_fiscais" USING btree ("data_emissao");--> statement-breakpoint
CREATE INDEX "idx_docs_fiscais_cliente_competencia" ON "documentos_fiscais" USING btree ("cliente_id","data_emissao_fiscal","id");--> statement-breakpoint
CREATE INDEX "idx_docs_fiscais_cliente_competencia_nfse" ON "documentos_fiscais" USING btree ("cliente_id","competencia_declarada","id");--> statement-breakpoint
CREATE INDEX "idx_docs_fiscais_nsu" ON "documentos_fiscais" USING btree ("nsu");--> statement-breakpoint
CREATE INDEX "idx_docs_fiscais_destinatario" ON "documentos_fiscais" USING btree ("destinatario_cnpj_cpf");--> statement-breakpoint
CREATE INDEX "idx_docs_fiscais_emitente" ON "documentos_fiscais" USING btree ("emitente_cnpj_cpf");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_cte_escrituracao_documento" ON "documentos_fiscais_cte_escrituracao" USING btree ("documento_fiscal_id");--> statement-breakpoint
CREATE INDEX "idx_cte_escrituracao_cliente" ON "documentos_fiscais_cte_escrituracao" USING btree ("cliente_id");--> statement-breakpoint
CREATE INDEX "idx_cte_escrituracao_cfop" ON "documentos_fiscais_cte_escrituracao" USING btree ("cfop");--> statement-breakpoint
CREATE INDEX "idx_cte_escrituracao_apuracao" ON "documentos_fiscais_cte_escrituracao" USING btree ("cliente_id","escrituravel","cfop");--> statement-breakpoint
CREATE INDEX "idx_cte_escrituracao_referencia" ON "documentos_fiscais_cte_escrituracao" USING btree ("chave_cte_referenciado");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_item_doc_num" ON "documentos_fiscais_itens" USING btree ("documento_fiscal_id","numero_item");--> statement-breakpoint
CREATE INDEX "idx_item_cliente_id" ON "documentos_fiscais_itens" USING btree ("cliente_id");--> statement-breakpoint
CREATE INDEX "idx_item_cfop" ON "documentos_fiscais_itens" USING btree ("cfop");--> statement-breakpoint
CREATE INDEX "idx_item_cfop_xml" ON "documentos_fiscais_itens" USING btree ("cfop_xml");--> statement-breakpoint
CREATE INDEX "idx_item_operacao_escriturada" ON "documentos_fiscais_itens" USING btree ("tipo_operacao_escriturada");--> statement-breakpoint
CREATE INDEX "idx_item_cst_icms" ON "documentos_fiscais_itens" USING btree ("cst_icms");--> statement-breakpoint
CREATE INDEX "idx_item_csosn_icms" ON "documentos_fiscais_itens" USING btree ("csosn_icms");--> statement-breakpoint
CREATE INDEX "idx_item_cst_pis" ON "documentos_fiscais_itens" USING btree ("cst_pis");--> statement-breakpoint
CREATE INDEX "idx_item_cst_cofins" ON "documentos_fiscais_itens" USING btree ("cst_cofins");--> statement-breakpoint
CREATE INDEX "idx_item_ncm" ON "documentos_fiscais_itens" USING btree ("ncm");--> statement-breakpoint
CREATE INDEX "idx_item_servico_lc116" ON "documentos_fiscais_itens" USING btree ("item_lista_servico");--> statement-breakpoint
CREATE INDEX "idx_item_cnae" ON "documentos_fiscais_itens" USING btree ("cnae");--> statement-breakpoint
CREATE INDEX "idx_eventos_auditoria_entidade" ON "eventos_auditoria" USING btree ("entidade_tipo","entidade_id","criado_em");--> statement-breakpoint
CREATE INDEX "idx_eventos_auditoria_ator" ON "eventos_auditoria" USING btree ("ator_user_id","criado_em");--> statement-breakpoint
CREATE INDEX "idx_eventos_fiscais_doc" ON "eventos_fiscais" USING btree ("documento_fiscal_id");--> statement-breakpoint
CREATE INDEX "idx_eventos_fiscais_tipo" ON "eventos_fiscais" USING btree ("tipo_evento");--> statement-breakpoint
CREATE INDEX "idx_eventos_fiscais_data" ON "eventos_fiscais" USING btree ("data_evento");--> statement-breakpoint
CREATE INDEX "idx_fiscal_guias_cliente_competencia" ON "fiscal_apuracoes_guias" USING btree ("cliente_id","competencia");--> statement-breakpoint
CREATE INDEX "idx_fiscal_guias_status" ON "fiscal_apuracoes_guias" USING btree ("status_pagamento");--> statement-breakpoint
CREATE INDEX "idx_fiscal_guias_fechamento" ON "fiscal_apuracoes_guias" USING btree ("fechamento_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_fiscal_guias_guia_upload" ON "fiscal_apuracoes_guias" USING btree ("guia_upload_id") WHERE "fiscal_apuracoes_guias"."guia_upload_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_fiscal_guias_cliente_idempotency" ON "fiscal_apuracoes_guias" USING btree ("cliente_id","idempotency_key") WHERE "fiscal_apuracoes_guias"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_fiscal_catalogo_vigencia" ON "fiscal_catalogos_versoes" USING btree ("tipo","uf","vigencia_inicio");--> statement-breakpoint
CREATE INDEX "idx_fiscal_catalogo_tipo_uf" ON "fiscal_catalogos_versoes" USING btree ("tipo","uf");--> statement-breakpoint
CREATE INDEX "idx_fiscal_decisoes_item_cliente" ON "fiscal_decisoes_item" USING btree ("cliente_id");--> statement-breakpoint
CREATE INDEX "idx_fiscal_entrega_competencia" ON "fiscal_entregas" USING btree ("cliente_id","competencia","obrigacao");--> statement-breakpoint
CREATE INDEX "idx_fiscal_entrega_fechamento" ON "fiscal_entregas" USING btree ("fechamento_id");--> statement-breakpoint
CREATE INDEX "idx_fiscal_entrega_original" ON "fiscal_entregas" USING btree ("entrega_original_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_fiscal_fechamento_versao" ON "fiscal_fechamentos" USING btree ("cliente_id","obrigacao","competencia","versao");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_fiscal_fechamento_corrente" ON "fiscal_fechamentos" USING btree ("cliente_id","obrigacao","competencia") WHERE "fiscal_fechamentos"."corrente" = true;--> statement-breakpoint
CREATE INDEX "idx_fiscal_fechamento_competencia" ON "fiscal_fechamentos" USING btree ("cliente_id","competencia","obrigacao");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_fiscal_lancamento_fato_versao" ON "fiscal_lancamentos" USING btree ("cliente_id","origem","fato_chave","fechamento_versao","tributo","natureza");--> statement-breakpoint
CREATE INDEX "idx_fiscal_lancamento_competencia" ON "fiscal_lancamentos" USING btree ("cliente_id","competencia","fechamento_versao");--> statement-breakpoint
CREATE INDEX "idx_fiscal_lancamento_documento" ON "fiscal_lancamentos" USING btree ("documento_fiscal_id");--> statement-breakpoint
CREATE INDEX "idx_fiscal_pagamento_evento_guia" ON "fiscal_pagamentos_eventos" USING btree ("guia_id","data_evento");--> statement-breakpoint
CREATE INDEX "idx_fiscal_pagamento_evento_fechamento" ON "fiscal_pagamentos_eventos" USING btree ("fechamento_id");--> statement-breakpoint
CREATE INDEX "idx_fiscal_pagamento_evento_cliente" ON "fiscal_pagamentos_eventos" USING btree ("cliente_id","data_evento");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_fiscal_perfil_vigencia" ON "fiscal_perfis_vigencia" USING btree ("cliente_id","uf","obrigacao","vigencia_inicio");--> statement-breakpoint
CREATE INDEX "idx_fiscal_perfil_lookup" ON "fiscal_perfis_vigencia" USING btree ("cliente_id","uf","obrigacao","vigencia_inicio");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_fiscal_regra_revisao" ON "fiscal_regras_versoes" USING btree ("catalogo_versao_id","chave","revisao");--> statement-breakpoint
CREATE INDEX "idx_fiscal_regra_lookup" ON "fiscal_regras_versoes" USING btree ("catalogo_versao_id","chave","vigencia_inicio");--> statement-breakpoint
CREATE INDEX "idx_simples_anexos_tabela" ON "fiscal_simples_anexos" USING btree ("tabela_id");--> statement-breakpoint
CREATE INDEX "idx_simples_apuracao_itens_apuracao" ON "fiscal_simples_apuracao_itens" USING btree ("apuracao_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_simples_apuracao_versao" ON "fiscal_simples_apuracoes" USING btree ("cliente_id","competencia","versao");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_simples_apuracao_corrente" ON "fiscal_simples_apuracoes" USING btree ("cliente_id","competencia") WHERE "fiscal_simples_apuracoes"."corrente" = true;--> statement-breakpoint
CREATE INDEX "idx_simples_apuracao_competencia" ON "fiscal_simples_apuracoes" USING btree ("cliente_id","competencia");--> statement-breakpoint
CREATE INDEX "idx_simples_faixas_anexo_rbt12" ON "fiscal_simples_faixas" USING btree ("anexo_id","rbt12_de","rbt12_ate");--> statement-breakpoint
CREATE INDEX "idx_simples_historico_cliente_competencia" ON "fiscal_simples_historicos_mensais" USING btree ("cliente_id","competencia");--> statement-breakpoint
CREATE INDEX "idx_simples_tabelas_vigencia" ON "fiscal_simples_tabelas" USING btree ("vigencia_inicio","vigencia_fim");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_folhas_cliente_competencia" ON "folhas_pagamento" USING btree ("cliente_id","competencia") WHERE "folhas_pagamento"."tipo" = 'FOLHA_MENSAL';--> statement-breakpoint
CREATE INDEX "idx_folhas_cliente_id" ON "folhas_pagamento" USING btree ("cliente_id");--> statement-breakpoint
CREATE INDEX "idx_folhas_competencia" ON "folhas_pagamento" USING btree ("competencia");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_funcionarios_cliente_codigo" ON "funcionarios_rh" USING btree ("cliente_id","codigo_funcionario");--> statement-breakpoint
CREATE INDEX "idx_funcionarios_cliente_id" ON "funcionarios_rh" USING btree ("cliente_id");--> statement-breakpoint
CREATE INDEX "idx_guias_cliente_id" ON "guias" USING btree ("cliente_id");--> statement-breakpoint
CREATE INDEX "idx_guias_tipo" ON "guias" USING btree ("tipo");--> statement-breakpoint
CREATE INDEX "idx_guias_periodo" ON "guias" USING btree ("periodo");--> statement-breakpoint
CREATE INDEX "idx_guias_status" ON "guias" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_guias_pagamento_confirmado_por" ON "guias" USING btree ("pagamento_confirmado_por");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_itens_folha_funcionario" ON "itens_folha_pagamento" USING btree ("folha_id","funcionario_id");--> statement-breakpoint
CREATE INDEX "idx_itens_folha_id" ON "itens_folha_pagamento" USING btree ("folha_id");--> statement-breakpoint
CREATE INDEX "idx_itens_funcionario_id" ON "itens_folha_pagamento" USING btree ("funcionario_id");--> statement-breakpoint
CREATE INDEX "idx_itens_cliente_id" ON "itens_folha_pagamento" USING btree ("cliente_id");--> statement-breakpoint
CREATE INDEX "idx_regras_fiscais_cliente" ON "regras_fiscais" USING btree ("cliente_id");--> statement-breakpoint
CREATE INDEX "idx_regras_fiscais_match" ON "regras_fiscais" USING btree ("tipo_operacao_origem","cfop_origem","prioridade");--> statement-breakpoint
CREATE INDEX "idx_regras_fiscais_ncm" ON "regras_fiscais" USING btree ("ncm");--> statement-breakpoint
CREATE INDEX "idx_sped_ajuste_cliente_competencia" ON "sped_ajustes_apuracao" USING btree ("cliente_id","competencia");--> statement-breakpoint
CREATE INDEX "idx_sped_arquivo_cliente_competencia" ON "sped_arquivos_gerados" USING btree ("cliente_id","competencia","criado_em");--> statement-breakpoint
CREATE INDEX "idx_sped_arquivo_status" ON "sped_arquivos_gerados" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_sped_config_cliente" ON "sped_configuracoes" USING btree ("cliente_id");--> statement-breakpoint
CREATE INDEX "idx_sped_contabilista_cliente" ON "sped_contabilistas" USING btree ("cliente_id");--> statement-breakpoint
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
CREATE INDEX "idx_storage_cleanup_status_criado_em" ON "storage_cleanup_jobs" USING btree ("status","criado_em");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_verification_identifier" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_verification_value" ON "verification" USING btree ("value");--> statement-breakpoint
CREATE INDEX "idx_visualizacoes_folha" ON "visualizacoes_folhas" USING btree ("folha_id");--> statement-breakpoint
CREATE INDEX "idx_visualizacoes_folha_user" ON "visualizacoes_folhas" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_visualizacoes_guia" ON "visualizacoes_guias" USING btree ("guia_id");--> statement-breakpoint
CREATE INDEX "idx_visualizacoes_guia_user" ON "visualizacoes_guias" USING btree ("user_id");