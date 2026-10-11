/**
 * NÚCLEO PURO DO INVENTÁRIO DE ROLLOUT (Fase 5, tarefa 5.1 — R5.2).
 *
 * O design (§Rollout §13) exige, ANTES de ativar correções fiscais: "inventário
 * read-only de versões entregues, competências abertas, operações com CIAP/CT-e
 * de saída/créditos vedados/PIS misto. Preservar cópia de arquivos/recibos/
 * decisões." Esta é a PRIMEIRA tarefa do grupo 5 (rollout) e é, por definição,
 * uma PROJEÇÃO ESTRITAMENTE READ-ONLY: ela MONTA e APRESENTA um retrato do que
 * já existe no banco antes de qualquer ativação — não escreve nada, não migra
 * nada, não decide ativar nada (os critérios de "homologado" são a tarefa 5.2).
 *
 * Este módulo é um RESOLVER PURO (espelha `montarMatrizOnboarding`/`projetarLivros`):
 * recebe os fatos já carregados do banco pelo serviço que o orquestra e apenas
 * CLASSIFICA/APRESENTA. Isso deixa a derivação testável sem banco, determinística
 * (mesmos fatos → mesmo inventário) e com a mesma postura das demais projeções
 * da fase. Toda a leitura do banco acontece no serviço (`RolloutInventarioService`),
 * sempre com `select` — nunca `insert`/`update`/`delete` (read-only — R5.2).
 *
 * O inventário tem três eixos, exatamente os do design:
 *  1. VERSÕES ENTREGUES — o que já foi transmitido/entregue (`fiscal_entregas`),
 *     por competência/obrigação, com a trilha de retificação preservada.
 *  2. COMPETÊNCIAS ABERTAS — fechamentos (`fiscal_fechamentos`) de uma
 *     competência/obrigação que ainda NÃO têm versão corrente FECHADA; são as
 *     competências que uma ativação de correção ainda pode mudar.
 *  3. OPERAÇÕES AFETADAS — operações sensíveis a correções: CIAP (bens ativos,
 *     crédito vedado, saneamento pendente), CT-e de SAÍDA escriturado, créditos
 *     de ICMS VEDADOS por decisão de item e operações de PIS/COFINS MISTO
 *     (tributado + monofásico/ST/alíquota zero na mesma base).
 */

/**
 * Obrigação acessória (mesmo domínio restrito dos CHECK de `fiscal_fechamentos`
 * e `fiscal_entregas`). Mantida como string frouxa na entrada (espelha a coluna)
 * e apresentada tal como gravada.
 */
export type ObrigacaoInventario = string;

/**
 * Uma ENTREGA já registrada (`fiscal_entregas`), carregada como fato. Decimais
 * (quando houver, em `valorDiferenca`) chegam como string — nunca `Number`.
 */
export interface EntregaFato {
  id: string;
  obrigacao: string;
  competencia: string; // 'YYYY-MM' (já normalizada pelo serviço)
  statusValidacao: string;
  /** `true` quando esta entrega retifica outra (tem `entregaOriginalId`). */
  ehRetificacao: boolean;
  /** Protocolo/recibo da transmissão, quando houver (apresentação). */
  protocoloNumero: string | null;
  /** Momento da transmissão, quando houver (ISO), para a ordenação/retrato. */
  transmitidaEm: string | null;
}

/**
 * Um FECHAMENTO (`fiscal_fechamentos`) carregado como fato. `corrente` e
 * `estado` decidem se a competência está ABERTA (sem versão corrente fechada).
 */
export interface FechamentoFato {
  obrigacao: string;
  competencia: string; // 'YYYY-MM'
  versao: number;
  estado: string; // RASCUNHO | PENDENTE | REVISADO | FECHADO
  corrente: boolean;
}

/**
 * Sinais JÁ AGREGADOS (no SQL, sem N+1) das operações sensíveis a correção.
 * Todos são CONTAGENS/presença — o inventário é um retrato quantitativo, nunca
 * aritmética monetária.
 */
