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
  primaryKey,
  varchar,
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
    regimeTributario: text('regime_tributario'),
    apuraIcms: boolean('apura_icms').notNull().default(false),
    inscricaoEstadual: text('inscricao_estadual'),
    tipoContribuinteIcms: text('tipo_contribuinte_icms'),
    optanteSimplesNacional: boolean('optante_simples_nacional'),
    simplesNacionalFonte: text('simples_nacional_fonte'),
    simplesNacionalConsultadoEm: timestamp('simples_nacional_consultado_em', {
      withTimezone: true,
    }),
    logoKey: text('logo_key'),
    primeiroLogin: boolean('primeiro_login').notNull().default(true),
    suspenso: boolean('suspenso').notNull().default(false),
    suspensoEm: timestamp('suspenso_em', { withTimezone: true }),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    contadorId: uuid('contador_id').references(() => contadores.id, {
      onDelete: 'set null',
    }),
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
      'chk_clientes_regime_tributario',
      sql`${table.regimeTributario} IS NULL OR ${table.regimeTributario} IN ('SIMPLES_NACIONAL', 'LUCRO_PRESUMIDO', 'LUCRO_REAL')`,
    ),
    check(
      'chk_clientes_tipo_contribuinte_icms',
      sql`${table.tipoContribuinteIcms} IS NULL OR ${table.tipoContribuinteIcms} IN ('CONTRIBUINTE', 'ISENTO', 'NAO_CONTRIBUINTE')`,
    ),
    check(
      'chk_clientes_inscricao_estadual',
      sql`${table.inscricaoEstadual} IS NULL OR ${table.inscricaoEstadual} ~ '^[0-9A-Z./-]{2,20}$'`,
    ),
    check(
      'chk_clientes_apura_icms_coerencia',
      sql`(${table.tipoPessoa} = 'PF' AND ${table.regimeTributario} IS NULL) OR (${table.tipoPessoa} = 'PJ' AND ${table.regimeTributario} IN ('LUCRO_PRESUMIDO', 'LUCRO_REAL') AND ${table.apuraIcms} = true) OR (${table.tipoPessoa} = 'PJ' AND ${table.regimeTributario} = 'SIMPLES_NACIONAL') OR (${table.tipoPessoa} = 'PJ' AND ${table.regimeTributario} IS NULL)`,
    ),
    check(
      'chk_clientes_consulta_simples_coerencia',
      sql`(
        (${table.optanteSimplesNacional} IS NULL AND ${table.simplesNacionalFonte} IS NULL AND ${table.simplesNacionalConsultadoEm} IS NULL)
        OR
        (${table.optanteSimplesNacional} IS NOT NULL AND ${table.simplesNacionalFonte} IN ('OPEN_CNPJ', 'RECEITA_WS') AND ${table.simplesNacionalConsultadoEm} IS NOT NULL)
      )
      AND (${table.tipoPessoa} = 'PJ' OR ${table.optanteSimplesNacional} IS NULL)
      AND (${table.optanteSimplesNacional} IS DISTINCT FROM true OR ${table.regimeTributario} = 'SIMPLES_NACIONAL')
      AND (${table.optanteSimplesNacional} IS DISTINCT FROM false OR ${table.regimeTributario} IS DISTINCT FROM 'SIMPLES_NACIONAL')`,
    ),
    check(
      'chk_clientes_documento_por_tipo',
      sql`(${table.tipoPessoa} = 'PJ' AND ${table.cnpj} ~ '^[0-9A-Z]{12}[0-9]{2}$' AND ${table.cpf} IS NULL) OR (${table.tipoPessoa} = 'PF' AND ${table.cnpj} ~ '^[0-9]{11}$' AND ${table.cpf} = ${table.cnpj})`,
    ),
    check(
      'chk_clientes_suspensao_coerencia',
      sql`(${table.suspenso} = true AND ${table.suspensoEm} IS NOT NULL) OR (${table.suspenso} = false AND ${table.suspensoEm} IS NULL)`,
    ),
    index('idx_clientes_regime_tributario')
      .on(table.regimeTributario)
      .where(sql`${table.regimeTributario} IS NOT NULL`),
    index('idx_clientes_contador_id').on(table.contadorId),
  ],
);

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

export const visualizacoesGuias = pgTable(
  'visualizacoes_guias',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guiaId: uuid('guia_id')
      .notNull()
      .references(() => guias.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    visualizadoEm: timestamp('visualizado_em').notNull().defaultNow(),
  },
  (table) => [
    index('idx_visualizacoes_guia').on(table.guiaId),
    index('idx_visualizacoes_guia_user').on(table.userId),
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
    guiaId: uuid('documento_id').references(() => guias.id, {
      onDelete: 'set null',
    }),
    arquivoKey: text('arquivo_key').notNull(),
    arquivoNome: text('arquivo_nome').notNull(),
    tipo: text('tipo').notNull().default('FOLHA_MENSAL'),
    competencia: text('competencia').notNull(),
    periodoInicio: date('periodo_inicio').notNull(),
    periodoFim: date('periodo_fim').notNull(),
    periodoAquisitivoInicio: date('periodo_aquisitivo_inicio'),
    periodoAquisitivoFim: date('periodo_aquisitivo_fim'),
    diasFerias: integer('dias_ferias'),
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
    uniqueIndex('uidx_folhas_cliente_competencia')
      .on(table.clienteId, table.competencia)
      .where(sql`${table.tipo} = 'FOLHA_MENSAL'`),
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
      'chk_folhas_tipo',
      sql`${table.tipo} IN ('FOLHA_MENSAL', 'FERIAS')`,
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

export const cfops = pgTable(
  'cfops',
  {
    codigo: varchar('codigo', { length: 4 }).primaryKey(),
    descricao: text('descricao').notNull(),
    tipoOperacao: varchar('tipo_operacao', { length: 10 }).notNull(),
    abrangencia: varchar('abrangencia', { length: 15 }).notNull(),
    grupo: text('grupo'),
    // Categoria fiscal da destinação econômica da mercadoria/serviço.
    // Base para o motor de regras decidir crédito de ICMS/IPI e CIAP.
    categoriaFiscal: varchar('categoria_fiscal', { length: 30 })
      .notNull()
      .default('OUTRAS'),
    // Indica se, em regra geral, o CFOP dá direito a crédito de ICMS na entrada.
    // Uso/consumo (1556/2556) e ST-substituído (1403/1405) => false.
    geraCreditoIcmsPadrao: boolean('gera_credito_icms_padrao')
      .notNull()
      .default(false),
    descricaoDetalhada: text('descricao_detalhada'),
    ativo: boolean('ativo').notNull().default(true),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
  },
  (table) => [
    index('idx_cfops_tipo').on(table.tipoOperacao),
    index('idx_cfops_abrangencia').on(table.abrangencia),
    index('idx_cfops_categoria').on(table.categoriaFiscal),
    check('chk_cfops_codigo', sql`${table.codigo} ~ '^[123567][0-9]{3}$'`),
    check('chk_cfops_tipo', sql`${table.tipoOperacao} IN ('ENTRADA', 'SAIDA')`),
    check(
      'chk_cfops_abrangencia',
      sql`${table.abrangencia} IN ('ESTADUAL', 'INTERESTADUAL', 'EXTERIOR')`,
    ),
    check(
      'chk_cfops_categoria',
      sql`${table.categoriaFiscal} IN ('COMPRA_REVENDA', 'COMPRA_INSUMO', 'USO_CONSUMO', 'ATIVO_IMOBILIZADO', 'DEVOLUCAO', 'TRANSFERENCIA', 'REMESSA_RETORNO', 'PRESTACAO_SERVICO', 'OUTRAS')`,
    ),
  ],
);

export const cfopEquivalencias = pgTable(
  'cfop_equivalencias',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clienteId: uuid('cliente_id').references(() => clientes.id, {
      onDelete: 'cascade',
    }),
    cfopOrigem: varchar('cfop_origem', { length: 4 })
      .notNull()
      .references(() => cfops.codigo, { onDelete: 'cascade' }),
    cfopDestino: varchar('cfop_destino', { length: 4 })
      .notNull()
      .references(() => cfops.codigo, { onDelete: 'cascade' }),
    tipoOperacao: varchar('tipo_operacao', { length: 20 })
      .notNull()
      .default('SAIDA_PARA_ENTRADA'),
    descricao: text('descricao'),
    ativo: boolean('ativo').notNull().default(true),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
  },
  (table) => [
    unique('uidx_cfop_eq_cliente_origem')
      .on(table.clienteId, table.cfopOrigem)
      .nullsNotDistinct(),
    index('idx_cfop_eq_origem').on(table.cfopOrigem),
    index('idx_cfop_eq_cliente').on(table.clienteId),
    check(
      'chk_cfop_eq_tipo',
      sql`${table.tipoOperacao} IN ('SAIDA_PARA_ENTRADA', 'ENTRADA_PARA_SAIDA')`,
    ),
    check(
      'chk_cfop_eq_destino_diferente',
      sql`${table.cfopOrigem} <> ${table.cfopDestino}`,
    ),
  ],
);

export const controleNsu = pgTable(
  'controle_nsu',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    cnpj: text('cnpj').notNull(),
    tipoDocumento: text('tipo_documento').notNull(),
    ultimoNsu: bigint('ultimo_nsu', { mode: 'number' }).notNull().default(0),
    maxNsu: bigint('max_nsu', { mode: 'number' }).notNull().default(0),
    statusSefaz: integer('status_sefaz'),
    motivoSefaz: text('motivo_sefaz'),
    ultimaConsultaEm: timestamp('ultima_consulta_em'),
    proximaConsultaEm: timestamp('proxima_consulta_em'),
    sincronizacaoId: uuid('sincronizacao_id'),
    sincronizacaoIniciadaEm: timestamp('sincronizacao_iniciada_em', {
      withTimezone: true,
    }),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uidx_controle_nsu_cliente_tipo').on(
      table.clienteId,
      table.tipoDocumento,
    ),
    index('idx_controle_nsu_cliente_id').on(table.clienteId),
    check(
      'chk_controle_nsu_tipo',
      sql`${table.tipoDocumento} IN ('NFE', 'CTE')`,
    ),
    check('chk_controle_nsu_ultimo', sql`${table.ultimoNsu} >= 0`),
    check('chk_controle_nsu_max', sql`${table.maxNsu} >= 0`),
    check(
      'chk_controle_nsu_sincronizacao_coerencia',
      sql`(${table.sincronizacaoId} IS NULL AND ${table.sincronizacaoIniciadaEm} IS NULL) OR (${table.sincronizacaoId} IS NOT NULL AND ${table.sincronizacaoIniciadaEm} IS NOT NULL)`,
    ),
  ],
);

export const documentosFiscais = pgTable(
  'documentos_fiscais',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    chaveAcesso: text('chave_acesso').notNull(),
    nsu: bigint('nsu', { mode: 'number' }).notNull(),
    tipoDocumento: text('tipo_documento').notNull(),
    modelo: text('modelo').notNull(),
    serie: text('serie'),
    numeroDocumento: text('numero_documento').notNull(),
    emitenteCnpjCpf: text('emitente_cnpj_cpf').notNull(),
    emitenteRazaoSocial: text('emitente_razao_social'),
    destinatarioCnpjCpf: text('destinatario_cnpj_cpf').notNull(),
    destinatarioRazaoSocial: text('destinatario_razao_social'),
    dataEmissao: timestamp('data_emissao').notNull(),
    dataEmissaoFiscal: date('data_emissao_fiscal'),
    dataEntradaSaida: timestamp('data_entrada_saida'),
    dataEntradaSaidaFiscal: date('data_entrada_saida_fiscal'),
    valorTotal: numeric('valor_total', { precision: 14, scale: 2 }).notNull(),
    valorTotalDeclaradoXml: numeric('valor_total_declarado_xml', {
      precision: 15,
      scale: 2,
    }),
    totaisDeclaradosXml: jsonb('totais_declarados_xml').$type<
      Record<string, string | null>
    >(),
    quantidadeItensDeclaradaXml: integer('quantidade_itens_declarada_xml'),
    integridadeConferida: boolean('integridade_conferida')
      .notNull()
      .default(false),
    integridadeStatus: varchar('integridade_status', { length: 20 })
      .notNull()
      .default('NAO_CONFERIDA'),
    integridadeDetalhes: jsonb('integridade_detalhes').$type<
      Record<string, unknown>
    >(),
    codSituacaoSped: varchar('cod_situacao_sped', { length: 2 }),
    modalidadeFrete: varchar('modalidade_frete', { length: 1 }),
    informacoesComplementares: text('informacoes_complementares'),
    emitenteDados: jsonb('emitente_dados').$type<Record<string, unknown>>(),
    destinatarioDados:
      jsonb('destinatario_dados').$type<Record<string, unknown>>(),
    // Documentos referenciados (grupo <NFref>) para o registro C113 da EFD.
    documentosReferenciados: jsonb('documentos_referenciados').$type<
      Array<{ tipo: string; chaveAcesso: string | null }>
    >(),
    situacao: text('situacao').notNull().default('AUTORIZADA'),
    manifestacaoStatus: text('manifestacao_status')
      .notNull()
      .default('SEM_MANIFESTACAO'),
    tipoOperacaoEscriturada: varchar('tipo_operacao_escriturada', {
      length: 10,
    })
      .notNull()
      .default('ENTRADA'),
    tpNfXml: varchar('tp_nf_xml', { length: 1 }),
    escriturado: boolean('escriturado').notNull().default(false),
    escrituracaoStatus: varchar('escrituracao_status', { length: 24 })
      .notNull()
      .default('NAO_ESCRITURAVEL'),
    xmlKey: text('xml_key').notNull(),
    danfeKey: text('danfe_key'),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uidx_docs_fiscais_cliente_chave').on(
      table.clienteId,
      table.chaveAcesso,
    ),
    index('idx_docs_fiscais_cliente_id').on(table.clienteId),
    index('idx_docs_fiscais_tipo').on(table.tipoDocumento),
    index('idx_docs_fiscais_data_emissao').on(table.dataEmissao),
    index('idx_docs_fiscais_cliente_competencia').on(
      table.clienteId,
      table.dataEmissaoFiscal,
      table.id,
    ),
    index('idx_docs_fiscais_nsu').on(table.nsu),
    index('idx_docs_fiscais_destinatario').on(table.destinatarioCnpjCpf),
    index('idx_docs_fiscais_emitente').on(table.emitenteCnpjCpf),
    check('chk_docs_fiscais_chave', sql`length(${table.chaveAcesso}) = 44`),
    check(
      'chk_docs_fiscais_tipo',
      sql`${table.tipoDocumento} IN ('NFE', 'CTE', 'NFCE')`,
    ),
    check(
      'chk_docs_fiscais_modelo',
      sql`${table.modelo} IN ('55', '57', '65')`,
    ),
    check(
      'chk_docs_fiscais_tipo_modelo',
      sql`(${table.tipoDocumento} = 'NFE' AND ${table.modelo} = '55') OR (${table.tipoDocumento} = 'CTE' AND ${table.modelo} = '57') OR (${table.tipoDocumento} = 'NFCE' AND ${table.modelo} = '65')`,
    ),
    check(
      'chk_docs_fiscais_situacao',
      sql`${table.situacao} IN ('AUTORIZADA', 'CANCELADA', 'DENEGADA', 'RESUMIDA')`,
    ),
    check(
      'chk_docs_fiscais_manifestacao',
      sql`${table.manifestacaoStatus} IN ('SEM_MANIFESTACAO', 'CIENCIA', 'CONFIRMADA', 'DESCONHECIDA', 'NAO_REALIZADA')`,
    ),
    check(
      'chk_docs_fiscais_operacao_escriturada',
      sql`${table.tipoOperacaoEscriturada} IN ('ENTRADA', 'SAIDA')`,
    ),
    check(
      'chk_docs_fiscais_tp_nf_xml',
      sql`${table.tpNfXml} IS NULL OR ${table.tpNfXml} IN ('0', '1')`,
    ),
    check(
      'chk_docs_fiscais_escrituracao_status',
      sql`${table.escrituracaoStatus} IN ('ESCRITURADO', 'NAO_ESCRITURAVEL', 'PENDENTE_REVISAO')`,
    ),
    check(
      'chk_docs_fiscais_escrituracao_coerencia',
      sql`(${table.escriturado} = false AND ${table.escrituracaoStatus} = 'NAO_ESCRITURAVEL') OR (${table.escriturado} = true AND ${table.escrituracaoStatus} IN ('ESCRITURADO', 'PENDENTE_REVISAO'))`,
    ),
    check('chk_docs_fiscais_valor', sql`${table.valorTotal} >= 0`),
    check(
      'chk_docs_fiscais_valor_declarado',
      sql`${table.valorTotalDeclaradoXml} IS NULL OR ${table.valorTotalDeclaradoXml} >= 0`,
    ),
    check(
      'chk_docs_fiscais_quantidade_itens_declarada',
      sql`${table.quantidadeItensDeclaradaXml} IS NULL OR ${table.quantidadeItensDeclaradaXml} >= 0`,
    ),
    check(
      'chk_docs_fiscais_integridade_status',
      sql`${table.integridadeStatus} IN ('NAO_CONFERIDA', 'OK', 'DIVERGENTE')`,
    ),
    check(
      'chk_docs_fiscais_integridade_coerencia',
      sql`(${table.integridadeConferida} = false AND ${table.integridadeStatus} = 'NAO_CONFERIDA') OR (${table.integridadeConferida} = true AND ${table.integridadeStatus} IN ('OK', 'DIVERGENTE'))`,
    ),
    check(
      'chk_docs_fiscais_cod_situacao_sped',
      sql`${table.codSituacaoSped} IS NULL OR ${table.codSituacaoSped} ~ '^[0-9]{2}$'`,
    ),
    check(
      'chk_docs_fiscais_modalidade_frete',
      sql`${table.modalidadeFrete} IS NULL OR ${table.modalidadeFrete} ~ '^[0-9]$'`,
    ),
    check('chk_docs_fiscais_xml_key', sql`btrim(${table.xmlKey}) <> ''`),
  ],
);

