/**
 * NÚCLEO PURO DAS MÉTRICAS DE ROLLOUT (§13.3) (Fase 5, tarefa 5.5 — R5.5).
 *
 * O design (§Rollout §13) exige que as métricas de §13.3 estejam
 * instrumentadas: "diferença por tributo, créditos com/sem fundamento,
 * pendências, repetições bloqueadas, rejeições PVA, guias sem vínculo,
 * mudanças pós-fechamento, tempo/consultas por documento (atenção a N+1 e
 * caches por versão)." R5.5 repete a lista literal. Esta é a QUINTA e ÚLTIMA
 * tarefa de implementação do grupo 5 (rollout) e segue EXATAMENTE o mesmo
 * padrão de RESOLVER PURO das anteriores (`rollout-inventario.ts`,
 * `rollout-homologacao.ts`, `retificacao-decisao-fiscal.ts`,
 * `ciap-saneamento.ts`): determinístico, testável sem banco, que apenas
 * CLASSIFICA e APRESENTA fatos JÁ AGREGADOS — nunca escreve, nunca migra,
 * nunca consulta o banco.
 *
 * POSTURA READ-ONLY: as métricas são um RETRATO quantitativo do estado atual,
 * tirado antes/durante o rollout. O serviço que orquestra este núcleo
 * (`RolloutMetricasService`) carrega os fatos SEMPRE com `select` e agrega no
 * SQL (sem N+1, atento aos caches por versão como o design pede); aqui só
 * MONTAMOS o objeto de métricas sobre os números já computados.
 *
 * VALORES MONETÁRIOS: as somas de diferença chegam como string decimal (nunca
 * `Number`) e são combinadas por aritmética inteira de centavos
 * (`somarCentavos`), preservando a convenção monetária da fase. As demais
 * métricas são CONTAGENS inteiras.
 *
 * As OITO métricas, na ordem literal do design/§13.3:
 *  1. diferença por tributo        → `diferencaPorTributo`
 *  2. créditos com/sem fundamento  → `creditos`
 *  3. pendências                   → `pendencias`
 *  4. repetições bloqueadas        → `repeticoesBloqueadas`
 *  5. rejeições PVA                → `rejeicoesPva`
 *  6. guias sem vínculo            → `guiasSemVinculo`
 *  7. mudanças pós-fechamento      → `mudancasPosFechamento`
 *  8. tempo/consultas por documento→ `consultasPorDocumento`
 */

/**
 * Diferença AGREGADA de UM tributo (`fiscal_apuracoes_guias.tributo`) entre a
 * guia emitida e a obrigação apurada vinculada. O serviço já somou, por
 * tributo, o valor absoluto de (guia − obrigação) das guias de origem APURAÇÃO
 * marcadas como divergentes (R1.2), e contou quantas guias divergiram. Decimais
 * SEMPRE como string — nunca `Number`.
 */
export interface DiferencaTributoFato {
  tributo: string;
  /** Soma (string decimal) do |guia − obrigação| das guias divergentes. */
  somaDiferencaAbsoluta: string;
  /** Quantas guias do tributo estão marcadas como divergentes. */
  guiasDivergentes: number;
}

/**
 * Fatos JÁ AGREGADOS (no SQL, sem N+1) que alimentam as métricas de §13.3.
 * Contrato de entrada do núcleo puro: nenhuma consulta aqui, só números.
 */
export interface RolloutMetricasFatos {
  clienteId: string;
  /** Momento do retrato (ISO) — quando as métricas foram tiradas. */
  geradoEm: string;

  /** (1) Diferença por tributo — uma linha por tributo com divergência. */
  diferencasPorTributo: DiferencaTributoFato[];

  /**
   * (2) Créditos COM fundamento (decisão `ADMITIDO`) e SEM fundamento
   * (`VEDADO` ou `EXIGE_REVISAO`), contados em `fiscal_decisoes_item`.
   */
  creditosComFundamento: number;
  creditosSemFundamento: number;

