import {
  boolean,
  check,
  date,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { contadores } from './contadores';
import { user } from './user';

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
    regimeCompetencia: boolean('regime_competencia').notNull().default(true),
    dataAberturaCnpj: date('data_abertura_cnpj'),
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
