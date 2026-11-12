ALTER TABLE "financeiro_contratos" ADD COLUMN "servicos_contratados" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "financeiro_contratos" ADD COLUMN "contratante_representante" text;--> statement-breakpoint
ALTER TABLE "financeiro_contratos" ADD COLUMN "data_inicio" date;--> statement-breakpoint
ALTER TABLE "financeiro_contratos" ADD COLUMN "aviso_previo_dias" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "financeiro_contratos" ADD COLUMN "condicoes_contratuais" text;--> statement-breakpoint
ALTER TABLE "financeiro_contratos" ADD CONSTRAINT "chk_fin_contratos_aviso" CHECK ("financeiro_contratos"."aviso_previo_dias" BETWEEN 0 AND 365);