  /**
   * (3) Pendências: guias ativas (não canceladas) com `statusPagamento`
   * PENDENTE e guias VENCIDAS (um subconjunto que merece destaque próprio).
   */
  guiasPendentes: number;
  guiasVencidas: number;

  /**
   * (4) Repetições bloqueadas: tentativas de criação idempotente que não
   * geraram guia nova (retries deduplicados por `idempotency_key`) e fichas de
   * CIAP travadas em saneamento assistido (reconstrução por contador bloqueada,
   * R5.4). Ambas são "repetições/reconstruções que o sistema recusou".
   */
  guiasComIdempotencyKey: number;
  ciapSaneamentoBloqueado: number;

  /** (5) Rejeições do PVA: entregas com `statusValidacao` REJEITADA. */
  entregasRejeitadasPva: number;

  /**
   * (6) Guias sem vínculo com a versão de apuração: guias ativas de origem
   * APURAÇÃO sem `fechamento_id` (anomalia que o CHECK impede, mas a métrica
   * audita) e guias MANUAIS sem vínculo (legítimas, mas inventariadas como
   * "fora da conciliação por apuração").
   */
  guiasApuracaoSemVinculo: number;
  guiasManuaisSemVinculo: number;

  /**
   * (7) Mudanças pós-fechamento: fechamentos cuja versão corrente é > 1
   * (reabertos/retificados) e entregas que são retificações (`entrega_original_id`
   * preenchido). Ambas são alterações APÓS um primeiro fechamento/entrega.
   */
  fechamentosRetificados: number;
  entregasRetificadoras: number;

  /**
   * (8) Tempo/consultas por documento: contagem de documentos fiscais do
   * escopo e um total de "consultas/leituras" observadas (eventos de leitura
   * agregados pelo serviço). A métrica derivada é a razão consultas/documento,
   * útil para detectar leitura redundante (N+1) por documento.
   */
  documentosFiscais: number;
  consultasObservadas: number;
}

/** (1) Linha de diferença por tributo, já apresentável. */
export interface MetricaDiferencaTributo {
  tributo: string;
  /** Soma do |guia − obrigação| (string decimal — nunca `Number`). */
  diferencaAbsoluta: string;
  guiasDivergentes: number;
}

/** (2) Créditos de ICMS por fundamento da decisão de item. */
export interface MetricaCreditos {
  comFundamento: number;
  semFundamento: number;
  total: number;
}

/** (3) Pendências de guias. */
export interface MetricaPendencias {
  pendentes: number;
  vencidas: number;
  total: number;
}

/** (4) Repetições/reconstruções que o sistema bloqueou. */
export interface MetricaRepeticoesBloqueadas {
  /** Guias protegidas por chave de idempotência (retries deduplicados). */
  guiasIdempotentes: number;
  /** Fichas de CIAP travadas em saneamento (reconstrução recusada — R5.4). */
  ciapSaneamentoBloqueado: number;
  total: number;
}

/** (6) Guias fora do vínculo com a versão de apuração. */
export interface MetricaGuiasSemVinculo {
  /** Guias de origem APURAÇÃO sem fechamento (anomalia — deveria ser 0). */
  apuracaoSemVinculo: number;
  /** Guias MANUAIS sem fechamento (legítimas, fora da conciliação apurada). */
  manuaisSemVinculo: number;
  total: number;
}

/** (7) Alterações após o primeiro fechamento/entrega. */
export interface MetricaMudancasPosFechamento {
  fechamentosRetificados: number;
  entregasRetificadoras: number;
  total: number;
}

/**
 * (8) Consultas por documento. A razão é 0 quando não há documentos (evita
 * divisão por zero) e vem com 4 casas decimais como string (nunca `Number`),
 * coerente com a convenção monetária/decimal da fase.
 */
