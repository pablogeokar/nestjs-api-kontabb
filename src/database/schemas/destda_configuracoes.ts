import {
  check,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { clientes } from './clientes';
import { user } from './user';

// ─────────────────────────────────────────────────────────────────────────────
// DeSTDA (Ajuste SINIEF 12/2015 / Ato COTEPE/ICMS 47/2015)
// Dados complementares do contribuinte optante pelo Simples Nacional que não
// existem no cadastro da empresa: responsável/assinante (0005), município IBGE
// (0000), inscrições estaduais como substituto em outras UFs (0002) e ajustes
// do perfil do contribuinte (0030).
// ─────────────────────────────────────────────────────────────────────────────
export const destdaConfiguracoes = pgTable(
  'destda_configuracoes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    codigoMunicipioIbge: varchar('codigo_municipio_ibge', { length: 7 }),
    nomeFantasia: text('nome_fantasia'),
    inscricaoMunicipal: text('inscricao_municipal'),
    suframa: text('suframa'),
    nire: varchar('nire', { length: 11 }),
    telefone: text('telefone'),
    fax: text('fax'),
    responsavelNome: text('responsavel_nome'),
    responsavelCpf: varchar('responsavel_cpf', { length: 11 }),
    responsavelCodAssinante: varchar('responsavel_cod_assinante', {
      length: 3,
    }),
    inscricoesSubstituto: jsonb('inscricoes_substituto')
      .$type<Array<{ uf: string; ie: string }>>()
      .notNull()
      .default([]),
    perfil: jsonb('perfil')
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    atualizadoPor: text('atualizado_por').references(() => user.id, {
      onDelete: 'set null',
    }),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uidx_destda_config_cliente').on(table.clienteId),
    check(
      'chk_destda_config_codigo_municipio',
      sql`${table.codigoMunicipioIbge} IS NULL OR ${table.codigoMunicipioIbge} ~ '^[0-9]{7}$'`,
    ),
    check(
      'chk_destda_config_nire',
      sql`${table.nire} IS NULL OR ${table.nire} ~ '^[0-9]{11}$'`,
    ),
    check(
      'chk_destda_config_resp_cpf',
      sql`${table.responsavelCpf} IS NULL OR ${table.responsavelCpf} ~ '^[0-9]{11}$'`,
    ),
    check(
      'chk_destda_config_cod_assinante',
      sql`${table.responsavelCodAssinante} IS NULL OR ${table.responsavelCodAssinante} ~ '^[0-9]{3}$'`,
    ),
    check(
      'chk_destda_config_inscricoes',
      sql`jsonb_typeof(${table.inscricoesSubstituto}) = 'array'`,
    ),
    check(
      'chk_destda_config_perfil',
      sql`jsonb_typeof(${table.perfil}) = 'object'`,
    ),
  ],
);
