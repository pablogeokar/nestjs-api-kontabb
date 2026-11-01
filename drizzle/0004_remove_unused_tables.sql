-- Esta migration depende da transação do migrador Drizzle. O lock impede uma
-- escrita entre a verificação de vazio e os DROP; qualquer erro reverte tudo.
-- A consulta prévia ao catálogo e a homologação de restore continuam sendo
-- requisitos de rollout. Nunca execute esta migration no banco implantado
-- sem uma autorização posterior que revogue a proibição atual do usuário.
SET LOCAL lock_timeout = '3s';--> statement-breakpoint
SET LOCAL statement_timeout = '15s';--> statement-breakpoint
LOCK TABLE public.fiscal_lancamentos, public.fiscal_perfis_vigencia,
           public.sped_contabilistas IN ACCESS EXCLUSIVE MODE;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.fiscal_lancamentos) THEN
    RAISE EXCEPTION 'fiscal_lancamentos contém dados; migration 0004 abortada';
  END IF;
  IF EXISTS (SELECT 1 FROM public.fiscal_perfis_vigencia) THEN
    RAISE EXCEPTION 'fiscal_perfis_vigencia contém dados; migration 0004 abortada';
  END IF;
  IF EXISTS (SELECT 1 FROM public.sped_contabilistas) THEN
    RAISE EXCEPTION 'sped_contabilistas contém dados; migration 0004 abortada';
  END IF;
END;
$$;--> statement-breakpoint
DROP TABLE public.fiscal_lancamentos RESTRICT;--> statement-breakpoint
DROP TABLE public.fiscal_perfis_vigencia RESTRICT;--> statement-breakpoint
DROP TABLE public.sped_contabilistas RESTRICT;
