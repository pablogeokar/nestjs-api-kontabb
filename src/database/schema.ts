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
    check(
      'chk_user_role',
      sql`${table.role} IN ('ADMIN', 'COLABORADOR', 'CLIENTE')`,
    ),
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
    cep: text('cep'),
    logradouro: text('logradouro'),
    numero: text('numero'),
    complemento: text('complemento'),
    bairro: text('bairro'),
    municipio: text('municipio'),
    uf: text('uf'),
    cnaePrincipalCodigo: text('cnae_principal_codigo'),
    cnaePrincipalDescricao: text('cnae_principal_descricao'),
    cnaesSecundarios: jsonb('cnaes_secundarios')
      .$type<Array<{ code: string; description: string }>>()
      .notNull()
      .default([]),
    primeiroLogin: boolean('primeiro_login').notNull().default(true),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uidx_clientes_user_id').on(table.userId),
    check('chk_clientes_tipo_pessoa', sql`${table.tipoPessoa} IN ('PF', 'PJ')`),
    check(
      'chk_clientes_cep',
      sql`${table.cep} IS NULL OR ${table.cep} ~ '^[0-9]{8}$'`,
    ),
    check(
      'chk_clientes_uf',
      sql`${table.uf} IS NULL OR ${table.uf} ~ '^[A-Z]{2}$'`,
    ),
    check(
      'chk_clientes_cnae_principal',
      sql`${table.cnaePrincipalCodigo} IS NULL OR ${table.cnaePrincipalCodigo} ~ '^[0-9]{7}$'`,
    ),
    check(
      'chk_clientes_cnaes_secundarios',
      sql`jsonb_typeof(${table.cnaesSecundarios}) = 'array'`,
    ),
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
    index('idx_documentos_cliente_id').on(table.clienteId),
    index('idx_documentos_tipo').on(table.tipo),
    index('idx_documentos_periodo').on(table.periodo),
    index('idx_documentos_status').on(table.status),
    index('idx_documentos_pagamento_confirmado_por').on(
      table.pagamentoConfirmadoPor,
    ),
    check(
      'chk_documentos_tipo',
      sql`${table.tipo} IN ('FGTS', 'DARF', 'DAS', 'DAS-PARCSN', 'DAS-PGFN', 'INSS', 'ISS', 'ICMS', 'PIS', 'COFINS', 'CSLL', 'IRPJ', 'DAE', 'PGFN-SISPAR', 'TAXA-ASSISTENCIAL', 'OUTROS', 'FOLHA-PAGAMENTO')`,
    ),
    check(
      'chk_documentos_status',
      sql`${table.status} IN ('PENDENTE', 'PAGO')`,
    ),
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
    index('idx_storage_cleanup_status_criado_em').on(
      table.status,
      table.criadoEm,
    ),
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
    atorUserId: text('ator_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    acao: text('acao').notNull(),
    entidadeTipo: text('entidade_tipo').notNull(),
    entidadeId: text('entidade_id').notNull(),
    dados: jsonb('dados')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
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

// ─────────────────────────────────────────────────────────────────────────────
// Módulo RH — Folha de Pagamento
// ─────────────────────────────────────────────────────────────────────────────

export const folhasPagamento = pgTable(
  'folhas_pagamento',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    documentoId: uuid('documento_id').references(() => documentos.id, {
      onDelete: 'set null',
    }),
    arquivoKey: text('arquivo_key'),
    arquivoNome: text('arquivo_nome'),
    competencia: text('competencia').notNull(),
    periodoInicio: date('periodo_inicio').notNull(),
    periodoFim: date('periodo_fim').notNull(),
    totalBruto: numeric('total_bruto', { precision: 12, scale: 2 }).notNull(),
    totalDescontos: numeric('total_descontos', {
      precision: 12,
      scale: 2,
    }).notNull(),
    totalLiquido: numeric('total_liquido', {
      precision: 12,
      scale: 2,
    }).notNull(),
    totalFuncionarios: integer('total_funcionarios').notNull(),
    totalInss: numeric('total_inss', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    totalFgts: numeric('total_fgts', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    totalIrrf: numeric('total_irrf', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    totalSalarioFamilia: numeric('total_salario_familia', {
      precision: 12,
      scale: 2,
    })
      .notNull()
      .default('0'),
    uploadadoPor: text('uploadado_por').references(() => user.id, {
      onDelete: 'set null',
    }),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uidx_folhas_cliente_competencia').on(
      table.clienteId,
      table.competencia,
    ),
    index('idx_folhas_cliente_id').on(table.clienteId),
    index('idx_folhas_competencia').on(table.competencia),
  ],
);

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
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uidx_funcionarios_cliente_codigo').on(
      table.clienteId,
      table.codigoFuncionario,
    ),
    index('idx_funcionarios_cliente_id').on(table.clienteId),
  ],
);

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
  ],
);
