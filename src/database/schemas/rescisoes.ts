import {
  check,
  date,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { clientes } from './clientes';
import { folhasPagamento } from './folhas_pagamento';

// ─────────────────────────────────────────────────────────────────────────────
// Módulo RH — Rescisão de contrato
// Cada rescisão tem uma linha em `folhas_pagamento` (tipo RESCISAO, arquivo =
// TRCT) para aparecer na mesma listagem de folhas, férias e 13º.
// ─────────────────────────────────────────────────────────────────────────────

export const rescisoes = pgTable(
  'rescisoes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    folhaId: uuid('folha_id')
      .notNull()
      .references(() => folhasPagamento.id, { onDelete: 'cascade' }),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    funcionarioNome: text('funcionario_nome').notNull(),
    funcionarioCpf: text('funcionario_cpf').notNull(),
    dataAdmissao: date('data_admissao').notNull(),
    dataDesligamento: date('data_desligamento').notNull(),
    causaAfastamento: text('causa_afastamento'),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uidx_rescisoes_folha').on(table.folhaId),
    uniqueIndex('uidx_rescisoes_cliente_cpf_desligamento').on(
      table.clienteId,
      table.funcionarioCpf,
      table.dataDesligamento,
    ),
    index('idx_rescisoes_cliente_id').on(table.clienteId),
    check('chk_rescisoes_cpf', sql`${table.funcionarioCpf} ~ '^[0-9]{11}$'`),
    check('chk_rescisoes_nome', sql`btrim(${table.funcionarioNome}) <> ''`),
  ],
);
