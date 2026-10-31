-- Diagnóstico somente leitura para uma cópia representativa do banco alvo.
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
SELECT 'sped_contabilistas' AS objeto, count(*) AS linhas FROM sped_contabilistas
UNION ALL SELECT 'fiscal_lancamentos', count(*) FROM fiscal_lancamentos
UNION ALL SELECT 'fiscal_perfis_vigencia', count(*) FROM fiscal_perfis_vigencia
UNION ALL SELECT 'ciap_competencias_apropriadas', count(*) FROM ciap_competencias_apropriadas
UNION ALL SELECT 'ciap_movimentos', count(*) FROM ciap_movimentos
UNION ALL SELECT 'sped_arquivos_gerados', count(*) FROM sped_arquivos_gerados
UNION ALL SELECT 'classificacao_destinacao_aprendizado', count(*) FROM classificacao_destinacao_aprendizado
UNION ALL SELECT 'fiscal_regras_versoes', count(*) FROM fiscal_regras_versoes
UNION ALL SELECT 'fiscal_decisoes_item', count(*) FROM fiscal_decisoes_item;

-- FKs que apontam para candidatas, inclusive autorreferências.
SELECT f.confrelid::regclass AS tabela_referenciada,
       f.conrelid::regclass AS tabela_origem, f.conname,
       pg_get_constraintdef(f.oid) AS definicao
FROM pg_constraint f
WHERE f.contype = 'f'
  AND f.confrelid IN (
    'sped_contabilistas'::regclass, 'fiscal_lancamentos'::regclass,
    'fiscal_perfis_vigencia'::regclass, 'ciap_competencias_apropriadas'::regclass,
    'ciap_movimentos'::regclass, 'sped_arquivos_gerados'::regclass,
    'classificacao_destinacao_aprendizado'::regclass,
    'fiscal_regras_versoes'::regclass, 'fiscal_decisoes_item'::regclass
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

COMMIT;
