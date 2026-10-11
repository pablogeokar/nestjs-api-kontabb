ALTER TABLE "fiscal_apuracoes_guias" ADD COLUMN "origem" varchar(20) DEFAULT 'MANUAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "fiscal_apuracoes_guias" ADD COLUMN "fechamento_id" uuid;--> statement-breakpoint
ALTER TABLE "fiscal_apuracoes_guias" ADD CONSTRAINT "fiscal_apuracoes_guias_fechamento_id_fiscal_fechamentos_id_fk" FOREIGN KEY ("fechamento_id") REFERENCES "public"."fiscal_fechamentos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_fiscal_guias_fechamento" ON "fiscal_apuracoes_guias" USING btree ("fechamento_id");--> statement-breakpoint
ALTER TABLE "fiscal_apuracoes_guias" ADD CONSTRAINT "chk_fiscal_guias_origem" CHECK ("fiscal_apuracoes_guias"."origem" IN ('APURACAO', 'MANUAL'));--> statement-breakpoint
ALTER TABLE "fiscal_apuracoes_guias" ADD CONSTRAINT "chk_fiscal_guias_apuracao_vinculo" CHECK ("fiscal_apuracoes_guias"."origem" <> 'APURACAO' OR "fiscal_apuracoes_guias"."fechamento_id" IS NOT NULL);