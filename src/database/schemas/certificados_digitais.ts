import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { clientes } from './clientes';
import { user } from './user';

// ─────────────────────────────────────────────────────────────────────────────
// Módulo Fiscal — Certificados Digitais, NSU e Documentos Fiscais
// ─────────────────────────────────────────────────────────────────────────────

export const certificadosDigitais = pgTable(
  'certificados_digitais',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    cnpj: text('cnpj').notNull(),
    razaoSocial: text('razao_social').notNull(),
    arquivoKey: text('arquivo_key').notNull(),
    senhaCriptografada: text('senha_criptografada').notNull(),
    thumbprint: text('thumbprint'),
    emissor: text('emissor'),
    validadeInicio: timestamp('validade_inicio').notNull(),
    validadeFim: timestamp('validade_fim').notNull(),
    status: text('status').notNull().default('ATIVO'),
    uploadadoPor: text('uploadado_por').references(() => user.id, {
      onDelete: 'set null',
    }),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
  },
  (table) => [
    index('idx_certificados_cliente_id').on(table.clienteId),
    index('idx_certificados_cnpj').on(table.cnpj),
    index('idx_certificados_status').on(table.status),
    index('idx_certificados_validade_fim').on(table.validadeFim),
    uniqueIndex('uidx_certificados_cliente').on(table.clienteId),
    check(
      'chk_certificados_status',
      sql`${table.status} IN ('ATIVO', 'EXPIRADO', 'PRESTES_A_EXPIRAR', 'REVOGADO')`,
    ),
    check(
      'chk_certificados_cnpj',
      sql`${table.cnpj} ~ '^[0-9A-Z]{12}[0-9]{2}$'`,
    ),
    check(
      'chk_certificados_validade',
      sql`${table.validadeInicio} < ${table.validadeFim}`,
    ),
    check(
      'chk_certificados_arquivo_key',
      sql`btrim(${table.arquivoKey}) <> ''`,
    ),
  ],
);
