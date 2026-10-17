ALTER TABLE "documentos_fiscais" ADD COLUMN "ultima_tentativa_xml_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documentos_fiscais" ADD COLUMN "proxima_tentativa_xml_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documentos_fiscais" ADD COLUMN "tentativas_xml" integer DEFAULT 0 NOT NULL;