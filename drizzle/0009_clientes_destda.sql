ALTER TABLE "destda_configuracoes" DROP CONSTRAINT "chk_destda_config_cod_assinante";--> statement-breakpoint
ALTER TABLE "destda_configuracoes" ALTER COLUMN "responsavel_cod_assinante" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "destda_configuracoes" ALTER COLUMN "responsavel_cod_assinante" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "codigo_municipio_ibge" varchar(7);--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "nome_fantasia" text;--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "responsavel_nome" text;--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "responsavel_cpf" varchar(11);--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "responsavel_cod_assinante" varchar(3);--> statement-breakpoint
ALTER TABLE "clientes" ADD CONSTRAINT "chk_clientes_codigo_municipio_ibge" CHECK ("clientes"."codigo_municipio_ibge" IS NULL OR "clientes"."codigo_municipio_ibge" ~ '^[0-9]{7}$');--> statement-breakpoint
ALTER TABLE "clientes" ADD CONSTRAINT "chk_clientes_responsavel_cpf" CHECK ("clientes"."responsavel_cpf" IS NULL OR "clientes"."responsavel_cpf" ~ '^[0-9]{11}$');--> statement-breakpoint
ALTER TABLE "clientes" ADD CONSTRAINT "chk_clientes_responsavel_cod_assinante" CHECK ("clientes"."responsavel_cod_assinante" IS NULL OR "clientes"."responsavel_cod_assinante" ~ '^[0-9]{3}$');--> statement-breakpoint
ALTER TABLE "destda_configuracoes" ADD CONSTRAINT "chk_destda_config_cod_assinante" CHECK ("destda_configuracoes"."responsavel_cod_assinante" IS NULL OR "destda_configuracoes"."responsavel_cod_assinante" ~ '^[0-9]{3}$');