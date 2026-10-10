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
ALTER TABLE "fiscal_pagamentos_eventos" ADD CONSTRAINT "fiscal_pagamentos_eventos_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_pagamentos_eventos" ADD CONSTRAINT "fiscal_pagamentos_eventos_guia_id_fiscal_apuracoes_guias_id_fk" FOREIGN KEY ("guia_id") REFERENCES "public"."fiscal_apuracoes_guias"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_pagamentos_eventos" ADD CONSTRAINT "fiscal_pagamentos_eventos_fechamento_id_fiscal_fechamentos_id_fk" FOREIGN KEY ("fechamento_id") REFERENCES "public"."fiscal_fechamentos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_pagamentos_eventos" ADD CONSTRAINT "fiscal_pagamentos_eventos_estornado_fk" FOREIGN KEY ("evento_estornado_id") REFERENCES "public"."fiscal_pagamentos_eventos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_fiscal_pagamento_evento_guia" ON "fiscal_pagamentos_eventos" USING btree ("guia_id","data_evento");--> statement-breakpoint
CREATE INDEX "idx_fiscal_pagamento_evento_fechamento" ON "fiscal_pagamentos_eventos" USING btree ("fechamento_id");--> statement-breakpoint
CREATE INDEX "idx_fiscal_pagamento_evento_cliente" ON "fiscal_pagamentos_eventos" USING btree ("cliente_id","data_evento");