export const documentosFiscaisItens = pgTable(
  'documentos_fiscais_itens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentoFiscalId: uuid('documento_fiscal_id').notNull(),
    clienteId: uuid('cliente_id').notNull(),
    numeroItem: integer('numero_item').notNull(),
    codigoProduto: text('codigo_produto').notNull(),
    codigoEan: text('codigo_ean'),
    descricao: text('descricao').notNull(),
    ncm: varchar('ncm', { length: 8 }),
    nve: text('nve'),
    cest: varchar('cest', { length: 7 }),
    indEscala: varchar('ind_escala', { length: 1 }),
    cnpjFabricante: varchar('cnpj_fabricante', { length: 14 }),
    codigoBeneficioFiscal: text('codigo_beneficio_fiscal'),
    cfopXml: varchar('cfop_xml', { length: 4 }),
    cfop: varchar('cfop', { length: 4 }).notNull(),
    tipoOperacaoEscriturada: varchar('tipo_operacao_escriturada', {
      length: 10,
    })
      .notNull()
      .default('ENTRADA'),
    cfopRevisaoNecessaria: boolean('cfop_revisao_necessaria')
      .notNull()
      .default(false),
    // Destinação econômica atribuída pelo usuário (override manual) que
    // realimenta o motor de regras para re-resolver o CFOP escriturado.
    destinacaoMercadoria: varchar('destinacao_mercadoria', { length: 20 }),
    destinacaoInferida: varchar('destinacao_inferida', { length: 20 }),
    destinacaoOrigem: varchar('destinacao_origem', { length: 20 }),
    destinacaoConfianca: numeric('destinacao_confianca', {
      precision: 4,
      scale: 3,
    }),
    destinacaoJustificativa: text('destinacao_justificativa'),
    cfopManual: boolean('cfop_manual').notNull().default(false),
    cfopOrigemResolucao: varchar('cfop_origem_resolucao', { length: 30 }),
    cfopMotivoResolucao: text('cfop_motivo_resolucao'),

    unidadeComercial: varchar('unidade_comercial', { length: 10 }).notNull(),
    quantidadeComercial: numeric('quantidade_comercial', {
      precision: 15,
      scale: 4,
    }).notNull(),
    valorUnitarioComercial: numeric('valor_unitario_comercial', {
      precision: 21,
      scale: 10,
    }).notNull(),
    valorBrutoProduto: numeric('valor_bruto_produto', {
      precision: 15,
      scale: 2,
    }).notNull(),
    codigoEanTributavel: text('codigo_ean_tributavel'),
    unidadeTributavel: varchar('unidade_tributavel', { length: 10 }),
    quantidadeTributavel: numeric('quantidade_tributavel', {
      precision: 15,
      scale: 4,
    }),
    valorUnitarioTributavel: numeric('valor_unitario_tributavel', {
      precision: 21,
      scale: 10,
    }),
    valorFrete: numeric('valor_frete', { precision: 15, scale: 2 }),
    valorSeguro: numeric('valor_seguro', { precision: 15, scale: 2 }),
    valorDesconto: numeric('valor_desconto', { precision: 15, scale: 2 }),
    valorOutrasDespesas: numeric('valor_outras_despesas', {
      precision: 15,
      scale: 2,
    }),
    indTotal: varchar('ind_total', { length: 1 }).notNull(),
    numeroPedidoCompra: text('numero_pedido_compra'),
    itemPedidoCompra: text('item_pedido_compra'),
    informacoesAdicionais: text('informacoes_adicionais'),
    codObsSped: varchar('cod_obs_sped', { length: 6 }),
    codCtaSped: text('cod_cta_sped'),

    origemMercadoria: varchar('origem_mercadoria', { length: 1 }),
    cstIcms: varchar('cst_icms', { length: 3 }),
    csosnIcms: varchar('csosn_icms', { length: 4 }),
    modalidadeBcIcms: varchar('modalidade_bc_icms', { length: 1 }),
    percentualReducaoBcIcms: numeric('percentual_reducao_bc_icms', {
      precision: 7,
      scale: 4,
    }),
    valorBcIcms: numeric('valor_bc_icms', { precision: 15, scale: 2 }),
    aliquotaIcms: numeric('aliquota_icms', { precision: 7, scale: 4 }),
    valorIcms: numeric('valor_icms', { precision: 15, scale: 2 }),
    modalidadeBcIcmsSt: varchar('modalidade_bc_icms_st', { length: 1 }),
    percentualMvaSt: numeric('percentual_mva_st', {
      precision: 7,
      scale: 4,
    }),
    percentualReducaoBcIcmsSt: numeric('percentual_reducao_bc_icms_st', {
      precision: 7,
      scale: 4,
    }),
    valorBcIcmsSt: numeric('valor_bc_icms_st', { precision: 15, scale: 2 }),
    aliquotaIcmsSt: numeric('aliquota_icms_st', {
      precision: 7,
      scale: 4,
    }),
    valorIcmsSt: numeric('valor_icms_st', { precision: 15, scale: 2 }),
    valorBcFcp: numeric('valor_bc_fcp', { precision: 15, scale: 2 }),
    aliquotaFcp: numeric('aliquota_fcp', { precision: 7, scale: 4 }),
    valorFcp: numeric('valor_fcp', { precision: 15, scale: 2 }),
    valorBcFcpSt: numeric('valor_bc_fcp_st', { precision: 15, scale: 2 }),
    aliquotaFcpSt: numeric('aliquota_fcp_st', { precision: 7, scale: 4 }),
    valorFcpSt: numeric('valor_fcp_st', { precision: 15, scale: 2 }),
    motivoDesoneracaoIcms: varchar('motivo_desoneracao_icms', { length: 2 }),
    valorIcmsDesonerado: numeric('valor_icms_desonerado', {
      precision: 15,
      scale: 2,
    }),
    percentualDiferimento: numeric('percentual_diferimento', {
      precision: 7,
      scale: 4,
    }),
    valorIcmsDiferido: numeric('valor_icms_diferido', {
      precision: 15,
      scale: 2,
    }),
    valorIcmsOperacao: numeric('valor_icms_operacao', {
      precision: 15,
      scale: 2,
    }),
    aliquotaCreditoSn: numeric('aliquota_credito_sn', {
      precision: 7,
      scale: 4,
    }),
    valorCreditoIcmsSn: numeric('valor_credito_icms_sn', {
      precision: 15,
      scale: 2,
    }),
    valorBcIcmsStRetido: numeric('valor_bc_icms_st_retido', {
      precision: 15,
      scale: 2,
    }),
    aliquotaIcmsStRetido: numeric('aliquota_icms_st_retido', {
      precision: 7,
      scale: 4,
    }),
    valorIcmsStRetido: numeric('valor_icms_st_retido', {
      precision: 15,
      scale: 2,
    }),

    valorBcIcmsUfDest: numeric('valor_bc_icms_uf_dest', {
      precision: 15,
      scale: 2,
    }),
    valorBcFcpUfDest: numeric('valor_bc_fcp_uf_dest', {
      precision: 15,
      scale: 2,
    }),
    percentualFcpUfDest: numeric('percentual_fcp_uf_dest', {
      precision: 7,
      scale: 4,
    }),
    aliquotaIcmsUfDest: numeric('aliquota_icms_uf_dest', {
      precision: 7,
      scale: 4,
    }),
    aliquotaIcmsInterestadual: numeric('aliquota_icms_interestadual', {
      precision: 7,
      scale: 4,
    }),
    percentualProvisorioPartilha: numeric('percentual_provisorio_partilha', {
      precision: 7,
      scale: 4,
    }),
    valorFcpUfDest: numeric('valor_fcp_uf_dest', {
      precision: 15,
      scale: 2,
    }),
    valorIcmsUfDest: numeric('valor_icms_uf_dest', {
      precision: 15,
      scale: 2,
    }),
    valorIcmsUfRemetente: numeric('valor_icms_uf_remetente', {
      precision: 15,
      scale: 2,
    }),

    cstIpi: varchar('cst_ipi', { length: 2 }),
    classeEnquadramentoIpi: varchar('classe_enquadramento_ipi', { length: 5 }),
    codigoEnquadramentoIpi: varchar('codigo_enquadramento_ipi', { length: 3 }),
    cnpjProdutorIpi: varchar('cnpj_produtor_ipi', { length: 14 }),
    valorBcIpi: numeric('valor_bc_ipi', { precision: 15, scale: 2 }),
    aliquotaIpi: numeric('aliquota_ipi', { precision: 7, scale: 4 }),
    quantidadeUnidadeIpi: numeric('quantidade_unidade_ipi', {
      precision: 15,
      scale: 4,
    }),
    valorUnidadeIpi: numeric('valor_unidade_ipi', {
      precision: 15,
      scale: 4,
    }),
    valorIpi: numeric('valor_ipi', { precision: 15, scale: 2 }),

    cstPis: varchar('cst_pis', { length: 2 }),
    valorBcPis: numeric('valor_bc_pis', { precision: 15, scale: 2 }),
    aliquotaPisPercentual: numeric('aliquota_pis_percentual', {
      precision: 7,
      scale: 4,
    }),
    quantidadeBcPis: numeric('quantidade_bc_pis', {
      precision: 15,
      scale: 4,
    }),
    aliquotaPisReais: numeric('aliquota_pis_reais', {
      precision: 15,
      scale: 4,
    }),
    valorPis: numeric('valor_pis', { precision: 15, scale: 2 }),
    valorBcPisSt: numeric('valor_bc_pis_st', { precision: 15, scale: 2 }),
    aliquotaPisStPercentual: numeric('aliquota_pis_st_percentual', {
      precision: 7,
      scale: 4,
    }),
    valorPisSt: numeric('valor_pis_st', { precision: 15, scale: 2 }),

    cstCofins: varchar('cst_cofins', { length: 2 }),
    valorBcCofins: numeric('valor_bc_cofins', { precision: 15, scale: 2 }),
    aliquotaCofinsPercentual: numeric('aliquota_cofins_percentual', {
      precision: 7,
      scale: 4,
    }),
    quantidadeBcCofins: numeric('quantidade_bc_cofins', {
      precision: 15,
      scale: 4,
    }),
    aliquotaCofinsReais: numeric('aliquota_cofins_reais', {
      precision: 15,
      scale: 4,
    }),
    valorCofins: numeric('valor_cofins', { precision: 15, scale: 2 }),
    valorBcCofinsSt: numeric('valor_bc_cofins_st', {
      precision: 15,
      scale: 2,
    }),
    aliquotaCofinsStPercentual: numeric('aliquota_cofins_st_percentual', {
      precision: 7,
      scale: 4,
    }),
    valorCofinsSt: numeric('valor_cofins_st', {
      precision: 15,
      scale: 2,
    }),

    valorBcIi: numeric('valor_bc_ii', { precision: 15, scale: 2 }),
    valorDespesaAduaneira: numeric('valor_despesa_aduaneira', {
      precision: 15,
      scale: 2,
    }),
    valorImpostoImportacao: numeric('valor_imposto_importacao', {
      precision: 15,
      scale: 2,
    }),
    valorIof: numeric('valor_iof', { precision: 15, scale: 2 }),
    valorTributosAproximados: numeric('valor_tributos_aproximados', {
      precision: 15,
      scale: 2,
    }),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'fk_df_itens_documento_fiscal',
      columns: [table.documentoFiscalId],
      foreignColumns: [documentosFiscais.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_df_itens_cliente',
      columns: [table.clienteId],
      foreignColumns: [clientes.id],
    }).onDelete('cascade'),
    uniqueIndex('uidx_item_doc_num').on(
      table.documentoFiscalId,
      table.numeroItem,
    ),
    index('idx_item_cliente_id').on(table.clienteId),
    index('idx_item_cfop').on(table.cfop),
    index('idx_item_cfop_xml').on(table.cfopXml),
    index('idx_item_operacao_escriturada').on(table.tipoOperacaoEscriturada),
    index('idx_item_cst_icms').on(table.cstIcms),
    index('idx_item_csosn_icms').on(table.csosnIcms),
    index('idx_item_cst_pis').on(table.cstPis),
    index('idx_item_cst_cofins').on(table.cstCofins),
    index('idx_item_ncm').on(table.ncm),
    check(
      'chk_item_destinacao_inferida',
      sql`${table.destinacaoInferida} IS NULL OR ${table.destinacaoInferida} IN ('REVENDA', 'INDUSTRIALIZACAO', 'USO_CONSUMO', 'ATIVO_IMOBILIZADO')`,
    ),
    check(
      'chk_item_destinacao_confianca',
      sql`${table.destinacaoConfianca} IS NULL OR ${table.destinacaoConfianca} BETWEEN 0 AND 1`,
    ),
    check(
      'chk_item_destinacao_origem',
      sql`${table.destinacaoOrigem} IS NULL OR ${table.destinacaoOrigem} IN ('MANUAL', 'HISTORICO', 'NCM_PERFIL', 'HEURISTICA', 'INDETERMINADO')`,
    ),
    check('chk_item_numero', sql`${table.numeroItem} BETWEEN 1 AND 990`),
    check(
      'chk_item_ind_escala',
      sql`${table.indEscala} IS NULL OR ${table.indEscala} IN ('S', 'N')`,
    ),
    check('chk_item_ind_total', sql`${table.indTotal} IN ('0', '1')`),
    check(
      'chk_item_origem',
      sql`${table.origemMercadoria} IS NULL OR ${table.origemMercadoria} ~ '^[0-8]$'`,
    ),
    check('chk_item_cfop', sql`${table.cfop} ~ '^[1-7][0-9]{3}$'`),
    check(
      'chk_item_cfop_xml',
      sql`${table.cfopXml} IS NULL OR ${table.cfopXml} ~ '^[1-7][0-9]{3}$'`,
    ),
    check(
      'chk_item_operacao_escriturada',
      sql`${table.tipoOperacaoEscriturada} IN ('ENTRADA', 'SAIDA')`,
    ),
    check(
      'chk_item_destinacao',
      sql`${table.destinacaoMercadoria} IS NULL OR ${table.destinacaoMercadoria} IN ('REVENDA', 'INDUSTRIALIZACAO', 'USO_CONSUMO', 'ATIVO_IMOBILIZADO')`,
    ),
  ],
);

