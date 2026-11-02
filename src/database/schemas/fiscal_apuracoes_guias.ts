import {
  boolean,
  check,
  date,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { clientes } from './clientes';
import { fiscalFechamentos } from './fiscal_fechamentos';
import { guias } from './guias';

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

    // PDF oficial enviado pela Central de Upload. A FK torna a conciliação
    // persistente e evita que a Central dependa de semelhança recalculada a
    // cada leitura. Uma guia de upload só pode comprovar uma obrigação fiscal.
    guiaUploadId: uuid('guia_upload_id').references(() => guias.id, {
      onDelete: 'restrict',
    }),
    guiaUploadVinculadaEm: timestamp('guia_upload_vinculada_em', {
      withTimezone: true,
    }),
    guiaUploadDiferenca: numeric('guia_upload_diferenca', {
      precision: 15,
      scale: 2,
    }),

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
    uniqueIndex('uidx_fiscal_guias_guia_upload')
      .on(table.guiaUploadId)
      .where(sql`${table.guiaUploadId} IS NOT NULL`),
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
    check(
      'chk_fiscal_guias_upload_vinculo',
      sql`(${table.guiaUploadId} IS NULL AND ${table.guiaUploadVinculadaEm} IS NULL AND ${table.guiaUploadDiferenca} IS NULL) OR (${table.guiaUploadId} IS NOT NULL AND ${table.guiaUploadVinculadaEm} IS NOT NULL AND ${table.guiaUploadDiferenca} IS NOT NULL)`,
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
