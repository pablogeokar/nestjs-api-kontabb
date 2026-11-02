import {
  date,
  index,
  foreignKey,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { ciapAtivoPermanente } from './ciap_ativo_permanente';
import { clientes } from './clientes';

// Contenção de idempotência do CIAP (Fase 0 / F06). Registra que a apropriação
// de uma competência já foi aplicada a um bem, para que retries e chamadas
// concorrentes não consumam parcelas em duplicidade. Estrutura mínima e
// aditiva; será absorvida pela razão completa (ciap_apropriacoes) na Fase 2.

export const ciapCompetenciasApropriadas = pgTable(
  'ciap_competencias_apropriadas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    bemId: uuid('bem_id').notNull(),
    competencia: date('competencia').notNull(),
    aplicadoEm: timestamp('aplicado_em', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'fk_ciap_competencia_bem',
      columns: [table.bemId],
      foreignColumns: [ciapAtivoPermanente.id],
    }).onDelete('cascade'),
    uniqueIndex('uidx_ciap_competencia_bem').on(
      table.clienteId,
      table.competencia,
      table.bemId,
    ),
    index('idx_ciap_competencia_cliente').on(
      table.clienteId,
      table.competencia,
    ),
  ],
);
