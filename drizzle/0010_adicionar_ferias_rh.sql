DROP INDEX "uidx_folhas_cliente_competencia";--> statement-breakpoint
ALTER TABLE "folhas_pagamento" ADD COLUMN "tipo" text DEFAULT 'FOLHA_MENSAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "folhas_pagamento" ADD COLUMN "periodo_aquisitivo_inicio" date;--> statement-breakpoint
ALTER TABLE "folhas_pagamento" ADD COLUMN "periodo_aquisitivo_fim" date;--> statement-breakpoint
ALTER TABLE "folhas_pagamento" ADD COLUMN "dias_ferias" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_folhas_cliente_competencia" ON "folhas_pagamento" USING btree ("cliente_id","competencia") WHERE "folhas_pagamento"."tipo" = 'FOLHA_MENSAL';--> statement-breakpoint
ALTER TABLE "folhas_pagamento" ADD CONSTRAINT "chk_folhas_tipo" CHECK ("folhas_pagamento"."tipo" IN ('FOLHA_MENSAL', 'FERIAS'));