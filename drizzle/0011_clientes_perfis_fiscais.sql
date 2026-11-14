CREATE TABLE "clientes_perfis_fiscais" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"vigencia_inicio" date NOT NULL,
	"vigencia_fim" date,
	"uf" varchar(2),
	"inscricao_estadual" text,
	"regime_tributario" text,
	"origem" varchar(30) NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_clientes_perfil_fiscal_vigencia" CHECK ("clientes_perfis_fiscais"."vigencia_fim" IS NULL OR "clientes_perfis_fiscais"."vigencia_fim" >= "clientes_perfis_fiscais"."vigencia_inicio"),
	CONSTRAINT "chk_clientes_perfil_fiscal_origem" CHECK ("clientes_perfis_fiscais"."origem" IN ('CADASTRO_INICIAL', 'ANTERIOR_A_ALTERACAO', 'ALTERACAO_CADASTRAL', 'MANUAL'))
);
--> statement-breakpoint
ALTER TABLE "clientes_perfis_fiscais" ADD CONSTRAINT "clientes_perfis_fiscais_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_clientes_perfil_fiscal_inicio" ON "clientes_perfis_fiscais" USING btree ("cliente_id","vigencia_inicio");--> statement-breakpoint
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
       NEW.regime_tributario, 'CADASTRO_INICIAL');
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
       OLD.regime_tributario, 'ANTERIOR_A_ALTERACAO');
  END IF;

  SELECT * INTO aberto FROM clientes_perfis_fiscais
   WHERE cliente_id = OLD.id AND vigencia_fim IS NULL
   ORDER BY vigencia_inicio DESC LIMIT 1;

  IF aberto.id IS NOT NULL AND aberto.vigencia_inicio >= hoje THEN
    -- Várias alterações no mesmo dia: atualiza o perfil aberto.
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
       'ALTERACAO_CADASTRAL');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER trg_clientes_perfil_fiscal
AFTER INSERT OR UPDATE OF uf, inscricao_estadual, regime_tributario ON clientes
FOR EACH ROW EXECUTE FUNCTION fn_clientes_perfil_fiscal();
