CREATE TABLE "contadores_certificados" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contador_id" uuid NOT NULL,
	"arquivo_key" text NOT NULL,
	"senha_criptografada" text NOT NULL,
	"titular" text NOT NULL,
	"documento" text NOT NULL,
	"thumbprint" text NOT NULL,
	"validade_inicio" timestamp NOT NULL,
	"validade_fim" timestamp NOT NULL,
	"autorizado_assinar" text DEFAULT 'SIM' NOT NULL,
	"uploadado_por" text,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chk_contadores_certificados_autorizado" CHECK ("contadores_certificados"."autorizado_assinar" IN ('SIM', 'NAO'))
);
--> statement-breakpoint
CREATE TABLE "relatorios_faturamento" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"numero" bigint GENERATED ALWAYS AS IDENTITY (sequence name "relatorios_faturamento_numero_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"codigo" text NOT NULL,
	"cliente_id" uuid NOT NULL,
	"contador_id" uuid,
	"periodo_inicio" text NOT NULL,
	"periodo_fim" text NOT NULL,
	"empresa_nome" text NOT NULL,
	"empresa_documento" text NOT NULL,
	"contador_nome" text,
	"contador_crc" text,
	"meses" jsonb NOT NULL,
	"total" text NOT NULL,
	"pdf_key" text,
	"pdf_sha256" text,
	"assinatura_status" text DEFAULT 'SEM_CERTIFICADO' NOT NULL,
	"assinatura_thumbprint" text,
	"status" text DEFAULT 'PROCESSANDO' NOT NULL,
	"emitido_por" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"emitido_em" timestamp with time zone,
	CONSTRAINT "chk_relat_faturamento_status" CHECK ("relatorios_faturamento"."status" IN ('PROCESSANDO', 'EMITIDO', 'FALHOU')),
	CONSTRAINT "chk_relat_faturamento_assinatura" CHECK ("relatorios_faturamento"."assinatura_status" IN ('ASSINADO', 'SEM_CERTIFICADO'))
);
--> statement-breakpoint
ALTER TABLE "contadores_certificados" ADD CONSTRAINT "contadores_certificados_contador_id_contadores_id_fk" FOREIGN KEY ("contador_id") REFERENCES "public"."contadores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contadores_certificados" ADD CONSTRAINT "contadores_certificados_uploadado_por_user_id_fk" FOREIGN KEY ("uploadado_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relatorios_faturamento" ADD CONSTRAINT "relatorios_faturamento_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relatorios_faturamento" ADD CONSTRAINT "relatorios_faturamento_contador_id_contadores_id_fk" FOREIGN KEY ("contador_id") REFERENCES "public"."contadores"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relatorios_faturamento" ADD CONSTRAINT "relatorios_faturamento_emitido_por_user_id_fk" FOREIGN KEY ("emitido_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_contadores_certificados_contador" ON "contadores_certificados" USING btree ("contador_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_relat_faturamento_numero" ON "relatorios_faturamento" USING btree ("numero");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_relat_faturamento_codigo" ON "relatorios_faturamento" USING btree ("codigo");--> statement-breakpoint
CREATE INDEX "idx_relat_faturamento_cliente_data" ON "relatorios_faturamento" USING btree ("cliente_id","criado_em");