ALTER TABLE "clientes" ADD COLUMN "cep" text;--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "logradouro" text;--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "numero" text;--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "complemento" text;--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "bairro" text;--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "municipio" text;--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "uf" text;--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "cnae_principal_codigo" text;--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "cnae_principal_descricao" text;--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "cnaes_secundarios" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "clientes" ADD CONSTRAINT "chk_clientes_cep" CHECK ("clientes"."cep" IS NULL OR "clientes"."cep" ~ '^[0-9]{8}$');--> statement-breakpoint
ALTER TABLE "clientes" ADD CONSTRAINT "chk_clientes_uf" CHECK ("clientes"."uf" IS NULL OR "clientes"."uf" ~ '^[A-Z]{2}$');--> statement-breakpoint
ALTER TABLE "clientes" ADD CONSTRAINT "chk_clientes_cnae_principal" CHECK ("clientes"."cnae_principal_codigo" IS NULL OR "clientes"."cnae_principal_codigo" ~ '^[0-9]{7}$');--> statement-breakpoint
ALTER TABLE "clientes" ADD CONSTRAINT "chk_clientes_cnaes_secundarios" CHECK (jsonb_typeof("clientes"."cnaes_secundarios") = 'array');
