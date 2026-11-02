import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { clientes } from './clientes';

export const funcionariosRh = pgTable(
  'funcionarios_rh',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    codigoFuncionario: text('codigo_funcionario').notNull(),
    nomeCompleto: text('nome_completo').notNull(),
    cpf: text('cpf'),
    dataAdmissao: date('data_admissao'),
    cargo: text('cargo'),
    departamento: text('departamento'),
    ativo: boolean('ativo').notNull().default(true),
    senhaHash: text('senha_hash'),
    primeiroAcesso: boolean('primeiro_acesso').notNull().default(true),
    tokenVersion: integer('token_version').notNull().default(0),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uidx_funcionarios_cliente_codigo').on(
      table.clienteId,
      table.codigoFuncionario,
    ),
    unique('uq_funcionarios_id_cliente').on(table.id, table.clienteId),
    index('idx_funcionarios_cliente_id').on(table.clienteId),
    check(
      'chk_funcionarios_codigo',
      sql`btrim(${table.codigoFuncionario}) <> ''`,
    ),
    check('chk_funcionarios_nome', sql`btrim(${table.nomeCompleto}) <> ''`),
    check(
      'chk_funcionarios_cpf',
      sql`${table.cpf} IS NULL OR ${table.cpf} ~ '^[0-9]{11}$'`,
    ),
  ],
);
