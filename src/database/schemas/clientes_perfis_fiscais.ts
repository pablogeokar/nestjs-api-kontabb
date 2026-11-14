import {
  boolean,
  check,
  date,
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

// Perfil fiscal HISTÓRICO do estabelecimento (ICMS nacional, A3).
//
// `clientes` guarda só o estado atual de UF, IE e regime. O DIFAL e a
// antecipação dependem desses fatos NA DATA da operação, então cada alteração
// vira uma linha com vigência. O trigger `trg_clientes_perfil_fiscal` (migração
// 0011) grava as linhas a partir de qualquer caminho de escrita em `clientes`.
//
// `origem` registra a autoridade do dado:
//  - CADASTRO_INICIAL: valores no cadastro do cliente (início = data de criação);
//  - ANTERIOR_A_ALTERACAO: valores anteriores à primeira alteração registrada,
//    assumidos desde a criação do cadastro (confiança menor);
//  - ALTERACAO_CADASTRAL: alteração detectada, com início na data da alteração
//    no sistema (não a data legal de início de efeitos);
//  - MANUAL: perfil informado por revisão fiscal, com datas legais.
export const clientesPerfisFiscais = pgTable(
  'clientes_perfis_fiscais',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    vigenciaInicio: date('vigencia_inicio').notNull(),
    vigenciaFim: date('vigencia_fim'),
    uf: varchar('uf', { length: 2 }),
    inscricaoEstadual: text('inscricao_estadual'),
    regimeTributario: text('regime_tributario'),
    origem: varchar('origem', { length: 30 }).notNull(),
    // Perfil MANUAL: proveniência e responsável. Nulos nas linhas automáticas.
    fonte: text('fonte'),
    justificativa: text('justificativa'),
    criadoPor: text('criado_por').references(() => user.id, {
      onDelete: 'set null',
    }),
    // Linhas nunca são apagadas: `ativo = false` preserva a trilha.
    ativo: boolean('ativo').notNull().default(true),
    // Linha automática desativada por um perfil MANUAL; permite restaurá-la
    // se o perfil manual for removido.
    substituidoPor: uuid('substituido_por'),
    criadoEm: timestamp('criado_em', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('uidx_clientes_perfil_fiscal_inicio')
      .on(table.clienteId, table.vigenciaInicio)
      .where(sql`${table.ativo}`),
    check(
      'chk_clientes_perfil_fiscal_vigencia',
      sql`${table.vigenciaFim} IS NULL OR ${table.vigenciaFim} >= ${table.vigenciaInicio}`,
    ),
    check(
      'chk_clientes_perfil_fiscal_origem',
      sql`${table.origem} IN ('CADASTRO_INICIAL', 'ANTERIOR_A_ALTERACAO', 'ALTERACAO_CADASTRAL', 'MANUAL')`,
    ),
  ],
);
