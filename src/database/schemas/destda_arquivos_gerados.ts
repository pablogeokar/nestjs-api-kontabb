import {
  bigint,
  check,
  date,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { clientes } from './clientes';
import { user } from './user';

export const destdaArquivosGerados = pgTable(
  'destda_arquivos_gerados',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    competencia: date('competencia').notNull(),
    finalidade: varchar('finalidade', { length: 1 }).notNull(),
    codVersao: varchar('cod_versao', { length: 4 }).notNull(),
    status: varchar('status', { length: 12 }).notNull(),
    hashSha256: varchar('hash_sha256', { length: 64 }),
    arquivoKey: text('arquivo_key'),
    arquivoNome: text('arquivo_nome'),
    tamanhoBytes: bigint('tamanho_bytes', { mode: 'number' }),
    contadores: jsonb('contadores').$type<Record<string, unknown>>(),
    totais: jsonb('totais').$type<Record<string, unknown>>(),
    inconsistencias:
      jsonb('inconsistencias').$type<Array<Record<string, unknown>>>(),
    erro: text('erro'),
    geradoPor: text('gerado_por').references(() => user.id, {
      onDelete: 'set null',
    }),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
    concluidoEm: timestamp('concluido_em'),
  },
  (table) => [
    index('idx_destda_arquivo_cliente_competencia').on(
      table.clienteId,
      table.competencia,
      table.criadoEm,
    ),
    index('idx_destda_arquivo_status').on(table.status),
    check(
      'chk_destda_arquivo_finalidade',
      sql`${table.finalidade} IN ('0', '1')`,
    ),
    check(
      'chk_destda_arquivo_status',
      sql`${table.status} IN ('PROCESSANDO', 'GERADO', 'FALHOU')`,
    ),
    check(
      'chk_destda_arquivo_hash',
      sql`${table.hashSha256} IS NULL OR ${table.hashSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'chk_destda_arquivo_tamanho',
      sql`${table.tamanhoBytes} IS NULL OR ${table.tamanhoBytes} >= 0`,
    ),
  ],
);
