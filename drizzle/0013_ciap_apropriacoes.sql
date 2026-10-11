CREATE TABLE "ciap_apropriacoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"bem_id" uuid NOT NULL,
	"competencia" date NOT NULL,
	"versao" integer DEFAULT 1 NOT NULL,
	"ativa" boolean DEFAULT true NOT NULL,
	"numero_parcela" integer NOT NULL,
	"base_controle" numeric(15, 2) NOT NULL,
	"parcela_passivel" numeric(15, 2) NOT NULL,
	"coeficiente" numeric(9, 4) NOT NULL,
	"coeficiente_fonte" varchar(40) NOT NULL,
	"parcela_admitida" numeric(15, 2) NOT NULL,
	"parcela_vedada" numeric(15, 2) NOT NULL,
	"movimento_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_ciap_aprop_versao" CHECK ("ciap_apropriacoes"."versao" >= 1),
	CONSTRAINT "chk_ciap_aprop_numero_parcela" CHECK ("ciap_apropriacoes"."numero_parcela" >= 1),
	CONSTRAINT "chk_ciap_aprop_coeficiente" CHECK ("ciap_apropriacoes"."coeficiente" >= 0 AND "ciap_apropriacoes"."coeficiente" <= 1),
	CONSTRAINT "chk_ciap_aprop_decomposicao" CHECK ("ciap_apropriacoes"."parcela_admitida" + "ciap_apropriacoes"."parcela_vedada" = "ciap_apropriacoes"."parcela_passivel")
);
--> statement-breakpoint
ALTER TABLE "ciap_apropriacoes" ADD CONSTRAINT "ciap_apropriacoes_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ciap_apropriacoes" ADD CONSTRAINT "ciap_apropriacoes_bem_id_ciap_ativo_permanente_id_fk" FOREIGN KEY ("bem_id") REFERENCES "public"."ciap_ativo_permanente"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ciap_apropriacoes" ADD CONSTRAINT "ciap_apropriacoes_movimento_id_ciap_movimentos_id_fk" FOREIGN KEY ("movimento_id") REFERENCES "public"."ciap_movimentos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ciap_aprop_cliente" ON "ciap_apropriacoes" USING btree ("cliente_id");--> statement-breakpoint
CREATE INDEX "idx_ciap_aprop_bem" ON "ciap_apropriacoes" USING btree ("bem_id");--> statement-breakpoint
CREATE INDEX "idx_ciap_aprop_cliente_competencia" ON "ciap_apropriacoes" USING btree ("cliente_id","competencia");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_ciap_aprop_bem_competencia_versao" ON "ciap_apropriacoes" USING btree ("bem_id","competencia","versao");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_ciap_aprop_bem_competencia_ativa" ON "ciap_apropriacoes" USING btree ("bem_id","competencia") WHERE "ciap_apropriacoes"."ativa";