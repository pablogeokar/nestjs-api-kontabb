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
  unique,
  foreignKey,
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

export const account = pgTable(
  'account',
  {
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
  },
  (table) => [
    uniqueIndex('uidx_account_provider_account').on(
      table.providerId,
      table.accountId,
    ),
    uniqueIndex('uidx_account_user_provider').on(
      table.userId,
      table.providerId,
    ),
  ],
);

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    uniqueIndex('uidx_verification_identifier').on(table.identifier),
    uniqueIndex('uidx_verification_value').on(table.value),
  ],
);

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
    logoKey: text('logo_key'),
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
    check(
      'chk_clientes_documento_por_tipo',
      sql`(${table.tipoPessoa} = 'PJ' AND ${table.cnpj} ~ '^[0-9]{14}$' AND ${table.cpf} IS NULL) OR (${table.tipoPessoa} = 'PF' AND ${table.cnpj} ~ '^[0-9]{11}$' AND ${table.cpf} = ${table.cnpj})`,
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
    index('idx_documentos_cliente_id').on(table.clienteId),
    index('idx_documentos_tipo').on(table.tipo),
    index('idx_documentos_periodo').on(table.periodo),
    index('idx_documentos_status').on(table.status),
    index('idx_documentos_pagamento_confirmado_por').on(
      table.pagamentoConfirmadoPor,
    ),
    unique('uq_documentos_identidade')
      .on(table.clienteId, table.tipo, table.periodo, table.numeroParcelamento)
      .nullsNotDistinct(),
    check(
      'chk_documentos_tipo',
      sql`${table.tipo} IN ('FGTS', 'DARF', 'DAS', 'DAS-COMPL', 'DAS-PARCSN', 'DAS-PGFN', 'INSS', 'ISS', 'ICMS', 'PIS', 'COFINS', 'CSLL', 'IRPJ', 'DAE', 'PGFN-SISPAR', 'TAXA-ASSISTENCIAL', 'OUTROS', 'FOLHA-PAGAMENTO')`,
    ),
    check(
      'chk_documentos_status',
      sql`${table.status} IN ('PENDENTE', 'PAGO')`,
    ),
    check(
      'chk_documentos_email_status',
      sql`${table.emailStatus} IN ('NAO_ENVIADO', 'PENDENTE', 'ENVIADO', 'FALHOU', 'SEM_EMAIL')`,
    ),
    check(
      'chk_documentos_periodo',
      sql`${table.periodo} ~ '^(0[1-9]|1[0-2])/[0-9]{4}$'`,
    ),
    check('chk_documentos_arquivo_key', sql`btrim(${table.arquivoKey}) <> ''`),
    check(
      'chk_documentos_arquivo_nome',
      sql`btrim(${table.arquivoNome}) <> ''`,
    ),
    check(
      'chk_documentos_valor',
      sql`${table.valor} IS NULL OR ${table.valor} >= 0`,
    ),
    check(
      'chk_documentos_pagamento',
      sql`(${table.status} = 'PENDENTE' AND ${table.pagoEm} IS NULL) OR (${table.status} = 'PAGO' AND ${table.pagoEm} IS NOT NULL)`,
    ),
    check(
      'chk_documentos_numero_parcelamento',
      sql`${table.numeroParcelamento} IS NULL OR btrim(${table.numeroParcelamento}) <> ''`,
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
    userId: text('user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
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
    check(
      'chk_storage_cleanup_object_key',
      sql`btrim(${table.objectKey}) <> ''`,
    ),
    check('chk_storage_cleanup_tentativas', sql`${table.tentativas} >= 0`),
    check(
      'chk_storage_cleanup_conclusao',
      sql`(${table.status} = 'CONCLUIDO' AND ${table.concluidoEm} IS NOT NULL) OR (${table.status} <> 'CONCLUIDO' AND ${table.concluidoEm} IS NULL)`,
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

export const appRateLimits = pgTable(
  'app_rate_limits',
  {
    key: text('key').primaryKey(),
    count: integer('count').notNull(),
    resetAt: bigint('reset_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    check('chk_app_rate_limits_count', sql`${table.count} >= 0`),
    check('chk_app_rate_limits_reset_at', sql`${table.resetAt} > 0`),
  ],
);

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
    arquivoKey: text('arquivo_key').notNull(),
    arquivoNome: text('arquivo_nome').notNull(),
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
    unique('uq_folhas_id_cliente').on(table.id, table.clienteId),
    index('idx_folhas_cliente_id').on(table.clienteId),
    index('idx_folhas_competencia').on(table.competencia),
    check(
      'chk_folhas_competencia',
      sql`${table.competencia} ~ '^(0[1-9]|1[0-2])/[0-9]{4}$'`,
    ),
    check(
      'chk_folhas_periodo',
      sql`${table.periodoInicio} <= ${table.periodoFim}`,
    ),
    check(
      'chk_folhas_totais',
      sql`${table.totalBruto} >= 0 AND ${table.totalDescontos} >= 0 AND ${table.totalLiquido} >= 0 AND ${table.totalFuncionarios} >= 0 AND ${table.totalInss} >= 0 AND ${table.totalFgts} >= 0 AND ${table.totalIrrf} >= 0 AND ${table.totalSalarioFamilia} >= 0`,
    ),
    check('chk_folhas_arquivo_key', sql`btrim(${table.arquivoKey}) <> ''`),
    check('chk_folhas_arquivo_nome', sql`btrim(${table.arquivoNome}) <> ''`),
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
    senhaHash: text('senha_hash'),
    primeiroAcesso: boolean('primeiro_acesso').notNull().default(true),
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

export const visualizacoesFolhas = pgTable(
  'visualizacoes_folhas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    folhaId: uuid('folha_id')
      .notNull()
      .references(() => folhasPagamento.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    visualizadoEm: timestamp('visualizado_em').notNull().defaultNow(),
  },
  (table) => [
    index('idx_visualizacoes_folha').on(table.folhaId),
    index('idx_visualizacoes_folha_user').on(table.userId),
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
