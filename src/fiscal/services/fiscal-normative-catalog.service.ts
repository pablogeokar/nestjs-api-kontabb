import { BadRequestException, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service';
import {
  fiscalCatalogosVersoes,
  fiscalRegrasVersoes,
} from '../../database/schema';
import { parseCompetenciaMensal } from '../fiscal-date.util';

/**
 * Serviço comum do catálogo normativo versionado da Fase 4 (design §6.2/§7).
 *
 * Expõe os quatro insumos que o restante da fase (DIFAL, ST/FCP, PIS/COFINS)
 * consome de `fiscal_catalogos_versoes`/`fiscal_regras_versoes`: CÓDIGOS,
 * VIGÊNCIAS, FONTES e ESCOPO APROVADO.
 *
 * PRINCÍPIO CENTRAL — SELEÇÃO POR COMPETÊNCIA, NUNCA "O ÚLTIMO" (R3.1, design §7
 * "não usar último catálogo para competência histórica"): a versão aplicável a
 * uma competência é a que tem a janela de vigência CONTENDO aquela competência
 * (`vigenciaInicio <= competencia` E `vigenciaFim IS NULL OU >= competencia`),
 * não a mais recente carregada. Uma competência histórica resolve para a regra
 * vigente À ÉPOCA, de modo que reabrir/reprocessar um período antigo não aplica
 * uma regra nova retroativamente. Espelha o padrão de
 * `CiapService.resolverCodigoAjusteE111` (consulta E111_CIAP).
 *
 * ESCOPO APROVADO É O QUE SEPARA DECISÃO DE PENDÊNCIA (R3.5, R1.2 contexto,
 * design §6.2): só versões com `escopo_aprovado = true` alimentam uma DECISÃO
 * FISCAL DEFINITIVA. Uma versão vigente mas NÃO aprovada existe — e é devolvida
 * —, porém SEMPRE marcada como pendência/simulação, nunca como guia definitiva.
 * `resolver*` definitivo exige aprovação; `resolver*ParaSimulacao` devolve a
 * versão vigente com o status de aprovação explícito para o chamador tratar.
 *
 * DECIMAIS SEMPRE COMO STRING (restrição da fase): nenhum valor monetário/
 * alíquota é convertido para `Number` aqui. O conteúdo (`conteudo` jsonb) é
 * repassado como veio do banco; a interpretação de seus decimais fica a cargo
 * do consumidor, que deve mantê-los como strings.
 */

// Tipos de catálogo suportados pela Fase 4 (coerente com o CHECK
// `chk_fiscal_catalogo_tipo` e com o consumo legado do CIAP).
export type CatalogoTipo = 'E111_CIAP' | 'DIFAL' | 'ST_FCP' | 'PIS_COFINS';

/**
 * Versão de catálogo RESOLVIDA para uma competência (design §7).
 *
 * Expõe código, vigência, fontes e o estado de aprovação de forma auditável. A
 * `competencia` ecoa a competência consultada (primeiro dia do mês), para o
 * chamador conferir que a resolução foi por competência — não "o último".
 */
export interface CatalogoVersaoResolvida {
  id: string;
  tipo: CatalogoTipo;
  uf: string;
  // Código do catálogo (ex.: código estadual de ajuste, enquadramento).
  codigo: string;
  descricao: string | null;
  // Fonte normativa textual + ponteiro verificável (ato/convênio/legislação).
  fonte: string;
  fonteUrl: string | null;
  // Hash do conteúdo carregado (imutabilidade/auditoria), quando presente.
  hashConteudo: string | null;
  // Payload estruturado da versão. Decimais internos permanecem strings.
  conteudo: Record<string, unknown>;
  // Vigência resolvida (a janela que CONTÉM a competência consultada).
  vigenciaInicio: string;
  vigenciaFim: string | null;
  // Competência consultada (primeiro dia do mês, 'YYYY-MM-01').
  competencia: string;
  // Escopo aprovado: só `true` alimenta decisão fiscal DEFINITIVA (R3.5).
  escopoAprovado: boolean;
  aprovadoPor: string | null;
  // Verdadeiro quando a versão NÃO está aprovada: o resultado é
  // pendência/simulação, nunca guia definitiva (R1.2/R3.5).
  pendente: boolean;
}

/**
 * Revisão de regra RESOLVIDA para uma competência, ancorada numa versão de
 * catálogo também vigente/aprovada na mesma competência.
 */
export interface RegraVersaoResolvida {
  id: string;
  catalogoVersaoId: string;
  chave: string;
  revisao: number;
  conteudo: Record<string, unknown>;
  fonte: string;
  fonteUrl: string | null;
  responsavelPor: string | null;
  vigenciaInicio: string;
  vigenciaFim: string | null;
  competencia: string;
  // Herda a aprovação da versão de catálogo que a ancora.
  escopoAprovado: boolean;
  pendente: boolean;
}

interface ResolverCatalogoInput {
  tipo: CatalogoTipo;
  uf: string;
  // Competência mensal 'YYYY-MM' (ex.: '2026-09').
  competencia: string;
}

interface ResolverRegraInput extends ResolverCatalogoInput {
  // Chave estável da regra dentro do catálogo (hipótese/CEST/natureza).
  chave: string;
}

@Injectable()
export class FiscalNormativeCatalogService {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Resolve a versão de catálogo VIGENTE na competência (aprovada ou não),
   * marcando o estado de aprovação. Fundamento comum de todos os lookups.
   *
   * Devolve `null` quando NENHUMA versão (de qualquer aprovação) tem vigência
   * contendo a competência — não há "fallback para o último" (R3.1): uma
   * competência sem versão vigente simplesmente não resolve.
   *
   * Entre vigências que ainda cobrem a competência, escolhe a de início MAIS
   * RECENTE de forma determinística (a vigência "mais nova" aplicável).
   */
  async resolverVersaoVigente(
    input: ResolverCatalogoInput,
  ): Promise<CatalogoVersaoResolvida | null> {
    const competencia = this.competenciaDate(input.competencia);
    const uf = this.normalizarUf(input.uf);

    const rows = await this.database.db
      .select()
      .from(fiscalCatalogosVersoes)
      .where(
        and(
          eq(fiscalCatalogosVersoes.tipo, input.tipo),
          eq(fiscalCatalogosVersoes.uf, uf),
          eq(fiscalCatalogosVersoes.ativo, true),
          // SELEÇÃO POR COMPETÊNCIA: a janela de vigência CONTÉM a competência.
          lte(fiscalCatalogosVersoes.vigenciaInicio, competencia),
          or(
            isNull(fiscalCatalogosVersoes.vigenciaFim),
            gte(fiscalCatalogosVersoes.vigenciaFim, competencia),
          ),
        ),
      )
      // A vigência MAIS NOVA que ainda cobre a competência (determinístico);
      // NÃO é "a última carregada" — todas aqui já contêm a competência.
      .orderBy(desc(fiscalCatalogosVersoes.vigenciaInicio))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    return {
      id: row.id,
      tipo: row.tipo as CatalogoTipo,
      uf: row.uf,
      codigo: row.codigo,
      descricao: row.descricao ?? null,
      fonte: row.fonte,
      fonteUrl: row.fonteUrl ?? null,
      hashConteudo: row.hashConteudo ?? null,
      conteudo: row.conteudo ?? {},
      vigenciaInicio: row.vigenciaInicio,
      vigenciaFim: row.vigenciaFim ?? null,
      competencia,
      escopoAprovado: row.escopoAprovado,
      aprovadoPor: row.aprovadoPor ?? null,
      pendente: !row.escopoAprovado,
    };
  }

  /**
   * Resolve a versão de catálogo para uma DECISÃO FISCAL DEFINITIVA (R3.5).
   *
   * Exige escopo aprovado: devolve a versão APENAS quando ela existe, está
   * vigente na competência E `escopoAprovado = true`. Caso contrário, devolve
   * `null` — o chamador NÃO deve usar uma versão não aprovada como guia; deve
   * tratar como pendência (via {@link resolverVersaoParaSimulacao}).
   */
  async resolverVersaoAprovada(
    input: ResolverCatalogoInput,
  ): Promise<CatalogoVersaoResolvida | null> {
    const versao = await this.resolverVersaoVigente(input);
    if (!versao || !versao.escopoAprovado) return null;
    return versao;
  }

  /**
   * Resolve a versão vigente para SIMULAÇÃO/PENDÊNCIA (R1.2/R3.5).
   *
   * Devolve a versão vigente na competência SEM exigir aprovação; o campo
   * `pendente` indica se a versão ainda não foi aprovada. Serve ao caminho em
   * que o sistema produz uma pendência/simulação identificada, nunca guia.
   * Quando não há sequer uma versão vigente, devolve `null`.
   */
  resolverVersaoParaSimulacao(
    input: ResolverCatalogoInput,
  ): Promise<CatalogoVersaoResolvida | null> {
    return this.resolverVersaoVigente(input);
  }

  /**
   * CÓDIGO do catálogo vigente e APROVADO na competência (R3.1/R3.5).
   *
   * Bloqueia com inconsistência clara quando não há versão aprovada vigente —
   * nunca devolve um código de versão não aprovada como se fosse definitivo
   * (postura bloqueante da fase). Para o caminho de pendência/simulação, use
   * {@link resolverVersaoParaSimulacao}.
   */
  async resolverCodigo(input: ResolverCatalogoInput): Promise<string> {
    const versao = await this.resolverVersaoAprovada(input);
    if (!versao) {
      throw new BadRequestException(
        `Não há versão de catálogo ${input.tipo} aprovada e vigente para a UF ` +
          `${this.normalizarUf(input.uf)} na competência ${input.competencia}. ` +
          'Cadastre e aprove a versão em fiscal_catalogos_versoes antes de usá-la ' +
          'como guia definitiva (R3.5).',
      );
    }
    return versao.codigo;
  }

  /**
   * VIGÊNCIA resolvida (início/fim) da versão vigente na competência.
   * Inclui o estado de aprovação para o chamador distinguir decisão de
   * pendência. Devolve `null` quando não há versão vigente.
   */
  async resolverVigencia(input: ResolverCatalogoInput): Promise<{
    vigenciaInicio: string;
    vigenciaFim: string | null;
    escopoAprovado: boolean;
    pendente: boolean;
  } | null> {
    const versao = await this.resolverVersaoVigente(input);
    if (!versao) return null;
    return {
      vigenciaInicio: versao.vigenciaInicio,
      vigenciaFim: versao.vigenciaFim,
      escopoAprovado: versao.escopoAprovado,
      pendente: versao.pendente,
    };
  }

  /**
   * FONTE normativa resolvida (texto + URL) da versão vigente na competência.
   * Devolve `null` quando não há versão vigente.
   */
  async resolverFonte(input: ResolverCatalogoInput): Promise<{
    fonte: string;
    fonteUrl: string | null;
    hashConteudo: string | null;
    escopoAprovado: boolean;
  } | null> {
    const versao = await this.resolverVersaoVigente(input);
    if (!versao) return null;
    return {
      fonte: versao.fonte,
      fonteUrl: versao.fonteUrl,
      hashConteudo: versao.hashConteudo,
      escopoAprovado: versao.escopoAprovado,
    };
  }

  /**
   * Resolve a REVISÃO DE REGRA vigente na competência, ancorada numa versão de
   * catálogo também vigente na mesma competência.
   *
   * A regra herda a aprovação da versão de catálogo que a ancora: uma revisão
   * só alimenta decisão definitiva quando a versão de catálogo está aprovada.
   * Seleciona a revisão de início de vigência MAIS RECENTE que ainda cobre a
   * competência (nunca "a última revisão"). Devolve `null` quando não há versão
   * de catálogo vigente ou nenhuma revisão vigente para a chave.
   */
  async resolverRegraVigente(
    input: ResolverRegraInput,
  ): Promise<RegraVersaoResolvida | null> {
    const catalogo = await this.resolverVersaoVigente(input);
    if (!catalogo) return null;

    const competencia = catalogo.competencia;
    const rows = await this.database.db
      .select()
      .from(fiscalRegrasVersoes)
      .where(
        and(
          eq(fiscalRegrasVersoes.catalogoVersaoId, catalogo.id),
          eq(fiscalRegrasVersoes.chave, input.chave),
          eq(fiscalRegrasVersoes.ativo, true),
          lte(fiscalRegrasVersoes.vigenciaInicio, competencia),
          or(
            isNull(fiscalRegrasVersoes.vigenciaFim),
            gte(fiscalRegrasVersoes.vigenciaFim, competencia),
          ),
        ),
      )
      .orderBy(desc(fiscalRegrasVersoes.vigenciaInicio))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    return {
      id: row.id,
      catalogoVersaoId: row.catalogoVersaoId,
      chave: row.chave,
      revisao: row.revisao,
      conteudo: row.conteudo ?? {},
      fonte: row.fonte,
      fonteUrl: row.fonteUrl ?? null,
      responsavelPor: row.responsavelPor ?? null,
      vigenciaInicio: row.vigenciaInicio,
      vigenciaFim: row.vigenciaFim ?? null,
      competencia,
      escopoAprovado: catalogo.escopoAprovado,
      pendente: !catalogo.escopoAprovado,
    };
  }

  /**
   * Resolve a revisão de regra para DECISÃO DEFINITIVA (R3.5): exige que a
   * versão de catálogo que a ancora esteja aprovada. Devolve `null` quando a
   * regra vigente é pendente ou inexistente.
   */
  async resolverRegraAprovada(
    input: ResolverRegraInput,
  ): Promise<RegraVersaoResolvida | null> {
    const regra = await this.resolverRegraVigente(input);
    if (!regra || !regra.escopoAprovado) return null;
    return regra;
  }

  // Converte a competência mensal 'YYYY-MM' no primeiro dia do mês
  // ('YYYY-MM-01'), o MESMO valor persistido nas colunas `date` do catálogo.
  // Lança BadRequest para entradas inválidas (coerente com o resto da fase).
  private competenciaDate(competencia: string): string {
    try {
      return parseCompetenciaMensal(competencia).competencia;
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Competência inválida.',
      );
    }
  }

  private normalizarUf(uf: string): string {
    const normalizada = (uf ?? '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(normalizada)) {
      throw new BadRequestException(
        `UF inválida: "${uf}". Esperado uma sigla de 2 letras (ex.: SP).`,
      );
    }
    return normalizada;
  }
}
