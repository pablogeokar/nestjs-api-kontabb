import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { cfops } from './cfops';
import { clientes } from './clientes';

// ─────────────────────────────────────────────────────────────────────────────
// Motor de regras fiscais, CIAP (Bloco G) e guias de apuração
// ─────────────────────────────────────────────────────────────────────────────

// Regras fiscais avançadas (Rule Engine). clienteId nulo = regra global.
// Resolvem CFOP escriturado, CST/CSOSN e direito a crédito com base em
// destinação da mercadoria, NCM, fornecedor, UF e CFOP de origem.

export const regrasFiscais = pgTable(
  'regras_fiscais',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clienteId: uuid('cliente_id').references(() => clientes.id, {
      onDelete: 'cascade',
    }),
    prioridade: integer('prioridade').notNull().default(100),
    nomeRegra: text('nome_regra').notNull(),

    // Critérios de correspondência (match)
    tipoOperacaoOrigem: varchar('tipo_operacao_origem', { length: 10 }),
    cfopOrigem: varchar('cfop_origem', { length: 4 }),
    ncm: varchar('ncm', { length: 8 }),
    cstIcmsOrigem: varchar('cst_icms_origem', { length: 3 }),
    csosnOrigem: varchar('csosn_origem', { length: 4 }),
    fornecedorCnpjCpf: text('fornecedor_cnpj_cpf'),
    ufOrigem: varchar('uf_origem', { length: 2 }),
    destinacaoMercadoria: varchar('destinacao_mercadoria', { length: 20 }),

    // Ações resultantes (transform)
    cfopDestino: varchar('cfop_destino', { length: 4 })
      .notNull()
      .references(() => cfops.codigo),
    cstIcmsDestino: varchar('cst_icms_destino', { length: 3 }),
    csosnDestino: varchar('csosn_destino', { length: 4 }),
    apropriaCreditoIcms: boolean('apropria_credito_icms')
      .notNull()
      .default(false),
    percentualReducaoBcIcms: numeric('percentual_reducao_bc_icms', {
      precision: 7,
      scale: 4,
    }),
    apropriaCreditoIpi: boolean('apropria_credito_ipi')
      .notNull()
      .default(false),
    apropriaCreditoPisCofins: boolean('apropria_credito_pis_cofins')
      .notNull()
      .default(false),
    cstPisDestino: varchar('cst_pis_destino', { length: 2 }),
    cstCofinsDestino: varchar('cst_cofins_destino', { length: 2 }),
    exigeCiap: boolean('exige_ciap').notNull().default(false),
    exigeDifalEntrada: boolean('exige_difal_entrada').notNull().default(false),
    observacaoFiscal: text('observacao_fiscal'),

    ativo: boolean('ativo').notNull().default(true),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
  },
  (table) => [
    index('idx_regras_fiscais_cliente').on(table.clienteId),
    index('idx_regras_fiscais_match').on(
      table.tipoOperacaoOrigem,
      table.cfopOrigem,
      table.prioridade,
    ),
    index('idx_regras_fiscais_ncm').on(table.ncm),
    check(
      'chk_regras_fiscais_tipo_origem',
      sql`${table.tipoOperacaoOrigem} IS NULL OR ${table.tipoOperacaoOrigem} IN ('ENTRADA', 'SAIDA')`,
    ),
    check(
      'chk_regras_fiscais_destinacao',
      sql`${table.destinacaoMercadoria} IS NULL OR ${table.destinacaoMercadoria} IN ('REVENDA', 'INDUSTRIALIZACAO', 'USO_CONSUMO', 'ATIVO_IMOBILIZADO')`,
    ),
    check('chk_regras_fiscais_prioridade', sql`${table.prioridade} >= 0`),
  ],
);
