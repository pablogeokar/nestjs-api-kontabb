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
      sql`${table.emailStatus} IN ('NAO_ENVIADO', 'PENDENTE', 'ENVIADO', 'FALHOU', 'SEM_EMAIL')`,
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
    uniqueIndex('uidx_certificados_cliente_ativo')
      .on(table.clienteId)
      .where(sql`status IN ('ATIVO', 'PRESTES_A_EXPIRAR')`),
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
    check(
      'chk_ciap_status',
      sql`${table.status} IN ('ATIVO', 'BAIXADO', 'CONCLUIDO')`,
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

    criadoEm: timestamp('criado_em').notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
  },
  (table) => [
    index('idx_fiscal_guias_cliente_competencia').on(
      table.clienteId,
      table.competencia,
    ),
    index('idx_fiscal_guias_status').on(table.statusPagamento),
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
  ],
);