export interface OperacoesFatos {
  /** Bens de CIAP com status ATIVO (crédito 1/48 em curso). */
  ciapBensAtivos: number;
  /** Bens de CIAP marcados para saneamento assistido (R5.4) — não reconstruir. */
  ciapSaneamentoPendente: number;
  /** Apropriações de CIAP com parcela VEDADA > 0 (crédito parcialmente negado). */
  ciapApropriacoesComParcelaVedada: number;
  /** CT-e escriturado como operação de SAÍDA (prestação do próprio contribuinte). */
  cteSaidaEscriturado: number;
  /** Decisões de item com crédito de ICMS VEDADO (`decisao = 'VEDADO'`). */
  creditosIcmsVedados: number;
  /**
   * Itens de PIS/COFINS TRIBUTADOS (CST 01/02) e itens SEM DÉBITO
   * (monofásico/ST/alíquota zero/isenta/sem incidência/suspensão — CST
   * 04..09). A operação é MISTA quando AMBOS existem no mesmo escopo.
   */
  pisItensTributados: number;
  pisItensSemDebito: number;
}

/**
 * Fatos do inventário de rollout JÁ CARREGADOS do banco (read-only) pelo
 * serviço. Contrato de entrada do núcleo puro: nenhuma consulta aqui.
 */
export interface RolloutInventarioFatos {
  clienteId: string;
  /** Momento do retrato (ISO), para registrar quando o inventário foi tirado. */
  geradoEm: string;
  entregas: EntregaFato[];
  fechamentos: FechamentoFato[];
  operacoes: OperacoesFatos;
}

/** Versão entregue de uma competência/obrigação (eixo 1 do inventário). */
export interface VersaoEntregue {
  obrigacao: string;
  competencia: string;
  /** Número de entregas (originais + retificadoras) daquela competência. */
  totalEntregas: number;
  /** Quantas das entregas são retificações (trilha preservada). */
  retificacoes: number;
  /** Status da entrega mais recente da competência (retrato do estado atual). */
  statusMaisRecente: string;
  /** `true` quando ao menos uma entrega da competência foi transmitida. */
  transmitida: boolean;
}

/** Competência AINDA ABERTA (eixo 2 do inventário). */
export interface CompetenciaAberta {
  obrigacao: string;
  competencia: string;
  /** Maior número de versão de fechamento existente na competência. */
  ultimaVersao: number;
  /** Estado da última versão (RASCUNHO/PENDENTE/REVISADO). */
  estadoUltimaVersao: string;
  /** Motivo pelo qual é considerada aberta (apresentação auditável). */
  motivo: string;
}

/** Eixo das operações afetadas (eixo 3), com presença e contagem por tipo. */
export interface OperacaoAfetada {
  tipo:
    | 'CIAP'
    | 'CTE_SAIDA'
    | 'CREDITO_VEDADO'
    | 'PIS_MISTO';
  /** `true` quando há ao menos uma ocorrência do tipo no escopo. */
  presente: boolean;
  /** Quantidade representativa da operação (contagem). */
  quantidade: number;
  /** Memória textual auditável do que foi contado e por que importa. */
  memoria: string;
}

/**
 * O INVENTÁRIO DE ROLLOUT montado (R5.2). Projeção read-only, apresentável
 * diretamente antes de ativar correções: versões entregues, competências
 * abertas e operações afetadas. É um RETRATO — não altera nada no banco.
 */
export interface RolloutInventario {
  clienteId: string;
  geradoEm: string;
  versoesEntregues: VersaoEntregue[];
  competenciasAbertas: CompetenciaAberta[];
  operacoesAfetadas: OperacaoAfetada[];
  resumo: {
    totalVersoesEntregues: number;
    totalCompetenciasAbertas: number;
    /** Quantos TIPOS de operação afetada estão presentes (0..4). */
    tiposOperacaoAfetadaPresentes: number;
  };
}

/**
 * MONTA o inventário de rollout a partir dos fatos carregados (tarefa 5.1 —
 * R5.2). Puro e determinístico: os mesmos fatos sempre produzem o mesmo
 * inventário. APENAS classifica/agrega — não escreve nem decide ativação.
 */
