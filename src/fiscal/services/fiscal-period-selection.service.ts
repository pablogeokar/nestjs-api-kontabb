import { BadRequestException, Injectable } from '@nestjs/common';
import {
  and,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { documentosFiscais, eventosFiscais } from '../../database/schema';
import {
  parseCompetenciaMensal,
  type CompetenciaRange,
} from '../fiscal-date.util';

/**
 * Política única de seleção de período (F14 / plano §6.2).
 *
 * Centraliza, numa só fonte, as regras de quais documentos entram numa
 * apuração/livro para uma competência — hoje espalhadas e divergentes entre
 * livros/CIAP/DIFAL/PIS (filtram `dataEmissao` em UTC) e SPED (usa
 * `dataEmissaoFiscal`), além de filtros de `escriturado`/integridade que não
 * coincidem.
 *
 * O serviço é PURO em relação ao banco: produz predicados SQL (Drizzle) e a
 * descrição do universo excluído, sem executar consultas. Quem consulta (SPED,
 * livros) aplica o `where` e, com o mesmo serviço, deriva o relatório de
 * exclusões a partir das linhas lidas — garantindo que a seleção e a sua
 * justificativa venham da MESMA política (R3.1).
 */

/**
 * Finalidade tributária da seleção. Determina qual data fiscal define a
 * competência do documento — NÃO se copia cegamente uma única data para todos
 * os tributos (R3.5). A distinção emissão × entrada/saída × escrituração ×
 * evento é a base da política (R3.1/R3.2).
 */
export type FinalidadeSelecao =
  // ICMS/IPI próprios e livros de saída: competência pela data de emissão
  // fiscal (fuso local), caindo para o timestamp de emissão quando a data
  // fiscal não foi derivada.
  | 'EMISSAO'
  // Créditos de entrada (livro de entradas, DIFAL de entrada, CIAP): a
  // competência é a da entrada efetiva da mercadoria, com fallback para a
  // emissão quando a entrada não foi informada.
  | 'ENTRADA_SAIDA'
  // Escrituração extemporânea: a competência é o período em que o documento foi
  // efetivamente escriturado, não a sua emissão. NÃO existe hoje uma coluna
  // dedicada de data de escrituração em `documentosFiscais` (ver nota em
  // `buildPredicadoPeriodo`): a política é explícita quanto a isso e NÃO copia a
  // emissão como se fosse a escrituração — ela recorta pela entrada efetiva da
  // mercadoria (a aproximação temporal disponível para o lançamento), caindo
  // para a emissão apenas quando nem a entrada foi informada.
  | 'ESCRITURACAO'
  // Eventos tardios (cancelamento, correção) que recaem sobre a competência do
  // evento, não a do documento original. A data do evento vive em outra tabela
  // (`eventosFiscais.dataEvento`), de modo que o recorte NÃO é um predicado puro
  // sobre `documentosFiscais`: a seleção por evento é exposta por
  // `predicadoEvento`/`predicadoDocumentosComEvento` (estratégia explícita),
  // nunca reusando silenciosamente a data de emissão do documento (R3.2/R3.5).
  | 'EVENTO';

/** Tipo de data fiscal usada por uma finalidade. */
export type TipoDataFiscal =
  'DATA_EMISSAO' | 'DATA_ENTRADA_SAIDA' | 'DATA_ESCRITURACAO' | 'DATA_EVENTO';

export interface FiscalPeriodSelectionInput {
  /** Cliente/estabelecimento cujos documentos serão selecionados. */
  clienteId: string;
  /** Competência mensal explícita no formato 'AAAA-MM'. */
  competencia: string;
  /** Finalidade tributária — define a data fiscal da competência (R3.5). */
  finalidade: FinalidadeSelecao;
  /**
   * Quando `true`, a seleção é para apuração/entrega DEFINITIVA: exclui
   * documentos pendentes (escriturados sem os controles de revisão/integridade
   * concluídos), que não podem compor um fechamento (R3.3). Quando `false`
   * (visões auxiliares/parciais), os pendentes permanecem visíveis.
   */
  definitiva: boolean;
}

/** Período fiscal explícito resolvido para uma seleção. */
export interface FiscalPeriodo {
  /** Competência normalizada 'AAAA-MM'. */
  competencia: string;
  /** Primeiro dia do mês 'AAAA-MM-01' (colunas `date` do SPED). */
  competenciaDate: string;
  /** Último dia do mês 'AAAA-MM-DD' (colunas `date` do SPED). */
  competenciaFimDate: string;
  /** Limite inicial do mês (timestamp UTC) para colunas `timestamp`. */
  inicio: Date;
  /** Limite final do mês (timestamp UTC) para colunas `timestamp`. */
  fim: Date;
  /** Finalidade da seleção. */
  finalidade: FinalidadeSelecao;
  /** Data fiscal que define a competência para esta finalidade. */
  tipoData: TipoDataFiscal;
}

/** Resultado da aplicação da política: predicado + metadados do período. */
export interface FiscalPeriodSelection {
  periodo: FiscalPeriodo;
  /**
   * Predicado completo (cliente + período por data fiscal + situação +
   * elegibilidade) pronto para o `where` da consulta de documentos.
   */
  where: SQL;
  /** Apenas o recorte de período por data fiscal (sem cliente/situação). */
  predicadoPeriodo: SQL;
}

/** Motivo pelo qual um documento foi excluído da seleção definitiva. */
export type MotivoExclusao =
  | 'SITUACAO_NAO_AUTORIZADA'
  | 'NAO_ESCRITURADO'
  | 'PENDENTE_REVISAO'
  | 'INTEGRIDADE_NAO_CONFERIDA';

/**
 * Projeção mínima de um documento necessária para classificar exclusões.
 * Corresponde a colunas de `documentosFiscais`.
 */
export interface DocumentoElegibilidade {
  situacao: string;
  escriturado: boolean;
  escrituracaoStatus: string;
  integridadeStatus: string;
  valorTotal: string;
}

/** Universo excluído, agregado por motivo e no total (R3.4). */
export interface RelatorioExclusao {
  /** Quantidade total de documentos excluídos. */
  quantidade: number;
  /** Soma dos valores (string decimal 2 casas) dos documentos excluídos. */
  valor: string;
  /** Detalhamento por motivo. */
  porMotivo: Array<{
    motivo: MotivoExclusao;
    quantidade: number;
    valor: string;
  }>;
}

const SITUACAO_ELEGIVEL = 'AUTORIZADA';
const ESCRITURACAO_ELEGIVEL = 'ESCRITURADO';
/**
 * Status de integridade que admitem um documento numa apuração DEFINITIVA.
 *
 * O domínio REAL de `integridade_status` é fixado pelo CHECK
 * `chk_docs_fiscais_integridade_status` do schema:
 * `'NAO_CONFERIDA' | 'OK' | 'DIVERGENTE'`. Não existe o valor `'CONFERIDA'` que
 * a implementação anterior admitia — o filtro nunca casaria com ele e, pior,
 * sugeria um estado inexistente. Reconciliado com o schema, apenas `'OK'`
 * (conferido e sem divergência) é elegível: `NAO_CONFERIDA` ainda não passou
 * pela conferência e `DIVERGENTE` reprovou nela — ambos ficam fora do
 * fechamento definitivo (R3.3).
 */
const INTEGRIDADE_ELEGIVEL = new Set(['OK']);

/** Mapeia cada finalidade à data fiscal que define a competência (R3.5). */
const DATA_POR_FINALIDADE: Record<FinalidadeSelecao, TipoDataFiscal> = {
  EMISSAO: 'DATA_EMISSAO',
  ENTRADA_SAIDA: 'DATA_ENTRADA_SAIDA',
  ESCRITURACAO: 'DATA_ESCRITURACAO',
  EVENTO: 'DATA_EVENTO',
};

@Injectable()
export class FiscalPeriodSelectionService {
  /**
   * Resolve a política de seleção para um cliente/competência/finalidade.
   * O período é SEMPRE explícito: a competência mensal é validada e expandida
   * via `parseCompetenciaMensal` (reaproveito de `fiscal-date.util.ts`), de modo
   * que livros e SPED usem exatamente o mesmo recorte.
   */
  resolve(input: FiscalPeriodSelectionInput): FiscalPeriodSelection {
    const periodo = this.resolvePeriodo(input.competencia, input.finalidade);
    const predicadoPeriodo = this.buildPredicadoPeriodo(periodo);

    const conditions: SQL[] = [
      eq(documentosFiscais.clienteId, input.clienteId),
      predicadoPeriodo,
    ];
    if (input.definitiva) {
      conditions.push(this.predicadoElegibilidade());
    }

    return {
      periodo,
      predicadoPeriodo,
      where: and(...conditions) as SQL,
    };
  }

  /**
   * Normaliza e expande a competência mensal explícita (R3 — período fiscal
   * explícito). Converte o erro de formato de `fiscal-date.util.ts` num
   * `BadRequestException`, como as demais rotas fiscais.
   */
  resolvePeriodo(
    competencia: string,
    finalidade: FinalidadeSelecao,
  ): FiscalPeriodo {
    let range: CompetenciaRange;
    try {
      range = parseCompetenciaMensal(competencia);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Competência inválida.',
      );
    }
    const competenciaFimDate = this.formatDate(range.fim);
    return {
      competencia: competencia,
      competenciaDate: range.competencia,
      competenciaFimDate,
      inicio: range.inicio,
      fim: range.fim,
      finalidade,
      tipoData: DATA_POR_FINALIDADE[finalidade],
    };
  }

  /**
   * Predicado de recorte por data fiscal apropriada à finalidade (R3.1/R3.2).
   * Para as finalidades que têm par (data fiscal `date` + timestamp bruto),
   * prioriza a coluna fiscal (fuso local já aplicado na importação) e cai para o
   * timestamp quando a data fiscal não foi derivada — espelhando a seleção do
   * builder SPED, agora numa única fonte.
   */
  private buildPredicadoPeriodo(periodo: FiscalPeriodo): SQL {
    switch (periodo.tipoData) {
      case 'DATA_EMISSAO':
        return this.predicadoDataComFallback(
          documentosFiscais.dataEmissaoFiscal,
          documentosFiscais.dataEmissao,
          periodo,
        );
      case 'DATA_ENTRADA_SAIDA':
        // Entrada/saída pode não estar informada: cai para a emissão fiscal e,
        // por fim, para o timestamp de emissão, nunca copiando cegamente (R3.5).
        return this.buildPredicadoEntradaSaida(periodo);
      case 'DATA_ESCRITURACAO':
        // Escrituração extemporânea: `documentosFiscais` NÃO tem uma coluna de
        // data de escrituração (só emissão e entrada/saída, cada uma com par
        // `timestamp`+`date` fiscal; ver tabela no schema). A decisão explícita
        // (R3.2/R3.5) é NÃO copiar a emissão como se fosse a escrituração: para
        // o lançamento de uma entrada escriturada fora do prazo, a melhor
        // aproximação temporal disponível é a ENTRADA efetiva da mercadoria,
        // caindo para a emissão apenas quando a entrada não foi informada —
        // exatamente o mesmo recorte da finalidade de entrada/saída, mas
        // nomeado como escrituração para que o chamador saiba o que está
        // selecionando. Uma coluna dedicada de data de escrituração é uma
        // mudança de schema futura; quando existir, basta trocar este ramo.
        return this.buildPredicadoEntradaSaida(periodo);
      case 'DATA_EVENTO':
        // A data do evento está em `eventosFiscais`, não em `documentosFiscais`:
        // um recorte por evento não é expressável como predicado puro sobre a
        // tabela de documentos. Em vez de reusar silenciosamente a emissão
        // (bug que a 2.2 corrige), a finalidade EVENTO é atendida pelos métodos
        // dedicados `predicadoEvento`/`predicadoDocumentosComEvento`. Chamar o
        // caminho de predicado puro com EVENTO é um erro de uso.
        throw new BadRequestException(
          'Finalidade EVENTO não produz um predicado puro sobre documentos_fiscais: ' +
            'use predicadoEvento()/predicadoDocumentosComEvento() (a data vive em eventos_fiscais).',
        );
    }
  }

  /**
   * Recorte por entrada/saída com fallback para a emissão. Extraído para ser
   * reusado tanto por ENTRADA_SAIDA quanto por ESCRITURACAO (que, na ausência de
   * uma coluna de data de escrituração, usa a entrada efetiva como aproximação
   * explícita — ver `buildPredicadoPeriodo`).
   */
  private buildPredicadoEntradaSaida(periodo: FiscalPeriodo): SQL {
    return or(
      this.predicadoColunaData(
        documentosFiscais.dataEntradaSaidaFiscal,
        periodo,
      ),
      and(
        isNull(documentosFiscais.dataEntradaSaidaFiscal),
        this.predicadoDataComFallback(
          documentosFiscais.dataEmissaoFiscal,
          documentosFiscais.dataEmissao,
          periodo,
        ),
      ),
    ) as SQL;
  }

  /**
   * Recorte com fallback: usa a coluna `date` fiscal quando presente, senão o
   * timestamp bruto. As duas pernas são mutuamente exclusivas (presença/ausência
   * da data fiscal) para não contar o documento duas vezes.
   */
  private predicadoDataComFallback(
    colunaFiscal: typeof documentosFiscais.dataEmissaoFiscal,
    colunaTimestamp: typeof documentosFiscais.dataEmissao,
    periodo: FiscalPeriodo,
  ): SQL {
    return or(
      and(
        sql`${colunaFiscal} IS NOT NULL`,
        gte(colunaFiscal, periodo.competenciaDate),
        lte(colunaFiscal, periodo.competenciaFimDate),
      ),
      and(
        isNull(colunaFiscal),
        gte(colunaTimestamp, periodo.inicio),
        lte(colunaTimestamp, periodo.fim),
      ),
    ) as SQL;
  }

  /** Recorte simples por uma coluna `date` fiscal. */
  private predicadoColunaData(
    coluna: typeof documentosFiscais.dataEntradaSaidaFiscal,
    periodo: FiscalPeriodo,
  ): SQL {
    return and(
      sql`${coluna} IS NOT NULL`,
      gte(coluna, periodo.competenciaDate),
      lte(coluna, periodo.competenciaFimDate),
    ) as SQL;
  }

  /**
   * Elegibilidade para apuração DEFINITIVA (R3.3): só entram documentos
   * autorizados, escriturados, com a escrituração concluída (sem revisão
   * pendente) e com a integridade conferida. Um `escriturado=true` sem esses
   * controles permanece FORA do fechamento.
   */
  private predicadoElegibilidade(): SQL {
    return and(
      eq(documentosFiscais.situacao, SITUACAO_ELEGIVEL),
      eq(documentosFiscais.escriturado, true),
      eq(documentosFiscais.escrituracaoStatus, ESCRITURACAO_ELEGIVEL),
      inArray(
        documentosFiscais.integridadeStatus,
        Array.from(INTEGRIDADE_ELEGIVEL),
      ),
    ) as SQL;
  }

  /**
   * Classifica o motivo pelo qual um documento (já dentro do período) seria
   * excluído de uma seleção DEFINITIVA, ou `null` se é elegível. A ordem de
   * precedência vai do bloqueio mais forte (situação) ao mais específico
   * (integridade), para que cada documento tenha um único motivo determinístico.
   */
  classificarExclusao(doc: DocumentoElegibilidade): MotivoExclusao | null {
    if (doc.situacao !== SITUACAO_ELEGIVEL) return 'SITUACAO_NAO_AUTORIZADA';
    if (!doc.escriturado) return 'NAO_ESCRITURADO';
    if (doc.escrituracaoStatus !== ESCRITURACAO_ELEGIVEL)
      return 'PENDENTE_REVISAO';
    if (!INTEGRIDADE_ELEGIVEL.has(doc.integridadeStatus))
      return 'INTEGRIDADE_NAO_CONFERIDA';
    return null;
  }

  /**
   * Reporta o universo excluído de uma seleção definitiva: quantidade e valor
   * totais e por motivo (R3.4). Recebe o conjunto de documentos JÁ recortados
   * pelo período (ignora quem está fora do período, que não é "excluído" e sim
   * de outra competência).
   */
  reportExclusoes(
    documentos: readonly DocumentoElegibilidade[],
  ): RelatorioExclusao {
    const buckets = new Map<
      MotivoExclusao,
      { quantidade: number; valor: bigint }
    >();
    let total = 0;
    let totalValor = 0n;
    for (const doc of documentos) {
      const motivo = this.classificarExclusao(doc);
      if (!motivo) continue;
      const valor = this.toCentavos(doc.valorTotal);
      const bucket = buckets.get(motivo) ?? { quantidade: 0, valor: 0n };
      bucket.quantidade += 1;
      bucket.valor += valor;
      buckets.set(motivo, bucket);
      total += 1;
      totalValor += valor;
    }
    return {
      quantidade: total,
      valor: this.fromCentavos(totalValor),
      porMotivo: Array.from(buckets.entries())
        .map(([motivo, b]) => ({
          motivo,
          quantidade: b.quantidade,
          valor: this.fromCentavos(b.valor),
        }))
        .sort((a, b) => a.motivo.localeCompare(b.motivo)),
    };
  }

  /** Predicado que isola apenas documentos DENTRO do período (sem cliente). */
  predicadoPeriodo(
    competencia: string,
    finalidade: FinalidadeSelecao,
  ): { periodo: FiscalPeriodo; where: SQL } {
    const periodo = this.resolvePeriodo(competencia, finalidade);
    return { periodo, where: this.buildPredicadoPeriodo(periodo) };
  }

  /**
   * Estratégia explícita da finalidade EVENTO (R3.2/R3.5).
   *
   * A competência de um evento tardio (cancelamento, correção) é a data do
   * EVENTO, que reside em `eventosFiscais.dataEvento` — não em
   * `documentosFiscais`. Como `dataEvento` é um `timestamp`, o recorte usa os
   * limites de mês em UTC derivados pela MESMA `fiscal-date.util.ts`
   * (`inicio`/`fim`), sem reimplementar lógica de fuso. Opcionalmente filtra por
   * um conjunto de tipos de evento (ex.: só `CANCELAMENTO`), seguindo o domínio
   * do CHECK `chk_eventos_fiscais_tipo`.
   *
   * Retorna um predicado sobre `eventosFiscais` — o chamador consulta essa
   * tabela (ou a usa num `EXISTS`/join com documentos). Nunca cai para a emissão
   * do documento: a finalidade EVENTO é, por construção, sobre a tabela de
   * eventos.
   */
  predicadoEvento(
    competencia: string,
    opts: { tiposEvento?: readonly string[] } = {},
  ): { periodo: FiscalPeriodo; where: SQL } {
    const periodo = this.resolvePeriodo(competencia, 'EVENTO');
    const conditions: SQL[] = [
      gte(eventosFiscais.dataEvento, periodo.inicio),
      lte(eventosFiscais.dataEvento, periodo.fim),
    ];
    if (opts.tiposEvento && opts.tiposEvento.length > 0) {
      conditions.push(
        inArray(eventosFiscais.tipoEvento, Array.from(opts.tiposEvento)),
      );
    }
    return { periodo, where: and(...conditions) as SQL };
  }

  /**
   * Predicado sobre `documentosFiscais` que seleciona os documentos que
   * SOFRERAM um evento na competência (via `EXISTS` correlacionado em
   * `eventosFiscais`). Materializa a seleção por evento no espaço de documentos
   * sem copiar a data de emissão: o recorte temporal continua sendo o do evento.
   */
  predicadoDocumentosComEvento(
    competencia: string,
    opts: { tiposEvento?: readonly string[] } = {},
  ): { periodo: FiscalPeriodo; where: SQL } {
    const { periodo, where } = this.predicadoEvento(competencia, opts);
    const exists = sql`EXISTS (SELECT 1 FROM ${eventosFiscais} WHERE ${eventosFiscais.documentoFiscalId} = ${documentosFiscais.id} AND ${where})`;
    return { periodo, where: exists };
  }

  /**
   * Converte um decimal de 2 casas (string) em centavos inteiros, sem usar
   * `Number` para o valor monetário (a restrição da fase: o browser formata, a
   * API não recalcula com ponto flutuante). Lança erro para valores inválidos.
   */
  private toCentavos(valor: string): bigint {
    const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(valor.trim());
    if (!match) {
      throw new BadRequestException(`Valor monetário inválido: "${valor}".`);
    }
    const sinal = match[1] === '-' ? -1n : 1n;
    const inteiros = BigInt(match[2]);
    const centavosFrac = BigInt((match[3] ?? '').padEnd(2, '0'));
    return sinal * (inteiros * 100n + centavosFrac);
  }

  /** Formata centavos inteiros de volta para decimal de 2 casas. */
  private fromCentavos(centavos: bigint): string {
    const negativo = centavos < 0n;
    const abs = negativo ? -centavos : centavos;
    const inteiros = abs / 100n;
    const resto = abs % 100n;
    return `${negativo ? '-' : ''}${inteiros}.${resto.toString().padStart(2, '0')}`;
  }

  /** Formata um Date (UTC) como 'AAAA-MM-DD' para comparar com colunas `date`. */
  private formatDate(date: Date): string {
    const ano = date.getUTCFullYear();
    const mes = String(date.getUTCMonth() + 1).padStart(2, '0');
    const dia = String(date.getUTCDate()).padStart(2, '0');
    return `${ano}-${mes}-${dia}`;
  }
}
