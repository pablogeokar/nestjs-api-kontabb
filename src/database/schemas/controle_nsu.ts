import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { clientes } from './clientes';

export const controleNsu = pgTable(
  'controle_nsu',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    cnpj: text('cnpj').notNull(),
    tipoDocumento: text('tipo_documento').notNull(),
    ultimoNsu: bigint('ultimo_nsu', { mode: 'number' }).notNull().default(0),
    maxNsu: bigint('max_nsu', { mode: 'number' }).notNull().default(0),
    statusSefaz: integer('status_sefaz'),
    motivoSefaz: text('motivo_sefaz'),
    ultimaConsultaEm: timestamp('ultima_consulta_em'),
    proximaConsultaEm: timestamp('proxima_consulta_em'),
    sincronizacaoId: uuid('sincronizacao_id'),
    sincronizacaoIniciadaEm: timestamp('sincronizacao_iniciada_em', {
      withTimezone: true,
    }),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uidx_controle_nsu_cliente_tipo').on(
      table.clienteId,
      table.tipoDocumento,
    ),
    index('idx_controle_nsu_cliente_id').on(table.clienteId),
    check(
      'chk_controle_nsu_tipo',
      sql`${table.tipoDocumento} IN ('NFE', 'CTE')`,
    ),
    check('chk_controle_nsu_ultimo', sql`${table.ultimoNsu} >= 0`),
    check('chk_controle_nsu_max', sql`${table.maxNsu} >= 0`),
    check(
      'chk_controle_nsu_sincronizacao_coerencia',
      sql`(${table.sincronizacaoId} IS NULL AND ${table.sincronizacaoIniciadaEm} IS NULL) OR (${table.sincronizacaoId} IS NOT NULL AND ${table.sincronizacaoIniciadaEm} IS NOT NULL)`,
    ),
  ],
);
