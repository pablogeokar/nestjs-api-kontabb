-- Rename tables: documentos → guias, visualizacoes_documentos → visualizacoes_guias
ALTER TABLE "documentos" RENAME TO "guias";
ALTER TABLE "visualizacoes_documentos" RENAME TO "visualizacoes_guias";

-- Rename indexes on guias table
ALTER INDEX "idx_documentos_cliente_id" RENAME TO "idx_guias_cliente_id";
ALTER INDEX "idx_documentos_tipo" RENAME TO "idx_guias_tipo";
ALTER INDEX "idx_documentos_periodo" RENAME TO "idx_guias_periodo";
ALTER INDEX "idx_documentos_status" RENAME TO "idx_guias_status";
ALTER INDEX "idx_documentos_pagamento_confirmado_por" RENAME TO "idx_guias_pagamento_confirmado_por";

-- Rename unique constraint
ALTER TABLE "guias" RENAME CONSTRAINT "uq_documentos_identidade" TO "uq_guias_identidade";

-- Rename check constraints
ALTER TABLE "guias" RENAME CONSTRAINT "chk_documentos_tipo" TO "chk_guias_tipo";
ALTER TABLE "guias" RENAME CONSTRAINT "chk_documentos_status" TO "chk_guias_status";
ALTER TABLE "guias" RENAME CONSTRAINT "chk_documentos_email_status" TO "chk_guias_email_status";
ALTER TABLE "guias" RENAME CONSTRAINT "chk_documentos_periodo" TO "chk_guias_periodo";
ALTER TABLE "guias" RENAME CONSTRAINT "chk_documentos_arquivo_key" TO "chk_guias_arquivo_key";
ALTER TABLE "guias" RENAME CONSTRAINT "chk_documentos_arquivo_nome" TO "chk_guias_arquivo_nome";
ALTER TABLE "guias" RENAME CONSTRAINT "chk_documentos_valor" TO "chk_guias_valor";
ALTER TABLE "guias" RENAME CONSTRAINT "chk_documentos_pagamento" TO "chk_guias_pagamento";
ALTER TABLE "guias" RENAME CONSTRAINT "chk_documentos_numero_parcelamento" TO "chk_guias_numero_parcelamento";

-- Rename indexes on visualizacoes_guias table
ALTER INDEX "idx_visualizacoes_documento" RENAME TO "idx_visualizacoes_guia";
ALTER INDEX "idx_visualizacoes_user" RENAME TO "idx_visualizacoes_guia_user";

-- Rename column in visualizacoes_guias: documento_id → guia_id
ALTER TABLE "visualizacoes_guias" RENAME COLUMN "documento_id" TO "guia_id";
