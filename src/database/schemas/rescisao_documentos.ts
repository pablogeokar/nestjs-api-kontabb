import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { rescisoes } from './rescisoes';
import { user } from './user';

export const rescisaoDocumentos = pgTable(
  'rescisao_documentos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    rescisaoId: uuid('rescisao_id')
      .notNull()
      .references(() => rescisoes.id, { onDelete: 'cascade' }),
    tipoDocumento: text('tipo_documento').notNull(),
    arquivoKey: text('arquivo_key').notNull(),
    arquivoNome: text('arquivo_nome').notNull(),
    uploadadoPor: text('uploadado_por').references(() => user.id, {
      onDelete: 'set null',
    }),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
  },
  (table) => [
    // Um documento por tipo em cada rescisão; "OUTRO" pode se repetir.
    uniqueIndex('uidx_rescisao_documentos_tipo')
      .on(table.rescisaoId, table.tipoDocumento)
      .where(sql`${table.tipoDocumento} <> 'OUTRO'`),
    index('idx_rescisao_documentos_rescisao_id').on(table.rescisaoId),
    check(
      'chk_rescisao_documentos_tipo',
      sql`${table.tipoDocumento} IN ('TRCT', 'AVISO_PREVIO', 'EXAME_DEMISSIONAL', 'GUIA_SEGURO_DESEMPREGO', 'CARTA_RECOMENDACAO', 'HISTORICO_INSS', 'OUTRO')`,
    ),
    check(
      'chk_rescisao_documentos_arquivo_key',
      sql`btrim(${table.arquivoKey}) <> ''`,
    ),
  ],
);
