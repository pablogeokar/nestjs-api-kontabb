CREATE TABLE "financeiro_contrato_preferencias" (
	"usuario_id" text PRIMARY KEY NOT NULL,
	"local_assinatura" text DEFAULT '' NOT NULL,
	"dia_vencimento" integer DEFAULT 10 NOT NULL,
	"dia_fechamento" integer DEFAULT 25 NOT NULL,
	"aviso_previo_dias" integer DEFAULT 30 NOT NULL,
	"gera_13o" boolean DEFAULT false NOT NULL,
	"mes_13o" integer DEFAULT 12 NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chk_fin_contrato_pref_venc" CHECK ("financeiro_contrato_preferencias"."dia_vencimento" BETWEEN 1 AND 31),
	CONSTRAINT "chk_fin_contrato_pref_fech" CHECK ("financeiro_contrato_preferencias"."dia_fechamento" BETWEEN 1 AND 31),
	CONSTRAINT "chk_fin_contrato_pref_aviso" CHECK ("financeiro_contrato_preferencias"."aviso_previo_dias" BETWEEN 0 AND 365),
	CONSTRAINT "chk_fin_contrato_pref_mes13" CHECK ("financeiro_contrato_preferencias"."mes_13o" BETWEEN 1 AND 12),
	CONSTRAINT "chk_fin_contrato_pref_local" CHECK (char_length("financeiro_contrato_preferencias"."local_assinatura") <= 120)
);
--> statement-breakpoint
ALTER TABLE "financeiro_contrato_preferencias" ADD CONSTRAINT "financeiro_contrato_preferencias_usuario_id_user_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;