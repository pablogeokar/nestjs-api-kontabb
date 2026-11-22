import {
  bigint,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { clientes } from './clientes';
import { contadores } from './contadores';
import { user } from './user';

export interface FaturamentoMesSnapshot {
  competencia: string;
  valorProdutos: string;
  valorServicos: string;
  /** Prestação de serviço de transporte (CT-e). Ausente em relatórios anteriores à inclusão do CT-e. */
  valorTransportes?: string;
  /** Devoluções de vendas deduzidas da receita do mês. */
  valorDevolucoes?: string;
  /** Receita bruta do mês: base da apuração dos tributos. */
  total: string;
  /** De onde veio a receita do mês. Ausente em relatórios antigos (documentos). */
  origem?: 'APURACAO_SIMPLES' | 'HISTORICO_INFORMADO' | 'DOCUMENTOS';
  /** Falso quando a abertura por tipo não soma o total (histórico informado). */
  detalhado?: boolean;
  quantidadeProdutos?: number;
  quantidadeServicos?: number;
  quantidadeTransportes?: number;
}

export const relatoriosFaturamento = pgTable(
  'relatorios_faturamento',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    numero: bigint('numero', { mode: 'number' }).generatedAlwaysAsIdentity(),
    codigo: text('codigo').notNull(),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'restrict' }),
    contadorId: uuid('contador_id').references(() => contadores.id, {
      onDelete: 'set null',
    }),
    periodoInicio: text('periodo_inicio').notNull(),
    periodoFim: text('periodo_fim').notNull(),
    empresaNome: text('empresa_nome').notNull(),
    empresaDocumento: text('empresa_documento').notNull(),
    contadorNome: text('contador_nome'),
    contadorCrc: text('contador_crc'),
    meses: jsonb('meses').$type<FaturamentoMesSnapshot[]>().notNull(),
    total: text('total').notNull(),
    pdfKey: text('pdf_key'),
    pdfSha256: text('pdf_sha256'),
    assinaturaStatus: text('assinatura_status')
      .notNull()
      .default('SEM_CERTIFICADO'),
    assinaturaThumbprint: text('assinatura_thumbprint'),
    status: text('status').notNull().default('PROCESSANDO'),
    emitidoPor: text('emitido_por').references(() => user.id, {
      onDelete: 'set null',
    }),
    criadoEm: timestamp('criado_em', { withTimezone: true })
      .notNull()
      .defaultNow(),
    emitidoEm: timestamp('emitido_em', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('uidx_relat_faturamento_numero').on(table.numero),
    uniqueIndex('uidx_relat_faturamento_codigo').on(table.codigo),
    index('idx_relat_faturamento_cliente_data').on(
      table.clienteId,
      table.criadoEm,
    ),
    check(
      'chk_relat_faturamento_status',
      sql`${table.status} IN ('PROCESSANDO', 'EMITIDO', 'FALHOU')`,
    ),
    check(
      'chk_relat_faturamento_assinatura',
      sql`${table.assinaturaStatus} IN ('ASSINADO', 'SEM_CERTIFICADO')`,
    ),
  ],
);