export const documentosFiscaisCteEscrituracao = pgTable(
  'documentos_fiscais_cte_escrituracao',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentoFiscalId: uuid('documento_fiscal_id')
      .notNull()
      .references(() => documentosFiscais.id, { onDelete: 'cascade' }),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    escrituravel: boolean('escrituravel').notNull(),
    motivoNaoEscrituravel: text('motivo_nao_escrituravel'),
    tomadorCnpjCpf: text('tomador_cnpj_cpf').notNull(),
    tomadorPapel: varchar('tomador_papel', { length: 20 }).notNull(),
    tipoOperacaoEscriturada: varchar('tipo_operacao_escriturada', {
      length: 10,
    })
      .notNull()
      .default('ENTRADA'),
    tpCte: varchar('tp_cte', { length: 1 }).notNull(),
    tpServ: varchar('tp_serv', { length: 1 }).notNull(),
    modal: varchar('modal', { length: 2 }).notNull(),
    cfopXml: varchar('cfop_xml', { length: 4 }).notNull(),
    cfop: varchar('cfop', { length: 4 }).notNull(),
    cfopRevisaoNecessaria: boolean('cfop_revisao_necessaria')
      .notNull()
      .default(false),
    revisaoNecessaria: boolean('revisao_necessaria').notNull().default(false),
    cstIcms: varchar('cst_icms', { length: 3 }),
    csosnIcms: varchar('csosn_icms', { length: 4 }),
    valorTotalServico: numeric('valor_total_servico', {
      precision: 15,
      scale: 2,
    }).notNull(),
    valorReceber: numeric('valor_receber', {
      precision: 15,
      scale: 2,
    }).notNull(),
    valorBcIcms: numeric('valor_bc_icms', { precision: 15, scale: 2 }),
    aliquotaIcms: numeric('aliquota_icms', { precision: 7, scale: 4 }),
    valorIcms: numeric('valor_icms', { precision: 15, scale: 2 }),
    valorIcmsCreditavel: numeric('valor_icms_creditavel', {
      precision: 15,
      scale: 2,
    })
      .notNull()
      .default('0'),
    valorTotalTributos: numeric('valor_total_tributos', {
      precision: 15,
      scale: 2,
    }),
    chaveCteReferenciado: text('chave_cte_referenciado'),
    codigoMunicipioOrigem: varchar('codigo_municipio_origem', { length: 7 }),
    codigoMunicipioDestino: varchar('codigo_municipio_destino', { length: 7 }),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uidx_cte_escrituracao_documento').on(table.documentoFiscalId),
    index('idx_cte_escrituracao_cliente').on(table.clienteId),
    index('idx_cte_escrituracao_cfop').on(table.cfop),
    index('idx_cte_escrituracao_apuracao').on(
      table.clienteId,
      table.escrituravel,
      table.cfop,
    ),
    index('idx_cte_escrituracao_referencia').on(table.chaveCteReferenciado),
    check(
      'chk_cte_escrituracao_motivo',
      sql`(${table.escrituravel} = true AND ${table.motivoNaoEscrituravel} IS NULL) OR (${table.escrituravel} = false AND btrim(COALESCE(${table.motivoNaoEscrituravel}, '')) <> '')`,
    ),
    check(
      'chk_cte_escrituracao_tomador_documento',
      sql`${table.tomadorCnpjCpf} ~ '^[0-9]{11}$|^[0-9A-Z]{12}[0-9]{2}$'`,
    ),
    check(
      'chk_cte_escrituracao_tomador_papel',
      sql`${table.tomadorPapel} IN ('REMETENTE', 'EXPEDIDOR', 'RECEBEDOR', 'DESTINATARIO', 'TERCEIRO')`,
    ),
    check(
      'chk_cte_escrituracao_operacao',
      sql`${table.tipoOperacaoEscriturada} IN ('ENTRADA', 'SAIDA')`,
    ),
    check(
      'chk_cte_escrituracao_tp_cte',
      sql`${table.tpCte} IN ('0', '1', '2', '3')`,
    ),
    check(
      'chk_cte_escrituracao_tp_serv',
      sql`${table.tpServ} IN ('0', '1', '2', '3', '4')`,
    ),
    check('chk_cte_escrituracao_modal', sql`${table.modal} ~ '^[0-9]{2}$'`),
    check(
      'chk_cte_escrituracao_cfop_xml',
      sql`${table.cfopXml} ~ '^[123567][0-9]{3}$'`,
    ),
    check(
      'chk_cte_escrituracao_cfop',
      sql`${table.cfop} ~ '^[123567][0-9]{3}$'`,
    ),
    check(
      'chk_cte_escrituracao_referencia',
      sql`${table.chaveCteReferenciado} IS NULL OR ${table.chaveCteReferenciado} ~ '^[0-9A-Z]{44}$'`,
    ),
    check(
      'chk_cte_escrituracao_municipio_origem',
      sql`${table.codigoMunicipioOrigem} IS NULL OR ${table.codigoMunicipioOrigem} ~ '^[0-9]{7}$'`,
    ),
    check(
      'chk_cte_escrituracao_municipio_destino',
      sql`${table.codigoMunicipioDestino} IS NULL OR ${table.codigoMunicipioDestino} ~ '^[0-9]{7}$'`,
    ),
  ],
);

export const eventosFiscais = pgTable(
  'eventos_fiscais',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentoFiscalId: uuid('documento_fiscal_id')
      .notNull()
      .references(() => documentosFiscais.id, { onDelete: 'cascade' }),
    tipoEvento: text('tipo_evento').notNull(),
    codigoEvento: text('codigo_evento').notNull(),
    sequenciaEvento: integer('sequencia_evento').notNull().default(1),
    descricao: text('descricao'),
    protocolo: text('protocolo'),
    statusSefaz: integer('status_sefaz'),
    motivoSefaz: text('motivo_sefaz'),
    dataEvento: timestamp('data_evento').notNull().defaultNow(),
    xmlEventoKey: text('xml_evento_key'),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
  },
  (table) => [
    index('idx_eventos_fiscais_doc').on(table.documentoFiscalId),
    index('idx_eventos_fiscais_tipo').on(table.tipoEvento),
    index('idx_eventos_fiscais_data').on(table.dataEvento),
    check(
      'chk_eventos_fiscais_tipo',
      sql`${table.tipoEvento} IN ('MANIFESTACAO_CIENCIA', 'MANIFESTACAO_CONFIRMACAO', 'MANIFESTACAO_DESCONHECIMENTO', 'MANIFESTACAO_NAO_REALIZADA', 'CANCELAMENTO', 'CCE')`,
    ),
    check('chk_eventos_fiscais_sequencia', sql`${table.sequenciaEvento} >= 1`),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// EFD ICMS/IPI (SPED Fiscal)
// ─────────────────────────────────────────────────────────────────────────────

export const spedConfiguracoes = pgTable(
  'sped_configuracoes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    obrigadoEfdIcmsIpi: boolean('obrigado_efd_icms_ipi')
      .notNull()
      .default(false),
    perfilEfd: varchar('perfil_efd', { length: 1 }),
    indAtiv: varchar('ind_ativ', { length: 1 }),
    classificacaoEstabelecimentoIndustrial: varchar(
      'classificacao_estabelecimento_industrial',
      { length: 2 },
    ),
    codigoMunicipioIbge: varchar('codigo_municipio_ibge', { length: 7 }),
    nomeFantasia: text('nome_fantasia'),
    inscricaoMunicipal: text('inscricao_municipal'),
    suframa: text('suframa'),
    telefone: text('telefone'),
    fax: text('fax'),
    inventarioObrigatorio: boolean('inventario_obrigatorio')
      .notNull()
      .default(false),
    mesEntregaInventario: integer('mes_entrega_inventario')
      .notNull()
      .default(2),
    blocoKComMovimento: boolean('bloco_k_com_movimento')
      .notNull()
      .default(false),
    tipoItemPadrao: varchar('tipo_item_padrao', { length: 2 })
      .notNull()
      .default('00'),
    indicadores1010: jsonb('indicadores_1010')
      .$type<Record<string, 'S' | 'N'>>()
      .notNull()
      .default({}),
    atualizadoPor: text('atualizado_por').references(() => user.id, {
      onDelete: 'set null',
    }),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uidx_sped_config_cliente').on(table.clienteId),
    check(
      'chk_sped_config_perfil',
      sql`${table.perfilEfd} IS NULL OR ${table.perfilEfd} IN ('A', 'B', 'C')`,
    ),
    check(
      'chk_sped_config_ind_ativ',
      sql`${table.indAtiv} IS NULL OR ${table.indAtiv} IN ('0', '1')`,
    ),
    check(
      'chk_sped_config_clas_estab_ind',
      sql`${table.classificacaoEstabelecimentoIndustrial} IS NULL OR ${table.classificacaoEstabelecimentoIndustrial} ~ '^[0-9]{2}$'`,
    ),
    check(
      'chk_sped_config_codigo_municipio',
      sql`${table.codigoMunicipioIbge} IS NULL OR ${table.codigoMunicipioIbge} ~ '^[0-9]{7}$'`,
    ),
    check(
      'chk_sped_config_tipo_item_padrao',
      sql`${table.tipoItemPadrao} ~ '^[0-9]{2}$'`,
    ),
    check(
      'chk_sped_config_mes_inventario',
      sql`${table.mesEntregaInventario} BETWEEN 1 AND 12`,
    ),
    check(
      'chk_sped_config_indicadores_1010',
      sql`jsonb_typeof(${table.indicadores1010}) = 'object'`,
    ),
  ],
);

export const spedContabilistas = pgTable(
  'sped_contabilistas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
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
    index('idx_sped_contabilista_cliente').on(table.clienteId),
    check(
      'chk_sped_contabilista_documento',
      sql`(${table.cpf} IS NOT NULL AND ${table.cpf} ~ '^[0-9]{11}$') OR (${table.cnpj} IS NOT NULL AND ${table.cnpj} ~ '^[0-9A-Z]{12}[0-9]{2}$')`,
    ),
    check(
      'chk_sped_contabilista_cep',
      sql`${table.cep} IS NULL OR ${table.cep} ~ '^[0-9]{8}$'`,
    ),
    check(
      'chk_sped_contabilista_codigo_municipio',
      sql`${table.codigoMunicipioIbge} ~ '^[0-9]{7}$'`,
    ),
  ],
);

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
    fonteUltimoDocumentoId: uuid('fonte_ultimo_documento_id').references(
      () => documentosFiscais.id,
      { onDelete: 'set null' },
    ),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
  },
  (table) => [
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

export const spedUnidades = pgTable(
  'sped_unidades',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    codigo: varchar('codigo', { length: 6 }).notNull(),
    descricao: text('descricao').notNull(),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uidx_sped_unidade_codigo').on(table.clienteId, table.codigo),
    index('idx_sped_unidade_cliente').on(table.clienteId),
    check('chk_sped_unidade_codigo', sql`btrim(${table.codigo}) <> ''`),
  ],
);

export const spedItens = pgTable(
  'sped_itens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    participanteOrigemId: uuid('participante_origem_id').references(
      () => spedParticipantes.id,
      { onDelete: 'restrict' },
    ),
    codigo: varchar('codigo', { length: 60 }).notNull(),
    codigoExterno: text('codigo_externo').notNull(),
    descricao: text('descricao').notNull(),
    codigoBarras: text('codigo_barras'),
    unidadeId: uuid('unidade_id')
      .notNull()
      .references(() => spedUnidades.id, { onDelete: 'restrict' }),
    tipoItem: varchar('tipo_item', { length: 2 }).notNull().default('00'),
    tipoItemInferido: boolean('tipo_item_inferido').notNull().default(true),
    ncm: varchar('ncm', { length: 8 }),
    exIpi: varchar('ex_ipi', { length: 3 }),
    codigoGenero: varchar('codigo_genero', { length: 2 }),
    codigoServico: text('codigo_servico'),
    aliquotaIcms: numeric('aliquota_icms', { precision: 7, scale: 4 }),
    cest: varchar('cest', { length: 7 }),
    ativo: boolean('ativo').notNull().default(true),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uidx_sped_item_codigo').on(table.clienteId, table.codigo),
    unique('uq_sped_item_origem_externo')
      .on(table.clienteId, table.participanteOrigemId, table.codigoExterno)
      .nullsNotDistinct(),
    index('idx_sped_item_cliente').on(table.clienteId),
    check('chk_sped_item_tipo', sql`${table.tipoItem} ~ '^[0-9]{2}$'`),
    check(
      'chk_sped_item_ncm',
      sql`${table.ncm} IS NULL OR ${table.ncm} ~ '^[0-9]{8}$'`,
    ),
    check(
      'chk_sped_item_cest',
      sql`${table.cest} IS NULL OR ${table.cest} ~ '^[0-9]{7}$'`,
    ),
  ],
);

export const spedResponsabilidadesTributarias = pgTable(
  'sped_responsabilidades_tributarias',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    tipo: varchar('tipo', { length: 20 }).notNull(),
    uf: varchar('uf', { length: 2 }).notNull(),
    vigenciaInicio: date('vigencia_inicio').notNull(),
    vigenciaFim: date('vigencia_fim'),
    ativo: boolean('ativo').notNull().default(true),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uidx_sped_responsabilidade_vigencia').on(
      table.clienteId,
      table.tipo,
      table.uf,
      table.vigenciaInicio,
    ),
    index('idx_sped_responsabilidade_cliente').on(table.clienteId),
    check(
      'chk_sped_responsabilidade_tipo',
      sql`${table.tipo} IN ('ICMS_ST', 'DIFAL_FCP')`,
    ),
    check('chk_sped_responsabilidade_uf', sql`${table.uf} ~ '^[A-Z]{2}$'`),
    check(
      'chk_sped_responsabilidade_vigencia',
      sql`${table.vigenciaFim} IS NULL OR ${table.vigenciaFim} >= ${table.vigenciaInicio}`,
    ),
  ],
);

export const spedSaldosApuracao = pgTable(
  'sped_saldos_apuracao',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    competencia: date('competencia').notNull(),
    tipo: varchar('tipo', { length: 20 }).notNull(),
    uf: varchar('uf', { length: 2 }),
    saldoCredorAnterior: numeric('saldo_credor_anterior', {
      precision: 15,
      scale: 2,
    })
      .notNull()
      .default('0'),
    atualizadoPor: text('atualizado_por').references(() => user.id, {
      onDelete: 'set null',
    }),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
  },
  (table) => [
    unique('uq_sped_saldo_competencia')
      .on(table.clienteId, table.competencia, table.tipo, table.uf)
      .nullsNotDistinct(),
    index('idx_sped_saldo_cliente_competencia').on(
      table.clienteId,
      table.competencia,
    ),
    check(
      'chk_sped_saldo_tipo',
      sql`${table.tipo} IN ('ICMS_PROPRIO', 'ICMS_ST', 'IPI')`,
    ),
    check(
      'chk_sped_saldo_uf',
      sql`${table.uf} IS NULL OR ${table.uf} ~ '^[A-Z]{2}$'`,
    ),
    check('chk_sped_saldo_valor', sql`${table.saldoCredorAnterior} >= 0`),
  ],
);

export const spedAjustesApuracao = pgTable(
  'sped_ajustes_apuracao',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    competencia: date('competencia').notNull(),
    registro: varchar('registro', { length: 4 }).notNull(),
    codigoAjuste: text('codigo_ajuste').notNull(),
    descricao: text('descricao'),
    valor: numeric('valor', { precision: 15, scale: 2 }).notNull(),
    indicador: varchar('indicador', { length: 24 }).notNull(),
    uf: varchar('uf', { length: 2 }),
    numeroDocumento: text('numero_documento'),
    atualizadoPor: text('atualizado_por').references(() => user.id, {
      onDelete: 'set null',
    }),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
  },
  (table) => [
    index('idx_sped_ajuste_cliente_competencia').on(
      table.clienteId,
      table.competencia,
    ),
    check(
      'chk_sped_ajuste_registro',
      sql`${table.registro} IN ('E111', 'E220', 'E311', 'E530')`,
    ),
    check(
      'chk_sped_ajuste_indicador',
      sql`${table.indicador} IN ('DEBITO', 'CREDITO', 'ESTORNO_DEBITO', 'ESTORNO_CREDITO', 'DEDUCAO', 'DEBITO_ESPECIAL')`,
    ),
    check('chk_sped_ajuste_valor', sql`${table.valor} >= 0`),
    check(
      'chk_sped_ajuste_uf',
      sql`${table.uf} IS NULL OR ${table.uf} ~ '^[A-Z]{2}$'`,
    ),
    check(
      'chk_sped_ajuste_coerencia',
      sql`(
        (${table.registro} = 'E111' AND ${table.uf} IS NULL AND ${table.codigoAjuste} ~ '^[A-Z]{2}0[0-5][A-Z0-9]{4}$')
        OR (${table.registro} = 'E220' AND ${table.uf} IS NOT NULL AND ${table.codigoAjuste} ~ ('^' || ${table.uf} || '1[0-5][A-Z0-9]{4}$'))
        OR (${table.registro} = 'E311' AND ${table.uf} IS NOT NULL AND ${table.codigoAjuste} ~ ('^' || ${table.uf} || '[23][0-5][A-Z0-9]{4}$'))
        OR (${table.registro} = 'E530' AND ${table.uf} IS NULL AND ${table.codigoAjuste} ~ '^[A-Z0-9]{1,3}$' AND ${table.indicador} IN ('DEBITO', 'CREDITO'))
      )`,
    ),
    check(
      'chk_sped_ajuste_natureza_indicador',
      sql`${table.registro} = 'E530' OR CASE substring(${table.codigoAjuste} FROM 4 FOR 1)
        WHEN '0' THEN ${table.indicador} = 'DEBITO'
        WHEN '1' THEN ${table.indicador} = 'ESTORNO_CREDITO'
        WHEN '2' THEN ${table.indicador} = 'CREDITO'
        WHEN '3' THEN ${table.indicador} = 'ESTORNO_DEBITO'
        WHEN '4' THEN ${table.indicador} = 'DEDUCAO'
        WHEN '5' THEN ${table.indicador} = 'DEBITO_ESPECIAL'
        ELSE false
      END`,
    ),
  ],
);

