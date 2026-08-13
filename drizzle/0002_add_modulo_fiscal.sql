-- Módulo Fiscal — Certificados Digitais, Controle NSU, Documentos e Eventos Fiscais

CREATE TABLE IF NOT EXISTS "certificados_digitais" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "cliente_id" uuid NOT NULL REFERENCES "clientes"("id") ON DELETE CASCADE,
  "cnpj" text NOT NULL,
  "razao_social" text NOT NULL,
  "arquivo_key" text NOT NULL,
  "senha_criptografada" text NOT NULL,
  "thumbprint" text,
  "emissor" text,
  "validade_inicio" timestamp NOT NULL,
  "validade_fim" timestamp NOT NULL,
  "status" text NOT NULL DEFAULT 'ATIVO',
  "uploadado_por" text REFERENCES "user"("id") ON DELETE SET NULL,
  "criado_em" timestamp NOT NULL DEFAULT now(),
  "atualizado_em" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "chk_certificados_status" CHECK ("status" IN ('ATIVO', 'EXPIRADO', 'PRESTES_A_EXPIRAR', 'REVOGADO')),
  CONSTRAINT "chk_certificados_cnpj" CHECK ("cnpj" ~ '^[0-9]{14}$'),
  CONSTRAINT "chk_certificados_validade" CHECK ("validade_inicio" < "validade_fim"),
  CONSTRAINT "chk_certificados_arquivo_key" CHECK (btrim("arquivo_key") <> '')
);

CREATE INDEX "idx_certificados_cliente_id" ON "certificados_digitais" ("cliente_id");
CREATE INDEX "idx_certificados_cnpj" ON "certificados_digitais" ("cnpj");
CREATE INDEX "idx_certificados_status" ON "certificados_digitais" ("status");
CREATE INDEX "idx_certificados_validade_fim" ON "certificados_digitais" ("validade_fim");
CREATE UNIQUE INDEX "uidx_certificados_cliente_ativo" ON "certificados_digitais" ("cliente_id") WHERE status IN ('ATIVO', 'PRESTES_A_EXPIRAR');

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "controle_nsu" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "cliente_id" uuid NOT NULL REFERENCES "clientes"("id") ON DELETE CASCADE,
  "cnpj" text NOT NULL,
  "tipo_documento" text NOT NULL,
  "ultimo_nsu" bigint NOT NULL DEFAULT 0,
  "max_nsu" bigint NOT NULL DEFAULT 0,
  "status_sefaz" integer,
  "motivo_sefaz" text,
  "ultima_consulta_em" timestamp,
  "proxima_consulta_em" timestamp,
  "criado_em" timestamp NOT NULL DEFAULT now(),
  "atualizado_em" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "chk_controle_nsu_tipo" CHECK ("tipo_documento" IN ('NFE', 'CTE')),
  CONSTRAINT "chk_controle_nsu_ultimo" CHECK ("ultimo_nsu" >= 0),
  CONSTRAINT "chk_controle_nsu_max" CHECK ("max_nsu" >= 0)
);

CREATE UNIQUE INDEX "uidx_controle_nsu_cliente_tipo" ON "controle_nsu" ("cliente_id", "tipo_documento");
CREATE INDEX "idx_controle_nsu_cliente_id" ON "controle_nsu" ("cliente_id");

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "documentos_fiscais" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "cliente_id" uuid NOT NULL REFERENCES "clientes"("id") ON DELETE CASCADE,
  "chave_acesso" text NOT NULL UNIQUE,
  "nsu" bigint NOT NULL,
  "tipo_documento" text NOT NULL,
  "modelo" text NOT NULL,
  "serie" text,
  "numero_documento" text NOT NULL,
  "emitente_cnpj_cpf" text NOT NULL,
  "emitente_razao_social" text,
  "destinatario_cnpj_cpf" text NOT NULL,
  "destinatario_razao_social" text,
  "data_emissao" timestamp NOT NULL,
  "valor_total" numeric(14, 2) NOT NULL,
  "situacao" text NOT NULL DEFAULT 'AUTORIZADA',
  "manifestacao_status" text NOT NULL DEFAULT 'SEM_MANIFESTACAO',
  "xml_key" text NOT NULL,
  "danfe_key" text,
  "criado_em" timestamp NOT NULL DEFAULT now(),
  "atualizado_em" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "chk_docs_fiscais_chave" CHECK (length("chave_acesso") = 44),
  CONSTRAINT "chk_docs_fiscais_tipo" CHECK ("tipo_documento" IN ('NFE', 'CTE', 'NFCE')),
  CONSTRAINT "chk_docs_fiscais_modelo" CHECK ("modelo" IN ('55', '57', '65')),
  CONSTRAINT "chk_docs_fiscais_situacao" CHECK ("situacao" IN ('AUTORIZADA', 'CANCELADA', 'DENEGADA', 'RESUMIDA')),
  CONSTRAINT "chk_docs_fiscais_manifestacao" CHECK ("manifestacao_status" IN ('SEM_MANIFESTACAO', 'CIENCIA', 'CONFIRMADA', 'DESCONHECIDA', 'NAO_REALIZADA')),
  CONSTRAINT "chk_docs_fiscais_valor" CHECK ("valor_total" >= 0),
  CONSTRAINT "chk_docs_fiscais_xml_key" CHECK (btrim("xml_key") <> '')
);

CREATE UNIQUE INDEX "uidx_docs_fiscais_chave" ON "documentos_fiscais" ("chave_acesso");
CREATE INDEX "idx_docs_fiscais_cliente_id" ON "documentos_fiscais" ("cliente_id");
CREATE INDEX "idx_docs_fiscais_tipo" ON "documentos_fiscais" ("tipo_documento");
CREATE INDEX "idx_docs_fiscais_data_emissao" ON "documentos_fiscais" ("data_emissao");
CREATE INDEX "idx_docs_fiscais_nsu" ON "documentos_fiscais" ("nsu");
CREATE INDEX "idx_docs_fiscais_destinatario" ON "documentos_fiscais" ("destinatario_cnpj_cpf");
CREATE INDEX "idx_docs_fiscais_emitente" ON "documentos_fiscais" ("emitente_cnpj_cpf");

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "eventos_fiscais" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "documento_fiscal_id" uuid NOT NULL REFERENCES "documentos_fiscais"("id") ON DELETE CASCADE,
  "tipo_evento" text NOT NULL,
  "codigo_evento" text NOT NULL,
  "sequencia_evento" integer NOT NULL DEFAULT 1,
  "descricao" text,
  "protocolo" text,
  "status_sefaz" integer,
  "motivo_sefaz" text,
  "data_evento" timestamp NOT NULL DEFAULT now(),
  "xml_evento_key" text,
  "criado_em" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "chk_eventos_fiscais_tipo" CHECK ("tipo_evento" IN ('MANIFESTACAO_CIENCIA', 'MANIFESTACAO_CONFIRMACAO', 'MANIFESTACAO_DESCONHECIMENTO', 'MANIFESTACAO_NAO_REALIZADA', 'CANCELAMENTO', 'CCE')),
  CONSTRAINT "chk_eventos_fiscais_sequencia" CHECK ("sequencia_evento" >= 1)
);

CREATE INDEX "idx_eventos_fiscais_doc" ON "eventos_fiscais" ("documento_fiscal_id");
CREATE INDEX "idx_eventos_fiscais_tipo" ON "eventos_fiscais" ("tipo_evento");
CREATE INDEX "idx_eventos_fiscais_data" ON "eventos_fiscais" ("data_evento");
