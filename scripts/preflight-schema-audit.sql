-- Diagnóstico somente leitura para uma cópia representativa do banco alvo.
-- Funciona antes e depois da 0004 (57 ou 54 tabelas); requer psql por \gexec.
-- Execute com: psql "$KONTABB_AUDIT_DATABASE_URL" -v ON_ERROR_STOP=1 \
--   -f scripts/preflight-schema-audit.sql
-- Não aplique migrations, DROP ou backfill com base apenas neste resultado.

BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';

SELECT current_database() AS banco, current_schema() AS schema_atual,
       current_setting('server_version') AS postgres_versao;

-- Compare a contagem e os hashes com drizzle/meta/_journal.json e migrations.
SELECT id, hash, created_at
FROM drizzle.__drizzle_migrations
ORDER BY created_at;

-- Estimativa do catálogo; as contagens exatas abaixo são a evidência principal.
WITH candidatas(tabela) AS (
  VALUES ('sped_contabilistas'), ('fiscal_lancamentos'),
         ('fiscal_perfis_vigencia'), ('ciap_competencias_apropriadas'),
         ('ciap_movimentos'), ('sped_arquivos_gerados'),
         ('classificacao_destinacao_aprendizado'), ('fiscal_regras_versoes'),
         ('fiscal_decisoes_item')
)
SELECT c.tabela, to_regclass('public.' || c.tabela) IS NOT NULL AS existe,
       p.reltuples::bigint AS linhas_estimadas
FROM candidatas c
LEFT JOIN pg_class p ON p.oid = to_regclass('public.' || c.tabela)
ORDER BY c.tabela;

-- Contagens exatas: revise custo/timeout no alvo antes de executar.
-- Uma tabela retirada aparece com linhas NULL; zero significa tabela existente
-- e vazia. A query gerada usa somente nomes fixos desta lista.
WITH candidatas(tabela, ordem) AS (
  VALUES ('sped_contabilistas', 1), ('fiscal_lancamentos', 2),
         ('fiscal_perfis_vigencia', 3), ('ciap_competencias_apropriadas', 4),
         ('ciap_movimentos', 5), ('sped_arquivos_gerados', 6),
         ('classificacao_destinacao_aprendizado', 7),
         ('fiscal_regras_versoes', 8), ('fiscal_decisoes_item', 9)
)
SELECT string_agg(
  CASE WHEN to_regclass(format('public.%I', tabela)) IS NULL
    THEN format('SELECT %L::text AS objeto, NULL::bigint AS linhas', tabela)
    ELSE format('SELECT %L::text AS objeto, count(*)::bigint AS linhas FROM public.%I', tabela, tabela)
  END,
  E' UNION ALL\n' ORDER BY ordem
)
FROM candidatas
\gexec

-- FKs que apontam para candidatas, inclusive autorreferências.
SELECT f.confrelid::regclass AS tabela_referenciada,
       f.conrelid::regclass AS tabela_origem, f.conname,
       pg_get_constraintdef(f.oid) AS definicao
FROM pg_constraint f
WHERE f.contype = 'f'
  AND f.confrelid IN (
    to_regclass('public.sped_contabilistas'),
    to_regclass('public.fiscal_lancamentos'),
    to_regclass('public.fiscal_perfis_vigencia'),
    to_regclass('public.ciap_competencias_apropriadas'),
    to_regclass('public.ciap_movimentos'),
    to_regclass('public.sped_arquivos_gerados'),
    to_regclass('public.classificacao_destinacao_aprendizado'),
    to_regclass('public.fiscal_regras_versoes'),
    to_regclass('public.fiscal_decisoes_item')
  )
ORDER BY 1, 2, 3;

-- Índices das tabelas candidatas e sua definição para revisão de dependência.
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN (
    'sped_contabilistas', 'fiscal_lancamentos', 'fiscal_perfis_vigencia',
    'ciap_competencias_apropriadas', 'ciap_movimentos',
    'sped_arquivos_gerados', 'classificacao_destinacao_aprendizado',
    'fiscal_regras_versoes', 'fiscal_decisoes_item'
  )
ORDER BY tablename, indexname;

-- Campos candidatos: presença e ocupação real, sem retornar conteúdo pessoal.
SELECT 'folhas_pagamento.documento_id' AS objeto,
       count(*) AS linhas_totais, count(documento_id) AS nao_nulos
