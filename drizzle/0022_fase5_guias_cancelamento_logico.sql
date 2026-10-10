ALTER TABLE "fiscal_apuracoes_guias" ADD COLUMN "cancelada" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "fiscal_apuracoes_guias" ADD COLUMN "cancelada_em" timestamp;--> statement-breakpoint
ALTER TABLE "fiscal_apuracoes_guias" ADD COLUMN "motivo_cancelamento" text;--> statement-breakpoint
ALTER TABLE "fiscal_apuracoes_guias" ADD CONSTRAINT "chk_fiscal_guias_cancelamento" CHECK ("fiscal_apuracoes_guias"."cancelada" = false OR "fiscal_apuracoes_guias"."cancelada_em" IS NOT NULL);