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
	"descricao_detalhada" text,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chk_cfops_codigo" CHECK ("cfops"."codigo" ~ '^[123567][0-9]{3}$'),
	CONSTRAINT "chk_cfops_tipo" CHECK ("cfops"."tipo_operacao" IN ('ENTRADA', 'SAIDA')),
	CONSTRAINT "chk_cfops_abrangencia" CHECK ("cfops"."abrangencia" IN ('ESTADUAL', 'INTERESTADUAL', 'EXTERIOR'))
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
	"user_id" text,
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
	CONSTRAINT "chk_clientes_documento_por_tipo" CHECK (("clientes"."tipo_pessoa" = 'PJ' AND "clientes"."cnpj" ~ '^[0-9A-Z]{12}[0-9]{2}$' AND "clientes"."cpf" IS NULL) OR ("clientes"."tipo_pessoa" = 'PF' AND "clientes"."cnpj" ~ '^[0-9]{11}$' AND "clientes"."cpf" = "clientes"."cnpj"))
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
	CONSTRAINT "chk_docs_fiscais_chave" CHECK (length("documentos_fiscais"."chave_acesso") = 44),
	CONSTRAINT "chk_docs_fiscais_tipo" CHECK ("documentos_fiscais"."tipo_documento" IN ('NFE', 'CTE', 'NFCE')),
	CONSTRAINT "chk_docs_fiscais_modelo" CHECK ("documentos_fiscais"."modelo" IN ('55', '57', '65')),
	CONSTRAINT "chk_docs_fiscais_tipo_modelo" CHECK (("documentos_fiscais"."tipo_documento" = 'NFE' AND "documentos_fiscais"."modelo" = '55') OR ("documentos_fiscais"."tipo_documento" = 'CTE' AND "documentos_fiscais"."modelo" = '57') OR ("documentos_fiscais"."tipo_documento" = 'NFCE' AND "documentos_fiscais"."modelo" = '65')),
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
	CONSTRAINT "chk_cte_escrituracao_operacao" CHECK ("documentos_fiscais_cte_escrituracao"."tipo_operacao_escriturada" = 'ENTRADA'),
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
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chk_item_numero" CHECK ("documentos_fiscais_itens"."numero_item" BETWEEN 1 AND 990),
	CONSTRAINT "chk_item_ind_escala" CHECK ("documentos_fiscais_itens"."ind_escala" IS NULL OR "documentos_fiscais_itens"."ind_escala" IN ('S', 'N')),
	CONSTRAINT "chk_item_ind_total" CHECK ("documentos_fiscais_itens"."ind_total" IN ('0', '1')),
	CONSTRAINT "chk_item_origem" CHECK ("documentos_fiscais_itens"."origem_mercadoria" IS NULL OR "documentos_fiscais_itens"."origem_mercadoria" ~ '^[0-8]$'),
	CONSTRAINT "chk_item_cfop" CHECK ("documentos_fiscais_itens"."cfop" ~ '^[1-7][0-9]{3}$'),
	CONSTRAINT "chk_item_cfop_xml" CHECK ("documentos_fiscais_itens"."cfop_xml" IS NULL OR "documentos_fiscais_itens"."cfop_xml" ~ '^[1-7][0-9]{3}$'),
	CONSTRAINT "chk_item_operacao_escriturada" CHECK ("documentos_fiscais_itens"."tipo_operacao_escriturada" IN ('ENTRADA', 'SAIDA'))
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
	CONSTRAINT "chk_guias_email_status" CHECK ("guias"."email_status" IN ('NAO_ENVIADO', 'PENDENTE', 'ENVIADO', 'FALHOU', 'SEM_EMAIL')),
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
ALTER TABLE "clientes" ADD CONSTRAINT "clientes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "controle_nsu" ADD CONSTRAINT "controle_nsu_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documentos_fiscais" ADD CONSTRAINT "documentos_fiscais_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documentos_fiscais_cte_escrituracao" ADD CONSTRAINT "documentos_fiscais_cte_escrituracao_documento_fiscal_id_documentos_fiscais_id_fk" FOREIGN KEY ("documento_fiscal_id") REFERENCES "public"."documentos_fiscais"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documentos_fiscais_cte_escrituracao" ADD CONSTRAINT "documentos_fiscais_cte_escrituracao_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documentos_fiscais_itens" ADD CONSTRAINT "fk_df_itens_documento_fiscal" FOREIGN KEY ("documento_fiscal_id") REFERENCES "public"."documentos_fiscais"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documentos_fiscais_itens" ADD CONSTRAINT "fk_df_itens_cliente" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eventos_auditoria" ADD CONSTRAINT "eventos_auditoria_ator_user_id_user_id_fk" FOREIGN KEY ("ator_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eventos_fiscais" ADD CONSTRAINT "eventos_fiscais_documento_fiscal_id_documentos_fiscais_id_fk" FOREIGN KEY ("documento_fiscal_id") REFERENCES "public"."documentos_fiscais"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
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
CREATE UNIQUE INDEX "uidx_certificados_cliente_ativo" ON "certificados_digitais" USING btree ("cliente_id") WHERE status IN ('ATIVO', 'PRESTES_A_EXPIRAR');--> statement-breakpoint
CREATE INDEX "idx_cfop_eq_origem" ON "cfop_equivalencias" USING btree ("cfop_origem");--> statement-breakpoint
CREATE INDEX "idx_cfop_eq_cliente" ON "cfop_equivalencias" USING btree ("cliente_id");--> statement-breakpoint
CREATE INDEX "idx_cfops_tipo" ON "cfops" USING btree ("tipo_operacao");--> statement-breakpoint
CREATE INDEX "idx_cfops_abrangencia" ON "cfops" USING btree ("abrangencia");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_clientes_user_id" ON "clientes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_clientes_regime_tributario" ON "clientes" USING btree ("regime_tributario") WHERE "clientes"."regime_tributario" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_controle_nsu_cliente_tipo" ON "controle_nsu" USING btree ("cliente_id","tipo_documento");--> statement-breakpoint
CREATE INDEX "idx_controle_nsu_cliente_id" ON "controle_nsu" USING btree ("cliente_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_docs_fiscais_cliente_chave" ON "documentos_fiscais" USING btree ("cliente_id","chave_acesso");--> statement-breakpoint
CREATE INDEX "idx_docs_fiscais_cliente_id" ON "documentos_fiscais" USING btree ("cliente_id");--> statement-breakpoint
CREATE INDEX "idx_docs_fiscais_tipo" ON "documentos_fiscais" USING btree ("tipo_documento");--> statement-breakpoint
CREATE INDEX "idx_docs_fiscais_data_emissao" ON "documentos_fiscais" USING btree ("data_emissao");--> statement-breakpoint
CREATE INDEX "idx_docs_fiscais_cliente_competencia" ON "documentos_fiscais" USING btree ("cliente_id","data_emissao_fiscal","id");--> statement-breakpoint
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
CREATE INDEX "idx_eventos_auditoria_entidade" ON "eventos_auditoria" USING btree ("entidade_tipo","entidade_id","criado_em");--> statement-breakpoint
CREATE INDEX "idx_eventos_auditoria_ator" ON "eventos_auditoria" USING btree ("ator_user_id","criado_em");--> statement-breakpoint
CREATE INDEX "idx_eventos_fiscais_doc" ON "eventos_fiscais" USING btree ("documento_fiscal_id");--> statement-breakpoint
CREATE INDEX "idx_eventos_fiscais_tipo" ON "eventos_fiscais" USING btree ("tipo_evento");--> statement-breakpoint
CREATE INDEX "idx_eventos_fiscais_data" ON "eventos_fiscais" USING btree ("data_evento");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_folhas_cliente_competencia" ON "folhas_pagamento" USING btree ("cliente_id","competencia");--> statement-breakpoint
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
CREATE INDEX "idx_storage_cleanup_status_criado_em" ON "storage_cleanup_jobs" USING btree ("status","criado_em");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_verification_identifier" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_verification_value" ON "verification" USING btree ("value");--> statement-breakpoint
CREATE INDEX "idx_visualizacoes_folha" ON "visualizacoes_folhas" USING btree ("folha_id");--> statement-breakpoint
CREATE INDEX "idx_visualizacoes_folha_user" ON "visualizacoes_folhas" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_visualizacoes_guia" ON "visualizacoes_guias" USING btree ("guia_id");--> statement-breakpoint
CREATE INDEX "idx_visualizacoes_guia_user" ON "visualizacoes_guias" USING btree ("user_id");