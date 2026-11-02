import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { user } from './user';

// ─────────────────────────────────────────────────────────────────────────────
// Tabelas da aplicação
// ─────────────────────────────────────────────────────────────────────────────

export const contadores = pgTable(
  'contadores',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nome: text('nome').notNull(),
    cpf: varchar('cpf', { length: 11 }),
    crc: text('crc').notNull(),
    cnpj: varchar('cnpj', { length: 14 }),
    cep: varchar('cep', { length: 8 }),
    logradouro: text('logradouro'),
    numero: text('numero'),
    complemento: text('complemento'),
    bairro: text('bairro'),
    telefone: text('telefone'),
    fax: text('fax'),
    email: text('email'),
    codigoMunicipioIbge: varchar('codigo_municipio_ibge', {
      length: 7,
    }).notNull(),
    atualizadoPor: text('atualizado_por').references(() => user.id, {
      onDelete: 'set null',
    }),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uidx_contadores_cpf_crc')
      .on(table.cpf, table.crc)
      .where(sql`${table.cpf} IS NOT NULL`),
    uniqueIndex('uidx_contadores_cnpj_crc')
      .on(table.cnpj, table.crc)
      .where(sql`${table.cnpj} IS NOT NULL`),
    index('idx_contadores_nome').on(table.nome),
    check(
      'chk_contadores_documento',
      sql`(${table.cpf} IS NOT NULL AND ${table.cpf} ~ '^[0-9]{11}$') OR (${table.cnpj} IS NOT NULL AND ${table.cnpj} ~ '^[0-9A-Z]{12}[0-9]{2}$')`,
    ),
    check(
      'chk_contadores_cep',
      sql`${table.cep} IS NULL OR ${table.cep} ~ '^[0-9]{8}$'`,
    ),
    check(
      'chk_contadores_codigo_municipio',
      sql`${table.codigoMunicipioIbge} ~ '^[0-9]{7}$'`,
    ),
    check(
      'chk_contadores_nome',
      sql`char_length(btrim(${table.nome})) BETWEEN 2 AND 100`,
    ),
    check(
      'chk_contadores_crc',
      sql`char_length(btrim(${table.crc})) BETWEEN 2 AND 30`,
    ),
  ],
);
