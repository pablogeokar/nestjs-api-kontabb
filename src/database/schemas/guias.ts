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

export const guias = pgTable(
  'guias',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    tipo: text('tipo').notNull(),
    periodo: text('periodo').notNull(),
    vencimento: date('vencimento'),
    valor: numeric('valor', { precision: 12, scale: 2 }),
    arquivoKey: text('arquivo_key').notNull(),
    arquivoNome: text('arquivo_nome').notNull(),
    status: text('status').notNull().default('PENDENTE'),
    pagoEm: timestamp('pago_em'),
    pagamentoConfirmadoPor: text('pagamento_confirmado_por').references(
      () => user.id,
      {
        onDelete: 'set null',
      },
    ),
    observacaoPagamento: text('observacao_pagamento'),
    comprovanteKey: text('comprovante_key'),
    emailStatus: text('email_status').notNull().default('NAO_ENVIADO'),
    emailErro: text('email_erro'),
    numeroParcelamento: text('numero_parcelamento'),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
  },
  (table) => [
    index('idx_guias_cliente_id').on(table.clienteId),
    index('idx_guias_tipo').on(table.tipo),
    index('idx_guias_periodo').on(table.periodo),
    index('idx_guias_status').on(table.status),
    index('idx_guias_pagamento_confirmado_por').on(
      table.pagamentoConfirmadoPor,
    ),
    unique('uq_guias_identidade')
      .on(table.clienteId, table.tipo, table.periodo, table.numeroParcelamento)
      .nullsNotDistinct(),
    check(
      'chk_guias_tipo',
      sql`${table.tipo} IN ('FGTS', 'DARF', 'DAS', 'DAS-COMPL', 'DAS-PARCSN', 'DAS-PGFN', 'INSS', 'ISS', 'ICMS', 'PIS', 'COFINS', 'CSLL', 'IRPJ', 'DAE', 'PGFN-SISPAR', 'TAXA-ASSISTENCIAL', 'OUTROS', 'FOLHA-PAGAMENTO')`,
    ),
    check('chk_guias_status', sql`${table.status} IN ('PENDENTE', 'PAGO')`),
    check(
      'chk_guias_email_status',
      sql`${table.emailStatus} IN ('NAO_ENVIADO', 'PENDENTE', 'ENVIADO', 'FALHOU', 'SEM_EMAIL', 'SUSPENSO')`,
    ),
    check(
      'chk_guias_periodo',
      sql`${table.periodo} ~ '^(0[1-9]|1[0-2])/[0-9]{4}$'`,
    ),
    check('chk_guias_arquivo_key', sql`btrim(${table.arquivoKey}) <> ''`),
    check('chk_guias_arquivo_nome', sql`btrim(${table.arquivoNome}) <> ''`),
    check(
      'chk_guias_valor',
      sql`${table.valor} IS NULL OR ${table.valor} >= 0`,
    ),
    check(
      'chk_guias_pagamento',
      sql`(${table.status} = 'PENDENTE' AND ${table.pagoEm} IS NULL) OR (${table.status} = 'PAGO' AND ${table.pagoEm} IS NOT NULL)`,
    ),
    check(
      'chk_guias_numero_parcelamento',
      sql`${table.numeroParcelamento} IS NULL OR btrim(${table.numeroParcelamento}) <> ''`,
    ),
  ],
);
