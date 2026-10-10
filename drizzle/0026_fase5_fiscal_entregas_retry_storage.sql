ALTER TABLE "fiscal_entregas" ADD COLUMN "tentativas_storage" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "fiscal_entregas" ADD COLUMN "ultimo_erro_storage" text;