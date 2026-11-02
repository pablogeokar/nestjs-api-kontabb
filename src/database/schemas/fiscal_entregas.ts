import {
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { clientes } from './clientes';
import { fiscalFechamentos } from './fiscal_fechamentos';

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