export function montarInventarioRollout(
  fatos: RolloutInventarioFatos,
): RolloutInventario {
  const versoesEntregues = montarVersoesEntregues(fatos.entregas);
  const competenciasAbertas = montarCompetenciasAbertas(fatos.fechamentos);
  const operacoesAfetadas = montarOperacoesAfetadas(fatos.operacoes);

  return {
    clienteId: fatos.clienteId,
    geradoEm: fatos.geradoEm,
    versoesEntregues,
    competenciasAbertas,
    operacoesAfetadas,
    resumo: {
      totalVersoesEntregues: versoesEntregues.length,
      totalCompetenciasAbertas: competenciasAbertas.length,
      tiposOperacaoAfetadaPresentes: operacoesAfetadas.filter((o) => o.presente)
        .length,
    },
  };
}

/**
 * EIXO 1 — versões entregues. Agrupa as entregas por (obrigação, competência):
 * conta o total, as retificações e resume o estado da entrega mais recente
 * (pela transmissão quando houver, senão estável por status). A trilha
 * original → retificações é preservada na contagem (nunca descartada).
 */
function montarVersoesEntregues(entregas: EntregaFato[]): VersaoEntregue[] {
  const grupos = new Map<string, EntregaFato[]>();
  for (const entrega of entregas) {
    const chave = `${entrega.obrigacao}|${entrega.competencia}`;
    const lista = grupos.get(chave);
    if (lista) lista.push(entrega);
    else grupos.set(chave, [entrega]);
  }

  const versoes: VersaoEntregue[] = [];
  for (const lista of grupos.values()) {
    const retificacoes = lista.filter((e) => e.ehRetificacao).length;
    const maisRecente = escolherEntregaMaisRecente(lista);
    const transmitida = lista.some(
      (e) => e.transmitidaEm != null || e.statusValidacao === 'TRANSMITIDA',
    );
    versoes.push({
      obrigacao: maisRecente.obrigacao,
      competencia: maisRecente.competencia,
      totalEntregas: lista.length,
      retificacoes,
      statusMaisRecente: maisRecente.statusValidacao,
      transmitida,
    });
  }

  return versoes.sort(ordenarPorObrigacaoCompetencia);
}

/**
 * Entrega "mais recente" de um grupo: a de maior `transmitidaEm` quando há
 * transmissão; na ausência de datas, mantém-se estável e determinístico
 * preferindo a retificação (que supera a original) e, por fim, o id.
 */
function escolherEntregaMaisRecente(lista: EntregaFato[]): EntregaFato {
  return [...lista].sort((a, b) => {
    const ta = a.transmitidaEm ?? '';
    const tb = b.transmitidaEm ?? '';
    if (ta !== tb) return ta < tb ? 1 : -1; // mais recente primeiro
    if (a.ehRetificacao !== b.ehRetificacao) return a.ehRetificacao ? -1 : 1;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  })[0];
}

/**
 * EIXO 2 — competências abertas. Uma competência/obrigação está ABERTA quando
 * NENHUMA de suas versões de fechamento é a versão CORRENTE FECHADA. Com os
 * fechamentos agrupados por escopo, se existe uma versão `corrente === true`
 * (que o schema só permite quando `estado === 'FECHADO'`), a competência está
 * fechada e sai do inventário; caso contrário, ela é aberta e reportamos a
 * última versão e o seu estado.
 */
function montarCompetenciasAbertas(
  fechamentos: FechamentoFato[],
): CompetenciaAberta[] {
  const grupos = new Map<string, FechamentoFato[]>();
  for (const fechamento of fechamentos) {
    const chave = `${fechamento.obrigacao}|${fechamento.competencia}`;
    const lista = grupos.get(chave);
    if (lista) lista.push(fechamento);
    else grupos.set(chave, [fechamento]);
  }

  const abertas: CompetenciaAberta[] = [];
  for (const lista of grupos.values()) {
    const temCorrenteFechada = lista.some(
      (f) => f.corrente && f.estado === 'FECHADO',
    );
    if (temCorrenteFechada) continue; // competência fechada: não é aberta

    const ultima = [...lista].sort((a, b) => b.versao - a.versao)[0];
    abertas.push({
      obrigacao: ultima.obrigacao,
      competencia: ultima.competencia,
      ultimaVersao: ultima.versao,
      estadoUltimaVersao: ultima.estado,
      motivo:
        'Sem versão corrente fechada: a competência ainda pode ser alterada ' +
        `por uma ativação de correção (última versão ${ultima.versao}, estado ` +
        `${ultima.estado}).`,
    });
  }

  return abertas.sort(ordenarPorObrigacaoCompetencia);
}

