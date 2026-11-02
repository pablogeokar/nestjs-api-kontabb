import {
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { ciapAtivoPermanente } from './ciap_ativo_permanente';
import { ciapMovimentos } from './ciap_movimentos';
import { clientes } from './clientes';

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
