ALTER TABLE "fiscal_regras_versoes" ADD COLUMN "escopo_aprovado" boolean;--> statement-breakpoint
ALTER TABLE "fiscal_regras_versoes" ADD COLUMN "aprovado_por" text;--> statement-breakpoint
ALTER TABLE "fiscal_regras_versoes" ADD COLUMN "aprovado_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fiscal_regras_versoes" ADD CONSTRAINT "fiscal_regras_versoes_aprovado_por_user_id_fk" FOREIGN KEY ("aprovado_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;