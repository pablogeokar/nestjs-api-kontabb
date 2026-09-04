CREATE TABLE "contadores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"cpf" varchar(11),
	"crc" text NOT NULL,
	"cnpj" varchar(14),
	"cep" varchar(8),
	"logradouro" text,
	"numero" text,
	"complemento" text,
	"bairro" text,
	"telefone" text,
	"fax" text,
	"email" text,
	"codigo_municipio_ibge" varchar(7) NOT NULL,
	"atualizado_por" text,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chk_contadores_documento" CHECK (("contadores"."cpf" IS NOT NULL AND "contadores"."cpf" ~ '^[0-9]{11}$') OR ("contadores"."cnpj" IS NOT NULL AND "contadores"."cnpj" ~ '^[0-9A-Z]{12}[0-9]{2}$')),
	CONSTRAINT "chk_contadores_cep" CHECK ("contadores"."cep" IS NULL OR "contadores"."cep" ~ '^[0-9]{8}$'),
	CONSTRAINT "chk_contadores_codigo_municipio" CHECK ("contadores"."codigo_municipio_ibge" ~ '^[0-9]{7}$'),
	CONSTRAINT "chk_contadores_nome" CHECK (char_length(btrim("contadores"."nome")) BETWEEN 2 AND 100),
	CONSTRAINT "chk_contadores_crc" CHECK (char_length(btrim("contadores"."crc")) BETWEEN 2 AND 30)
);
--> statement-breakpoint
DROP INDEX "uidx_sped_contabilista_cliente";--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "contador_id" uuid;--> statement-breakpoint
ALTER TABLE "contadores" ADD CONSTRAINT "contadores_atualizado_por_user_id_fk" FOREIGN KEY ("atualizado_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_contadores_cpf_crc" ON "contadores" USING btree ("cpf","crc") WHERE "contadores"."cpf" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_contadores_cnpj_crc" ON "contadores" USING btree ("cnpj","crc") WHERE "contadores"."cnpj" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_contadores_nome" ON "contadores" USING btree ("nome");--> statement-breakpoint
-- Backfill idempotente: preserva o registro legado e deduplica por documento + CRC.
-- ON CONFLICT também protege bases onde o mesmo profissional apareceu com CPF e CNPJ.
INSERT INTO "contadores" (
	"nome", "cpf", "crc", "cnpj", "cep", "logradouro", "numero",
	"complemento", "bairro", "telefone", "fax", "email",
	"codigo_municipio_ibge", "atualizado_por", "criado_em", "atualizado_em"
)
SELECT
	legacy."nome", legacy."cpf", upper(btrim(legacy."crc")), legacy."cnpj",
	legacy."cep", legacy."logradouro", legacy."numero", legacy."complemento",
	legacy."bairro", legacy."telefone", legacy."fax", legacy."email",
	legacy."codigo_municipio_ibge", legacy."atualizado_por",
	legacy."criado_em", legacy."atualizado_em"
FROM (
	SELECT DISTINCT ON (
		COALESCE('CPF:' || "cpf", 'CNPJ:' || "cnpj"), upper(btrim("crc"))
	) *
	FROM "sped_contabilistas"
	ORDER BY
		COALESCE('CPF:' || "cpf", 'CNPJ:' || "cnpj"),
		upper(btrim("crc")), "atualizado_em" DESC, "id"
) legacy
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "clientes" cliente
SET "contador_id" = (
	SELECT contador."id"
	FROM "sped_contabilistas" legacy
	JOIN "contadores" contador
	  ON upper(btrim(contador."crc")) = upper(btrim(legacy."crc"))
	 AND (
		(legacy."cpf" IS NOT NULL AND contador."cpf" = legacy."cpf")
		OR (legacy."cnpj" IS NOT NULL AND contador."cnpj" = legacy."cnpj")
	 )
	WHERE legacy."cliente_id" = cliente."id"
	ORDER BY legacy."atualizado_em" DESC, contador."id"
	LIMIT 1
)
WHERE cliente."contador_id" IS NULL
  AND EXISTS (
	SELECT 1
	FROM "sped_contabilistas" legacy
	JOIN "contadores" contador
	  ON upper(btrim(contador."crc")) = upper(btrim(legacy."crc"))
	 AND (
		(legacy."cpf" IS NOT NULL AND contador."cpf" = legacy."cpf")
		OR (legacy."cnpj" IS NOT NULL AND contador."cnpj" = legacy."cnpj")
	 )
	WHERE legacy."cliente_id" = cliente."id"
  );--> statement-breakpoint
ALTER TABLE "clientes" ADD CONSTRAINT "clientes_contador_id_contadores_id_fk" FOREIGN KEY ("contador_id") REFERENCES "public"."contadores"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_clientes_contador_id" ON "clientes" USING btree ("contador_id");--> statement-breakpoint
CREATE INDEX "idx_sped_contabilista_cliente" ON "sped_contabilistas" USING btree ("cliente_id");
