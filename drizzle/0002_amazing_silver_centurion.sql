CREATE TABLE "ciap_ativo_permanente" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"documento_fiscal_id" uuid,
	"documento_fiscal_item_id" uuid,
	"codigo_bem" varchar(60) NOT NULL,
	"identificacao_bem" text NOT NULL,
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
	CONSTRAINT "chk_ciap_parcelas" CHECK ("ciap_ativo_permanente"."quantidade_parcelas" > 0 AND "ciap_ativo_permanente"."parcelas_apropriadas" >= 0 AND "ciap_ativo_permanente"."parcelas_apropriadas" <= "ciap_ativo_permanente"."quantidade_parcelas"),
	CONSTRAINT "chk_ciap_motivo_baixa" CHECK ("ciap_ativo_permanente"."motivo_baixa" IS NULL OR "ciap_ativo_permanente"."motivo_baixa" IN ('01', '02', '03'))
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
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chk_fiscal_guias_tributo" CHECK ("fiscal_apuracoes_guias"."tributo" IN ('ICMS_PROPRIO', 'ICMS_ST', 'DIFAL_ENTRADA', 'DIFAL_SAIDA', 'FCP', 'IPI', 'PIS', 'COFINS', 'DAS_SIMPLES')),
	CONSTRAINT "chk_fiscal_guias_tipo" CHECK ("fiscal_apuracoes_guias"."tipo_guia" IN ('DAE', 'GNRE', 'DARF', 'DAS')),
	CONSTRAINT "chk_fiscal_guias_status" CHECK ("fiscal_apuracoes_guias"."status_pagamento" IN ('PENDENTE', 'PAGO', 'VENCIDO')),
	CONSTRAINT "chk_fiscal_guias_uf" CHECK ("fiscal_apuracoes_guias"."uf_favorecida" ~ '^[A-Z]{2}$')
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
ALTER TABLE "cfops" ADD COLUMN "categoria_fiscal" varchar(30) DEFAULT 'OUTRAS' NOT NULL;--> statement-breakpoint
ALTER TABLE "cfops" ADD COLUMN "gera_credito_icms_padrao" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ciap_ativo_permanente" ADD CONSTRAINT "ciap_ativo_permanente_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ciap_ativo_permanente" ADD CONSTRAINT "ciap_ativo_permanente_documento_fiscal_id_documentos_fiscais_id_fk" FOREIGN KEY ("documento_fiscal_id") REFERENCES "public"."documentos_fiscais"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ciap_ativo_permanente" ADD CONSTRAINT "ciap_ativo_permanente_documento_fiscal_item_id_documentos_fiscais_itens_id_fk" FOREIGN KEY ("documento_fiscal_item_id") REFERENCES "public"."documentos_fiscais_itens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_apuracoes_guias" ADD CONSTRAINT "fiscal_apuracoes_guias_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regras_fiscais" ADD CONSTRAINT "regras_fiscais_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regras_fiscais" ADD CONSTRAINT "regras_fiscais_cfop_destino_cfops_codigo_fk" FOREIGN KEY ("cfop_destino") REFERENCES "public"."cfops"("codigo") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ciap_cliente" ON "ciap_ativo_permanente" USING btree ("cliente_id");--> statement-breakpoint
CREATE INDEX "idx_ciap_status" ON "ciap_ativo_permanente" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_ciap_cliente_codigo_bem" ON "ciap_ativo_permanente" USING btree ("cliente_id","codigo_bem");--> statement-breakpoint
CREATE INDEX "idx_fiscal_guias_cliente_competencia" ON "fiscal_apuracoes_guias" USING btree ("cliente_id","competencia");--> statement-breakpoint
CREATE INDEX "idx_fiscal_guias_status" ON "fiscal_apuracoes_guias" USING btree ("status_pagamento");--> statement-breakpoint
CREATE INDEX "idx_regras_fiscais_cliente" ON "regras_fiscais" USING btree ("cliente_id");--> statement-breakpoint
CREATE INDEX "idx_regras_fiscais_match" ON "regras_fiscais" USING btree ("tipo_operacao_origem","cfop_origem","prioridade");--> statement-breakpoint
CREATE INDEX "idx_regras_fiscais_ncm" ON "regras_fiscais" USING btree ("ncm");--> statement-breakpoint
CREATE INDEX "idx_cfops_categoria" ON "cfops" USING btree ("categoria_fiscal");--> statement-breakpoint
ALTER TABLE "cfops" ADD CONSTRAINT "chk_cfops_categoria" CHECK ("cfops"."categoria_fiscal" IN ('COMPRA_REVENDA', 'COMPRA_INSUMO', 'USO_CONSUMO', 'ATIVO_IMOBILIZADO', 'DEVOLUCAO', 'TRANSFERENCIA', 'REMESSA_RETORNO', 'PRESTACAO_SERVICO', 'OUTRAS'));