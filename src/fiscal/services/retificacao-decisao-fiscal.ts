/**
 * NÚCLEO PURO DA PREPARAÇÃO DE DIFERENÇAS PARA DECISÃO FISCAL
 * (Fase 5, tarefa 5.3 — R5.3).
 *
 * O design (§Rollout §13 + Riscos) é literal e restritivo: "Não retificar
 * automaticamente obrigação transmitida; preparar diferenças para o fiscal" e
 * "Retificação de obrigação já transmitida é sensível. O design proíbe
 * automação; decisão sempre do fiscal." Esta é a TERCEIRA tarefa do grupo 5
 * (rollout), logo após o inventário read-only (5.1) e os critérios de
 * homologação (5.2), e segue o MESMO padrão de RESOLVER PURO: determinístico,
 * testável sem banco, que apenas CLASSIFICA e APRESENTA — nunca escreve, nunca
 * migra, nunca retifica.
 *
 * DUAS GARANTIAS, UMA POSTURA:
 *  1. NÃO AUTOMATIZAR a retificação de obrigação já TRANSMITIDA. A retificação
 *     real (`FiscalEntregasService.retificarEntrega`) é um caminho SEPARADO e
 *     DELIBERADO, iniciado por humano via HTTP (`POST .../entregas/retificar`);
 *     nenhum fluxo de correção/ativação de rollout a dispara. Este núcleo nunca
 *     chama retificação: dado uma obrigação transmitida com valor novo (ex.: de
 *     um fechamento corrigido), ele PARA e devolve uma preparação
 *     `AGUARDANDO_DECISAO_FISCAL` — a aplicação depende de ação explícita do
 *     fiscal, fora daqui.
 *  2. PREPARAR a diferença para o fiscal decidir. A preparação é um RETRATO
 *     read-only: o valor transmitido, o valor novo computado e o DELTA assinado
 *     (novo - transmitido), com memória auditável. Para obrigações NÃO
 *     transmitidas, o caminho de correção segue livre (status `LIVRE_PARA_CORRECAO`):
 *     a trava é especificamente sobre o que já foi transmitido.
 *
 * A sinalização de "transmitida" espelha exatamente a do inventário de rollout
 * (`rollout-inventario.ts`): uma entrega é tida como transmitida quando tem
 * `transmitidaEm` OU `statusValidacao === 'TRANSMITIDA'`. Assim, as duas
 * projeções da fase enxergam a mesma realidade de transmissão.
 */

/**
 * Status da preparação de diferença (R5.3). É um retrato, nunca uma ação:
 *  - `AGUARDANDO_DECISAO_FISCAL`: a obrigação JÁ foi transmitida e há uma
 *    diferença preparada; a retificação NÃO é aplicada automaticamente —
 *    depende de decisão explícita do responsável fiscal.
 *  - `LIVRE_PARA_CORRECAO`: a obrigação NÃO foi transmitida; a correção pode
 *    seguir o fluxo normal (a trava de R5.3 é só sobre o transmitido).
 */
export type StatusPreparacaoDiferenca =
  'AGUARDANDO_DECISAO_FISCAL' | 'LIVRE_PARA_CORRECAO';

/**
 * Uma ENTREGA conhecida da obrigação (fato de entrada), reduzida ao que importa
 * para decidir se a obrigação está transmitida. Mesma leitura do inventário de
 * rollout: `transmitidaEm` OU `statusValidacao === 'TRANSMITIDA'`.
 */
export interface EntregaTransmissaoFato {
  /** Status do ciclo da entrega (PENDENTE/VALIDADA/REJEITADA/TRANSMITIDA/...). */
  statusValidacao: string;
  /** Momento da transmissão, quando houver (ISO). `null`/ausente = não transmitida por data. */
  transmitidaEm?: string | null;
}

/**
 * Fatos de entrada para preparar a diferença de UMA obrigação/competência
 * (R5.3). Os valores monetários são strings decimais de duas casas (restrição
 * da fase: nunca `Number`). `valorTransmitido` é o valor da obrigação como já
 * entregue/transmitida; `valorNovoComputado` é o valor recém-calculado (ex.: de
 * um fechamento corrigido) que o fiscal avaliará.
 */
export interface PreparacaoDiferencaFatos {
  clienteId: string;
  obrigacao: string;
  competencia: string; // 'YYYY-MM'
  /** Entregas conhecidas da obrigação/competência (para aferir transmissão). */
  entregas: EntregaTransmissaoFato[];
  /** Valor da obrigação como transmitida (string decimal de duas casas). */
  valorTransmitido: string;
  /** Novo valor computado a avaliar (string decimal de duas casas). */
  valorNovoComputado: string;
}

/**
 * A PREPARAÇÃO DE DIFERENÇA montada (R5.3): retrato read-only para o fiscal
 * decidir. NUNCA aplica a retificação; apenas apresenta o delta e o status.
 */
export interface PreparacaoDiferenca {
  clienteId: string;
  obrigacao: string;
  competencia: string;
  /** `true` quando ao menos uma entrega da obrigação está transmitida. */
  transmitida: boolean;
  valorTransmitido: string;
  valorNovoComputado: string;
  /** `valorNovoComputado - valorTransmitido` (string decimal de duas casas, com sinal). */
  diferenca: string;
  /** `true` quando `valorTransmitido !== valorNovoComputado`. */
  houveDiferenca: boolean;
  /** Status do retrato (R5.3): aguardando decisão fiscal × livre para correção. */
  status: StatusPreparacaoDiferenca;
  /**
   * SEMPRE `false`: este núcleo NUNCA retifica automaticamente obrigação
   * transmitida (R5.3). Mantido explícito no contrato como garantia auditável
   * de que a aplicação depende de ação do fiscal, fora daqui.
   */
  retificacaoAutomaticaAplicada: false;
  /** Memória textual auditável do retrato (sempre preenchida). */
  memoria: string;
}

