ALTER TABLE "folhas_pagamento" ADD COLUMN "arquivo_key" text;
--> statement-breakpoint
ALTER TABLE "folhas_pagamento" ADD COLUMN "arquivo_nome" text;
--> statement-breakpoint
-- Migrate existing data: copy arquivo_key/arquivo_nome from documentos to folhas_pagamento
UPDATE "folhas_pagamento" f
SET arquivo_key = d.arquivo_key, arquivo_nome = d.arquivo_nome
FROM "documentos" d
WHERE f.documento_id = d.id AND f.arquivo_key IS NULL;
