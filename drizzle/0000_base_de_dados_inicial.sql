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
	CONSTRAINT "chk_certificados_cnpj" CHECK ("certificados_digitais"."cnpj" ~ '^[0-9]{14}$'),
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
	CONSTRAINT "chk_clientes_documento_por_tipo" CHECK (("clientes"."tipo_pessoa" = 'PJ' AND "clientes"."cnpj" ~ '^[0-9]{14}$' AND "clientes"."cpf" IS NULL) OR ("clientes"."tipo_pessoa" = 'PF' AND "clientes"."cnpj" ~ '^[0-9]{11}$' AND "clientes"."cpf" = "clientes"."cnpj"))
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
	"valor_total" numeric(14, 2) NOT NULL,
	"situacao" text DEFAULT 'AUTORIZADA' NOT NULL,
	"manifestacao_status" text DEFAULT 'SEM_MANIFESTACAO' NOT NULL,
	"tipo_operacao_escriturada" varchar(10) DEFAULT 'ENTRADA' NOT NULL,
	"tp_nf_xml" varchar(1),
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
	CONSTRAINT "chk_docs_fiscais_valor" CHECK ("documentos_fiscais"."valor_total" >= 0),
	CONSTRAINT "chk_docs_fiscais_xml_key" CHECK (btrim("documentos_fiscais"."xml_key") <> '')
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
CREATE INDEX "idx_docs_fiscais_nsu" ON "documentos_fiscais" USING btree ("nsu");--> statement-breakpoint
CREATE INDEX "idx_docs_fiscais_destinatario" ON "documentos_fiscais" USING btree ("destinatario_cnpj_cpf");--> statement-breakpoint
CREATE INDEX "idx_docs_fiscais_emitente" ON "documentos_fiscais" USING btree ("emitente_cnpj_cpf");--> statement-breakpoint
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
CREATE INDEX "idx_storage_cleanup_status_criado_em" ON "storage_cleanup_jobs" USING btree ("status","criado_em");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_verification_identifier" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_verification_value" ON "verification" USING btree ("value");--> statement-breakpoint
CREATE INDEX "idx_visualizacoes_folha" ON "visualizacoes_folhas" USING btree ("folha_id");--> statement-breakpoint
CREATE INDEX "idx_visualizacoes_folha_user" ON "visualizacoes_folhas" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_visualizacoes_guia" ON "visualizacoes_guias" USING btree ("guia_id");--> statement-breakpoint
CREATE INDEX "idx_visualizacoes_guia_user" ON "visualizacoes_guias" USING btree ("user_id");