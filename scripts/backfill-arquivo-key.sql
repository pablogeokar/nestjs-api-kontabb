-- Backfill histórico de obrigacoes.arquivo_key a partir de obrigacoes.arquivo_url.
-- Use somente em bancos legados, após backup e antes da migration que remove arquivo_url.

WITH candidatas AS (
  SELECT
    id,
    arquivo_url,
    CASE
      WHEN arquivo_url LIKE 'clientes/%' THEN split_part(arquivo_url, '?', 1)
      WHEN arquivo_url ~ '/clientes/' THEN substring(arquivo_url FROM '/(clientes/[^?]+)')
      ELSE NULL
    END AS arquivo_key_extraida
  FROM obrigacoes
  WHERE nullif(btrim(arquivo_key), '') IS NULL
)
SELECT id, arquivo_url, arquivo_key_extraida
FROM candidatas
ORDER BY id;

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    WITH candidatas AS (
      SELECT CASE
        WHEN arquivo_url LIKE 'clientes/%' THEN split_part(arquivo_url, '?', 1)
        WHEN arquivo_url ~ '/clientes/' THEN substring(arquivo_url FROM '/(clientes/[^?]+)')
        ELSE NULL
      END AS arquivo_key_extraida
      FROM obrigacoes
      WHERE nullif(btrim(arquivo_key), '') IS NULL
    )
    SELECT 1
    FROM candidatas
    WHERE arquivo_key_extraida IS NULL OR arquivo_key_extraida !~ '^clientes/.+'
  ) THEN
    RAISE EXCEPTION
      'Backfill cancelado: existe arquivo_url sem uma key válida iniciada por clientes/.';
  END IF;
END $$;

WITH candidatas AS (
  SELECT
    id,
    CASE
      WHEN arquivo_url LIKE 'clientes/%' THEN split_part(arquivo_url, '?', 1)
      WHEN arquivo_url ~ '/clientes/' THEN substring(arquivo_url FROM '/(clientes/[^?]+)')
    END AS arquivo_key_extraida
  FROM obrigacoes
  WHERE nullif(btrim(arquivo_key), '') IS NULL
)
UPDATE obrigacoes AS o
SET arquivo_key = c.arquivo_key_extraida
FROM candidatas AS c
WHERE o.id = c.id
RETURNING o.id, o.arquivo_key;

COMMIT;

SELECT id, arquivo_url
FROM obrigacoes
WHERE nullif(btrim(arquivo_key), '') IS NULL;
