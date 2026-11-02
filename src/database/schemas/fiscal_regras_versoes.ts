import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  foreignKey,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { fiscalCatalogosVersoes } from './fiscal_catalogos_versoes';
import { user } from './user';

// ─────────────────────────────────────────────────────────────────────────────
// Catálogo normativo versionado — regras versionadas
// (Fase 4 / tarefa 1.1, R1.1/R2.1/R3.1; plano §6.2/§7).
// ─────────────────────────────────────────────────────────────────────────────
//
// Base comum da Fase 4: parametriza tributos que dependem de JURISDIÇÃO, REGIME
// e VIGÊNCIA (DIFAL, ST/FCP, PIS-COFINS). Nenhuma tabela estática é fonte de
// verdade — a seleção é SEMPRE por competência via vigência, não "o último".
// Sem regra homologada vigente, o consumo produz pendência/simulação/bloqueio,
// nunca guia definitiva (R1.2/R3.4).
//
// Todas ADITIVAS: só criam estruturas novas; não alteram nem removem nada.

// `fiscal_regras_versoes` (design §7): REVISÕES IMUTÁVEIS de uma regra fiscal,
// ancoradas numa versão de catálogo. Cada linha é uma versão de regra com
// conteúdo, fonte, responsável e vigência — nunca editada no lugar: uma nova
// revisão cria uma nova linha (`revisao` crescente), preservando o histórico
// (reprodutibilidade — a competência histórica usa a regra vigente à época,
// não a mais recente). O conteúdo guarda os parâmetros aplicáveis (ex.:
// composição de base DIFAL, enquadramento ST/FCP, naturezas PIS-COFINS), com
// decimais sempre como string — nunca `Number` (restrição da fase).

export const fiscalRegrasVersoes = pgTable(
  'fiscal_regras_versoes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Versão de catálogo que ancora a regra (fonte/hash/vigência/UF).
    catalogoVersaoId: uuid('catalogo_versao_id').notNull(),
    // Chave estável da regra dentro do catálogo (ex.: hipótese DIFAL, CEST/UF
    // de ST, natureza de receita de PIS/COFINS). Agrupa suas revisões.
    chave: text('chave').notNull(),
    // Revisão imutável e crescente (>= 1): nova revisão = nova linha.
    revisao: integer('revisao').notNull().default(1),
    // Conteúdo versionado da regra (parâmetros). Decimais como string.
    conteudo: jsonb('conteudo')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    // Origem normativa da revisão (ato/legislação/convênio).
    fonte: varchar('fonte', { length: 60 }).notNull(),
    fonteUrl: text('fonte_url'),
    // Responsável fiscal que registrou/homologou a revisão.
    responsavelPor: text('responsavel_por').references(() => user.id, {
      onDelete: 'set null',
    }),
    // Janela de vigência da revisão (fim aberto = ainda vigente).
    vigenciaInicio: date('vigencia_inicio').notNull(),
    vigenciaFim: date('vigencia_fim'),
    ativo: boolean('ativo').notNull().default(true),
    criadoEm: timestamp('criado_em', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'fk_fiscal_regra_catalogo',
      columns: [table.catalogoVersaoId],
      foreignColumns: [fiscalCatalogosVersoes.id],
    }).onDelete('cascade'),
    // Imutabilidade por revisão: uma linha por (catálogo, chave, revisão).
    uniqueIndex('uidx_fiscal_regra_revisao').on(
      table.catalogoVersaoId,
      table.chave,
      table.revisao,
    ),
    // Lookup por competência: revisões de uma regra ordenadas por vigência.
    index('idx_fiscal_regra_lookup').on(
      table.catalogoVersaoId,
      table.chave,
      table.vigenciaInicio,
    ),
    check('chk_fiscal_regra_revisao', sql`${table.revisao} >= 1`),
    // Vigência fechada só quando o fim é posterior ou igual ao início.
    check(
      'chk_fiscal_regra_vigencia',
      sql`${table.vigenciaFim} IS NULL OR ${table.vigenciaFim} >= ${table.vigenciaInicio}`,
    ),
  ],
);
