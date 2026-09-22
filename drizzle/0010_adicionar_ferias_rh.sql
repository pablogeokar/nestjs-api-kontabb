ALTER TABLE "folhas_pagamento" ADD COLUMN IF NOT EXISTS "tipo" text DEFAULT 'FOLHA_MENSAL' NOT NULL;
--> statement-breakpoint
ALTER TABLE "folhas_pagamento" ADD COLUMN IF NOT EXISTS "dias_ferias" integer;
--> statement-breakpoint
ALTER TABLE "folhas_pagamento" ADD COLUMN IF NOT EXISTS "periodo_aquisitivo_inicio" date;
--> statement-breakpoint
ALTER TABLE "folhas_pagamento" ADD COLUMN IF NOT EXISTS "periodo_aquisitivo_fim" date;
--> statement-breakpoint
ALTER TABLE "folhas_pagamento" DROP CONSTRAINT IF EXISTS "chk_folhas_tipo";
--> statement-breakpoint
ALTER TABLE "folhas_pagamento" ADD CONSTRAINT "chk_folhas_tipo" CHECK ("tipo" IN ('FOLHA_MENSAL', 'FERIAS'));
--> statement-breakpoint
DROP INDEX IF EXISTS "uidx_folhas_cliente_competencia";
--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_folhas_cliente_competencia" ON "folhas_pagamento" ("cliente_id", "competencia") WHERE "tipo" = 'FOLHA_MENSAL';
