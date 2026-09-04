ALTER TABLE "guias" DROP CONSTRAINT "chk_guias_email_status";--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "suspenso" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "suspenso_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clientes" ADD CONSTRAINT "chk_clientes_suspensao_coerencia" CHECK (("clientes"."suspenso" = true AND "clientes"."suspenso_em" IS NOT NULL) OR ("clientes"."suspenso" = false AND "clientes"."suspenso_em" IS NULL));--> statement-breakpoint
ALTER TABLE "guias" ADD CONSTRAINT "chk_guias_email_status" CHECK ("guias"."email_status" IN ('NAO_ENVIADO', 'PENDENTE', 'ENVIADO', 'FALHOU', 'SEM_EMAIL', 'SUSPENSO'));