export const spedObrigacoesRecolhimento = pgTable(
  'sped_obrigacoes_recolhimento',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    competencia: date('competencia').notNull(),
    tipo: varchar('tipo', { length: 20 }).notNull(),
    uf: varchar('uf', { length: 2 }),
    codigoObrigacao: text('codigo_obrigacao').notNull(),
    valor: numeric('valor', { precision: 15, scale: 2 }).notNull(),
    dataVencimento: date('data_vencimento').notNull(),
    codigoReceita: text('codigo_receita'),
    numeroProcesso: text('numero_processo'),
    indicadorProcesso: varchar('indicador_processo', { length: 1 }),
    processo: text('processo'),
    textoComplementar: text('texto_complementar'),
    mesReferencia: varchar('mes_referencia', { length: 6 }),
    atualizadoPor: text('atualizado_por').references(() => user.id, {
      onDelete: 'set null',
    }),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
  },
  (table) => [
    unique('uq_sped_obrigacao_competencia')
      .on(table.clienteId, table.competencia, table.tipo, table.uf)
      .nullsNotDistinct(),
    index('idx_sped_obrigacao_cliente_competencia').on(
      table.clienteId,
      table.competencia,
    ),
    check(
      'chk_sped_obrigacao_tipo',
      sql`${table.tipo} IN ('ICMS_PROPRIO', 'ICMS_ST', 'DIFAL_FCP')`,
    ),
    check('chk_sped_obrigacao_valor', sql`${table.valor} >= 0`),
    check(
      'chk_sped_obrigacao_uf',
      sql`${table.uf} IS NULL OR ${table.uf} ~ '^[A-Z]{2}$'`,
    ),
    check(
      'chk_sped_obrigacao_mes_referencia',
      sql`${table.mesReferencia} IS NULL OR ${table.mesReferencia} ~ '^[0-9]{6}$'`,
    ),
  ],
);

export const spedInventarios = pgTable(
  'sped_inventarios',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    dataInventario: date('data_inventario').notNull(),
    motivo: varchar('motivo', { length: 2 }).notNull(),
    valorTotal: numeric('valor_total', { precision: 15, scale: 2 }).notNull(),
    status: varchar('status', { length: 12 }).notNull().default('RASCUNHO'),
    atualizadoPor: text('atualizado_por').references(() => user.id, {
      onDelete: 'set null',
    }),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uidx_sped_inventario_cliente_data_motivo').on(
      table.clienteId,
      table.dataInventario,
      table.motivo,
    ),
    index('idx_sped_inventario_cliente_data').on(
      table.clienteId,
      table.dataInventario,
    ),
    check(
      'chk_sped_inventario_motivo',
      sql`${table.motivo} IN ('01', '02', '03', '04', '05', '06')`,
    ),
    check(
      'chk_sped_inventario_status',
      sql`${table.status} IN ('RASCUNHO', 'FECHADO')`,
    ),
    check('chk_sped_inventario_valor', sql`${table.valorTotal} >= 0`),
  ],
);

export const spedInventarioItens = pgTable(
  'sped_inventario_itens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    inventarioId: uuid('inventario_id')
      .notNull()
      .references(() => spedInventarios.id, { onDelete: 'cascade' }),
    spedItemId: uuid('sped_item_id')
      .notNull()
      .references(() => spedItens.id, { onDelete: 'restrict' }),
    unidade: varchar('unidade', { length: 6 }).notNull(),
    quantidade: numeric('quantidade', { precision: 15, scale: 3 }).notNull(),
    valorUnitario: numeric('valor_unitario', {
      precision: 21,
      scale: 6,
    }).notNull(),
    valorItem: numeric('valor_item', { precision: 15, scale: 2 }).notNull(),
    indicadorPropriedade: varchar('indicador_propriedade', { length: 1 })
      .notNull()
      .default('0'),
    participanteId: uuid('participante_id').references(
      () => spedParticipantes.id,
      { onDelete: 'restrict' },
    ),
    textoComplementar: text('texto_complementar'),
    codigoConta: text('codigo_conta'),
    valorItemIr: numeric('valor_item_ir', { precision: 15, scale: 2 }),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
  },
  (table) => [
    unique('uq_sped_inventario_item_participante')
      .on(
        table.inventarioId,
        table.spedItemId,
        table.indicadorPropriedade,
        table.participanteId,
      )
      .nullsNotDistinct(),
    index('idx_sped_inventario_item_inventario').on(table.inventarioId),
    check('chk_sped_inventario_item_qtd', sql`${table.quantidade} >= 0`),
    check(
      'chk_sped_inventario_item_valor_unitario',
      sql`${table.valorUnitario} >= 0`,
    ),
    check('chk_sped_inventario_item_valor', sql`${table.valorItem} >= 0`),
    check(
      'chk_sped_inventario_item_calculo',
      sql`${table.valorItem} = round(${table.quantidade} * ${table.valorUnitario}, 2)`,
    ),
    check(
      'chk_sped_inventario_item_unidade',
      sql`${table.unidade} ~ '^[0-9A-Z]{1,6}$'`,
    ),
    check(
      'chk_sped_inventario_item_ind_prop',
      sql`${table.indicadorPropriedade} IN ('0', '1', '2')`,
    ),
    check(
      'chk_sped_inventario_item_participante',
      sql`(${table.indicadorPropriedade} = '0' AND ${table.participanteId} IS NULL) OR (${table.indicadorPropriedade} IN ('1', '2') AND ${table.participanteId} IS NOT NULL)`,
    ),
    check(
      'chk_sped_inventario_item_valor_ir',
      sql`${table.valorItemIr} IS NULL OR ${table.valorItemIr} >= 0`,
    ),
  ],
);

