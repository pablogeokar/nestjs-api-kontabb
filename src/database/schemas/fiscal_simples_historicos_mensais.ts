import {
  check,
  date,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { clientes } from './clientes';
import { user } from './user';

// Histórico mensal informado na migração de carteira. Valores manuais
// substituem a fonte automática somente na competência explicitamente lançada,
// evitando dupla contagem de documentos/folhas já importados.

export const fiscalSimplesHistoricosMensais = pgTable(
  'fiscal_simples_historicos_mensais',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    competencia: date('competencia').notNull(),
    receitaBruta: numeric('receita_bruta', { precision: 15, scale: 2 }),
    folhaSalariosEncargos: numeric('folha_salarios_encargos', {
      precision: 15,
      scale: 2,
    }),
    observacao: text('observacao'),
    informadoPor: text('informado_por').references(() => user.id, {
      onDelete: 'set null',
    }),
    criadoEm: timestamp('criado_em', { withTimezone: true })
      .notNull()
      .defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('uq_simples_historico_cliente_competencia').on(
      table.clienteId,
      table.competencia,
    ),
    index('idx_simples_historico_cliente_competencia').on(
      table.clienteId,
      table.competencia,
    ),
    check(
      'chk_simples_historico_competencia',
      sql`date_part('day', ${table.competencia}) = 1`,
    ),
    check(
      'chk_simples_historico_preenchido',
      sql`${table.receitaBruta} IS NOT NULL OR ${table.folhaSalariosEncargos} IS NOT NULL`,
    ),
    check(
      'chk_simples_historico_valores',
      sql`(${table.receitaBruta} IS NULL OR ${table.receitaBruta} >= 0) AND (${table.folhaSalariosEncargos} IS NULL OR ${table.folhaSalariosEncargos} >= 0)`,
    ),
  ],
);
