CREATE TABLE "financeiro_baixas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fatura_id" uuid NOT NULL,
	"valor_recebido" numeric(12, 2) NOT NULL,
	"data_pagamento" date NOT NULL,
	"forma_pagamento" varchar(20) NOT NULL,
	"valor_multa" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"valor_juros" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"valor_desconto" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"comprovante_key" text,
	"comprovante_nome" text,
	"observacao" text,
	"registrado_por" text,
	"estornado" boolean DEFAULT false NOT NULL,
	"estornado_em" timestamp,
	"estornado_por" text,
	"motivo_estorno" text,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chk_fin_baixas_valor_recebido" CHECK ("financeiro_baixas"."valor_recebido" > 0),
	CONSTRAINT "chk_fin_baixas_acrescimos_desconto" CHECK ("financeiro_baixas"."valor_multa" >= 0 AND "financeiro_baixas"."valor_juros" >= 0 AND "financeiro_baixas"."valor_desconto" >= 0),
	CONSTRAINT "chk_fin_baixas_forma_pagamento" CHECK ("financeiro_baixas"."forma_pagamento" IN ('PIX', 'BOLETO', 'TRANSFERENCIA', 'DINHEIRO', 'CARTAO', 'OUTROS')),
	CONSTRAINT "chk_fin_baixas_estorno_coerencia" CHECK (("financeiro_baixas"."estornado" = false AND "financeiro_baixas"."estornado_em" IS NULL AND "financeiro_baixas"."estornado_por" IS NULL) OR ("financeiro_baixas"."estornado" = true AND "financeiro_baixas"."estornado_em" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "financeiro_contratos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"valor_mensalidade" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"dia_vencimento" integer DEFAULT 10 NOT NULL,
	"dia_fechamento" integer DEFAULT 25 NOT NULL,
	"gera_13o" boolean DEFAULT true NOT NULL,
	"mes_13o" integer DEFAULT 12 NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"observacoes" text,
	"atualizado_por" text,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chk_fin_contratos_valor" CHECK ("financeiro_contratos"."valor_mensalidade" >= 0),
	CONSTRAINT "chk_fin_contratos_dia_vencimento" CHECK ("financeiro_contratos"."dia_vencimento" BETWEEN 1 AND 31),
	CONSTRAINT "chk_fin_contratos_dia_fechamento" CHECK ("financeiro_contratos"."dia_fechamento" BETWEEN 1 AND 31),
	CONSTRAINT "chk_fin_contratos_mes_13o" CHECK ("financeiro_contratos"."mes_13o" BETWEEN 1 AND 12)
);
--> statement-breakpoint
CREATE TABLE "financeiro_faturas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"numero" varchar(40) NOT NULL,
	"cliente_id" uuid NOT NULL,
	"competencia" varchar(7) NOT NULL,
	"data_emissao" date NOT NULL,
	"data_vencimento" date NOT NULL,
	"valor_bruto" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"valor_descontos" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"valor_acrescimos" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"valor_liquido" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"valor_pago" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"status" varchar(20) DEFAULT 'PENDENTE' NOT NULL,
	"pix_copia_e_cola" text,
	"linha_digitavel" text,
	"observacoes" text,
	"criado_por" text,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chk_fin_faturas_competencia" CHECK ("financeiro_faturas"."competencia" ~ '^(0[1-9]|1[0-2])/[0-9]{4}$'),
	CONSTRAINT "chk_fin_faturas_status" CHECK ("financeiro_faturas"."status" IN ('PENDENTE', 'PARCIALMENTE_PAGA', 'PAGA', 'VENCIDA', 'CANCELADA')),
	CONSTRAINT "chk_fin_faturas_valores" CHECK ("financeiro_faturas"."valor_bruto" >= 0 AND "financeiro_faturas"."valor_descontos" >= 0 AND "financeiro_faturas"."valor_acrescimos" >= 0 AND "financeiro_faturas"."valor_liquido" >= 0 AND "financeiro_faturas"."valor_pago" >= 0)
);
--> statement-breakpoint
CREATE TABLE "financeiro_lancamentos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"tipo_lancamento_id" uuid NOT NULL,
	"fatura_id" uuid,
	"competencia" varchar(7) NOT NULL,
	"descricao" text NOT NULL,
	"natureza" varchar(10) DEFAULT 'DEBITO' NOT NULL,
	"valor" numeric(12, 2) NOT NULL,
	"data_lancamento" date NOT NULL,
	"status" varchar(20) DEFAULT 'PENDENTE' NOT NULL,
	"criado_por" text,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chk_fin_lanc_competencia" CHECK ("financeiro_lancamentos"."competencia" ~ '^(0[1-9]|1[0-2])/[0-9]{4}$'),
	CONSTRAINT "chk_fin_lanc_natureza" CHECK ("financeiro_lancamentos"."natureza" IN ('DEBITO', 'CREDITO')),
	CONSTRAINT "chk_fin_lanc_valor" CHECK ("financeiro_lancamentos"."valor" > 0),
	CONSTRAINT "chk_fin_lanc_status" CHECK ("financeiro_lancamentos"."status" IN ('PENDENTE', 'FATURADO', 'CANCELADO')),
	CONSTRAINT "chk_fin_lanc_descricao" CHECK (btrim("financeiro_lancamentos"."descricao") <> '')
);
--> statement-breakpoint
CREATE TABLE "financeiro_tipos_lancamento" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"codigo" varchar(50) NOT NULL,
	"nome" varchar(150) NOT NULL,
	"descricao" text,
	"natureza" varchar(10) DEFAULT 'DEBITO' NOT NULL,
	"valor_padrao" numeric(12, 2),
	"permite_avulso" boolean DEFAULT true NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chk_fin_tipos_natureza" CHECK ("financeiro_tipos_lancamento"."natureza" IN ('DEBITO', 'CREDITO')),
	CONSTRAINT "chk_fin_tipos_valor_padrao" CHECK ("financeiro_tipos_lancamento"."valor_padrao" IS NULL OR "financeiro_tipos_lancamento"."valor_padrao" >= 0)
);
--> statement-breakpoint
ALTER TABLE "financeiro_baixas" ADD CONSTRAINT "financeiro_baixas_fatura_id_financeiro_faturas_id_fk" FOREIGN KEY ("fatura_id") REFERENCES "public"."financeiro_faturas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financeiro_baixas" ADD CONSTRAINT "financeiro_baixas_registrado_por_user_id_fk" FOREIGN KEY ("registrado_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financeiro_baixas" ADD CONSTRAINT "financeiro_baixas_estornado_por_user_id_fk" FOREIGN KEY ("estornado_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financeiro_contratos" ADD CONSTRAINT "financeiro_contratos_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financeiro_contratos" ADD CONSTRAINT "financeiro_contratos_atualizado_por_user_id_fk" FOREIGN KEY ("atualizado_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financeiro_faturas" ADD CONSTRAINT "financeiro_faturas_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financeiro_faturas" ADD CONSTRAINT "financeiro_faturas_criado_por_user_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financeiro_lancamentos" ADD CONSTRAINT "financeiro_lancamentos_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financeiro_lancamentos" ADD CONSTRAINT "financeiro_lancamentos_fatura_id_financeiro_faturas_id_fk" FOREIGN KEY ("fatura_id") REFERENCES "public"."financeiro_faturas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financeiro_lancamentos" ADD CONSTRAINT "financeiro_lancamentos_criado_por_user_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financeiro_lancamentos" ADD CONSTRAINT "fin_lanc_tipo_lancamento_id_fk" FOREIGN KEY ("tipo_lancamento_id") REFERENCES "public"."financeiro_tipos_lancamento"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_fin_baixas_fatura_id" ON "financeiro_baixas" USING btree ("fatura_id");--> statement-breakpoint
CREATE INDEX "idx_fin_baixas_data_pagamento" ON "financeiro_baixas" USING btree ("data_pagamento");--> statement-breakpoint
CREATE INDEX "idx_fin_baixas_estornado" ON "financeiro_baixas" USING btree ("estornado");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_fin_contratos_cliente" ON "financeiro_contratos" USING btree ("cliente_id");--> statement-breakpoint
CREATE INDEX "idx_fin_contratos_ativo" ON "financeiro_contratos" USING btree ("ativo");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_fin_faturas_numero" ON "financeiro_faturas" USING btree ("numero");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_fin_faturas_cliente_competencia" ON "financeiro_faturas" USING btree ("cliente_id","competencia") WHERE "financeiro_faturas"."status" <> 'CANCELADA';--> statement-breakpoint
CREATE INDEX "idx_fin_faturas_cliente_id" ON "financeiro_faturas" USING btree ("cliente_id");--> statement-breakpoint
CREATE INDEX "idx_fin_faturas_competencia" ON "financeiro_faturas" USING btree ("competencia");--> statement-breakpoint
CREATE INDEX "idx_fin_faturas_status" ON "financeiro_faturas" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_fin_faturas_vencimento" ON "financeiro_faturas" USING btree ("data_vencimento");--> statement-breakpoint
CREATE INDEX "idx_fin_lanc_cliente_id" ON "financeiro_lancamentos" USING btree ("cliente_id");--> statement-breakpoint
CREATE INDEX "idx_fin_lanc_fatura_id" ON "financeiro_lancamentos" USING btree ("fatura_id");--> statement-breakpoint
CREATE INDEX "idx_fin_lanc_competencia" ON "financeiro_lancamentos" USING btree ("competencia");--> statement-breakpoint
CREATE INDEX "idx_fin_lanc_status" ON "financeiro_lancamentos" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_fin_tipos_codigo" ON "financeiro_tipos_lancamento" USING btree ("codigo");--> statement-breakpoint
CREATE INDEX "idx_fin_tipos_ativo" ON "financeiro_tipos_lancamento" USING btree ("ativo");