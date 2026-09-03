// Aplica de forma IDEMPOTENTE o DDL das migrações 0002 e 0003 cujo tracker
// (__drizzle_migrations) marcou como aplicadas mas cujo DDL não executou.
// Somente operações aditivas/seguras (ADD COLUMN IF NOT EXISTS, CREATE TABLE
// IF NOT EXISTS, recriação da CHECK do CT-e).
const postgres = require('postgres');

(async () => {
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  try {
    await sql.begin(async (tx) => {
      // ── 0002: colunas em cfops ──────────────────────────────────────────
      await tx`ALTER TABLE cfops ADD COLUMN IF NOT EXISTS categoria_fiscal varchar(30) DEFAULT 'OUTRAS' NOT NULL`;
      await tx`ALTER TABLE cfops ADD COLUMN IF NOT EXISTS gera_credito_icms_padrao boolean DEFAULT false NOT NULL`;
      await tx`CREATE INDEX IF NOT EXISTS idx_cfops_categoria ON cfops (categoria_fiscal)`;
      await tx`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_cfops_categoria') THEN
            ALTER TABLE cfops ADD CONSTRAINT chk_cfops_categoria CHECK (categoria_fiscal IN ('COMPRA_REVENDA','COMPRA_INSUMO','USO_CONSUMO','ATIVO_IMOBILIZADO','DEVOLUCAO','TRANSFERENCIA','REMESSA_RETORNO','PRESTACAO_SERVICO','OUTRAS'));
          END IF;
        END $$;`;

      // ── 0002: regras_fiscais ────────────────────────────────────────────
      await tx`CREATE TABLE IF NOT EXISTS regras_fiscais (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        cliente_id uuid REFERENCES clientes(id) ON DELETE cascade,
        prioridade integer DEFAULT 100 NOT NULL,
        nome_regra text NOT NULL,
        tipo_operacao_origem varchar(10),
        cfop_origem varchar(4),
        ncm varchar(8),
        cst_icms_origem varchar(3),
        csosn_origem varchar(4),
        fornecedor_cnpj_cpf text,
        uf_origem varchar(2),
        destinacao_mercadoria varchar(20),
        cfop_destino varchar(4) NOT NULL REFERENCES cfops(codigo),
        cst_icms_destino varchar(3),
        csosn_destino varchar(4),
        apropria_credito_icms boolean DEFAULT false NOT NULL,
        percentual_reducao_bc_icms numeric(7,4),
        apropria_credito_ipi boolean DEFAULT false NOT NULL,
        apropria_credito_pis_cofins boolean DEFAULT false NOT NULL,
        cst_pis_destino varchar(2),
        cst_cofins_destino varchar(2),
        exige_ciap boolean DEFAULT false NOT NULL,
        exige_difal_entrada boolean DEFAULT false NOT NULL,
        observacao_fiscal text,
        ativo boolean DEFAULT true NOT NULL,
        criado_em timestamp DEFAULT now() NOT NULL,
        atualizado_em timestamp DEFAULT now() NOT NULL,
        CONSTRAINT chk_regras_fiscais_tipo_origem CHECK (tipo_operacao_origem IS NULL OR tipo_operacao_origem IN ('ENTRADA','SAIDA')),
        CONSTRAINT chk_regras_fiscais_destinacao CHECK (destinacao_mercadoria IS NULL OR destinacao_mercadoria IN ('REVENDA','INDUSTRIALIZACAO','USO_CONSUMO','ATIVO_IMOBILIZADO')),
        CONSTRAINT chk_regras_fiscais_prioridade CHECK (prioridade >= 0)
      )`;
      await tx`CREATE INDEX IF NOT EXISTS idx_regras_fiscais_cliente ON regras_fiscais (cliente_id)`;
      await tx`CREATE INDEX IF NOT EXISTS idx_regras_fiscais_match ON regras_fiscais (tipo_operacao_origem, cfop_origem, prioridade)`;
      await tx`CREATE INDEX IF NOT EXISTS idx_regras_fiscais_ncm ON regras_fiscais (ncm)`;

      // ── 0002: ciap_ativo_permanente ─────────────────────────────────────
      await tx`CREATE TABLE IF NOT EXISTS ciap_ativo_permanente (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        cliente_id uuid NOT NULL REFERENCES clientes(id) ON DELETE cascade,
        documento_fiscal_id uuid REFERENCES documentos_fiscais(id) ON DELETE set null,
        documento_fiscal_item_id uuid REFERENCES documentos_fiscais_itens(id) ON DELETE set null,
        codigo_bem varchar(60) NOT NULL,
        identificacao_bem text NOT NULL,
        data_entrada date NOT NULL,
        valor_icms_total numeric(15,2) NOT NULL,
        valor_icms_frete numeric(15,2) DEFAULT '0',
        valor_icms_difal numeric(15,2) DEFAULT '0',
        quantidade_parcelas integer DEFAULT 48 NOT NULL,
        parcelas_apropriadas integer DEFAULT 0 NOT NULL,
        saldo_credor_restante numeric(15,2) NOT NULL,
        status varchar(20) DEFAULT 'ATIVO' NOT NULL,
        data_baixa date,
        motivo_baixa varchar(2),
        criado_em timestamp DEFAULT now() NOT NULL,
        atualizado_em timestamp DEFAULT now() NOT NULL,
        CONSTRAINT chk_ciap_status CHECK (status IN ('ATIVO','BAIXADO','CONCLUIDO')),
        CONSTRAINT chk_ciap_parcelas CHECK (quantidade_parcelas > 0 AND parcelas_apropriadas >= 0 AND parcelas_apropriadas <= quantidade_parcelas),
        CONSTRAINT chk_ciap_motivo_baixa CHECK (motivo_baixa IS NULL OR motivo_baixa IN ('01','02','03'))
      )`;
      await tx`CREATE INDEX IF NOT EXISTS idx_ciap_cliente ON ciap_ativo_permanente (cliente_id)`;
      await tx`CREATE INDEX IF NOT EXISTS idx_ciap_status ON ciap_ativo_permanente (status)`;
      await tx`CREATE UNIQUE INDEX IF NOT EXISTS uidx_ciap_cliente_codigo_bem ON ciap_ativo_permanente (cliente_id, codigo_bem)`;

      // ── 0002: fiscal_apuracoes_guias ────────────────────────────────────
      await tx`CREATE TABLE IF NOT EXISTS fiscal_apuracoes_guias (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        cliente_id uuid NOT NULL REFERENCES clientes(id) ON DELETE cascade,
        competencia date NOT NULL,
        tributo varchar(20) NOT NULL,
        uf_favorecida varchar(2) NOT NULL,
        tipo_guia varchar(10) NOT NULL,
        codigo_receita text NOT NULL,
        data_vencimento date NOT NULL,
        valor_principal numeric(15,2) NOT NULL,
        valor_multa numeric(15,2) DEFAULT '0',
        valor_juros numeric(15,2) DEFAULT '0',
        valor_total numeric(15,2) NOT NULL,
        codigo_barras text,
        linha_digitavel text,
        status_pagamento varchar(20) DEFAULT 'PENDENTE' NOT NULL,
        arquivo_guia_key text,
        criado_em timestamp DEFAULT now() NOT NULL,
        atualizado_em timestamp DEFAULT now() NOT NULL,
        CONSTRAINT chk_fiscal_guias_tributo CHECK (tributo IN ('ICMS_PROPRIO','ICMS_ST','DIFAL_ENTRADA','DIFAL_SAIDA','FCP','IPI','PIS','COFINS','DAS_SIMPLES')),
        CONSTRAINT chk_fiscal_guias_tipo CHECK (tipo_guia IN ('DAE','GNRE','DARF','DAS')),
        CONSTRAINT chk_fiscal_guias_status CHECK (status_pagamento IN ('PENDENTE','PAGO','VENCIDO')),
        CONSTRAINT chk_fiscal_guias_uf CHECK (uf_favorecida ~ '^[A-Z]{2}$')
      )`;
      await tx`CREATE INDEX IF NOT EXISTS idx_fiscal_guias_cliente_competencia ON fiscal_apuracoes_guias (cliente_id, competencia)`;
      await tx`CREATE INDEX IF NOT EXISTS idx_fiscal_guias_status ON fiscal_apuracoes_guias (status_pagamento)`;

      // ── 0003: relaxa a CHECK do CT-e para permitir SAIDA ────────────────
      await tx`ALTER TABLE documentos_fiscais_cte_escrituracao DROP CONSTRAINT IF EXISTS chk_cte_escrituracao_operacao`;
      await tx`ALTER TABLE documentos_fiscais_cte_escrituracao ADD CONSTRAINT chk_cte_escrituracao_operacao CHECK (tipo_operacao_escriturada IN ('ENTRADA','SAIDA'))`;
    });
    console.log('DDL fiscal aplicado com sucesso.');
  } catch (e) {
    console.log('FALHA:', e.code, e.message);
    process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
})();
