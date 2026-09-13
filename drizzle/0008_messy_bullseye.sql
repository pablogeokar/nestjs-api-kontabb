CREATE TABLE "ciap_competencias_apropriadas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"bem_id" uuid NOT NULL,
	"competencia" date NOT NULL,
	"aplicado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ciap_competencias_apropriadas" ADD CONSTRAINT "ciap_competencias_apropriadas_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ciap_competencias_apropriadas" ADD CONSTRAINT "ciap_competencias_apropriadas_bem_id_ciap_ativo_permanente_id_fk" FOREIGN KEY ("bem_id") REFERENCES "public"."ciap_ativo_permanente"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_ciap_competencia_bem" ON "ciap_competencias_apropriadas" USING btree ("cliente_id","competencia","bem_id");--> statement-breakpoint
CREATE INDEX "idx_ciap_competencia_cliente" ON "ciap_competencias_apropriadas" USING btree ("cliente_id","competencia");