export interface MetricaConsultasPorDocumento {
  documentos: number;
  consultas: number;
  /** consultas ÷ documentos, 4 casas, string. '0.0000' quando sem documentos. */
  razao: string;
}

/**
 * O PAINEL DE MÉTRICAS DE §13.3 montado (R5.5). Projeção read-only e
 * determinística, apresentável diretamente no cockpit de rollout.
 */
export interface RolloutMetricas {
  clienteId: string;
  geradoEm: string;
  diferencaPorTributo: MetricaDiferencaTributo[];
  creditos: MetricaCreditos;
  pendencias: MetricaPendencias;
  repeticoesBloqueadas: MetricaRepeticoesBloqueadas;
  /** Rejeições do PVA (entregas REJEITADA) — contagem simples. */
  rejeicoesPva: number;
  guiasSemVinculo: MetricaGuiasSemVinculo;
  mudancasPosFechamento: MetricaMudancasPosFechamento;
  consultasPorDocumento: MetricaConsultasPorDocumento;
}

/**
 * MONTA o painel de métricas de §13.3 a partir dos fatos agregados (tarefa 5.5
 * — R5.5). Puro e determinístico: os mesmos fatos sempre produzem o mesmo
 * painel. APENAS classifica/apresenta — não escreve nem decide nada.
 */
export function montarMetricasRollout(
  fatos: RolloutMetricasFatos,
): RolloutMetricas {
  return {
    clienteId: fatos.clienteId,
    geradoEm: fatos.geradoEm,
    diferencaPorTributo: montarDiferencaPorTributo(fatos.diferencasPorTributo),
    creditos: montarCreditos(fatos),
    pendencias: montarPendencias(fatos),
    repeticoesBloqueadas: montarRepeticoesBloqueadas(fatos),
    rejeicoesPva: fatos.entregasRejeitadasPva,
    guiasSemVinculo: montarGuiasSemVinculo(fatos),
    mudancasPosFechamento: montarMudancasPosFechamento(fatos),
    consultasPorDocumento: montarConsultasPorDocumento(fatos),
  };
}

/**
 * (1) Diferença por tributo. Normaliza a soma decimal (string) de cada tributo
 * e ordena por tributo (apresentação estável). Preserva a string como veio da
 * agregação — nunca converte para `Number`.
 */
function montarDiferencaPorTributo(
  diferencas: DiferencaTributoFato[],
): MetricaDiferencaTributo[] {
  return [...diferencas]
    .map((d) => ({
      tributo: d.tributo,
      diferencaAbsoluta: normalizarDecimal(d.somaDiferencaAbsoluta),
      guiasDivergentes: d.guiasDivergentes,
    }))
    .sort((a, b) => a.tributo.localeCompare(b.tributo));
}

/** (2) Créditos com/sem fundamento, com o total conciliando as duas pontas. */
function montarCreditos(fatos: RolloutMetricasFatos): MetricaCreditos {
  return {
    comFundamento: fatos.creditosComFundamento,
    semFundamento: fatos.creditosSemFundamento,
    total: fatos.creditosComFundamento + fatos.creditosSemFundamento,
  };
}

/** (3) Pendências: pendentes + vencidas, com total. */
function montarPendencias(fatos: RolloutMetricasFatos): MetricaPendencias {
  return {
    pendentes: fatos.guiasPendentes,
    vencidas: fatos.guiasVencidas,
    total: fatos.guiasPendentes + fatos.guiasVencidas,
  };
}

/** (4) Repetições bloqueadas: idempotência de guias + saneamento de CIAP. */
function montarRepeticoesBloqueadas(
  fatos: RolloutMetricasFatos,
): MetricaRepeticoesBloqueadas {
  return {
    guiasIdempotentes: fatos.guiasComIdempotencyKey,
    ciapSaneamentoBloqueado: fatos.ciapSaneamentoBloqueado,
    total: fatos.guiasComIdempotencyKey + fatos.ciapSaneamentoBloqueado,
  };
}

