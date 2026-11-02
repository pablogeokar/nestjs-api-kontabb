import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { clientes } from './clientes';
import { folhasPagamento } from './folhas_pagamento';
import { funcionariosRh } from './funcionarios_rh';

export const itensFolhaPagamento = pgTable(
  'itens_folha_pagamento',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    folhaId: uuid('folha_id')
      .notNull()
      .references(() => folhasPagamento.id, { onDelete: 'cascade' }),
    funcionarioId: uuid('funcionario_id')
      .notNull()
      .references(() => funcionariosRh.id, { onDelete: 'cascade' }),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    salarioBase: numeric('salario_base', { precision: 12, scale: 2 }).notNull(),
    totalProventos: numeric('total_proventos', {
      precision: 12,
      scale: 2,
    }).notNull(),
    totalDescontos: numeric('total_descontos', {
      precision: 12,
      scale: 2,
    }).notNull(),
    salarioLiquido: numeric('salario_liquido', {
      precision: 12,
      scale: 2,
    }).notNull(),
    baseInss: numeric('base_inss', { precision: 12, scale: 2 }),
    aliquotaInss: numeric('aliquota_inss', { precision: 6, scale: 4 }),
    valorInss: numeric('valor_inss', { precision: 12, scale: 2 }),
    baseFgts: numeric('base_fgts', { precision: 12, scale: 2 }),
    valorFgts: numeric('valor_fgts', { precision: 12, scale: 2 }),
    baseIrrf: numeric('base_irrf', { precision: 12, scale: 2 }),
    valorIrrf: numeric('valor_irrf', { precision: 12, scale: 2 }),
    referencia: text('referencia'),
    codigoFolha: text('codigo_folha'),
    dependentesIr: integer('dependentes_ir').default(0),
    dependentesSf: integer('dependentes_sf').default(0),
    rubricas: jsonb('rubricas')
      .$type<
        Array<{
          codigo: string;
          descricao: string;
          referencia: string | null;
          tipo: 'PROVENTO' | 'DESCONTO';
          valor: number;
        }>
      >()
      .notNull()
      .default([]),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uidx_itens_folha_funcionario').on(
      table.folhaId,
      table.funcionarioId,
    ),
    index('idx_itens_folha_id').on(table.folhaId),
    index('idx_itens_funcionario_id').on(table.funcionarioId),
    index('idx_itens_cliente_id').on(table.clienteId),
    foreignKey({
      name: 'fk_itens_folha_cliente',
      columns: [table.folhaId, table.clienteId],
      foreignColumns: [folhasPagamento.id, folhasPagamento.clienteId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_itens_funcionario_cliente',
      columns: [table.funcionarioId, table.clienteId],
      foreignColumns: [funcionariosRh.id, funcionariosRh.clienteId],
    }).onDelete('cascade'),
    check(
      'chk_itens_dependentes',
      sql`COALESCE(${table.dependentesIr}, 0) >= 0 AND COALESCE(${table.dependentesSf}, 0) >= 0`,
    ),
    check('chk_itens_rubricas', sql`jsonb_typeof(${table.rubricas}) = 'array'`),
  ],
);
