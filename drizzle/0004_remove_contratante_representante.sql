-- O representante do contrato passa a vir do cadastro do cliente (clientes.responsavel_nome).
-- Preserva o que já foi digitado nos contratos quando o cadastro ainda não tem responsável.
UPDATE "clientes" c
SET "responsavel_nome" = left(btrim(fc."contratante_representante"), 100)
FROM "financeiro_contratos" fc
WHERE fc."cliente_id" = c."id"
  AND (c."responsavel_nome" IS NULL OR btrim(c."responsavel_nome") = '')
  AND length(btrim(COALESCE(fc."contratante_representante", ''))) >= 2;--> statement-breakpoint
ALTER TABLE "financeiro_contratos" DROP COLUMN "contratante_representante";