/** (6) Guias sem vínculo: anomalia de apuração + manuais fora da conciliação. */
function montarGuiasSemVinculo(
  fatos: RolloutMetricasFatos,
): MetricaGuiasSemVinculo {
  return {
    apuracaoSemVinculo: fatos.guiasApuracaoSemVinculo,
    manuaisSemVinculo: fatos.guiasManuaisSemVinculo,
    total: fatos.guiasApuracaoSemVinculo + fatos.guiasManuaisSemVinculo,
  };
}

/** (7) Mudanças pós-fechamento: fechamentos retificados + entregas retificadoras. */
function montarMudancasPosFechamento(
  fatos: RolloutMetricasFatos,
): MetricaMudancasPosFechamento {
  return {
    fechamentosRetificados: fatos.fechamentosRetificados,
    entregasRetificadoras: fatos.entregasRetificadoras,
    total: fatos.fechamentosRetificados + fatos.entregasRetificadoras,
  };
}

/**
 * (8) Consultas por documento. A razão é consultas ÷ documentos com 4 casas,
 * calculada em inteiros (centésimos de milésimo) para não cair em ponto
 * flutuante, e devolvida como string. Sem documentos, a razão é '0.0000'
 * (evita divisão por zero sem fabricar um número enganoso).
 */
function montarConsultasPorDocumento(
  fatos: RolloutMetricasFatos,
): MetricaConsultasPorDocumento {
  const documentos = Math.max(0, Math.trunc(fatos.documentosFiscais));
  const consultas = Math.max(0, Math.trunc(fatos.consultasObservadas));
  return {
    documentos,
    consultas,
    razao: razaoQuatroCasas(consultas, documentos),
  };
}

/**
 * Razão `numerador / denominador` com 4 casas decimais, como string, usando
 * aritmética inteira (sem ponto flutuante). Denominador 0 → '0.0000'.
 */
function razaoQuatroCasas(numerador: number, denominador: number): string {
  if (denominador <= 0) return '0.0000';
  // Escala por 10^4 para 4 casas; arredondamento meio-para-cima.
  const escalado = Math.round((numerador * 10000) / denominador);
  const inteiro = Math.trunc(escalado / 10000);
  const frac = Math.abs(escalado % 10000)
    .toString()
    .padStart(4, '0');
  return `${inteiro}.${frac}`;
}

/**
 * Normaliza uma string decimal a 2 casas (centavos). Aceita vazio/`null`-como-
 * string como zero. Usa aritmética inteira de centavos para não introduzir erro
 * de ponto flutuante na soma apresentada.
 */
function normalizarDecimal(valor: string | null | undefined): string {
  const centavos = paraCentavos(valor);
  const inteiro = Math.trunc(centavos / 100);
  const frac = Math.abs(centavos % 100)
    .toString()
    .padStart(2, '0');
  const sinal = centavos < 0 && inteiro === 0 ? '-' : '';
  return `${sinal}${inteiro}.${frac}`;
}

/**
 * Converte uma string decimal 'inteiro[.frac]' em CENTAVOS inteiros, truncando
 * além da segunda casa. Entrada vazia/indefinida → 0. Não usa `parseFloat`
 * (evita o erro de ponto flutuante da fase).
 */
function paraCentavos(valor: string | null | undefined): number {
  if (valor == null) return 0;
  const texto = valor.trim();
  if (texto === '') return 0;
  const negativo = texto.startsWith('-');
  const semSinal = negativo ? texto.slice(1) : texto;
  const [inteiroStr, fracStr = ''] = semSinal.split('.');
  const inteiro = Number.parseInt(inteiroStr === '' ? '0' : inteiroStr, 10);
  const frac2 = (fracStr + '00').slice(0, 2);
  const frac = Number.parseInt(frac2, 10);
  if (Number.isNaN(inteiro) || Number.isNaN(frac)) return 0;
  const centavos = inteiro * 100 + frac;
  return negativo ? -centavos : centavos;
}