FROM folhas_pagamento
UNION ALL
SELECT 'documentos_fiscais_itens.cod_obs_sped', count(*), count(cod_obs_sped)
FROM documentos_fiscais_itens
UNION ALL
SELECT 'regras_fiscais.apropria_credito_pis_cofins', count(*),
       count(apropria_credito_pis_cofins)
FROM regras_fiscais
UNION ALL
SELECT 'fiscal_catalogos_versoes.data_carga', count(*), count(data_carga)
FROM fiscal_catalogos_versoes;

WITH candidatas(tabela, coluna) AS (
  VALUES ('folhas_pagamento', 'documento_id'),
         ('documentos_fiscais_itens', 'cod_obs_sped'),
         ('regras_fiscais', 'apropria_credito_pis_cofins'),
         ('fiscal_catalogos_versoes', 'data_carga')
)
SELECT c.tabela, c.coluna, a.attnotnull AS obrigatoria,
       format_type(a.atttypid, a.atttypmod) AS tipo
FROM candidatas c
LEFT JOIN pg_attribute a
  ON a.attrelid = to_regclass('public.' || c.tabela)
 AND a.attname = c.coluna AND NOT a.attisdropped
ORDER BY c.tabela, c.coluna;

-- Inclui índices, constraints e views registrados no catálogo como dependentes.
WITH candidatas(tabela, coluna) AS (
  VALUES ('folhas_pagamento', 'documento_id'),
         ('documentos_fiscais_itens', 'cod_obs_sped'),
         ('regras_fiscais', 'apropria_credito_pis_cofins'),
         ('fiscal_catalogos_versoes', 'data_carga')
), colunas AS (
  SELECT c.tabela, c.coluna, a.attrelid, a.attnum
  FROM candidatas c
  JOIN pg_attribute a
    ON a.attrelid = to_regclass('public.' || c.tabela)
   AND a.attname = c.coluna AND NOT a.attisdropped
)
SELECT c.tabela, c.coluna,
       pg_describe_object(d.classid, d.objid, d.objsubid) AS dependente,
       d.deptype AS tipo_dependencia
FROM colunas c
JOIN pg_depend d
  ON d.refclassid = 'pg_class'::regclass
 AND d.refobjid = c.attrelid AND d.refobjsubid = c.attnum
ORDER BY c.tabela, c.coluna, dependente;

-- A baixa histórica precisa de revisão humana; status sozinho não prova pagamento.
SELECT count(*) AS guias_upload_pagas_sem_evento_origem
FROM guias g
JOIN fiscal_apuracoes_guias f ON f.guia_upload_id = g.id
WHERE g.status = 'PAGO' AND f.cancelada = false
  AND NOT EXISTS (
    SELECT 1 FROM fiscal_pagamentos_eventos e
    WHERE e.guia_id = f.id
      AND e.documento_externo = concat('guia-upload:', g.id)
  );

WITH saldos AS (
  SELECT f.id, f.status_pagamento, f.valor_total,
         COALESCE(sum(e.sinal * e.valor), 0) AS total_pago
  FROM fiscal_apuracoes_guias f
  LEFT JOIN fiscal_pagamentos_eventos e ON e.guia_id = f.id
  WHERE f.cancelada = false
  GROUP BY f.id
)
SELECT count(*) AS guias_fiscais_pagas_com_saldo_aberto
FROM saldos
WHERE status_pagamento = 'PAGO' AND total_pago < valor_total;

WITH saldos AS (
  SELECT f.id, f.guia_upload_id, f.valor_total,
         COALESCE(sum(e.sinal * e.valor), 0) AS total_pago
  FROM fiscal_apuracoes_guias f
  LEFT JOIN fiscal_pagamentos_eventos e ON e.guia_id = f.id
  WHERE f.cancelada = false AND f.guia_upload_id IS NOT NULL
  GROUP BY f.id
)
SELECT count(*) AS guias_upload_pendentes_com_fiscal_ja_quitado
FROM saldos s
JOIN guias g ON g.id = s.guia_upload_id
WHERE g.status = 'PENDENTE' AND s.total_pago >= s.valor_total;

SELECT count(*) AS origens_de_upload_duplicadas
FROM (
  SELECT guia_id, documento_externo
  FROM fiscal_pagamentos_eventos
  WHERE documento_externo LIKE 'guia-upload:%'
  GROUP BY guia_id, documento_externo
  HAVING count(*) > 1
) duplicadas;

COMMIT;
