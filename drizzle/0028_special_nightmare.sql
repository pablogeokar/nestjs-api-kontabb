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
ALTER TABLE "fiscal_simples_anexos" ADD CONSTRAINT "fiscal_simples_anexos_tabela_id_fiscal_simples_tabelas_id_fk" FOREIGN KEY ("tabela_id") REFERENCES "public"."fiscal_simples_tabelas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_simples_apuracao_itens" ADD CONSTRAINT "fiscal_simples_apuracao_itens_apuracao_id_fiscal_simples_apuracoes_id_fk" FOREIGN KEY ("apuracao_id") REFERENCES "public"."fiscal_simples_apuracoes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_simples_apuracoes" ADD CONSTRAINT "fiscal_simples_apuracoes_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_simples_apuracoes" ADD CONSTRAINT "fiscal_simples_apuracoes_tabela_id_fiscal_simples_tabelas_id_fk" FOREIGN KEY ("tabela_id") REFERENCES "public"."fiscal_simples_tabelas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_simples_apuracoes" ADD CONSTRAINT "fiscal_simples_apuracoes_fechamento_id_fiscal_fechamentos_id_fk" FOREIGN KEY ("fechamento_id") REFERENCES "public"."fiscal_fechamentos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_simples_apuracoes" ADD CONSTRAINT "fiscal_simples_apuracoes_guia_id_fiscal_apuracoes_guias_id_fk" FOREIGN KEY ("guia_id") REFERENCES "public"."fiscal_apuracoes_guias"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_simples_faixas" ADD CONSTRAINT "fiscal_simples_faixas_anexo_id_fiscal_simples_anexos_id_fk" FOREIGN KEY ("anexo_id") REFERENCES "public"."fiscal_simples_anexos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_simples_anexos_tabela" ON "fiscal_simples_anexos" USING btree ("tabela_id");--> statement-breakpoint
CREATE INDEX "idx_simples_apuracao_itens_apuracao" ON "fiscal_simples_apuracao_itens" USING btree ("apuracao_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_simples_apuracao_versao" ON "fiscal_simples_apuracoes" USING btree ("cliente_id","competencia","versao");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_simples_apuracao_corrente" ON "fiscal_simples_apuracoes" USING btree ("cliente_id","competencia") WHERE "fiscal_simples_apuracoes"."corrente" = true;--> statement-breakpoint
CREATE INDEX "idx_simples_apuracao_competencia" ON "fiscal_simples_apuracoes" USING btree ("cliente_id","competencia");--> statement-breakpoint
CREATE INDEX "idx_simples_faixas_anexo_rbt12" ON "fiscal_simples_faixas" USING btree ("anexo_id","rbt12_de","rbt12_ate");--> statement-breakpoint
CREATE INDEX "idx_simples_tabelas_vigencia" ON "fiscal_simples_tabelas" USING btree ("vigencia_inicio","vigencia_fim");