export const spedArquivosGerados = pgTable(
  'sped_arquivos_gerados',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    competencia: date('competencia').notNull(),
    finalidade: varchar('finalidade', { length: 1 }).notNull(),
    codVersao: varchar('cod_versao', { length: 3 }).notNull(),
    perfil: varchar('perfil', { length: 1 }).notNull(),
    status: varchar('status', { length: 12 }).notNull(),
    hashSha256: varchar('hash_sha256', { length: 64 }),
    arquivoKey: text('arquivo_key'),
    arquivoNome: text('arquivo_nome'),
    tamanhoBytes: bigint('tamanho_bytes', { mode: 'number' }),
    contadores: jsonb('contadores').$type<Record<string, unknown>>(),
    inconsistencias:
      jsonb('inconsistencias').$type<Array<Record<string, unknown>>>(),
    erro: text('erro'),
    geradoPor: text('gerado_por').references(() => user.id, {
      onDelete: 'set null',
    }),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
    concluidoEm: timestamp('concluido_em'),
  },
  (table) => [
    index('idx_sped_arquivo_cliente_competencia').on(
      table.clienteId,
      table.competencia,
      table.criadoEm,
    ),
    index('idx_sped_arquivo_status').on(table.status),
    check(
      'chk_sped_arquivo_finalidade',
      sql`${table.finalidade} IN ('0', '1')`,
    ),
    check('chk_sped_arquivo_perfil', sql`${table.perfil} IN ('A', 'B', 'C')`),
    check(
      'chk_sped_arquivo_status',
      sql`${table.status} IN ('PROCESSANDO', 'GERADO', 'FALHOU')`,
    ),
    check(
      'chk_sped_arquivo_hash',
      sql`${table.hashSha256} IS NULL OR ${table.hashSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'chk_sped_arquivo_tamanho',
      sql`${table.tamanhoBytes} IS NULL OR ${table.tamanhoBytes} >= 0`,
    ),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// Motor de regras fiscais, CIAP (Bloco G) e guias de apuração
// ─────────────────────────────────────────────────────────────────────────────

// Regras fiscais avançadas (Rule Engine). clienteId nulo = regra global.
// Resolvem CFOP escriturado, CST/CSOSN e direito a crédito com base em
// destinação da mercadoria, NCM, fornecedor, UF e CFOP de origem.
export const regrasFiscais = pgTable(
  'regras_fiscais',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clienteId: uuid('cliente_id').references(() => clientes.id, {
      onDelete: 'cascade',
    }),
    prioridade: integer('prioridade').notNull().default(100),
    nomeRegra: text('nome_regra').notNull(),

    // Critérios de correspondência (match)
    tipoOperacaoOrigem: varchar('tipo_operacao_origem', { length: 10 }),
    cfopOrigem: varchar('cfop_origem', { length: 4 }),
    ncm: varchar('ncm', { length: 8 }),
    cstIcmsOrigem: varchar('cst_icms_origem', { length: 3 }),
    csosnOrigem: varchar('csosn_origem', { length: 4 }),
    fornecedorCnpjCpf: text('fornecedor_cnpj_cpf'),
    ufOrigem: varchar('uf_origem', { length: 2 }),
    destinacaoMercadoria: varchar('destinacao_mercadoria', { length: 20 }),

    // Ações resultantes (transform)
    cfopDestino: varchar('cfop_destino', { length: 4 })
      .notNull()
      .references(() => cfops.codigo),
    cstIcmsDestino: varchar('cst_icms_destino', { length: 3 }),
    csosnDestino: varchar('csosn_destino', { length: 4 }),
    apropriaCreditoIcms: boolean('apropria_credito_icms')
      .notNull()
      .default(false),
    percentualReducaoBcIcms: numeric('percentual_reducao_bc_icms', {
      precision: 7,
      scale: 4,
    }),
    apropriaCreditoIpi: boolean('apropria_credito_ipi')
      .notNull()
      .default(false),
    apropriaCreditoPisCofins: boolean('apropria_credito_pis_cofins')
      .notNull()
      .default(false),
    cstPisDestino: varchar('cst_pis_destino', { length: 2 }),
    cstCofinsDestino: varchar('cst_cofins_destino', { length: 2 }),
    exigeCiap: boolean('exige_ciap').notNull().default(false),
    exigeDifalEntrada: boolean('exige_difal_entrada').notNull().default(false),
    observacaoFiscal: text('observacao_fiscal'),

    ativo: boolean('ativo').notNull().default(true),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
  },
  (table) => [
    index('idx_regras_fiscais_cliente').on(table.clienteId),
    index('idx_regras_fiscais_match').on(
      table.tipoOperacaoOrigem,
      table.cfopOrigem,
      table.prioridade,
    ),
    index('idx_regras_fiscais_ncm').on(table.ncm),
    check(
      'chk_regras_fiscais_tipo_origem',
      sql`${table.tipoOperacaoOrigem} IS NULL OR ${table.tipoOperacaoOrigem} IN ('ENTRADA', 'SAIDA')`,
    ),
    check(
      'chk_regras_fiscais_destinacao',
      sql`${table.destinacaoMercadoria} IS NULL OR ${table.destinacaoMercadoria} IN ('REVENDA', 'INDUSTRIALIZACAO', 'USO_CONSUMO', 'ATIVO_IMOBILIZADO')`,
    ),
    check('chk_regras_fiscais_prioridade', sql`${table.prioridade} >= 0`),
  ],
);

// CIAP — Controle de crédito do ICMS do ativo permanente (Bloco G / 1-48 avos)
export const ciapAtivoPermanente = pgTable(
  'ciap_ativo_permanente',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    documentoFiscalId: uuid('documento_fiscal_id').references(
      () => documentosFiscais.id,
      { onDelete: 'set null' },
    ),
    documentoFiscalItemId: uuid('documento_fiscal_item_id').references(
      () => documentosFiscaisItens.id,
      { onDelete: 'set null' },
    ),

    codigoBem: varchar('codigo_bem', { length: 60 }).notNull(),
    identificacaoBem: text('identificacao_bem').notNull(),

    // Fase 2 / R2.1 — Identidade patrimonial POR AQUISIÇÃO (não por SKU).
    //
    // O `codigoBem` acima é derivado do SKU (`codigoProduto`) e, pelo unique
    // `uidx_ciap_cliente_codigo_bem`, funde duas compras do mesmo SKU num único
    // bem. `chaveAquisicao` passa a ser a identidade estável de UMA aquisição:
    // `${documentoFiscalId}:${documentoFiscalItemId}` quando o bem veio de um
    // item escriturado, ou o próprio `id` (UUID) para cadastros manuais sem
    // item. Duas aquisições do mesmo SKU têm chaves distintas e, portanto, duas
    // identidades patrimoniais distintas (R2.1).
    //
    // Coluna ADITIVA e anulável: o backfill assistido a popula sem destruir o
    // `codigoBem` legado; o unique parcial abaixo só vale para linhas já
    // migradas (chave não nula), de modo que a migração não quebra fichas
    // antigas ainda não saneadas.
    chaveAquisicao: varchar('chave_aquisicao', { length: 120 }),

    // Procedência da identidade atual do bem, para auditoria do saneamento:
    //  - 'aquisicao'                 → identidade reconstruída a partir de um
    //                                   documento/item escriturado (comprovada);
    //  - 'reconstruido_nao_comprovado' → ficha legada sem lastro em item
    //                                   escriturado; chave = próprio UUID (o
    //                                   backfill NÃO inventa documento/competência);
    //  - 'sku_legado'                → ainda não migrada (estado inicial pós-DDL).
    // Restringido por `chk_ciap_origem_identidade`.
    origemIdentidade: varchar('origem_identidade', { length: 30 })
      .notNull()
      .default('sku_legado'),

    // R2.1 — fichas cuja identidade por SKU encobre MAIS DE UMA aquisição
    // escriturada ficam marcadas para saneamento assistido (rollout, Fase 5/13):
    // o backfill não decide sozinho a qual aquisição a ficha legada pertence.
    saneamentoPendente: boolean('saneamento_pendente').notNull().default(false),

    dataEntrada: date('data_entrada').notNull(),
    valorIcmsTotal: numeric('valor_icms_total', {
      precision: 15,
      scale: 2,
    }).notNull(),
    valorIcmsFrete: numeric('valor_icms_frete', {
      precision: 15,
      scale: 2,
    }).default('0'),
    valorIcmsDifal: numeric('valor_icms_difal', {
      precision: 15,
      scale: 2,
    }).default('0'),
    quantidadeParcelas: integer('quantidade_parcelas').notNull().default(48),
    parcelasApropriadas: integer('parcelas_apropriadas').notNull().default(0),
    saldoCredorRestante: numeric('saldo_credor_restante', {
      precision: 15,
      scale: 2,
    }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('ATIVO'),
    dataBaixa: date('data_baixa'),
    motivoBaixa: varchar('motivo_baixa', { length: 2 }),

    criadoEm: timestamp('criado_em').notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
  },
  (table) => [
    index('idx_ciap_cliente').on(table.clienteId),
    index('idx_ciap_status').on(table.status),
    uniqueIndex('uidx_ciap_cliente_codigo_bem').on(
      table.clienteId,
      table.codigoBem,
    ),
    // R2.1 — identidade POR AQUISIÇÃO: no máximo uma ficha por
    // (cliente, chaveAquisicao). Unique PARCIAL (apenas chave não nula) para
    // conviver, de forma aditiva, com fichas legadas ainda não migradas (chave
    // nula) e com o unique legado por SKU, que permanece durante a transição.
    uniqueIndex('uidx_ciap_cliente_chave_aquisicao')
      .on(table.clienteId, table.chaveAquisicao)
      .where(sql`${table.chaveAquisicao} IS NOT NULL`),
    check(
      'chk_ciap_status',
      sql`${table.status} IN ('ATIVO', 'BAIXADO', 'CONCLUIDO')`,
    ),
    check(
      'chk_ciap_origem_identidade',
      sql`${table.origemIdentidade} IN ('sku_legado', 'aquisicao', 'reconstruido_nao_comprovado')`,
    ),
    check(
      'chk_ciap_parcelas',
      sql`${table.quantidadeParcelas} > 0 AND ${table.parcelasApropriadas} >= 0 AND ${table.parcelasApropriadas} <= ${table.quantidadeParcelas}`,
    ),
    check(
      'chk_ciap_motivo_baixa',
      sql`${table.motivoBaixa} IS NULL OR ${table.motivoBaixa} IN ('01', '02', '03')`,
    ),
  ],
);

// Contenção de idempotência do CIAP (Fase 0 / F06). Registra que a apropriação
// de uma competência já foi aplicada a um bem, para que retries e chamadas
// concorrentes não consumam parcelas em duplicidade. Estrutura mínima e
// aditiva; será absorvida pela razão completa (ciap_apropriacoes) na Fase 2.
export const ciapCompetenciasApropriadas = pgTable(
  'ciap_competencias_apropriadas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    bemId: uuid('bem_id')
      .notNull()
      .references(() => ciapAtivoPermanente.id, { onDelete: 'cascade' }),
    competencia: date('competencia').notNull(),
    aplicadoEm: timestamp('aplicado_em', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('uidx_ciap_competencia_bem').on(
      table.clienteId,
      table.competencia,
      table.bemId,
    ),
    index('idx_ciap_competencia_cliente').on(
      table.clienteId,
      table.competencia,
    ),
  ],
);

// Razão de fatos patrimoniais do CIAP (Fase 2 / F06). É o histórico auditável
// dos eventos que afetam o bem: aquisição, imobilização, baixa, transferência e
// correção/estorno. Diferente de `ciap_apropriacoes` (que grava a razão mensal
// de crédito), esta tabela registra os FATOS que originam ou alteram o controle,
// com datas e documentos. Migração aditiva: não altera as tabelas existentes.
//
// R1.6: a correção retroativa gera um movimento de `correcao` (estorno/
//   substituição) auditável, nunca uma sobrescrita silenciosa. O vínculo com o
//   movimento substituído é guardado em `movimentoAnteriorId`.
// R1.7: o histórico separa saldo passível de controle (aquisicao/imobilizacao),
//   e o cancelamento residual (baixa/transferencia/correcao), classificado por
//   `tipo` e refletido em `valorIcmsPassivel`.
export const ciapMovimentos = pgTable(
  'ciap_movimentos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    bemId: uuid('bem_id')
      .notNull()
      .references(() => ciapAtivoPermanente.id, { onDelete: 'cascade' }),

    // Tipo do fato patrimonial. Restringido por check `chk_ciap_mov_tipo`.
    tipo: varchar('tipo', { length: 20 }).notNull(),

    // Data do fato (não a data de registro). Dirige elegibilidade/calendário.
    dataMovimento: date('data_movimento').notNull(),

    // Documento fiscal de origem/suporte do fato, quando houver.
    documentoFiscalId: uuid('documento_fiscal_id').references(
      () => documentosFiscais.id,
      { onDelete: 'set null' },
    ),
    documentoFiscalItemId: uuid('documento_fiscal_item_id').references(
      () => documentosFiscaisItens.id,
      { onDelete: 'set null' },
    ),

    // Valor de ICMS passível de controle afetado pelo fato (base da razão).
    // Positivo em aquisicao/imobilizacao, pode ser negativo em baixa/correcao.
    valorIcmsPassivel: numeric('valor_icms_passivel', {
      precision: 15,
      scale: 2,
    }).notNull(),

    // R1.6 — auditoria da correção retroativa: aponta para o movimento que este
    // estorna/substitui. NULL para fatos originais.
    movimentoAnteriorId: uuid('movimento_anterior_id'),

    // Motivo de baixa (SPED 01/02/03) quando `tipo = 'baixa'`.
    motivoBaixa: varchar('motivo_baixa', { length: 2 }),

    observacao: text('observacao'),

    criadoEm: timestamp('criado_em', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_ciap_mov_cliente').on(table.clienteId),
    index('idx_ciap_mov_bem').on(table.bemId),
    index('idx_ciap_mov_bem_data').on(table.bemId, table.dataMovimento),
    foreignKey({
      columns: [table.movimentoAnteriorId],
      foreignColumns: [table.id],
      name: 'ciap_movimentos_movimento_anterior_id_fk',
    }).onDelete('set null'),
    check(
      'chk_ciap_mov_tipo',
      sql`${table.tipo} IN ('aquisicao', 'imobilizacao', 'baixa', 'transferencia', 'correcao')`,
    ),
    check(
      'chk_ciap_mov_motivo_baixa',
      sql`${table.motivoBaixa} IS NULL OR ${table.motivoBaixa} IN ('01', '02', '03')`,
    ),
    // R1.6: um movimento só referencia outro quando é correção/estorno.
    check(
      'chk_ciap_mov_correcao',
      sql`${table.movimentoAnteriorId} IS NULL OR ${table.tipo} = 'correcao'`,
    ),
  ],
);

// Razão mensal de crédito do CIAP (Fase 2 / F06-F08). Grava, por bem e
// competência, a apropriação versionada do crédito: base de controle, parcela
// passível, coeficiente do cenário, parcela admitida e parcela vedada. Absorve
// conceitualmente `ciap_competencias_apropriadas` da Fase 0 (que apenas marcava
// a competência como apropriada). Migração aditiva: a tabela da Fase 0 NÃO é
// removida nesta etapa — a transição é feita no motor de apropriação (tarefa 2).
//
// R1.1/R1.2: idempotência e concorrência — o unique por (cliente, bem,
//   competência) sobre a versão ativa impede dupla parcela; retries e chamadas
//   concorrentes convergem para uma única apropriação ativa.
// R1.4: `numeroParcela` é derivado do calendário (mês de entrada + proporcional),
//   não do número de chamadas. Guardado aqui para auditoria da razão.
// R1.5: o reprocesso de uma competência já fechada devolve a MESMA versão; novas
//   versões só surgem em correção retroativa (R1.6), nunca por reprocesso.
// R2.2: separa parcela passível, parcela admitida (apropriada) e parcela vedada
//   (não apropriável) — base de controle × coeficiente do cenário.
// R2.3/R2.4: `coeficiente` é persistido com a fundamentação do cenário (não um
//   1.0000 silencioso); `coeficienteFonte` registra a regra aplicada.
export const ciapApropriacoes = pgTable(
  'ciap_apropriacoes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    bemId: uuid('bem_id')
      .notNull()
      .references(() => ciapAtivoPermanente.id, { onDelete: 'cascade' }),

    // Competência da apropriação (primeiro dia do mês).
    competencia: date('competencia').notNull(),

    // R1.5/R1.6 — versionamento temporal. A versão 1 é a apropriação original;
    // correções retroativas incrementam a versão. Apenas uma versão por
    // (cliente, bem, competência) fica `ativa = true`.
    versao: integer('versao').notNull().default(1),
    ativa: boolean('ativa').notNull().default(true),

    // R1.4 — número da parcela derivado do calendário (1..quantidadeParcelas).
    numeroParcela: integer('numero_parcela').notNull(),

    // Base de controle do crédito na competência (ICMS passível acumulado).
    baseControle: numeric('base_controle', {
      precision: 15,
      scale: 2,
    }).notNull(),

    // R2.2 — parcela passível (base ÷ quantidade de parcelas), antes do rateio.
    parcelaPassivel: numeric('parcela_passivel', {
      precision: 15,
      scale: 2,
    }).notNull(),

    // R2.3/R2.4 — coeficiente do cenário (índice de participação), 4 casas.
    coeficiente: numeric('coeficiente', {
      precision: 9,
      scale: 4,
    }).notNull(),
    // Fundamentação do coeficiente (regra aplicada: tributada, exportação,
    // sem-saidas, etc.). Nunca presume 1.0000 silencioso (R2.4).
    coeficienteFonte: varchar('coeficiente_fonte', { length: 40 }).notNull(),

    // R2.2 — parcela admitida (passível × coeficiente) e parcela vedada
    // (passível − admitida). A soma reconstitui a parcela passível.
    parcelaAdmitida: numeric('parcela_admitida', {
      precision: 15,
      scale: 2,
    }).notNull(),
    parcelaVedada: numeric('parcela_vedada', {
      precision: 15,
      scale: 2,
    }).notNull(),

    // Movimento patrimonial que originou a apropriação, quando houver (razão).
    movimentoId: uuid('movimento_id').references(() => ciapMovimentos.id, {
      onDelete: 'set null',
    }),

    criadoEm: timestamp('criado_em', { withTimezone: true })
      .notNull()
      .defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_ciap_aprop_cliente').on(table.clienteId),
    index('idx_ciap_aprop_bem').on(table.bemId),
    index('idx_ciap_aprop_cliente_competencia').on(
      table.clienteId,
      table.competencia,
    ),
    // R1.1/R1.2/R1.5 — identidade da razão: uma linha por bem/competência/versão.
    uniqueIndex('uidx_ciap_aprop_bem_competencia_versao').on(
      table.bemId,
      table.competencia,
      table.versao,
    ),
    // R1.1/R1.2 — no máximo UMA versão ativa por bem/competência. O unique
    // parcial impede que retries/concorrência gerem dupla parcela ativa.
    uniqueIndex('uidx_ciap_aprop_bem_competencia_ativa')
      .on(table.bemId, table.competencia)
      .where(sql`${table.ativa}`),
    check('chk_ciap_aprop_versao', sql`${table.versao} >= 1`),
    check('chk_ciap_aprop_numero_parcela', sql`${table.numeroParcela} >= 1`),
    // R2.3/R2.4 — coeficiente dentro de [0, 1].
    check(
      'chk_ciap_aprop_coeficiente',
      sql`${table.coeficiente} >= 0 AND ${table.coeficiente} <= 1`,
    ),
    // R2.2 — admitida + vedada reconstituem a parcela passível.
    check(
      'chk_ciap_aprop_decomposicao',
      sql`${table.parcelaAdmitida} + ${table.parcelaVedada} = ${table.parcelaPassivel}`,
    ),
  ],
);

// Guias e obrigações fiscais apuradas (DAE/GNRE/DARF/DAS)
export const fiscalApuracoesGuias = pgTable(
  'fiscal_apuracoes_guias',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    competencia: date('competencia').notNull(),
    tributo: varchar('tributo', { length: 20 }).notNull(),
    ufFavorecida: varchar('uf_favorecida', { length: 2 }).notNull(),
    tipoGuia: varchar('tipo_guia', { length: 10 }).notNull(),
    codigoReceita: text('codigo_receita').notNull(),
    dataVencimento: date('data_vencimento').notNull(),
    valorPrincipal: numeric('valor_principal', {
      precision: 15,
      scale: 2,
    }).notNull(),
    valorMulta: numeric('valor_multa', { precision: 15, scale: 2 }).default(
      '0',
    ),
    valorJuros: numeric('valor_juros', { precision: 15, scale: 2 }).default(
      '0',
    ),
    valorTotal: numeric('valor_total', { precision: 15, scale: 2 }).notNull(),
    codigoBarras: text('codigo_barras'),
    linhaDigitavel: text('linha_digitavel'),
    statusPagamento: varchar('status_pagamento', { length: 20 })
      .notNull()
      .default('PENDENTE'),
    arquivoGuiaKey: text('arquivo_guia_key'),

    // R1.1 (Fase 5, tarefa 1.2): separa os quatro conceitos — obrigação
    // calculada, guia emitida, pagamento e conciliação. Esta linha é a GUIA
    // EMITIDA; o PAGAMENTO vive em `fiscal_pagamentos_eventos` (nunca mais um
    // mero `status_pagamento`), e a CONCILIAÇÃO se amarra à OBRIGAÇÃO CALCULADA
    // pelo vínculo com a versão de apuração abaixo.
    //
    // `origem` identifica DE ONDE a guia veio: calculada a partir de um
    // fechamento (APURACAO) ou lançada manualmente pelo responsável (MANUAL).
    // Default 'MANUAL' preserva as linhas já existentes (migração aditiva).
    origem: varchar('origem', { length: 20 }).notNull().default('MANUAL'),

    // R1.7 (Fase 5, tarefa 1.2): VÍNCULO com a versão de apuração (fechamento
    // da Fase 3). Uma guia criada a partir da obrigação calculada aponta o
    // fechamento que a originou — base da conciliação guia ↔ apuração. Nullable
    // para manter a migração aditiva e não invalidar guias manuais legadas; o
    // serviço EXIGE o vínculo quando `origem = 'APURACAO'`. `set null` em delete
    // preserva a guia e seu histórico mesmo se o fechamento for removido.
    fechamentoId: uuid('fechamento_id').references(() => fiscalFechamentos.id, {
      onDelete: 'set null',
    }),

    // R1.2 (Fase 5, tarefa 1.3): sinalização de guia DIVERGENTE da obrigação
    // apurada. Quando a guia nasce da apuração (`origem = 'APURACAO'`), seu total
    // é comparado ao total da obrigação projetado do fechamento vinculado
    // (`projetarSaldoDevedorApurado` — o MESMO valor da conciliação, sem segundo
    // motor). `divergente_obrigacao = true` marca que |guia − obrigação| excede a
    // tolerância de centavos. SINAL informativo: não bloqueia a emissão (uma guia
    // pode divergir legitimamente), apenas destaca para conciliação/cockpit.
    // Default `false` preserva as linhas existentes (migração aditiva); guia
    // MANUAL (sem obrigação apurada por trás) permanece `false`.
    divergenteObrigacao: boolean('divergente_obrigacao')
      .notNull()
      .default(false),

    // Total da OBRIGAÇÃO APURADA (saldo devedor documental) da versão de apuração
    // vinculada, congelado no momento da emissão da guia — o valor contra o qual
    // a guia foi comparada. Nullable: só é preenchido para guia `APURACAO` (guia
    // MANUAL não tem obrigação apurada). Preservar o valor comparado torna a
    // sinalização auditável mesmo que o fechamento mude depois (R1.2).
    valorObrigacao: numeric('valor_obrigacao', { precision: 15, scale: 2 }),

    // R1.4 (Fase 5, tarefa 1.4): CANCELAMENTO LÓGICO em vez de delete físico. A
    // guia NUNCA é removida da tabela — "remover" uma guia é marcá-la como
    // cancelada, preservando a linha e toda a trilha de pagamentos/estornos
    // (`fiscal_pagamentos_eventos`) vinculada a ela. Default `false` preserva as
    // linhas existentes (migração aditiva). `canceladaEm` registra QUANDO e
    // `motivoCancelamento` (opcional) PORQUÊ — rastro mínimo do cancelamento.
    cancelada: boolean('cancelada').notNull().default(false),
    canceladaEm: timestamp('cancelada_em'),
    motivoCancelamento: text('motivo_cancelamento'),

    // R1.5 (Fase 5, tarefa 1.5): REGISTRAR uma guia ≠ EMITIDA no órgão
    // arrecadador. Esta linha representa a guia REGISTRADA no sistema; só
    // quando ela foi de fato emitida/transmitida no órgão (DAE/GNRE/DARF/DAS
    // geradas no portal correspondente) é que `emitida_orgao` passa a `true`,
    // com `emitida_orgao_em` registrando QUANDO. Default `false` preserva as
    // linhas existentes (migração aditiva) e deixa explícito que uma guia
    // recém-registrada NÃO está emitida no órgão. O flag é informativo e
    // separado de `status_pagamento`: registrar, emitir no órgão e pagar são
    // fatos distintos (R1.1/R1.5).
    emitidaOrgao: boolean('emitida_orgao').notNull().default(false),
    emitidaOrgaoEm: timestamp('emitida_orgao_em'),

    // R1.6 (Fase 5, tarefa 1.6): CHAVE DE IDEMPOTÊNCIA fornecida pelo chamador
    // (por requisição) para deduplicar guias criadas por RETRY. Um retry que
    // carrega a MESMA chave NÃO cria uma guia duplicada — o serviço retorna a já
    // criada. A chave é a FRONTEIRA de deduplicação, NUNCA uma unicidade por
    // tributo/período/UF: duas obrigações LEGÍTIMAS do mesmo tributo/período/UF
    // continuam permitidas (chaves distintas, ou sem chave). Nullable para manter
    // a migração aditiva e não bloquear guias legadas/sem chave; a unicidade é um
    // índice PARCIAL escopado por cliente (abaixo), que só vale quando há chave.
    idempotencyKey: text('idempotency_key'),

    criadoEm: timestamp('criado_em').notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
  },
  (table) => [
    index('idx_fiscal_guias_cliente_competencia').on(
      table.clienteId,
      table.competencia,
    ),
    index('idx_fiscal_guias_status').on(table.statusPagamento),
    // Conciliação guia ↔ versão de apuração: projeção por fechamento (R1.7).
    index('idx_fiscal_guias_fechamento').on(table.fechamentoId),
    check(
      'chk_fiscal_guias_tributo',
      sql`${table.tributo} IN ('ICMS_PROPRIO', 'ICMS_ST', 'DIFAL_ENTRADA', 'DIFAL_SAIDA', 'FCP', 'IPI', 'PIS', 'COFINS', 'DAS_SIMPLES')`,
    ),
    check(
      'chk_fiscal_guias_tipo',
      sql`${table.tipoGuia} IN ('DAE', 'GNRE', 'DARF', 'DAS')`,
    ),
    check(
      'chk_fiscal_guias_status',
      sql`${table.statusPagamento} IN ('PENDENTE', 'PAGO', 'VENCIDO')`,
    ),
    check('chk_fiscal_guias_uf', sql`${table.ufFavorecida} ~ '^[A-Z]{2}$'`),
    // Origem da guia: calculada de um fechamento ou lançada manualmente (R1.1).
    check(
      'chk_fiscal_guias_origem',
      sql`${table.origem} IN ('APURACAO', 'MANUAL')`,
    ),
    // R1.7: guia de origem APURACAO DEVE ter vínculo com a versão de apuração;
    // guia MANUAL não exige fechamento. O serviço reforça isto antes do insert,
    // e o banco é a última linha de defesa contra guia calculada sem vínculo.
    check(
      'chk_fiscal_guias_apuracao_vinculo',
      sql`${table.origem} <> 'APURACAO' OR ${table.fechamentoId} IS NOT NULL`,
    ),
    // R1.2 (tarefa 1.3): só guia de origem APURAÇÃO pode divergir — uma guia
    // MANUAL não tem obrigação apurada por trás, logo não há do que divergir
    // nem valor de obrigação a comparar. O banco é a última linha de defesa
    // contra marcar divergência/obrigação em guia que não nasceu de apuração.
    check(
      'chk_fiscal_guias_divergencia_apuracao',
      sql`${table.origem} = 'APURACAO' OR (${table.divergenteObrigacao} = false AND ${table.valorObrigacao} IS NULL)`,
    ),
    // R1.4 (tarefa 1.4): uma guia cancelada DEVE ter a data do cancelamento —
    // coerência mínima do cancelamento lógico. Guia não cancelada não exige
    // data. Última linha de defesa no banco contra marcar cancelada sem rastro.
    check(
      'chk_fiscal_guias_cancelamento',
      sql`${table.cancelada} = false OR ${table.canceladaEm} IS NOT NULL`,
    ),
    // R1.5 (tarefa 1.5): coerência mínima da emissão no órgão — guia emitida no
    // órgão DEVE ter a data da emissão. Guia apenas registrada (não emitida)
    // não exige data. Última linha de defesa no banco contra marcar
    // "emitida no órgão" sem rastro de quando.
    check(
      'chk_fiscal_guias_emissao_orgao',
      sql`${table.emitidaOrgao} = false OR ${table.emitidaOrgaoEm} IS NOT NULL`,
    ),
    // R1.6 (tarefa 1.6): deduplicação por CHAVE DE IDEMPOTÊNCIA escopada por
    // cliente, como índice PARCIAL (só vale quando há chave). Dois efeitos:
    // (1) um RETRY com a MESMA chave não cria guia duplicada — o banco é a última
    //     linha de defesa contra concorrência/corrida que escape ao lookup do
    //     serviço (duas requisições simultâneas com a mesma chave colidem aqui);
    // (2) a unicidade é SÓ pela chave — NUNCA por tributo/período/UF —, de modo
    //     que múltiplas obrigações legítimas do mesmo tributo/período/UF (chaves
    //     distintas, ou sem chave) permanecem permitidas.
    // `WHERE idempotency_key IS NOT NULL` mantém a migração aditiva: linhas
    // legadas/sem chave não participam do índice e não são bloqueadas.
    uniqueIndex('uidx_fiscal_guias_cliente_idempotency')
      .on(table.clienteId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
  ],
);

// Uma confirmação por item: retries não aumentam artificialmente a confiança.
export const classificacaoDestinacaoAprendizado = pgTable(
  'classificacao_destinacao_aprendizado',
  {
    itemId: uuid('item_id')
      .primaryKey()
      .references(() => documentosFiscaisItens.id, { onDelete: 'cascade' }),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    fornecedor: text('fornecedor').notNull(),
    codigoProduto: text('codigo_produto').notNull(),
    ncm: varchar('ncm', { length: 8 }).notNull(),
    destinacao: varchar('destinacao', { length: 20 }).notNull(),
    ultimaConfirmacaoEm: timestamp('ultima_confirmacao_em', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_aprendizado_contexto').on(
      table.clienteId,
      table.fornecedor,
      table.codigoProduto,
      table.ncm,
    ),
    check(
      'chk_aprendizado_destinacao',
      sql`${table.destinacao} IN ('REVENDA', 'INDUSTRIALIZACAO', 'USO_CONSUMO', 'ATIVO_IMOBILIZADO')`,
    ),
    check('chk_aprendizado_ncm', sql`${table.ncm} ~ '^[0-9]{8}$'`),
  ],
);

// Decisão de crédito por item — embrião de `fiscal_decisoes_item` (F05 / R3.2,
// R3.4). Persiste, POR ITEM, a decisão produzida pela função pura
// `decidirCreditoIcms` (fiscal/services/decisao-credito.ts): o crédito
// efetivamente admitido, a decisão, o motivo e a versão da regra aplicada.
//
// ADITIVA E NÃO-DESTRUTIVA: o valor original destacado no XML permanece
// intocado em `documentos_fiscais_itens.valor_icms`. `valor_credito_admitido`
// é armazenado SEPARADAMENTE aqui e NUNCA sobrescreve o original (R3.2).
//
// Versionamento (R3.4): a chave é (item_id + regra_versao_id), de modo que uma
// nova versão de decisão gera uma nova linha em vez de sobrescrever a anterior.
// `regra_versao_id` usa a sentinela `'SEM_REGRA'` quando não há regra
// versionada aplicável (evita NULL na PK composta, permitindo unicidade).
export const fiscalDecisoesItem = pgTable(
  'fiscal_decisoes_item',
  {
    itemId: uuid('item_id')
      .notNull()
      .references(() => documentosFiscaisItens.id, { onDelete: 'cascade' }),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    // Versão da regra aplicada; sentinela quando não há regra versionada.
    // Compõe a PK para que novas versões coexistam (R3.4) sem sobrescrever.
    regraVersaoId: text('regra_versao_id').notNull().default('SEM_REGRA'),
    // Crédito de ICMS efetivamente admitido pela decisão. Mantido SEPARADO do
    // `valor_icms` original do XML (R3.2). 0 para VEDADO/EXIGE_REVISAO.
    valorCreditoAdmitido: numeric('valor_credito_admitido', {
      precision: 15,
      scale: 2,
    })
      .notNull()
      .default('0'),
    decisao: varchar('decisao', { length: 20 }).notNull(),
    motivo: varchar('motivo', { length: 40 }).notNull(),
    criadoEm: timestamp('criado_em', { withTimezone: true })
      .notNull()
      .defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'fiscal_decisoes_item_pk',
      columns: [table.itemId, table.regraVersaoId],
    }),
    index('idx_fiscal_decisoes_item_cliente').on(table.clienteId),
    check(
      'chk_fiscal_decisao',
      sql`${table.decisao} IN ('ADMITIDO', 'VEDADO', 'EXIGE_REVISAO')`,
    ),
    check(
      'chk_fiscal_decisao_motivo',
      sql`${table.motivo} IN ('SEM_VALOR_DESTACADO', 'CST_AUTORIZA_CREDITO', 'CSOSN_PERMITE_CREDITO', 'CFOP_VEDA_CREDITO', 'REGRA_VEDA_CREDITO', 'CST_NAO_AUTORIZADO')`,
    ),
    check(
      'chk_fiscal_decisao_credito_nao_negativo',
      sql`${table.valorCreditoAdmitido} >= 0`,
    ),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// Catálogo de códigos fiscais versionados por vigência (Fase 2 / tarefa 3.4,
// R2.6; compartilhado com a Fase 4 — design §Modelo de dados).
// ─────────────────────────────────────────────────────────────────────────────
//
// R2.6: "O ajuste de crédito DEVE usar código estadual oficial validado (código
// e vigência), não um valor fabricado só para passar no check." Esta tabela é a
// FONTE ÚNICA dos códigos oficiais de ajuste (hoje o E111 de crédito do CIAP;
// `tipo = 'E111_CIAP'`), substituindo o `${uf}02CIAP` fabricado em código. Cada
// linha vincula um `codigo` a uma `uf` e a uma JANELA DE VIGÊNCIA
// (`vigenciaInicio`..`vigenciaFim`), de modo que o ajuste de uma competência só
// é emitido com um código catalogado E vigente naquela competência. Sem linha
// válida (UF + vigência), a geração do ajuste é BLOQUEADA com inconsistência —
// nunca emite código inválido (postura bloqueante da fase).
//
// Segue o mesmo padrão de vigência de `sped_responsabilidades_tributarias`
// (codigo/uf/vigencia_inicio/vigencia_fim/ativo), aqui com `fonte` (origem
// normativa do código) e `descricao`. É um CATÁLOGO GLOBAL (não por cliente):
// o código estadual de ajuste é definido pela UF/legislação, não pela empresa.
//
// PRÉ-CONDIÇÃO FISCAL (bloqueante): os códigos REAIS por UF ainda dependem de
// confirmação do responsável fiscal (requirements, "Pré-condições fiscais"). O
// seed inicial (0015) carrega um default DOCUMENTADO e marcado como
// `fonte = 'default_pendente_confirmacao'` para que o mecanismo de lookup/
// validação funcione, deixando explícito que o código real ainda não foi
// homologado — a `fonte` permite distinguir e substituir sem alterar o schema.
//
// O `codigo` respeita o leiaute do E111 (`^[A-Z]{2}0[0-5][A-Z0-9]{4}$`) com
// natureza `2` (crédito, 4º caractere), coerente com `chk_sped_ajuste_coerencia`
// e `chk_sped_ajuste_natureza_indicador` de `sped_ajustes_apuracao`.
export const fiscalCatalogosVersoes = pgTable(
  'fiscal_catalogos_versoes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Tipo do catálogo. Hoje apenas o ajuste E111 de crédito do CIAP; a coluna
    // antecipa outros códigos estaduais (Fase 4) sem nova tabela.
    tipo: varchar('tipo', { length: 20 }).notNull(),
    uf: varchar('uf', { length: 2 }).notNull(),
    codigo: text('codigo').notNull(),
    descricao: text('descricao'),
    // Origem normativa do código (ato/legislação). O valor
    // `default_pendente_confirmacao` sinaliza um default ainda NÃO homologado
    // pelo responsável fiscal (pré-condição bloqueante da fase).
    fonte: varchar('fonte', { length: 60 }).notNull(),
    vigenciaInicio: date('vigencia_inicio').notNull(),
    vigenciaFim: date('vigencia_fim'),
    ativo: boolean('ativo').notNull().default(true),
    // ───────────────── Fase 4 (R1.1/R2.1/R3.1) — ADITIVO ─────────────────
    // A coluna `tipo` já antecipava "outros códigos estaduais (Fase 4) sem nova
    // tabela"; a Fase 4 amplia o domínio para DIFAL/ST_FCP/PIS_COFINS e
    // acrescenta os atributos que o design §6.2/§7 exige para um catálogo que
    // seja FONTE DE VERDADE versionada (fonte, hash, escopo aprovado, carga),
    // e consultável por COMPETÊNCIA — nunca "o último catálogo" para histórico.
    //
    // URL/identificador externo da fonte normativa (ato, convênio, legislação
    // estadual). Complementa `fonte` com um ponteiro verificável.
    fonteUrl: text('fonte_url'),
    // Hash do conteúdo carregado (R3.1 "fonte, hash, vigência, UF"): garante que
    // a versão do catálogo é imutável e auditável — mesma carga → mesmo hash.
    // SHA-256 em hex, mesmo formato de `fiscal_fechamentos.hash_entradas`.
    hashConteudo: varchar('hash_conteudo', { length: 64 }),
    // Payload estruturado da versão do catálogo (ex.: tabela de enquadramento
    // produto/CEST/UF para ST/FCP, ou parâmetros de DIFAL/PIS-COFINS). Decimais
    // sempre como string — nunca `Number` (restrição da fase).
    conteudo: jsonb('conteudo')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    // Escopo aprovado (design §6.2): só uma versão com `escopo_aprovado = true`
    // alimenta decisão fiscal definitiva. Enquanto não aprovada, o consumo
    // produz pendência/simulação, não guia (R1.2).
    escopoAprovado: boolean('escopo_aprovado').notNull().default(false),
    aprovadoPor: text('aprovado_por').references(() => user.id, {
      onDelete: 'set null',
    }),
    // Data de carga da versão (design §7: "não usar último catálogo para
    // competência histórica"): o lookup é por competência via vigência, e a
    // carga apenas registra QUANDO a versão entrou no sistema.
    dataCarga: timestamp('data_carga', { withTimezone: true })
      .notNull()
      .defaultNow(),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
  },
  (table) => [
    // Uma única vigência por (tipo, uf, inicio): novas vigências geram novas
    // linhas (não sobrescrevem a anterior), preservando o histórico de códigos.
    uniqueIndex('uidx_fiscal_catalogo_vigencia').on(
      table.tipo,
      table.uf,
      table.vigenciaInicio,
    ),
    index('idx_fiscal_catalogo_tipo_uf').on(table.tipo, table.uf),
    check('chk_fiscal_catalogo_uf', sql`${table.uf} ~ '^[A-Z]{2}$'`),
    check(
      'chk_fiscal_catalogo_tipo',
      sql`${table.tipo} IN ('E111_CIAP', 'DIFAL', 'ST_FCP', 'PIS_COFINS')`,
    ),
    // Vigência fechada só quando o fim é posterior ou igual ao início.
    check(
      'chk_fiscal_catalogo_vigencia',
      sql`${table.vigenciaFim} IS NULL OR ${table.vigenciaFim} >= ${table.vigenciaInicio}`,
    ),
    // O código de E111_CIAP respeita o leiaute do E111 (crédito, natureza 2),
    // coerente com `chk_sped_ajuste_coerencia` de `sped_ajustes_apuracao`.
    check(
      'chk_fiscal_catalogo_codigo_e111_ciap',
      sql`${table.tipo} <> 'E111_CIAP' OR ${table.codigo} ~ '^[A-Z]{2}02[A-Z0-9]{4}$'`,
    ),
    // Hash do conteúdo (quando presente) em SHA-256 hex, igual aos arquivos
    // SPED e a `fiscal_fechamentos.hash_entradas`.
    check(
      'chk_fiscal_catalogo_hash',
      sql`${table.hashConteudo} IS NULL OR ${table.hashConteudo} ~ '^[0-9a-f]{64}$'`,
    ),
    // Aprovação coerente: há aprovador se, e somente se, o escopo foi aprovado.
    check(
      'chk_fiscal_catalogo_aprovacao',
      sql`${table.escopoAprovado} = (${table.aprovadoPor} IS NOT NULL)`,
    ),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// Lançamentos fiscais normalizados (Fase 3 / tarefa 1.1, R2.1/R2.2; plano §7).
// ─────────────────────────────────────────────────────────────────────────────
//
// FONTE COMUM de créditos e débitos: livros, painéis e SPED passam a projetar
// desta tabela, em vez de cada um recalcular por caminho próprio (F03/F16). Como
// todos consomem o MESMO lançamento, para a MESMA versão de fechamento os
// créditos/débitos documentais são idênticos entre livro e SPED (R2.1), e a
// ponte documentos → lançamentos → apuração → livro → E110 (R2.2) fica explícita.
//
// VALORES DECIMAIS (restrição da fase): `numeric` — nunca `Number`. O navegador
// apenas FORMATA o decimal, não recalcula imposto (F15/§9.2). `valor` é a
// magnitude; o SINAL do efeito no saldo vem de `sinal` (+1 normal, -1 estorno/
// reversão), separado da NATUREZA contábil (`DEBITO`/`CREDITO`). Natureza e
// sinal são EXPLÍCITOS para não inferir o efeito a partir do valor.
//
// ORIGEM: de onde o fato veio (`DOCUMENTO`, `CIAP`, `AJUSTE`, `SALDO_ANTERIOR`,
// `APURACAO`), para a ponte conseguir atribuir cada parcela da apuração à sua
// fonte. `documentoFiscalId`/`documentoFiscalItemId` são opcionais: só os
// lançamentos de origem documental os referenciam.
//
// COMPETÊNCIA: primeiro dia do mês de competência fiscal (não a data crua do
// XML; a política de datas por finalidade é a tarefa 2 da fase). Mantida AQUI,
// no lançamento, para que a seleção por competência não dependa de recalcular
// datas em cada módulo.
//
// CHAVE IDEMPOTENTE POR FATO/VERSÃO: `fatoChave` identifica o fato gerador de
// forma estável (ex.: `item:<uuid>:icms`, `ciap:<ficha>:<competencia>`), e
// `fechamentoVersao` isola a versão do fechamento. O unique
// (cliente, origem, fato, versão, tributo, natureza) garante que reprocessar a
// mesma versão NÃO duplica lançamentos (reexecução idempotente), enquanto uma
// NOVA versão (reabertura/edição, R1.4) gera novas linhas sem sobrescrever as da
// versão anterior — preservando a reprodutibilidade do fechamento (F20).
//
// ADITIVA: só cria estruturas novas; não altera nem remove nada existente.
export const fiscalLancamentos = pgTable(
  'fiscal_lancamentos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    // Versão do fechamento a que o lançamento pertence. Isola reprocessamentos
    // (idempotência) de novas versões (reabertura/edição) — ver chave única.
    fechamentoVersao: integer('fechamento_versao').notNull().default(1),
    // Origem do fato gerador: permite atribuir cada parcela da apuração à fonte.
    origem: varchar('origem', { length: 20 }).notNull(),
    // Identidade estável do fato gerador dentro da origem (compõe a chave
    // idempotente). Ex.: `item:<uuid>:icms`, `ciap:<ficha>:<competencia>`.
    fatoChave: text('fato_chave').notNull(),
    // Competência fiscal (primeiro dia do mês). Fixada no lançamento para a
    // seleção por competência não recalcular datas em cada módulo.
    competencia: date('competencia').notNull(),
    // Tributo do lançamento (ICMS, ICMS_ST, IPI, PIS, COFINS, FCP, DIFAL).
    tributo: varchar('tributo', { length: 12 }).notNull(),
    // Natureza contábil EXPLÍCITA — não inferida pelo valor.
    natureza: varchar('natureza', { length: 7 }).notNull(),
    // Sinal do efeito no saldo: +1 lançamento normal, -1 estorno/reversão.
    sinal: integer('sinal').notNull().default(1),
    // Magnitude decimal do lançamento. `numeric`, nunca `Number`.
    valor: numeric('valor', { precision: 15, scale: 2 }).notNull(),
    // Base de cálculo e alíquota decimais (opcionais: ajustes/saldos não têm).
    baseCalculo: numeric('base_calculo', { precision: 15, scale: 2 }),
    aliquota: numeric('aliquota', { precision: 9, scale: 4 }),
    // Lastro documental: só os lançamentos de origem documental referenciam.
    documentoFiscalId: uuid('documento_fiscal_id').references(
      () => documentosFiscais.id,
      { onDelete: 'cascade' },
    ),
    documentoFiscalItemId: uuid('documento_fiscal_item_id').references(
      () => documentosFiscaisItens.id,
      { onDelete: 'cascade' },
    ),
    criadoEm: timestamp('criado_em', { withTimezone: true })
      .notNull()
      .defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Chave idempotente por fato/versão (R2.1): reprocessar a mesma versão não
    // duplica; uma nova versão gera novas linhas sem sobrescrever as anteriores.
    uniqueIndex('uidx_fiscal_lancamento_fato_versao').on(
      table.clienteId,
      table.origem,
      table.fatoChave,
      table.fechamentoVersao,
      table.tributo,
      table.natureza,
    ),
    // Projeção por competência/versão (livros, painéis e SPED consomem daqui).
    index('idx_fiscal_lancamento_competencia').on(
      table.clienteId,
      table.competencia,
      table.fechamentoVersao,
    ),
    // Ponte documento → lançamento (R2.2).
    index('idx_fiscal_lancamento_documento').on(table.documentoFiscalId),
    check(
      'chk_fiscal_lancamento_origem',
      sql`${table.origem} IN ('DOCUMENTO', 'CIAP', 'AJUSTE', 'SALDO_ANTERIOR', 'APURACAO')`,
    ),
    check(
      'chk_fiscal_lancamento_tributo',
      sql`${table.tributo} IN ('ICMS', 'ICMS_ST', 'IPI', 'PIS', 'COFINS', 'FCP', 'DIFAL')`,
    ),
    check(
      'chk_fiscal_lancamento_natureza',
      sql`${table.natureza} IN ('DEBITO', 'CREDITO')`,
    ),
    check(
      'chk_fiscal_lancamento_sinal',
      sql`${table.sinal} IN (-1, 1)`,
    ),
    check('chk_fiscal_lancamento_versao', sql`${table.fechamentoVersao} >= 1`),
    // Magnitude não-negativa: o efeito no saldo vem de natureza + sinal, não de
    // um valor negativo (mantém a decomposição explícita e conciliável).
    check('chk_fiscal_lancamento_valor', sql`${table.valor} >= 0`),
    check(
      'chk_fiscal_lancamento_base',
      sql`${table.baseCalculo} IS NULL OR ${table.baseCalculo} >= 0`,
    ),
    check(
      'chk_fiscal_lancamento_aliquota',
      sql`${table.aliquota} IS NULL OR ${table.aliquota} >= 0`,
    ),
    // Competência é sempre o primeiro dia do mês (competência fiscal, não a
    // data crua do documento).
    check(
      'chk_fiscal_lancamento_competencia_dia1',
      sql`date_part('day', ${table.competencia}) = 1`,
    ),
    // Lastro documental coerente: o item só existe junto do documento, e o par
    // só aparece em lançamentos de origem documental.
    check(
      'chk_fiscal_lancamento_item_exige_documento',
      sql`${table.documentoFiscalItemId} IS NULL OR ${table.documentoFiscalId} IS NOT NULL`,
    ),
    check(
      'chk_fiscal_lancamento_documento_origem',
      sql`${table.documentoFiscalId} IS NULL OR ${table.origem} = 'DOCUMENTO'`,
    ),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// Fechamento fiscal versionado (Fase 3 / tarefa 3.1, R1.1; plano §7).
// ─────────────────────────────────────────────────────────────────────────────
//
// MEMÓRIA DE CÁLCULO IMUTÁVEL por estabelecimento/competência/obrigação. Livros,
// painéis e SPED deixam de ter motor próprio e passam a PROJETAR desta versão
// congelada (F20). Cada fechamento guarda o conjunto de documentos, decisões,
// regras, parâmetros e saldos vigentes no momento do fechamento, mais a versão
// do motor (`motorVersao`) e o hash das entradas (`hashEntradas`) — de modo que
// as mesmas entradas reproduzam o mesmo resultado/hash (R1.2).
//
// ESCOPO: `clienteId` (um estabelecimento por cliente, coerente com as tabelas
// SPED que escopam por `cliente_id` + obrigação) e `obrigacao` (o domínio de
// obrigação acessória: EFD ICMS/IPI, EFD Contribuições etc.). A competência é o
// primeiro dia do mês (competência fiscal, mesma convenção da tarefa 1.1).
//
// VERSIONAMENTO: `versao` (>= 1) cresce a cada reabertura/edição (R1.4); a
// entrega anterior permanece intacta (novas linhas, nunca sobrescrita). O unique
// (cliente, obrigação, competência, versão) garante que não há duas linhas para
// a mesma versão. Além disso, SOMENTE UMA versão pode ser a corrente aprovada
// por (cliente, obrigação, competência): um unique PARCIAL em `corrente = true`
// permite muitas versões históricas mas apenas uma corrente — enquanto estados
// não-finais (RASCUNHO/PENDENTE/REVISADO) convivem com a corrente FECHADA.
//
// ESTADOS: `RASCUNHO → PENDENTE → REVISADO → FECHADO` (contrato ResultadoApuracao
// do plano §6.3). `corrente` só pode ser verdadeiro quando o estado é `FECHADO`
// (a corrente é a versão aprovada/entregue).
//
// SNAPSHOTS CONGELADOS: `documentos`, `decisoes`, `regras`, `parametros` e
// `saldos` são `jsonb` imutáveis — a fotografia das entradas no fechamento, para
// a conciliação não depender de recomputar o estado atual (que pode ter mudado).
// Valores monetários dentro dos snapshots são SEMPRE strings decimais (nunca
// `Number`); `hashEntradas` sela o conjunto para reprodutibilidade.
//
// ADITIVA: só cria estruturas novas; não altera nem remove nada existente.
export const fiscalFechamentos = pgTable(
  'fiscal_fechamentos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    // Obrigação acessória a que o fechamento se refere (escopo junto do
    // estabelecimento/competência). Domínio restrito por CHECK.
    obrigacao: varchar('obrigacao', { length: 20 }).notNull(),
    // Competência fiscal (primeiro dia do mês), mesma convenção da tarefa 1.1.
    competencia: date('competencia').notNull(),
    // Versão do fechamento (>= 1). Cresce a cada reabertura/edição; versões
    // anteriores permanecem intactas (reprodutibilidade — F20).
    versao: integer('versao').notNull().default(1),
    // Estado no ciclo RASCUNHO → PENDENTE → REVISADO → FECHADO.
    estado: varchar('estado', { length: 10 }).notNull().default('RASCUNHO'),
    // Versão corrente aprovada: no máximo uma por (cliente, obrigação,
    // competência) — garantido pelo índice único parcial abaixo. Só pode ser
    // verdadeira quando o estado é FECHADO.
    corrente: boolean('corrente').notNull().default(false),
    // Versão do motor de apuração que produziu o resultado (reprodutibilidade).
    motorVersao: varchar('motor_versao', { length: 40 }).notNull(),
    // Hash SHA-256 das entradas congeladas: mesmas entradas → mesmo hash (R1.2),
    // mesmo formato dos arquivos SPED (`sped_arquivos_gerados.hash_sha256`).
    hashEntradas: varchar('hash_entradas', { length: 64 }).notNull(),
    // Snapshots congelados do fechamento (fotografia das entradas). Valores
    // monetários sempre como strings decimais — nunca `Number`.
    documentos: jsonb('documentos')
      .$type<Array<Record<string, unknown>>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    decisoes: jsonb('decisoes')
      .$type<Array<Record<string, unknown>>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    regras: jsonb('regras')
      .$type<Array<Record<string, unknown>>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    parametros: jsonb('parametros')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    saldos: jsonb('saldos')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    aprovadoPor: text('aprovado_por').references(() => user.id, {
      onDelete: 'set null',
    }),
    fechadoEm: timestamp('fechado_em', { withTimezone: true }),
    criadoEm: timestamp('criado_em', { withTimezone: true })
      .notNull()
      .defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Unicidade de versão por estabelecimento/competência/obrigação (R1.1):
    // não há duas linhas para a mesma versão do mesmo escopo.
    uniqueIndex('uidx_fiscal_fechamento_versao').on(
      table.clienteId,
      table.obrigacao,
      table.competencia,
      table.versao,
    ),
    // SOMENTE UMA versão corrente aprovada por escopo: índice único PARCIAL em
    // `corrente = true`. Permite muitas versões históricas, mas apenas uma
    // corrente simultânea (uma corrente aprovada — R1.1).
    uniqueIndex('uidx_fiscal_fechamento_corrente')
      .on(table.clienteId, table.obrigacao, table.competencia)
      .where(sql`${table.corrente} = true`),
    // Consulta/projeção por escopo e competência (livros, painéis e SPED).
    index('idx_fiscal_fechamento_competencia').on(
      table.clienteId,
      table.competencia,
      table.obrigacao,
    ),
    check(
      'chk_fiscal_fechamento_obrigacao',
      sql`${table.obrigacao} IN ('EFD_ICMS_IPI', 'EFD_CONTRIBUICOES', 'GIA', 'DAS', 'DAPI')`,
    ),
    check(
      'chk_fiscal_fechamento_estado',
      sql`${table.estado} IN ('RASCUNHO', 'PENDENTE', 'REVISADO', 'FECHADO')`,
    ),
    check('chk_fiscal_fechamento_versao', sql`${table.versao} >= 1`),
    // A corrente é a versão aprovada/entregue: só pode ser verdadeira quando o
    // fechamento está FECHADO.
    check(
      'chk_fiscal_fechamento_corrente_fechado',
      sql`${table.corrente} = false OR ${table.estado} = 'FECHADO'`,
    ),
    // Hash SHA-256 das entradas no mesmo formato dos arquivos SPED.
    check(
      'chk_fiscal_fechamento_hash',
      sql`${table.hashEntradas} ~ '^[0-9a-f]{64}$'`,
    ),
    // Competência é sempre o primeiro dia do mês (competência fiscal).
    check(
      'chk_fiscal_fechamento_competencia_dia1',
      sql`date_part('day', ${table.competencia}) = 1`,
    ),
    // Fechamento FECHADO precisa registrar quando foi fechado; estados não-finais
    // não têm `fechado_em`.
    check(
      'chk_fiscal_fechamento_fechado_em',
      sql`(${table.estado} = 'FECHADO') = (${table.fechadoEm} IS NOT NULL)`,
    ),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// Catálogo normativo versionado — perfis de vigência e regras versionadas
// (Fase 4 / tarefa 1.1, R1.1/R2.1/R3.1; plano §6.2/§7).
// ─────────────────────────────────────────────────────────────────────────────
//
// Base comum da Fase 4: parametriza tributos que dependem de JURISDIÇÃO, REGIME
// e VIGÊNCIA (DIFAL, ST/FCP, PIS-COFINS). Nenhuma tabela estática é fonte de
// verdade — a seleção é SEMPRE por competência via vigência, não "o último".
// Sem regra homologada vigente, o consumo produz pendência/simulação/bloqueio,
// nunca guia definitiva (R1.2/R3.4).
//
// Todas ADITIVAS: só criam estruturas novas; não alteram nem removem nada.

// `fiscal_perfis_vigencia` (design §7): o perfil fiscal de um estabelecimento
// (cliente) por UF/regime/obrigação, com janela de vigência e fonte. É o que
// liga a empresa à matriz legal aplicável numa competência — ex.: "cliente X,
// UF SP, Simples, EFD_ICMS_IPI, vigente a partir de 2026-01-01". Impede
// sobreposição indevida de perfis do mesmo escopo (índice GiST de exclusão
// sobre o intervalo de vigência).
export const fiscalPerfisVigencia = pgTable(
  'fiscal_perfis_vigencia',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    // UF do perfil (jurisdição). Catálogo e regras são resolvidos por esta UF.
    uf: varchar('uf', { length: 2 }).notNull(),
    // Regime tributário vigente no período (coerente com `clientes`).
    regime: varchar('regime', { length: 20 }).notNull(),
    // Obrigação acessória a que o perfil se aplica (mesmo domínio de
    // `fiscal_fechamentos.obrigacao`).
    obrigacao: varchar('obrigacao', { length: 20 }).notNull(),
    // Janela de vigência do perfil (fim aberto = ainda vigente).
    vigenciaInicio: date('vigencia_inicio').notNull(),
    vigenciaFim: date('vigencia_fim'),
    // Origem da definição do perfil (matriz legal/inventário fiscal — a
    // pré-condição bloqueante da fase). Deixa EXPLÍCITO de onde veio.
    fonte: varchar('fonte', { length: 60 }).notNull(),
    ativo: boolean('ativo').notNull().default(true),
    criadoEm: timestamp('criado_em', { withTimezone: true })
      .notNull()
      .defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Um perfil por (cliente, uf, obrigacao, inicio): novas vigências geram
    // novas linhas, preservando o histórico (não sobrescrevem a anterior).
    uniqueIndex('uidx_fiscal_perfil_vigencia').on(
      table.clienteId,
      table.uf,
      table.obrigacao,
      table.vigenciaInicio,
    ),
    // Lookup por competência: perfis de um escopo ordenados por vigência.
    index('idx_fiscal_perfil_lookup').on(
      table.clienteId,
      table.uf,
      table.obrigacao,
      table.vigenciaInicio,
    ),
    check('chk_fiscal_perfil_uf', sql`${table.uf} ~ '^[A-Z]{2}$'`),
    check(
      'chk_fiscal_perfil_regime',
      sql`${table.regime} IN ('SIMPLES_NACIONAL', 'LUCRO_PRESUMIDO', 'LUCRO_REAL')`,
    ),
    check(
      'chk_fiscal_perfil_obrigacao',
      sql`${table.obrigacao} IN ('EFD_ICMS_IPI', 'EFD_CONTRIBUICOES', 'GIA', 'DAS', 'DAPI')`,
    ),
    // Vigência fechada só quando o fim é posterior ou igual ao início.
    check(
      'chk_fiscal_perfil_vigencia',
      sql`${table.vigenciaFim} IS NULL OR ${table.vigenciaFim} >= ${table.vigenciaInicio}`,
    ),
  ],
);

// `fiscal_regras_versoes` (design §7): REVISÕES IMUTÁVEIS de uma regra fiscal,
// ancoradas numa versão de catálogo. Cada linha é uma versão de regra com
// conteúdo, fonte, responsável e vigência — nunca editada no lugar: uma nova
// revisão cria uma nova linha (`revisao` crescente), preservando o histórico
// (reprodutibilidade — a competência histórica usa a regra vigente à época,
// não a mais recente). O conteúdo guarda os parâmetros aplicáveis (ex.:
// composição de base DIFAL, enquadramento ST/FCP, naturezas PIS-COFINS), com
// decimais sempre como string — nunca `Number` (restrição da fase).
export const fiscalRegrasVersoes = pgTable(
  'fiscal_regras_versoes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Versão de catálogo que ancora a regra (fonte/hash/vigência/UF).
    catalogoVersaoId: uuid('catalogo_versao_id')
      .notNull()
      .references(() => fiscalCatalogosVersoes.id, { onDelete: 'cascade' }),
    // Chave estável da regra dentro do catálogo (ex.: hipótese DIFAL, CEST/UF
    // de ST, natureza de receita de PIS/COFINS). Agrupa suas revisões.
    chave: text('chave').notNull(),
    // Revisão imutável e crescente (>= 1): nova revisão = nova linha.
    revisao: integer('revisao').notNull().default(1),
    // Conteúdo versionado da regra (parâmetros). Decimais como string.
    conteudo: jsonb('conteudo')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    // Origem normativa da revisão (ato/legislação/convênio).
    fonte: varchar('fonte', { length: 60 }).notNull(),
    fonteUrl: text('fonte_url'),
    // Responsável fiscal que registrou/homologou a revisão.
    responsavelPor: text('responsavel_por').references(() => user.id, {
      onDelete: 'set null',
    }),
    // Janela de vigência da revisão (fim aberto = ainda vigente).
    vigenciaInicio: date('vigencia_inicio').notNull(),
    vigenciaFim: date('vigencia_fim'),
    ativo: boolean('ativo').notNull().default(true),
    criadoEm: timestamp('criado_em', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Imutabilidade por revisão: uma linha por (catálogo, chave, revisão).
    uniqueIndex('uidx_fiscal_regra_revisao').on(
      table.catalogoVersaoId,
      table.chave,
      table.revisao,
    ),
    // Lookup por competência: revisões de uma regra ordenadas por vigência.
    index('idx_fiscal_regra_lookup').on(
      table.catalogoVersaoId,
      table.chave,
      table.vigenciaInicio,
    ),
    check('chk_fiscal_regra_revisao', sql`${table.revisao} >= 1`),
    // Vigência fechada só quando o fim é posterior ou igual ao início.
    check(
      'chk_fiscal_regra_vigencia',
      sql`${table.vigenciaFim} IS NULL OR ${table.vigenciaFim} >= ${table.vigenciaInicio}`,
    ),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// Eventos de pagamento/estorno de guias — trilha append-only (Fase 5 / tarefa
// 1.1, R1.1/R1.3; design "Guias conciliadas (F21)" §7).
// ─────────────────────────────────────────────────────────────────────────────
//
// SEPARA pagamento e conciliação da guia emitida (R1.1): a `fiscal_apuracoes_guias`
// descreve a OBRIGAÇÃO/guia; cada PAGAMENTO, PAGAMENTO PARCIAL ou ESTORNO é um
// EVENTO imutável aqui — nunca uma mudança de status que sobrescreve a anterior.
// O saldo da obrigação é o `valorTotal` da guia MENOS a soma dos efeitos destes
// eventos (pagamentos somam, estornos subtraem), de modo que a trilha completa é
// sempre reconstruível e o saldo preservado (R1.3).
//
// VÍNCULO: `guiaId` liga o evento à guia/obrigação; `fechamentoId` liga,
// opcionalmente, à VERSÃO de apuração que originou a obrigação (fechamento da
// Fase 3), para a conciliação amarrar pagamento ↔ apuração. Ambos cascateiam na
// remoção do escopo-pai, mas NUNCA são apagados em operação normal (cancelamento
// lógico, não delete físico — R1.4, coberto nas tarefas seguintes).
//
// EVIDÊNCIA: só a `comprovanteKey` do storage fica no banco — nunca URLs
// (restrição da fase/SKILL). URLs assinadas são geradas sob autorização.
//
// ESTORNO: um evento `ESTORNO` referencia, em `eventoEstornadoId`, o pagamento
// que reverte — mantendo o par original/reversão explícito sem sobrescrever o
// evento revertido. Pagamentos têm efeito +valor; estornos, -valor (via `sinal`).
//
// VALORES: `valor` é a MAGNITUDE decimal não-negativa (string, nunca `Number`);
// o efeito no saldo vem de `sinal` (+1 pagamento, -1 estorno), mantendo a
// decomposição explícita e conciliável (mesma convenção de `fiscal_lancamentos`).
//
// ADITIVA: só cria estrutura nova; não altera nem remove nada existente.
export const fiscalPagamentosEventos = pgTable(
  'fiscal_pagamentos_eventos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    // Guia/obrigação a que o evento se refere (vínculo guia/obrigação — R1.1).
    guiaId: uuid('guia_id')
      .notNull()
      .references(() => fiscalApuracoesGuias.id, { onDelete: 'cascade' }),
    // Versão de apuração que originou a obrigação (fechamento da Fase 3), quando
    // disponível. Amarra pagamento ↔ apuração para a conciliação (R1.1/R1.7).
    fechamentoId: uuid('fechamento_id').references(() => fiscalFechamentos.id, {
      onDelete: 'set null',
    }),
    // Tipo do evento na trilha: pagamento (total ou parcial) ou estorno.
    tipo: varchar('tipo', { length: 20 }).notNull(),
    // Origem do evento (de onde o lançamento do pagamento veio): registro
    // manual pelo responsável, importação de extrato/arquivo, ou conciliação.
    origem: varchar('origem', { length: 20 }).notNull(),
    // Magnitude decimal não-negativa do evento. `numeric`, nunca `Number`.
    valor: numeric('valor', { precision: 15, scale: 2 }).notNull(),
    // Efeito no saldo da obrigação: +1 pagamento, -1 estorno. O saldo = total da
    // guia menos a soma de (sinal * valor) dos eventos (R1.3).
    sinal: integer('sinal').notNull().default(1),
    // Data em que o pagamento/estorno de fato ocorreu (não a de registro).
    dataEvento: date('data_evento').notNull(),
    // Evidência: SOMENTE a key do storage (comprovante). Nunca URL (SKILL).
    comprovanteKey: text('comprovante_key'),
    // Marcação explícita de declaração manual sem comprovante anexado — "PAGO"
    // exige evidência OU esta indicação (R1.5, aplicada nas tarefas seguintes).
    declaracaoManual: boolean('declaracao_manual').notNull().default(false),
    // Documento externo/identificador do evento (ex.: autenticação bancária,
    // nº do comprovante) — torna a origem externa rastreável (R1.1).
    documentoExterno: text('documento_externo'),
    // Estorno: evento de pagamento que este evento reverte. Preenchido só em
    // eventos de tipo ESTORNO, mantendo o par original/reversão explícito.
    eventoEstornadoId: uuid('evento_estornado_id'),
    observacao: text('observacao'),
    criadoEm: timestamp('criado_em', { withTimezone: true })
      .notNull()
      .defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Auto-referência: estorno aponta o pagamento revertido (trilha preservada).
    foreignKey({
      columns: [table.eventoEstornadoId],
      foreignColumns: [table.id],
      name: 'fiscal_pagamentos_eventos_estornado_fk',
    }).onDelete('set null'),
    // Projeção da trilha por guia (ordem cronológica reconstrói o saldo — R1.3).
    index('idx_fiscal_pagamento_evento_guia').on(table.guiaId, table.dataEvento),
    // Conciliação por versão de apuração (pagamento ↔ apuração).
    index('idx_fiscal_pagamento_evento_fechamento').on(table.fechamentoId),
    index('idx_fiscal_pagamento_evento_cliente').on(
      table.clienteId,
      table.dataEvento,
    ),
    check(
      'chk_fiscal_pagamento_evento_tipo',
      sql`${table.tipo} IN ('PAGAMENTO', 'PAGAMENTO_PARCIAL', 'ESTORNO')`,
    ),
    check(
      'chk_fiscal_pagamento_evento_origem',
      sql`${table.origem} IN ('MANUAL', 'IMPORTACAO', 'CONCILIACAO')`,
    ),
    check('chk_fiscal_pagamento_evento_sinal', sql`${table.sinal} IN (-1, 1)`),
    // Magnitude não-negativa: o efeito no saldo vem de `sinal`, não do valor.
    check('chk_fiscal_pagamento_evento_valor', sql`${table.valor} > 0`),
    // Estorno é coerente: tipo ESTORNO ⇔ sinal -1 e referencia um evento; os
    // demais tipos somam (+1) e não referenciam estorno.
    check(
      'chk_fiscal_pagamento_evento_estorno',
      sql`(${table.tipo} = 'ESTORNO') = (${table.sinal} = -1)`,
    ),
    check(
      'chk_fiscal_pagamento_evento_estorno_ref',
      sql`${table.tipo} <> 'ESTORNO' OR ${table.eventoEstornadoId} IS NOT NULL`,
    ),
    check(
      'chk_fiscal_pagamento_evento_estorno_ref_tipo',
      sql`${table.tipo} = 'ESTORNO' OR ${table.eventoEstornadoId} IS NULL`,
    ),
    // "PAGO" exige evidência OU declaração manual explícita (R1.5): todo evento
    // de pagamento precisa de comprovante OU da marcação de declaração manual.
    check(
      'chk_fiscal_pagamento_evento_evidencia',
      sql`${table.tipo} = 'ESTORNO' OR ${table.comprovanteKey} IS NOT NULL OR ${table.declaracaoManual} = true`,
    ),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// Entregas fiscais — arquivo, hash, PVA, validação, assinatura, protocolo/recibo
// e vínculo de retificação (Fase 5 / tarefa 2.1, R2.1; design "Entrega e
// retificação (F20/F21 operacional)" §7).
// ─────────────────────────────────────────────────────────────────────────────
//
// A ENTREGA é o ato de homologar/transmitir o arquivo de uma obrigação acessória
// (EFD-ICMS-IPI, EFD-Contribuições etc.) de um escopo (cliente/competência/
// obrigação), amarrada à VERSÃO DE APURAÇÃO que a originou (fechamento da Fase 3,
// via `fechamentoId`) — a entrega projeta a mesma memória de cálculo versionada,
// nunca o estado atual (que pode ter mudado). R2.1 exige persistir: ARQUIVO
// (`arquivoKey`), HASH do conteúdo, PVA UTILIZADO (programa + versão), VALIDAÇÃO
// (status + resultado), ASSINATURA, PROTOCOLO/RECIBO (número + `reciboKey`) e o
// VÍNCULO DE RETIFICAÇÃO.
//
// STORAGE SÓ COM KEYS: apenas `arquivoKey` e `reciboKey` do storage ficam no
// banco — NUNCA URLs (restrição da fase/SKILL). URLs assinadas são geradas sob
// autorização, fora da persistência.
//
// RETIFICAÇÃO IMUTÁVEL: uma entrega retificadora referencia, em
// `entregaOriginalId`, a entrega que corrige — mantendo o par original/retificação
// explícito SEM sobrescrever a entrega anterior (a anterior é imutável; a nova
// linha carrega a diferença e o novo recibo — R2.2, aplicada na tarefa 2.4).
// Auto-FK `set null`: remover a original não apaga a retificadora (append-only).
//
// VIGÊNCIA DO LEIAUTE: `leiauteVersao` registra a versão do leiaute aplicada por
// VIGÊNCIA da competência (2026 = Guia 3.2.2; 2027 = 3.2.3 — N03/N04), tornando
// explícito qual leiaute foi usado, sem reutilização silenciosa (R2.5, tarefa 2.4).
//
// VALIDAÇÃO/TRANSMISSÃO: `statusValidacao` cobre o ciclo da entrega — PENDENTE,
// VALIDADA, REJEITADA (pelo PVA), TRANSMITIDA, FALHA_STORAGE (snapshot gravado,
// upload externo falhou → compensação/retry rastreável, R2.3, tarefa 2.3).
//
// VALORES: `valorDiferenca` (diferença da retificação) é decimal (`numeric`),
// nunca `Number`; só faz sentido em entrega retificadora.
//
// ADITIVA: só cria estrutura nova; não altera nem remove nada existente.
export const fiscalEntregas = pgTable(
  'fiscal_entregas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    // Versão de apuração que originou a entrega (fechamento da Fase 3). O
    // comprovante/recibo do PVA fica vinculado ao hash do fechamento (R2.4).
    // `set null` em delete preserva a entrega e seu histórico (append-only).
    fechamentoId: uuid('fechamento_id').references(() => fiscalFechamentos.id, {
      onDelete: 'set null',
    }),
    // Obrigação acessória entregue (mesmo domínio de `fiscal_fechamentos`).
    obrigacao: varchar('obrigacao', { length: 20 }).notNull(),
    // Competência fiscal (primeiro dia do mês), mesma convenção das demais
    // tabelas fiscais.
    competencia: date('competencia').notNull(),
    // ARQUIVO entregue: SOMENTE a key do storage. Nunca URL (SKILL).
    arquivoKey: text('arquivo_key').notNull(),
    // HASH SHA-256 do conteúdo do arquivo entregue (mesmo formato dos arquivos
    // SPED e do `hash_entradas` do fechamento) — sela o que foi transmitido.
    hashArquivo: varchar('hash_arquivo', { length: 64 }).notNull(),
    // PVA UTILIZADO: programa validador e sua VERSÃO operacional, confirmada na
    // homologação (N05) — nunca presumida como "a última".
    pvaPrograma: varchar('pva_programa', { length: 40 }).notNull(),
    pvaVersao: varchar('pva_versao', { length: 20 }).notNull(),
    // VALIDAÇÃO: status do ciclo da entrega + resultado estruturado do PVA
    // (ocorrências/advertências) congelado como snapshot JSONB. Decimais, se
    // houver, sempre como string — nunca `Number`.
    statusValidacao: varchar('status_validacao', { length: 20 })
      .notNull()
      .default('PENDENTE'),
    validacaoResultado: jsonb('validacao_resultado')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    // ASSINATURA digital do arquivo (ex.: titular/thumbprint do certificado) e
    // o momento em que foi assinado — rastro mínimo da assinatura (N02).
    assinaturaTitular: text('assinatura_titular'),
    assinaturaEm: timestamp('assinatura_em', { withTimezone: true }),
    // PROTOCOLO/RECIBO da transmissão: número do protocolo/recibo emitido pelo
    // órgão e a KEY do comprovante no storage (nunca URL — SKILL).
    protocoloNumero: text('protocolo_numero'),
    reciboKey: text('recibo_key'),
    // VÍNCULO DE RETIFICAÇÃO: entrega que esta retifica (auto-FK). Preenchido só
    // em entrega retificadora, mantendo o par original/retificação explícito sem
    // sobrescrever a anterior (R2.2). `valorDiferenca` guarda a diferença da
    // retificação (decimal, nunca `Number`).
    entregaOriginalId: uuid('entrega_original_id'),
    valorDiferenca: numeric('valor_diferenca', { precision: 15, scale: 2 }),
    // VIGÊNCIA DO LEIAUTE aplicada por competência (2026 vs. 2027 — N03/N04),
    // explícita para impedir reutilização silenciosa (R2.5).
    leiauteVersao: varchar('leiaute_versao', { length: 20 }).notNull(),
    transmitidaEm: timestamp('transmitida_em', { withTimezone: true }),
    // RETRY RASTREÁVEL DO STORAGE (R2.3, tarefa 2.3): a geração do snapshot usa
    // transação no banco; o upload externo (R2) NÃO participa dela. Quando o
    // upload falha APÓS o snapshot gravado, o status vai a FALHA_STORAGE e o
    // objeto parcial/órfão é compensado pela fila de limpeza. O retry é AMARRADO
    // ao MESMO snapshot (não cria entrega nova): `tentativasStorage` conta cada
    // tentativa de upload (começa em 0 e sobe a cada falha/retry) e
    // `ultimoErroStorage` guarda o rastro do último erro — a trilha completa fica
    // em `eventos_auditoria`. Num retry bem-sucedido o status volta a um estado
    // de sucesso (PENDENTE/VALIDADA) sem perder o histórico de tentativas.
    tentativasStorage: integer('tentativas_storage').notNull().default(0),
    ultimoErroStorage: text('ultimo_erro_storage'),
    criadoEm: timestamp('criado_em', { withTimezone: true })
      .notNull()
      .defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Auto-referência: retificação aponta a entrega original (trilha preservada).
    foreignKey({
      columns: [table.entregaOriginalId],
      foreignColumns: [table.id],
      name: 'fiscal_entregas_original_fk',
    }).onDelete('set null'),
    // Projeção por escopo/competência (painéis, livros, status de entrega).
    index('idx_fiscal_entrega_competencia').on(
      table.clienteId,
      table.competencia,
      table.obrigacao,
    ),
    // Conciliação entrega ↔ versão de apuração (recibo ↔ hash do fechamento).
    index('idx_fiscal_entrega_fechamento').on(table.fechamentoId),
    // Trilha de retificação: entregas que retificam uma dada original.
    index('idx_fiscal_entrega_original').on(table.entregaOriginalId),
    check(
      'chk_fiscal_entrega_obrigacao',
      sql`${table.obrigacao} IN ('EFD_ICMS_IPI', 'EFD_CONTRIBUICOES', 'GIA', 'DAS', 'DAPI')`,
    ),
    // Competência é sempre o primeiro dia do mês (competência fiscal).
    check(
      'chk_fiscal_entrega_competencia_dia1',
      sql`date_part('day', ${table.competencia}) = 1`,
    ),
    // Hash SHA-256 do arquivo no mesmo formato dos arquivos SPED/fechamento.
    check(
      'chk_fiscal_entrega_hash',
      sql`${table.hashArquivo} ~ '^[0-9a-f]{64}$'`,
    ),
    // Ciclo da entrega: validação do PVA, transmissão e falha de storage (R2.3).
    check(
      'chk_fiscal_entrega_status',
      sql`${table.statusValidacao} IN ('PENDENTE', 'VALIDADA', 'REJEITADA', 'TRANSMITIDA', 'FALHA_STORAGE')`,
    ),
    // A diferença só faz sentido numa entrega retificadora (vínculo à original):
    // sem vínculo de retificação, não há `valor_diferenca`.
    check(
      'chk_fiscal_entrega_retificacao_diferenca',
      sql`${table.entregaOriginalId} IS NOT NULL OR ${table.valorDiferenca} IS NULL`,
    ),
    // Uma entrega não retifica a si mesma (par original/retificação distinto).
    check(
      'chk_fiscal_entrega_nao_autoretifica',
      sql`${table.entregaOriginalId} IS NULL OR ${table.entregaOriginalId} <> ${table.id}`,
    ),
  ],
);