/**
 * EIXO 3 — operações afetadas. Converte os sinais agregados em quatro linhas
 * (CIAP, CT-e de saída, créditos vedados, PIS misto), cada uma com presença,
 * contagem e memória. PIS é MISTO somente quando há tributado E sem débito no
 * mesmo escopo (a presença de só um lado não é "misto").
 */
function montarOperacoesAfetadas(op: OperacoesFatos): OperacaoAfetada[] {
  const ciapQuantidade =
    op.ciapBensAtivos +
    op.ciapSaneamentoPendente +
    op.ciapApropriacoesComParcelaVedada;
  const ciap: OperacaoAfetada = {
    tipo: 'CIAP',
    presente: ciapQuantidade > 0,
    quantidade: ciapQuantidade,
    memoria:
      ciapQuantidade > 0
        ? `CIAP sensível a correção: ${op.ciapBensAtivos} bem(ns) ATIVO(s), ` +
          `${op.ciapApropriacoesComParcelaVedada} apropriação(ões) com parcela ` +
          `vedada e ${op.ciapSaneamentoPendente} ficha(s) em saneamento ` +
          'assistido (R5.4 — não reconstruir por contador). Preserve as fichas ' +
          'e decisões antes de ativar.'
        : 'Sem operações de CIAP sensíveis (nenhum bem ativo, parcela vedada ou ' +
          'saneamento pendente).',
  };

  const cteSaida: OperacaoAfetada = {
    tipo: 'CTE_SAIDA',
    presente: op.cteSaidaEscriturado > 0,
    quantidade: op.cteSaidaEscriturado,
    memoria:
      op.cteSaidaEscriturado > 0
        ? `${op.cteSaidaEscriturado} CT-e escriturado(s) como operação de SAÍDA ` +
          '(prestação do próprio contribuinte): sensível a correção de ICMS/' +
          'escrituração. Preserve os documentos antes de ativar.'
        : 'Sem CT-e de saída escriturado.',
  };

  const creditoVedado: OperacaoAfetada = {
    tipo: 'CREDITO_VEDADO',
    presente: op.creditosIcmsVedados > 0,
    quantidade: op.creditosIcmsVedados,
    memoria:
      op.creditosIcmsVedados > 0
        ? `${op.creditosIcmsVedados} decisão(ões) de item com crédito de ICMS ` +
          'VEDADO: uma ativação de correção pode reavaliar a admissão. Preserve ' +
          'as decisões antes de ativar.'
        : 'Sem créditos de ICMS vedados por decisão de item.',
  };

  const pisMistoPresente =
    op.pisItensTributados > 0 && op.pisItensSemDebito > 0;
  const pisMisto: OperacaoAfetada = {
    tipo: 'PIS_MISTO',
    // A contagem representativa é a soma dos dois lados quando é misto; 0 quando
    // não é misto (presença de um só lado não caracteriza operação mista).
    presente: pisMistoPresente,
    quantidade: pisMistoPresente
      ? op.pisItensTributados + op.pisItensSemDebito
      : 0,
    memoria: pisMistoPresente
      ? `PIS/COFINS MISTO: ${op.pisItensTributados} item(ns) tributado(s) e ` +
        `${op.pisItensSemDebito} sem débito (monofásico/ST/alíquota zero) no ` +
        'mesmo escopo. A segregação é sensível a correção. Preserve a apuração ' +
        'antes de ativar.'
      : 'Operação de PIS/COFINS não é mista (não há tributado e sem débito ' +
        'simultaneamente no escopo).',
  };

  // Ordem estável e previsível dos eixos.
  return [ciap, cteSaida, creditoVedado, pisMisto];
}

/** Ordenação estável por obrigação e depois competência (apresentação). */
function ordenarPorObrigacaoCompetencia(
  a: { obrigacao: string; competencia: string },
  b: { obrigacao: string; competencia: string },
): number {
  const o = a.obrigacao.localeCompare(b.obrigacao);
  return o !== 0 ? o : a.competencia.localeCompare(b.competencia);
}
