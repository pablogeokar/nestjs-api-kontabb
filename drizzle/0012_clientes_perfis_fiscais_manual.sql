DROP INDEX "uidx_clientes_perfil_fiscal_inicio";--> statement-breakpoint
ALTER TABLE "clientes_perfis_fiscais" ADD COLUMN "fonte" text;--> statement-breakpoint
ALTER TABLE "clientes_perfis_fiscais" ADD COLUMN "justificativa" text;--> statement-breakpoint
ALTER TABLE "clientes_perfis_fiscais" ADD COLUMN "criado_por" text;--> statement-breakpoint
ALTER TABLE "clientes_perfis_fiscais" ADD COLUMN "ativo" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "clientes_perfis_fiscais" ADD COLUMN "substituido_por" uuid;--> statement-breakpoint
ALTER TABLE "clientes_perfis_fiscais" ADD CONSTRAINT "clientes_perfis_fiscais_criado_por_user_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_clientes_perfil_fiscal_inicio" ON "clientes_perfis_fiscais" USING btree ("cliente_id","vigencia_inicio") WHERE "clientes_perfis_fiscais"."ativo";--> statement-breakpoint
CREATE OR REPLACE FUNCTION fn_clientes_perfil_fiscal() RETURNS trigger AS $$
DECLARE
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  aberto clientes_perfis_fiscais%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO clientes_perfis_fiscais
      (cliente_id, vigencia_inicio, uf, inscricao_estadual, regime_tributario, origem)
    VALUES
      (NEW.id, LEAST(NEW.criado_em::date, hoje), NEW.uf, NEW.inscricao_estadual,
       NEW.regime_tributario, 'CADASTRO_INICIAL')
    ON CONFLICT (cliente_id, vigencia_inicio) WHERE ativo DO NOTHING;
    RETURN NEW;
  END IF;

  IF NEW.uf IS NOT DISTINCT FROM OLD.uf
     AND NEW.inscricao_estadual IS NOT DISTINCT FROM OLD.inscricao_estadual
     AND NEW.regime_tributario IS NOT DISTINCT FROM OLD.regime_tributario THEN
    RETURN NEW;
  END IF;

  -- Cliente anterior ao histórico: registra o estado ANTERIOR à alteração.
  IF NOT EXISTS (SELECT 1 FROM clientes_perfis_fiscais WHERE cliente_id = OLD.id) THEN
    INSERT INTO clientes_perfis_fiscais
      (cliente_id, vigencia_inicio, uf, inscricao_estadual, regime_tributario, origem)
    VALUES
      (OLD.id, LEAST(OLD.criado_em::date, hoje), OLD.uf, OLD.inscricao_estadual,
       OLD.regime_tributario, 'ANTERIOR_A_ALTERACAO')
    ON CONFLICT (cliente_id, vigencia_inicio) WHERE ativo DO NOTHING;
  END IF;

  -- Só linhas automáticas ativas participam do encadeamento. Perfis MANUAL
  -- (datas legais) nunca são fechados nem sobrescritos por este trigger.
  SELECT * INTO aberto FROM clientes_perfis_fiscais
   WHERE cliente_id = OLD.id AND ativo AND vigencia_fim IS NULL AND origem <> 'MANUAL'
   ORDER BY vigencia_inicio DESC LIMIT 1;

  IF aberto.id IS NOT NULL AND aberto.vigencia_inicio >= hoje THEN
    UPDATE clientes_perfis_fiscais
       SET uf = NEW.uf, inscricao_estadual = NEW.inscricao_estadual,
           regime_tributario = NEW.regime_tributario
     WHERE id = aberto.id;
  ELSE
    IF aberto.id IS NOT NULL THEN
      UPDATE clientes_perfis_fiscais SET vigencia_fim = hoje - 1 WHERE id = aberto.id;
    END IF;
    INSERT INTO clientes_perfis_fiscais
      (cliente_id, vigencia_inicio, uf, inscricao_estadual, regime_tributario, origem)
    VALUES
      (NEW.id, hoje, NEW.uf, NEW.inscricao_estadual, NEW.regime_tributario,
       'ALTERACAO_CADASTRAL')
    ON CONFLICT (cliente_id, vigencia_inicio) WHERE ativo DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
