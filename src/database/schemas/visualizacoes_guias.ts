import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { guias } from './guias';
import { user } from './user';

export const visualizacoesGuias = pgTable(
  'visualizacoes_guias',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guiaId: uuid('guia_id')
      .notNull()
      .references(() => guias.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    visualizadoEm: timestamp('visualizado_em').notNull().defaultNow(),
  },
  (table) => [
    index('idx_visualizacoes_guia').on(table.guiaId),
    index('idx_visualizacoes_guia_user').on(table.userId),
  ],
);
