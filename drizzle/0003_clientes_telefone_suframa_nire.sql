ALTER TABLE "clientes" ADD COLUMN "telefone" text;--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "suframa" varchar(9);--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "nire" varchar(11);--> statement-breakpoint
ALTER TABLE "clientes" ADD CONSTRAINT "chk_clientes_suframa" CHECK ("clientes"."suframa" IS NULL OR "clientes"."suframa" ~ '^[0-9]{9}$');--> statement-breakpoint
ALTER TABLE "clientes" ADD CONSTRAINT "chk_clientes_nire" CHECK ("clientes"."nire" IS NULL OR "clientes"."nire" ~ '^[0-9]{11}$');--> statement-breakpoint
-- Consolida no cadastro do cliente os dados que DeSTDA e SPED mantinham em cópias
-- próprias. Prioridade: DeSTDA, depois SPED, depois o valor já existente no cadastro
-- (os dois primeiros foram digitados manualmente). Valores que violam as regras do
-- cadastro são ignorados. As colunas antigas das configurações NÃO são removidas.
UPDATE "clientes" c SET
  "telefone" = COALESCE(NULLIF(btrim(d."telefone"), ''), NULLIF(btrim(s."telefone"), ''), c."telefone"),
  "suframa" = COALESCE(
    CASE WHEN regexp_replace(COALESCE(d."suframa", ''), '\D', '', 'g') ~ '^[0-9]{9}$' THEN regexp_replace(d."suframa", '\D', '', 'g') END,
    CASE WHEN regexp_replace(COALESCE(s."suframa", ''), '\D', '', 'g') ~ '^[0-9]{9}$' THEN regexp_replace(s."suframa", '\D', '', 'g') END,
    c."suframa"),
  "nire" = COALESCE(d."nire", c."nire"),
  "codigo_municipio_ibge" = COALESCE(
    CASE WHEN d."codigo_municipio_ibge" ~ '^[0-9]{7}$' THEN d."codigo_municipio_ibge" END,
    CASE WHEN s."codigo_municipio_ibge" ~ '^[0-9]{7}$' THEN s."codigo_municipio_ibge" END,
    c."codigo_municipio_ibge"),
  "nome_fantasia" = COALESCE(NULLIF(btrim(d."nome_fantasia"), ''), NULLIF(btrim(s."nome_fantasia"), ''), c."nome_fantasia"),
  "responsavel_nome" = COALESCE(NULLIF(btrim(d."responsavel_nome"), ''), c."responsavel_nome"),
  "responsavel_cpf" = COALESCE(d."responsavel_cpf", c."responsavel_cpf"),
  "responsavel_cod_assinante" = COALESCE(d."responsavel_cod_assinante", c."responsavel_cod_assinante")
FROM "clientes" base
LEFT JOIN "destda_configuracoes" d ON d."cliente_id" = base."id"
LEFT JOIN "sped_configuracoes" s ON s."cliente_id" = base."id"
WHERE c."id" = base."id" AND (d."id" IS NOT NULL OR s."id" IS NOT NULL);
--> statement-breakpoint
UPDATE "clientes" c SET "inscricao_municipal" = COALESCE(
  CASE WHEN upper(btrim(d."inscricao_municipal")) ~ '^[0-9A-Z./-]{2,20}$' THEN upper(btrim(d."inscricao_municipal")) END,
  CASE WHEN upper(btrim(s."inscricao_municipal")) ~ '^[0-9A-Z./-]{2,20}$' THEN upper(btrim(s."inscricao_municipal")) END,
  c."inscricao_municipal")
FROM "clientes" base
LEFT JOIN "destda_configuracoes" d ON d."cliente_id" = base."id"
LEFT JOIN "sped_configuracoes" s ON s."cliente_id" = base."id"
WHERE c."id" = base."id" AND c."tipo_pessoa" = 'PJ' AND (d."id" IS NOT NULL OR s."id" IS NOT NULL);
