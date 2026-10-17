ALTER TABLE "documentos_fiscais" ADD COLUMN "ultima_tentativa_ciencia_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documentos_fiscais" ADD COLUMN "proxima_tentativa_ciencia_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documentos_fiscais" ADD COLUMN "tentativas_ciencia" integer DEFAULT 0 NOT NULL;