import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { documentosFiscais } from './documentos_fiscais';

export const eventosFiscais = pgTable(
  'eventos_fiscais',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentoFiscalId: uuid('documento_fiscal_id')
      .notNull()
      .references(() => documentosFiscais.id, { onDelete: 'cascade' }),
    tipoEvento: text('tipo_evento').notNull(),
    codigoEvento: text('codigo_evento').notNull(),
    sequenciaEvento: integer('sequencia_evento').notNull().default(1),
    descricao: text('descricao'),
    protocolo: text('protocolo'),
    statusSefaz: integer('status_sefaz'),
    motivoSefaz: text('motivo_sefaz'),
    dataEvento: timestamp('data_evento').notNull().defaultNow(),
    xmlEventoKey: text('xml_evento_key'),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
  },
  (table) => [
    index('idx_eventos_fiscais_doc').on(table.documentoFiscalId),
    index('idx_eventos_fiscais_tipo').on(table.tipoEvento),
    index('idx_eventos_fiscais_data').on(table.dataEvento),
    check(
      'chk_eventos_fiscais_tipo',
      sql`${table.tipoEvento} IN ('MANIFESTACAO_CIENCIA', 'MANIFESTACAO_CONFIRMACAO', 'MANIFESTACAO_DESCONHECIMENTO', 'MANIFESTACAO_NAO_REALIZADA', 'CANCELAMENTO', 'CCE')`,
    ),
    check('chk_eventos_fiscais_sequencia', sql`${table.sequenciaEvento} >= 1`),
  ],
);
