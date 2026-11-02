import {
  boolean,
  check,
  date,
  index,
  integer,
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
