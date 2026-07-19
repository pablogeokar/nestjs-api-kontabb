import {
    check,
    pgTable,
    uuid,
    text,
    timestamp,
    boolean,
    date,
    numeric,
    integer,
    jsonb,
    bigint,
    index,
    uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ─────────────────────────────────────────────────────────────────────────────
// Better Auth tables
// ─────────────────────────────────────────────────────────────────────────────

export const user = pgTable(
    'user',
    {
        id: text('id').primaryKey(),
        name: text('name').notNull(),
        email: text('email').notNull().unique(),
        emailVerified: boolean('email_verified').notNull().default(false),
        image: text('image'),
        role: text('role').notNull().default('CLIENTE'),
        createdAt: timestamp('created_at').notNull().defaultNow(),
        updatedAt: timestamp('updated_at').notNull().defaultNow(),
    },
    (table) => [
        check('chk_user_role', sql`${table.role} IN ('ADMIN', 'COLABORADOR', 'CLIENTE')`),
    ],
);

export const session = pgTable('session', {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
        .notNull()
        .references(() => user.id, { onDelete: 'cascade' }),
});

export const account = pgTable('account', {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
        .notNull()
        .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at'),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const verification = pgTable('verification', {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Tabelas da aplicação
// ─────────────────────────────────────────────────────────────────────────────

export const clientes = pgTable(
    'clientes',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        tipoPessoa: text('tipo_pessoa').notNull().default('PJ'),
        cnpj: text('cnpj').notNull().unique(),
        cpf: text('cpf').unique(),
        razaoSocial: text('razao_social').notNull(),
        emails: text('emails').array().notNull().default([]),
        primeiroLogin: boolean('primeiro_login').notNull().default(true),
        userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
        criadoEm: timestamp('criado_em').notNull().defaultNow(),
    },
    (table) => [
        uniqueIndex('uidx_clientes_user_id').on(table.userId),
        check('chk_clientes_tipo_pessoa', sql`${table.tipoPessoa} IN ('PF', 'PJ')`),
    ],
);

export const documentos = pgTable(
    'documentos',
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
        arquivoNome: text('arquivo_nome').notNull().default(''),
        status: text('status').notNull().default('PENDENTE'),
        pagoEm: timestamp('pago_em'),
        pagamentoConfirmadoPor: text('pagamento_confirmado_por').references(() => user.id, {
            onDelete: 'set null',
        }),
        observacaoPagamento: text('observacao_pagamento'),
        comprovanteKey: text('comprovante_key'),
        emailStatus: text('email_status').notNull().default('NAO_ENVIADO'),
        emailErro: text('email_erro'),
        numeroParcelamento: text('numero_parcelamento'),
        criadoEm: timestamp('criado_em').notNull().defaultNow(),
    },
    (table) => [
        index('idx_documentos_cliente_id').on(table.clienteId),
        index('idx_documentos_tipo').on(table.tipo),
        index('idx_documentos_periodo').on(table.periodo),
        index('idx_documentos_status').on(table.status),
        index('idx_documentos_pagamento_confirmado_por').on(table.pagamentoConfirmadoPor),
        check(
            'chk_documentos_tipo',
            sql`${table.tipo} IN ('FGTS', 'DARF', 'DAS', 'DAS-PARCSN', 'DAS-PGFN', 'INSS', 'ISS', 'ICMS', 'PIS', 'COFINS', 'CSLL', 'IRPJ', 'DAE', 'PGFN-SISPAR', 'TAXA-ASSISTENCIAL', 'OUTROS')`,
        ),
        check('chk_documentos_status', sql`${table.status} IN ('PENDENTE', 'PAGO')`),
        check(
            'chk_documentos_email_status',
            sql`${table.emailStatus} IN ('NAO_ENVIADO', 'PENDENTE', 'ENVIADO', 'FALHOU', 'SEM_EMAIL')`,
        ),
    ],
);

export const visualizacoesDocumentos = pgTable(
    'visualizacoes_documentos',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        documentoId: uuid('documento_id')
            .notNull()
            .references(() => documentos.id, { onDelete: 'cascade' }),
        userId: text('user_id')
            .notNull()
            .references(() => user.id, { onDelete: 'cascade' }),
        visualizadoEm: timestamp('visualizado_em').notNull().defaultNow(),
    },
    (table) => [
        index('idx_visualizacoes_documento').on(table.documentoId),
        index('idx_visualizacoes_user').on(table.userId),
    ],
);

export const storageCleanupJobs = pgTable(
    'storage_cleanup_jobs',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        objectKey: text('object_key').notNull().unique(),
        entidadeTipo: text('entidade_tipo').notNull(),
        entidadeId: text('entidade_id').notNull(),
        status: text('status').notNull().default('PENDENTE'),
        tentativas: integer('tentativas').notNull().default(0),
        ultimoErro: text('ultimo_erro'),
        criadoEm: timestamp('criado_em').notNull().defaultNow(),
        atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
        concluidoEm: timestamp('concluido_em'),
    },
    (table) => [
        index('idx_storage_cleanup_status_criado_em').on(table.status, table.criadoEm),
        check(
            'chk_storage_cleanup_status',
            sql`${table.status} IN ('PENDENTE', 'PROCESSANDO', 'FALHOU', 'CONCLUIDO')`,
        ),
    ],
);

export const eventosAuditoria = pgTable(
    'eventos_auditoria',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        atorUserId: text('ator_user_id').references(() => user.id, { onDelete: 'set null' }),
        acao: text('acao').notNull(),
        entidadeTipo: text('entidade_tipo').notNull(),
        entidadeId: text('entidade_id').notNull(),
        dados: jsonb('dados').$type<Record<string, unknown>>().notNull().default({}),
        criadoEm: timestamp('criado_em').notNull().defaultNow(),
    },
    (table) => [
        index('idx_eventos_auditoria_entidade').on(
            table.entidadeTipo,
            table.entidadeId,
            table.criadoEm,
        ),
        index('idx_eventos_auditoria_ator').on(table.atorUserId, table.criadoEm),
    ],
);

export const appRateLimits = pgTable('app_rate_limits', {
    key: text('key').primaryKey(),
    count: integer('count').notNull(),
    resetAt: bigint('reset_at', { mode: 'number' }).notNull(),
});
