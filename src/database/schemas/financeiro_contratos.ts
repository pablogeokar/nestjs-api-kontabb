import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  date,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { clientes } from './clientes';
import { user } from './user';
import type { CodigoServicoContrato } from '../../financeiro/financeiro-servicos.catalogo';

export const financeiroContratos = pgTable(
  'financeiro_contratos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    valorMensalidade: numeric('valor_mensalidade', { precision: 12, scale: 2 })
      .notNull()
      .default('0.00'),
    diaVencimento: integer('dia_vencimento').notNull().default(10),
    diaFechamento: integer('dia_fechamento').notNull().default(25),
    gera13o: boolean('gera_13o').notNull().default(true),
    mes13o: integer('mes_13o').notNull().default(12),
    ativo: boolean('ativo').notNull().default(true),
    observacoes: text('observacoes'),
    servicosContratados: jsonb('servicos_contratados')
      .$type<
        Array<{
          codigo: CodigoServicoContrato;
          descricao?: string;
          valorMensal: string;
        }>
      >()
      .notNull()
      .default([]),
    contratanteRepresentante: text('contratante_representante'),
    dataInicio: date('data_inicio'),
    avisoPrevioDias: integer('aviso_previo_dias').notNull().default(30),
    condicoesContratuais: text('condicoes_contratuais'),
    atualizadoPor: text('atualizado_por').references(() => user.id, {
      onDelete: 'set null',
    }),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uidx_fin_contratos_cliente').on(table.clienteId),
    index('idx_fin_contratos_ativo').on(table.ativo),
    check('chk_fin_contratos_valor', sql`${table.valorMensalidade} >= 0`),
    check(
      'chk_fin_contratos_dia_vencimento',
      sql`${table.diaVencimento} BETWEEN 1 AND 31`,
    ),
    check(
      'chk_fin_contratos_dia_fechamento',
      sql`${table.diaFechamento} BETWEEN 1 AND 31`,
    ),
    check('chk_fin_contratos_mes_13o', sql`${table.mes13o} BETWEEN 1 AND 12`),
    check(
      'chk_fin_contratos_aviso',
      sql`${table.avisoPrevioDias} BETWEEN 0 AND 365`,
    ),
  ],
);
