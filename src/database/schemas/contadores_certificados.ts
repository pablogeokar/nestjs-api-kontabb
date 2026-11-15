import {
  check,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { contadores } from './contadores';
import { user } from './user';

export const contadoresCertificados = pgTable(
  'contadores_certificados',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contadorId: uuid('contador_id')
      .notNull()
      .references(() => contadores.id, { onDelete: 'cascade' }),
    arquivoKey: text('arquivo_key').notNull(),
    senhaCriptografada: text('senha_criptografada').notNull(),
    titular: text('titular').notNull(),
    documento: text('documento').notNull(),
    thumbprint: text('thumbprint').notNull(),
    validadeInicio: timestamp('validade_inicio').notNull(),
    validadeFim: timestamp('validade_fim').notNull(),
    autorizadoAssinar: text('autorizado_assinar').notNull().default('SIM'),
    uploadadoPor: text('uploadado_por').references(() => user.id, {
      onDelete: 'set null',
    }),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uidx_contadores_certificados_contador').on(table.contadorId),
    check(
      'chk_contadores_certificados_autorizado',
      sql`${table.autorizadoAssinar} IN ('SIM', 'NAO')`,
    ),
  ],
);
