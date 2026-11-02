import {
  boolean,
  check,
  date,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { user } from './user';

// ─────────────────────────────────────────────────────────────────────────────
// Catálogo de códigos fiscais versionados por vigência (Fase 2 / tarefa 3.4,
// R2.6; compartilhado com a Fase 4 — design §Modelo de dados).
// ─────────────────────────────────────────────────────────────────────────────
//
// R2.6: "O ajuste de crédito DEVE usar código estadual oficial validado (código
// e vigência), não um valor fabricado só para passar no check." Esta tabela é a
// FONTE ÚNICA dos códigos oficiais de ajuste (hoje o E111 de crédito do CIAP;
// `tipo = 'E111_CIAP'`), substituindo o `${uf}02CIAP` fabricado em código. Cada
// linha vincula um `codigo` a uma `uf` e a uma JANELA DE VIGÊNCIA
// (`vigenciaInicio`..`vigenciaFim`), de modo que o ajuste de uma competência só
// é emitido com um código catalogado E vigente naquela competência. Sem linha
// válida (UF + vigência), a geração do ajuste é BLOQUEADA com inconsistência —
// nunca emite código inválido (postura bloqueante da fase).
//
// Segue o mesmo padrão de vigência de `sped_responsabilidades_tributarias`
// (codigo/uf/vigencia_inicio/vigencia_fim/ativo), aqui com `fonte` (origem
// normativa do código) e `descricao`. É um CATÁLOGO GLOBAL (não por cliente):
// o código estadual de ajuste é definido pela UF/legislação, não pela empresa.
//
// PRÉ-CONDIÇÃO FISCAL (bloqueante): os códigos REAIS por UF ainda dependem de
// confirmação do responsável fiscal (requirements, "Pré-condições fiscais"). O
// seed inicial (0015) carrega um default DOCUMENTADO e marcado como
// `fonte = 'default_pendente_confirmacao'` para que o mecanismo de lookup/
// validação funcione, deixando explícito que o código real ainda não foi
// homologado — a `fonte` permite distinguir e substituir sem alterar o schema.
//
// O `codigo` respeita o leiaute do E111 (`^[A-Z]{2}0[0-5][A-Z0-9]{4}$`) com
// natureza `2` (crédito, 4º caractere), coerente com `chk_sped_ajuste_coerencia`
// e `chk_sped_ajuste_natureza_indicador` de `sped_ajustes_apuracao`.

export const fiscalCatalogosVersoes = pgTable(
  'fiscal_catalogos_versoes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Tipo do catálogo. Hoje apenas o ajuste E111 de crédito do CIAP; a coluna
    // antecipa outros códigos estaduais (Fase 4) sem nova tabela.
    tipo: varchar('tipo', { length: 20 }).notNull(),
    uf: varchar('uf', { length: 2 }).notNull(),
    codigo: text('codigo').notNull(),
    descricao: text('descricao'),
    // Origem normativa do código (ato/legislação). O valor
    // `default_pendente_confirmacao` sinaliza um default ainda NÃO homologado
    // pelo responsável fiscal (pré-condição bloqueante da fase).
    fonte: varchar('fonte', { length: 60 }).notNull(),
    vigenciaInicio: date('vigencia_inicio').notNull(),
    vigenciaFim: date('vigencia_fim'),
    ativo: boolean('ativo').notNull().default(true),
    // ───────────────── Fase 4 (R1.1/R2.1/R3.1) — ADITIVO ─────────────────
    // A coluna `tipo` já antecipava "outros códigos estaduais (Fase 4) sem nova
    // tabela"; a Fase 4 amplia o domínio para DIFAL/ST_FCP/PIS_COFINS e
    // acrescenta os atributos que o design §6.2/§7 exige para um catálogo que
    // seja FONTE DE VERDADE versionada (fonte, hash, escopo aprovado, carga),
    // e consultável por COMPETÊNCIA — nunca "o último catálogo" para histórico.
    //
    // URL/identificador externo da fonte normativa (ato, convênio, legislação
    // estadual). Complementa `fonte` com um ponteiro verificável.
    fonteUrl: text('fonte_url'),
    // Hash do conteúdo carregado (R3.1 "fonte, hash, vigência, UF"): garante que
    // a versão do catálogo é imutável e auditável — mesma carga → mesmo hash.
    // SHA-256 em hex, mesmo formato de `fiscal_fechamentos.hash_entradas`.
    hashConteudo: varchar('hash_conteudo', { length: 64 }),
    // Payload estruturado da versão do catálogo (ex.: tabela de enquadramento
    // produto/CEST/UF para ST/FCP, ou parâmetros de DIFAL/PIS-COFINS). Decimais
    // sempre como string — nunca `Number` (restrição da fase).
    conteudo: jsonb('conteudo')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    // Escopo aprovado (design §6.2): só uma versão com `escopo_aprovado = true`
    // alimenta decisão fiscal definitiva. Enquanto não aprovada, o consumo
    // produz pendência/simulação, não guia (R1.2).
    escopoAprovado: boolean('escopo_aprovado').notNull().default(false),
    aprovadoPor: text('aprovado_por').references(() => user.id, {
      onDelete: 'set null',
    }),
    // Data de carga da versão (design §7: "não usar último catálogo para
    // competência histórica"): o lookup é por competência via vigência, e a
    // carga apenas registra QUANDO a versão entrou no sistema.
    dataCarga: timestamp('data_carga', { withTimezone: true })
      .notNull()
      .defaultNow(),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
  },
  (table) => [
    // Uma única vigência por (tipo, uf, inicio): novas vigências geram novas
    // linhas (não sobrescrevem a anterior), preservando o histórico de códigos.
    uniqueIndex('uidx_fiscal_catalogo_vigencia').on(
      table.tipo,
      table.uf,
      table.vigenciaInicio,
    ),
    index('idx_fiscal_catalogo_tipo_uf').on(table.tipo, table.uf),
    check('chk_fiscal_catalogo_uf', sql`${table.uf} ~ '^[A-Z]{2}$'`),
    check(
      'chk_fiscal_catalogo_tipo',
      sql`${table.tipo} IN ('E111_CIAP', 'DIFAL', 'ST_FCP', 'PIS_COFINS')`,
    ),
    // Vigência fechada só quando o fim é posterior ou igual ao início.
    check(
      'chk_fiscal_catalogo_vigencia',
      sql`${table.vigenciaFim} IS NULL OR ${table.vigenciaFim} >= ${table.vigenciaInicio}`,
    ),
    // O código de E111_CIAP respeita o leiaute do E111 (crédito, natureza 2),
    // coerente com `chk_sped_ajuste_coerencia` de `sped_ajustes_apuracao`.
    check(
      'chk_fiscal_catalogo_codigo_e111_ciap',
      sql`${table.tipo} <> 'E111_CIAP' OR ${table.codigo} ~ '^[A-Z]{2}02[A-Z0-9]{4}$'`,
    ),
    // Hash do conteúdo (quando presente) em SHA-256 hex, igual aos arquivos
    // SPED e a `fiscal_fechamentos.hash_entradas`.
    check(
      'chk_fiscal_catalogo_hash',
      sql`${table.hashConteudo} IS NULL OR ${table.hashConteudo} ~ '^[0-9a-f]{64}$'`,
    ),
    // Aprovação coerente: há aprovador se, e somente se, o escopo foi aprovado.
    check(
      'chk_fiscal_catalogo_aprovacao',
      sql`${table.escopoAprovado} = (${table.aprovadoPor} IS NOT NULL)`,
    ),
  ],
);
