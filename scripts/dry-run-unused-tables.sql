-- Ensaio local de uma possível migration futura. Em sucesso termina em
-- ROLLBACK; com ON_ERROR_STOP, uma falha encerra a sessão e reverte a transação.
-- Execute SOMENTE em clone descartável, com psql -v ON_ERROR_STOP=1.
-- Não é uma migration Drizzle; não inclua no journal sem verificar o banco
-- implantado, consumidores externos, backup/restauração e janela de deploy.

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM sped_contabilistas) THEN
    RAISE EXCEPTION 'sped_contabilistas contém dados; abortando ensaio';
  END IF;
  IF EXISTS (SELECT 1 FROM fiscal_lancamentos) THEN
    RAISE EXCEPTION 'fiscal_lancamentos contém dados; abortando ensaio';
  END IF;
  IF EXISTS (SELECT 1 FROM fiscal_perfis_vigencia) THEN
    RAISE EXCEPTION 'fiscal_perfis_vigencia contém dados; abortando ensaio';
  END IF;
END;
$$;

-- RESTRICT falha se surgir qualquer dependência, sem remover objetos em cascata.
DROP TABLE sped_contabilistas, fiscal_lancamentos,
           fiscal_perfis_vigencia RESTRICT;

SELECT to_regclass('public.sped_contabilistas') IS NULL AS contabilistas_ausente,
       to_regclass('public.fiscal_lancamentos') IS NULL AS lancamentos_ausente,
       to_regclass('public.fiscal_perfis_vigencia') IS NULL AS perfis_ausente;

ROLLBACK;

SELECT to_regclass('public.sped_contabilistas') IS NOT NULL AS contabilistas_restaurada,
       to_regclass('public.fiscal_lancamentos') IS NOT NULL AS lancamentos_restaurada,
       to_regclass('public.fiscal_perfis_vigencia') IS NOT NULL AS perfis_restaurada;
