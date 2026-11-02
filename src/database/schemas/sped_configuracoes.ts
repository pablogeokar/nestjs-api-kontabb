import {
  boolean,
  check,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { clientes } from './clientes';
import { user } from './user';

// ─────────────────────────────────────────────────────────────────────────────
// EFD ICMS/IPI (SPED Fiscal)
// ─────────────────────────────────────────────────────────────────────────────

export const spedConfiguracoes = pgTable(
  'sped_configuracoes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    obrigadoEfdIcmsIpi: boolean('obrigado_efd_icms_ipi')
      .notNull()
      .default(false),
    perfilEfd: varchar('perfil_efd', { length: 1 }),
    indAtiv: varchar('ind_ativ', { length: 1 }),
    classificacaoEstabelecimentoIndustrial: varchar(
      'classificacao_estabelecimento_industrial',
      { length: 2 },
    ),
    codigoMunicipioIbge: varchar('codigo_municipio_ibge', { length: 7 }),
    nomeFantasia: text('nome_fantasia'),
    inscricaoMunicipal: text('inscricao_municipal'),
    suframa: text('suframa'),
    telefone: text('telefone'),
    fax: text('fax'),
    inventarioObrigatorio: boolean('inventario_obrigatorio')
      .notNull()
      .default(false),
    mesEntregaInventario: integer('mes_entrega_inventario')
      .notNull()
      .default(2),
    blocoKComMovimento: boolean('bloco_k_com_movimento')
      .notNull()
      .default(false),
    tipoItemPadrao: varchar('tipo_item_padrao', { length: 2 })
      .notNull()
      .default('00'),
    indicadores1010: jsonb('indicadores_1010')
      .$type<Record<string, 'S' | 'N'>>()
      .notNull()
      .default({}),
    atualizadoPor: text('atualizado_por').references(() => user.id, {
      onDelete: 'set null',
    }),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uidx_sped_config_cliente').on(table.clienteId),
    check(
      'chk_sped_config_perfil',
      sql`${table.perfilEfd} IS NULL OR ${table.perfilEfd} IN ('A', 'B', 'C')`,
    ),
    check(
      'chk_sped_config_ind_ativ',
      sql`${table.indAtiv} IS NULL OR ${table.indAtiv} IN ('0', '1')`,
    ),
    check(
      'chk_sped_config_clas_estab_ind',
      sql`${table.classificacaoEstabelecimentoIndustrial} IS NULL OR ${table.classificacaoEstabelecimentoIndustrial} ~ '^[0-9]{2}$'`,
    ),
    check(
      'chk_sped_config_codigo_municipio',
      sql`${table.codigoMunicipioIbge} IS NULL OR ${table.codigoMunicipioIbge} ~ '^[0-9]{7}$'`,
    ),
    check(
      'chk_sped_config_tipo_item_padrao',
      sql`${table.tipoItemPadrao} ~ '^[0-9]{2}$'`,
    ),
    check(
      'chk_sped_config_mes_inventario',
      sql`${table.mesEntregaInventario} BETWEEN 1 AND 12`,
    ),
    check(
      'chk_sped_config_indicadores_1010',
      sql`jsonb_typeof(${table.indicadores1010}) = 'object'`,
    ),
  ],
);
