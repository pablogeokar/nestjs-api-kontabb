ALTER TABLE "ciap_ativo_permanente" ADD COLUMN "chave_aquisicao" varchar(120);--> statement-breakpoint
ALTER TABLE "ciap_ativo_permanente" ADD COLUMN "origem_identidade" varchar(30) DEFAULT 'sku_legado' NOT NULL;--> statement-breakpoint
ALTER TABLE "ciap_ativo_permanente" ADD COLUMN "saneamento_pendente" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_ciap_cliente_chave_aquisicao" ON "ciap_ativo_permanente" USING btree ("cliente_id","chave_aquisicao") WHERE "ciap_ativo_permanente"."chave_aquisicao" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "ciap_ativo_permanente" ADD CONSTRAINT "chk_ciap_origem_identidade" CHECK ("ciap_ativo_permanente"."origem_identidade" IN ('sku_legado', 'aquisicao', 'reconstruido_nao_comprovado'));
--> statement-breakpoint
-- Backfill assistido da identidade patrimonial por aquisição (Fase 2 / tarefa
-- 1.4, R2.1/R2.2). É ADITIVO: apenas preenche as colunas novas, nunca altera
-- `codigo_bem`, valores de ICMS, parcelas ou status das fichas existentes.
--
-- (1) Fichas com lastro em um item escriturado (documento + item): a identidade
-- por aquisição é reconstruída de forma COMPROVADA a partir do par
-- documento/item. Duas compras do mesmo SKU, por virem de itens distintos,
-- recebem chaves distintas — deixando de ser fundidas pelo unique por SKU
-- (R2.1).
UPDATE "ciap_ativo_permanente"
SET
  "chave_aquisicao" = "documento_fiscal_id" || ':' || "documento_fiscal_item_id",
  "origem_identidade" = 'aquisicao'
WHERE "chave_aquisicao" IS NULL
  AND "documento_fiscal_id" IS NOT NULL
  AND "documento_fiscal_item_id" IS NOT NULL;--> statement-breakpoint
-- (2) Fichas SEM lastro em item escriturado (cadastro manual, legado): a
-- identidade recebe o PRÓPRIO UUID da ficha e é classificada como
-- "reconstruída/não comprovada". O backfill NÃO inventa documento nem
-- competência a partir de `parcelas_apropriadas` (design: "backfill não pode
-- inventar histórico").
UPDATE "ciap_ativo_permanente"
SET
  "chave_aquisicao" = "id"::text,
  "origem_identidade" = 'reconstruido_nao_comprovado'
WHERE "chave_aquisicao" IS NULL;--> statement-breakpoint
-- (3) Saneamento assistido (R2.1): marca as fichas cujo `codigo_bem` (SKU)
-- corresponde a MAIS DE UMA aquisição de ativo escriturada (CFOP 1551/2551/
-- 3551). A identidade por SKU encobre essas aquisições e a divisão correta em
-- bens distintos exige decisão humana no rollout (Fase 5/13) — o backfill não
-- escolhe sozinho a qual aquisição a ficha legada pertence.
WITH aquisicoes_por_sku AS (
  SELECT
    i."cliente_id" AS cliente_id,
    LEFT(i."codigo_produto", 60) AS codigo_bem,
    COUNT(DISTINCT i."id") AS aquisicoes
  FROM "documentos_fiscais_itens" i
  INNER JOIN "documentos_fiscais" d ON d."id" = i."documento_fiscal_id"
  WHERE i."tipo_operacao_escriturada" = 'ENTRADA'
    AND d."situacao" = 'AUTORIZADA'
    AND d."escriturado" = true
    AND i."cfop" IN ('1551', '2551', '3551')
    AND i."codigo_produto" IS NOT NULL
  GROUP BY i."cliente_id", LEFT(i."codigo_produto", 60)
  HAVING COUNT(DISTINCT i."id") > 1
)
UPDATE "ciap_ativo_permanente" bem
SET "saneamento_pendente" = true
FROM aquisicoes_por_sku a
WHERE bem."cliente_id" = a.cliente_id
  AND bem."codigo_bem" = a.codigo_bem;
