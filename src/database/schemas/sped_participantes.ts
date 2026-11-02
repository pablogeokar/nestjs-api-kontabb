import {
  check,
  index,
  foreignKey,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { clientes } from './clientes';
import { documentosFiscais } from './documentos_fiscais';

export const spedParticipantes = pgTable(
  'sped_participantes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    codigo: varchar('codigo', { length: 60 }).notNull(),
    documento: varchar('documento', { length: 14 }).notNull(),
    tipoDocumento: varchar('tipo_documento', { length: 4 }).notNull(),
    nome: text('nome').notNull(),
    codigoPais: varchar('codigo_pais', { length: 5 })
      .notNull()
      .default('01058'),
    inscricaoEstadual: text('inscricao_estadual'),
    codigoMunicipioIbge: varchar('codigo_municipio_ibge', { length: 7 }),
    suframa: text('suframa'),
    logradouro: text('logradouro'),
    numero: text('numero'),
    complemento: text('complemento'),
    bairro: text('bairro'),
    cep: varchar('cep', { length: 8 }),
    fonteUltimoDocumentoId: uuid('fonte_ultimo_documento_id'),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'fk_sped_part_fonte_documento',
      columns: [table.fonteUltimoDocumentoId],
      foreignColumns: [documentosFiscais.id],
    }).onDelete('set null'),
    uniqueIndex('uidx_sped_participante_codigo').on(
      table.clienteId,
      table.codigo,
    ),
    uniqueIndex('uidx_sped_participante_documento').on(
      table.clienteId,
      table.documento,
    ),
    index('idx_sped_participante_cliente').on(table.clienteId),
    check(
      'chk_sped_participante_tipo_documento',
      sql`${table.tipoDocumento} IN ('CNPJ', 'CPF')`,
    ),
    check(
      'chk_sped_participante_documento',
      sql`(${table.tipoDocumento} = 'CPF' AND ${table.documento} ~ '^[0-9]{11}$') OR (${table.tipoDocumento} = 'CNPJ' AND ${table.documento} ~ '^[0-9A-Z]{12}[0-9]{2}$')`,
    ),
    check(
      'chk_sped_participante_codigo_pais',
      sql`${table.codigoPais} ~ '^[0-9]{5}$'`,
    ),
    check(
      'chk_sped_participante_codigo_municipio',
      sql`${table.codigoMunicipioIbge} IS NULL OR ${table.codigoMunicipioIbge} ~ '^[0-9]{7}$'`,
    ),
  ],
);
