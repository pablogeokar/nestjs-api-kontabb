ALTER TABLE "clientes" ADD COLUMN "optante_simples_nacional" boolean;--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "simples_nacional_fonte" text;--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "simples_nacional_consultado_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clientes" ADD CONSTRAINT "chk_clientes_consulta_simples_coerencia" CHECK ((
        ("clientes"."optante_simples_nacional" IS NULL AND "clientes"."simples_nacional_fonte" IS NULL AND "clientes"."simples_nacional_consultado_em" IS NULL)
        OR
        ("clientes"."optante_simples_nacional" IS NOT NULL AND "clientes"."simples_nacional_fonte" IN ('OPEN_CNPJ', 'RECEITA_WS') AND "clientes"."simples_nacional_consultado_em" IS NOT NULL)
      )
      AND ("clientes"."tipo_pessoa" = 'PJ' OR "clientes"."optante_simples_nacional" IS NULL)
      AND ("clientes"."optante_simples_nacional" IS DISTINCT FROM true OR "clientes"."regime_tributario" = 'SIMPLES_NACIONAL')
      AND ("clientes"."optante_simples_nacional" IS DISTINCT FROM false OR "clientes"."regime_tributario" IS DISTINCT FROM 'SIMPLES_NACIONAL'));