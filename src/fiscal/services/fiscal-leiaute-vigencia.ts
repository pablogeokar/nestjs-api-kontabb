/**
 * Núcleo PURO do leiaute por VIGÊNCIA da competência e da confirmação da versão
 * do PVA na homologação (Fase 5, tarefa 2.4 / R2.5 — "O leiaute do arquivo DEVE
 * seguir a vigência da competência (2026 vs. 2027), sem reutilização
 * silenciosa"; N03/N04 e N05).
 *
 * Duas responsabilidades, ambas determinísticas e testáveis sem banco:
 *
 *  1) LEIAUTE POR VIGÊNCIA (N03/N04): o leiaute aplicável NÃO é escolhido por
 *     quem registra a entrega; ele é DERIVADO da vigência da competência. O
 *     mapa competência → leiaute é EXPLÍCITO (nada de "última versão" implícita):
 *     competências de 2026 usam o Guia 3.2.2; competências de 2027 em diante
 *     usam o 3.2.3. Quando o chamador informa um `leiauteVersao`, ele é
 *     VALIDADO contra o esperado para a vigência — um leiaute que não casa é
 *     REJEITADO, fechando o caminho da reutilização silenciosa do leiaute
 *     errado.
 *
 *  2) VERSÃO DO PVA CONFIRMADA (N05): a versão do PVA usada na homologação é
 *     SEMPRE a que foi efetivamente confirmada pelo operador — nunca presumida
 *     como "a última". A entrega exige uma CONFIRMAÇÃO explícita da versão (não
 *     basta um valor qualquer): sem a confirmação, a entrega é rejeitada, para
 *     que a homologação registre a versão do PVA que de fato foi usada.
 */

/**
 * Versão do leiaute (Guia Prático) por vigência, conforme N03/N04. Mantido como
 * união explícita: adicionar uma nova vigência é uma mudança deliberada no mapa
 * abaixo, nunca um fallback silencioso para "a mais recente".
 */
export type LeiauteVersao = '3.2.2' | '3.2.3';

/**
 * MAPA EXPLÍCITO vigência (ano da competência) → versão do leiaute (N03/N04).
 * 2026 = Guia 3.2.2; 2027 em diante = 3.2.3. O ano piso de cada leiaute é
 * declarado aqui, de forma que a seleção seja auditável e não dependa de "pegar
 * a última". Qualquer competência anterior ao piso mais antigo é tratada como
 * fora do escopo coberto (ver `leiauteDaVigencia`).
 */
const LEIAUTE_POR_ANO_PISO: ReadonlyArray<{
  anoPiso: number;
  leiaute: LeiauteVersao;
}> = [
  { anoPiso: 2027, leiaute: '3.2.3' },
  { anoPiso: 2026, leiaute: '3.2.2' },
];

/** Menor ano coberto pelo mapa de vigência (abaixo dele não há leiaute definido). */
const ANO_PISO_MINIMO = Math.min(
  ...LEIAUTE_POR_ANO_PISO.map((item) => item.anoPiso),
);

/** Conjunto das versões de leiaute conhecidas (reforço do domínio aceito). */
const LEIAUTES_CONHECIDOS: ReadonlySet<string> = new Set(
  LEIAUTE_POR_ANO_PISO.map((item) => item.leiaute),
);

/**
 * Erro de domínio do leiaute/vigência. O chamador HTTP converte em BadRequest;
 * o serviço o deixa propagar. Mantém a mensagem normativa junto do ponto de
 * decisão (não espalhada por strings soltas).
 */
export class LeiauteVigenciaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LeiauteVigenciaError';
  }
}

/**
 * Extrai o ANO da competência ('YYYY-MM' ou 'YYYY-MM-DD'). A vigência do
 * leiaute é por ano-calendário da competência — o mês/dia não muda o leiaute.
 * Lança `LeiauteVigenciaError` para competência sem o prefixo 'YYYY-MM'.
 */
export function anoDaCompetencia(competencia: string): number {
  const match = /^(\d{4})-(0[1-9]|1[0-2])/.exec(competencia ?? '');
  if (!match) {
    throw new LeiauteVigenciaError(
      `Competência inválida para seleção de leiaute: "${competencia}". ` +
        'Esperado AAAA-MM.',
    );
  }
  return Number(match[1]);
}

/**
 * DERIVA o leiaute aplicável a partir da VIGÊNCIA da competência (N03/N04),
 * usando o mapa explícito acima. Puro e determinístico: a mesma competência
 * sempre resolve o mesmo leiaute, sem "pegar a última". Competência anterior ao
 * ano piso mínimo coberto é rejeitada (não há leiaute definido para ela — não
 * se reutiliza silenciosamente o mais antigo).
 */
