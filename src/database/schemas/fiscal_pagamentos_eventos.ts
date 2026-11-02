import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { clientes } from './clientes';
import { fiscalApuracoesGuias } from './fiscal_apuracoes_guias';
import { fiscalFechamentos } from './fiscal_fechamentos';

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
// decomposição explícita e conciliável.
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
    fechamentoId: uuid('fechamento_id'),
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
    foreignKey({
      name: 'fk_fiscal_pagamento_fechamento',
      columns: [table.fechamentoId],
      foreignColumns: [fiscalFechamentos.id],
    }).onDelete('set null'),
    // Auto-referência: estorno aponta o pagamento revertido (trilha preservada).
    foreignKey({
      columns: [table.eventoEstornadoId],
      foreignColumns: [table.id],
      name: 'fiscal_pagamentos_eventos_estornado_fk',
    }).onDelete('set null'),
    // Projeção da trilha por guia (ordem cronológica reconstrói o saldo — R1.3).
    index('idx_fiscal_pagamento_evento_guia').on(
      table.guiaId,
      table.dataEvento,
    ),
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