/**
 * Converte uma string decimal de duas casas em centavos (inteiro), rejeitando
 * `Number`/formatos inesperados. MESMA aritmética inteira (em centavos) de
 * `retificacao-fechamento.ts`: a diferença precisa ser exata (sem ponto
 * flutuante) e a restrição da fase exige strings decimais.
 */
function decimalParaCentavos(valor: string, campo: string): number {
  if (typeof valor !== 'string') {
    throw new Error(
      `"${campo}" deve ser string decimal (nunca Number) para a diferença (R5.3).`,
    );
  }
  const match = /^(-?)(\d+)\.(\d{2})$/.exec(valor.trim());
  if (!match) {
    throw new Error(
      `"${campo}" com formato decimal inesperado na diferença (R5.3): "${valor}".`,
    );
  }
  const [, sinal, inteiro, centavos] = match;
  const magnitude = Number(inteiro) * 100 + Number(centavos);
  return sinal === '-' ? -magnitude : magnitude;
}

/**
 * Centavos → string decimal de duas casas, preservando o sinal (mesma função de
 * `retificacao-fechamento.ts`): `-5` → `'-0.05'`, `130` → `'1.30'`.
 */
function centavosParaDecimal(centavos: number): string {
  const sinal = centavos < 0 ? '-' : '';
  const abs = Math.abs(centavos);
  const inteiro = Math.trunc(abs / 100);
  const resto = abs % 100;
  return `${sinal}${inteiro}.${String(resto).padStart(2, '0')}`;
}

/**
 * Aferição de transmissão espelhada do inventário de rollout
 * (`rollout-inventario.ts`): a obrigação está transmitida quando AO MENOS UMA
 * de suas entregas tem `transmitidaEm` OU `statusValidacao === 'TRANSMITIDA'`.
 */
export function obrigacaoTransmitida(
  entregas: EntregaTransmissaoFato[],
): boolean {
  return entregas.some(
    (e) => e.transmitidaEm != null || e.statusValidacao === 'TRANSMITIDA',
  );
}

/**
 * PREPARA a diferença de uma obrigação para a decisão do fiscal (tarefa 5.3 —
 * R5.3). Puro e determinístico: os mesmos fatos sempre produzem a mesma
 * preparação. NUNCA retifica — `retificacaoAutomaticaAplicada` é sempre `false`.
 *
 * Regra central de R5.3:
 *  - Se a obrigação está TRANSMITIDA, o status é `AGUARDANDO_DECISAO_FISCAL`:
 *    há (ou não) diferença, mas a aplicação de qualquer retificação depende de
 *    decisão EXPLÍCITA do responsável fiscal — este núcleo só prepara/apresenta.
 *  - Se a obrigação NÃO está transmitida, o status é `LIVRE_PARA_CORRECAO`: a
 *    trava de R5.3 é especificamente sobre o transmitido; o fluxo de correção
 *    normal não é afetado.
 *
 * O delta (`valorNovoComputado - valorTransmitido`) é calculado com aritmética
 * inteira em centavos (exato, com sinal), independentemente do status — a
 * diferença é informação para o fiscal, não uma ação.
 */
export function prepararDiferencaParaFiscal(
  fatos: PreparacaoDiferencaFatos,
): PreparacaoDiferenca {
  const transmitido = decimalParaCentavos(
    fatos.valorTransmitido,
    'valorTransmitido',
  );
  const novo = decimalParaCentavos(
    fatos.valorNovoComputado,
    'valorNovoComputado',
  );
  const deltaCentavos = novo - transmitido;
  const diferenca = centavosParaDecimal(deltaCentavos);
  const houveDiferenca = deltaCentavos !== 0;

  const transmitida = obrigacaoTransmitida(fatos.entregas);
  const status: StatusPreparacaoDiferenca = transmitida
    ? 'AGUARDANDO_DECISAO_FISCAL'
    : 'LIVRE_PARA_CORRECAO';

  const escopo = `${fatos.obrigacao} ${fatos.competencia}`;
  const memoria = transmitida
    ? `Obrigação ${escopo} JÁ TRANSMITIDA: a retificação NÃO é aplicada ` +
      `automaticamente (R5.3). Diferença preparada (transmitido ` +
      `${fatos.valorTransmitido} → novo ${fatos.valorNovoComputado}, delta ` +
      `${diferenca})` +
      (houveDiferenca
        ? '; aguardando decisão do responsável fiscal para eventual retificação.'
        : '; sem diferença de valor, nada a decidir além de confirmar.') +
      ' A aplicação depende de ação explícita do fiscal (`retificarEntrega`), ' +
      'fora deste retrato.'
    : `Obrigação ${escopo} NÃO transmitida: correção livre pelo fluxo normal ` +
      `(delta ${diferenca}). A trava de R5.3 incide apenas sobre o transmitido.`;

  return {
    clienteId: fatos.clienteId,
    obrigacao: fatos.obrigacao,
    competencia: fatos.competencia,
    transmitida,
    valorTransmitido: fatos.valorTransmitido,
    valorNovoComputado: fatos.valorNovoComputado,
    diferenca,
    houveDiferenca,
    status,
    retificacaoAutomaticaAplicada: false,
    memoria,
  };
}