export function leiauteDaVigencia(competencia: string): LeiauteVersao {
  const ano = anoDaCompetencia(competencia);
  if (ano < ANO_PISO_MINIMO) {
    throw new LeiauteVigenciaError(
      `Não há leiaute definido para a vigência da competência ${competencia} ` +
        `(ano ${ano}). O leiaute segue a vigência (2026 = 3.2.2; 2027 = 3.2.3 ` +
        '— N03/N04), sem reutilizar silenciosamente um leiaute de outra ' +
        'vigência (R2.5).',
    );
  }
  // Mapa ordenado do maior piso para o menor: a primeira faixa cujo piso é
  // alcançado pelo ano da competência é a vigência aplicável.
  for (const { anoPiso, leiaute } of LEIAUTE_POR_ANO_PISO) {
    if (ano >= anoPiso) return leiaute;
  }
  // Inalcançável: o guard de ANO_PISO_MINIMO acima já cobre o caso < piso.
  throw new LeiauteVigenciaError(
    `Não há leiaute definido para a competência ${competencia}.`,
  );
}

/**
 * RESOLVE e VALIDA a versão do leiaute de uma entrega contra a vigência da sua
 * competência (R2.5). Comportamento:
 *
 *  - Sem `leiauteInformado`: deriva o leiaute da vigência e o retorna (seleção
 *    automática por vigência — o caminho recomendado).
 *  - Com `leiauteInformado`: ele DEVE casar exatamente o leiaute esperado para a
 *    vigência. Um leiaute conhecido mas de OUTRA vigência (ex.: 3.2.2 numa
 *    competência de 2027) é REJEITADO — é exatamente a "reutilização silenciosa"
 *    que o requisito proíbe. Um valor fora do domínio conhecido também é
 *    rejeitado.
 *
 * Retorna sempre o leiaute canônico da vigência (string), para persistir na
 * entrega de forma explícita.
 */
export function resolverLeiautePorVigencia(
  competencia: string,
  leiauteInformado?: string | null,
): LeiauteVersao {
  const esperado = leiauteDaVigencia(competencia);
  if (leiauteInformado == null || leiauteInformado.trim() === '') {
    return esperado;
  }
  const informado = leiauteInformado.trim();
  if (!LEIAUTES_CONHECIDOS.has(informado)) {
    throw new LeiauteVigenciaError(
      `Versão de leiaute desconhecida: "${informado}". O leiaute segue a ` +
        'vigência da competência (2026 = 3.2.2; 2027 = 3.2.3 — N03/N04).',
    );
  }
  if (informado !== esperado) {
    throw new LeiauteVigenciaError(
      `Leiaute "${informado}" não corresponde à vigência da competência ` +
        `${competencia} (esperado "${esperado}"). O leiaute segue a vigência ` +
        '(2026 = 3.2.2; 2027 = 3.2.3 — N03/N04), sem reutilização silenciosa ' +
        'do leiaute de outra vigência (R2.5).',
    );
  }
  return esperado;
}

/**
 * Confirmação EXPLÍCITA da versão do PVA usada na homologação (N05). A versão
 * `pvaVersao` é o que foi efetivamente usado; `pvaVersaoConfirmada` é o sinal de
 * que a versão foi CONFIRMADA pelo operador na homologação — nunca presumida
 * como "a última". A entrega só grava a versão quando a confirmação casa a
 * versão informada.
 */
export interface ConfirmacaoPvaInput {
  /** Versão operacional do PVA usada (ex.: '6.1.1'). */
  pvaVersao: string;
  /**
   * Versão do PVA CONFIRMADA na homologação. DEVE ser informada e DEVE casar
   * `pvaVersao` — é a trava contra "presumir a última versão" (N05).
   */
  pvaVersaoConfirmada?: string | null;
}

/**
 * VALIDA a confirmação da versão do PVA (N05). A versão usada é aceita apenas
 * quando foi EXPLICITAMENTE confirmada e a confirmação casa a versão informada.
 * Rejeita:
 *  - versão vazia/ausente (não há o que confirmar);
 *  - confirmação ausente/vazia (a versão não foi confirmada na homologação —
 *    não se presume "a última");
 *  - confirmação que NÃO casa a versão informada (confirmou outra versão).
 *
 * Retorna a versão confirmada (string normalizada) para persistir.
 */
export function confirmarVersaoPva(input: ConfirmacaoPvaInput): string {
  const versao = (input.pvaVersao ?? '').trim();
  if (versao === '') {
    throw new LeiauteVigenciaError(
      'Versão do PVA é obrigatória: a homologação registra qual versão foi ' +
        'usada, nunca uma versão em branco (N05).',
    );
  }
  const confirmada = (input.pvaVersaoConfirmada ?? '').trim();
  if (confirmada === '') {
    throw new LeiauteVigenciaError(
      'A versão do PVA usada na homologação deve ser confirmada explicitamente ' +
        `(informe a confirmação da versão "${versao}"). A versão nunca é ` +
        'presumida como "a última" (N05).',
    );
  }
  if (confirmada !== versao) {
    throw new LeiauteVigenciaError(
      `A confirmação da versão do PVA ("${confirmada}") não corresponde à ` +
        `versão informada ("${versao}"). Confirme a versão efetivamente usada ` +
        'na homologação (N05).',
    );
  }
  return versao;
}
