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
ALTER TABLE "fiscal_entregas" ADD CONSTRAINT "fiscal_entregas_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_entregas" ADD CONSTRAINT "fiscal_entregas_fechamento_id_fiscal_fechamentos_id_fk" FOREIGN KEY ("fechamento_id") REFERENCES "public"."fiscal_fechamentos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_entregas" ADD CONSTRAINT "fiscal_entregas_original_fk" FOREIGN KEY ("entrega_original_id") REFERENCES "public"."fiscal_entregas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_fiscal_entrega_competencia" ON "fiscal_entregas" USING btree ("cliente_id","competencia","obrigacao");--> statement-breakpoint
CREATE INDEX "idx_fiscal_entrega_fechamento" ON "fiscal_entregas" USING btree ("fechamento_id");--> statement-breakpoint
CREATE INDEX "idx_fiscal_entrega_original" ON "fiscal_entregas" USING btree ("entrega_original_id");