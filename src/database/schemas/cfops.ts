import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const cfops = pgTable(
  'cfops',
  {
    codigo: varchar('codigo', { length: 4 }).primaryKey(),
    descricao: text('descricao').notNull(),
    tipoOperacao: varchar('tipo_operacao', { length: 10 }).notNull(),
    abrangencia: varchar('abrangencia', { length: 15 }).notNull(),
    grupo: text('grupo'),
    // Categoria fiscal da destinação econômica da mercadoria/serviço.
    // Base para o motor de regras decidir crédito de ICMS/IPI e CIAP.
    categoriaFiscal: varchar('categoria_fiscal', { length: 30 })
      .notNull()
      .default('OUTRAS'),
    // Indica se, em regra geral, o CFOP dá direito a crédito de ICMS na entrada.
    // Uso/consumo (1556/2556) e ST-substituído (1403/1405) => false.
    geraCreditoIcmsPadrao: boolean('gera_credito_icms_padrao')
      .notNull()
      .default(false),
    descricaoDetalhada: text('descricao_detalhada'),
    ativo: boolean('ativo').notNull().default(true),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
  },
  (table) => [
    index('idx_cfops_tipo').on(table.tipoOperacao),
    index('idx_cfops_abrangencia').on(table.abrangencia),
    index('idx_cfops_categoria').on(table.categoriaFiscal),
    check('chk_cfops_codigo', sql`${table.codigo} ~ '^[123567][0-9]{3}$'`),
    check('chk_cfops_tipo', sql`${table.tipoOperacao} IN ('ENTRADA', 'SAIDA')`),
    check(
      'chk_cfops_abrangencia',
      sql`${table.abrangencia} IN ('ESTADUAL', 'INTERESTADUAL', 'EXTERIOR')`,
    ),
    check(
      'chk_cfops_categoria',
      sql`${table.categoriaFiscal} IN ('COMPRA_REVENDA', 'COMPRA_INSUMO', 'USO_CONSUMO', 'ATIVO_IMOBILIZADO', 'DEVOLUCAO', 'TRANSFERENCIA', 'REMESSA_RETORNO', 'PRESTACAO_SERVICO', 'OUTRAS')`,
    ),
  ],
);
