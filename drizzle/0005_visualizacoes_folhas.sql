CREATE TABLE IF NOT EXISTS "visualizacoes_folhas" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "folha_id" uuid NOT NULL REFERENCES "folhas_pagamento"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "visualizado_em" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_visualizacoes_folha" ON "visualizacoes_folhas" ("folha_id");
CREATE INDEX IF NOT EXISTS "idx_visualizacoes_folha_user" ON "visualizacoes_folhas" ("user_id");
