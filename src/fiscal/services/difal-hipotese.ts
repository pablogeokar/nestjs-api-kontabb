/**
 * SEPARAÇÃO DO DIFAL POR HIPÓTESE (Fase 4 / tarefa 2.1 — R1.1).
 *
 * O estado anterior (`DifalEntradaService`) tratava o DIFAL como UM cálculo só:
 * uma tabela modal fixa por UF, fórmula única, e um `Set` de CFOPs de entrada
 * que INCLUÍA 2406/2407 (ST) ao lado de 2551/2556 (uso/consumo e ativo), sem
 * analisar recolhimento anterior ou responsabilidade. O design (§ DIFAL F11)
 * exige o contrário: "calculador parametrizado por hipótese... separando DIFAL
 * de entrada (contribuinte), DIFAL de saída (não contribuinte), antecipação,
 * ST" e "não incluir CFOPs (ex.: 2406/2407) sem analisar recolhimento
 * anterior/responsabilidade".
 *
 * Esta é a BASE da separação: um classificador PURO (sem banco, sem fórmula)
 * que, dado um item interestadual, decide a QUAL das quatro hipóteses ele
 * pertence. As tarefas seguintes (2.2 calculador, 2.4 composição da base, 2.5
 * duplicidade/retenção) consomem essa classificação para calcular CADA hipótese
 * pela sua regra própria, em vez de aplicar uma fórmula única a todos.
 *
 * A classificação NÃO calcula imposto nem decide se há guia — apenas enquadra.
 * A existência de regra homologada (R1.2) e o cálculo em si (R1.3) ficam para as
 * tarefas 2.2/2.3. Decimais permanecem strings; aqui não há aritmética.
 */

/**
 * As quatro hipóteses de DIFAL que a Fase 4 separa (R1.1). São MUTUAMENTE
 * EXCLUSIVAS: cada item interestadual pertinente cai em exatamente uma.
 *
 * - `DIFAL_ENTRADA_CONTRIBUINTE`: adquirente CONTRIBUINTE do ICMS que recebe,
 *   em operação interestadual, mercadoria para USO/CONSUMO ou ATIVO imobilizado
 *   (não revenda). Ele mesmo recolhe a diferença de alíquota (DIFAL de entrada).
 *   É o caso que o serviço legado já cobria (CFOPs 2551/2556).
 * - `DIFAL_SAIDA_NAO_CONTRIBUINTE`: venda interestadual a CONSUMIDOR FINAL NÃO
 *   contribuinte (EC 87/2015 / LC 190/2022 — N10). O remetente é o responsável
 *   pelo DIFAL devido à UF de destino. É uma SAÍDA, não aparecia no cálculo de
 *   entrada legado.
 * - `ANTECIPACAO`: antecipação do ICMS na entrada interestadual (sem ST), quando
 *   a legislação estadual a exige. Difere da entrada-contribuinte clássica: é um
 *   recolhimento antecipado do imposto da operação subsequente, não a diferença
 *   de alíquota de uso/consumo/ativo.
 * - `ST`: operação sob substituição tributária. O imposto já foi (ou será)
 *   retido pelo substituto; tratar como DIFAL de entrada comum recolheria em
 *   DUPLICIDADE. Os CFOPs 2406/2407 caem AQUI, não na entrada-contribuinte.
 */
export type DifalHipotese =
  | 'DIFAL_ENTRADA_CONTRIBUINTE'
  | 'DIFAL_SAIDA_NAO_CONTRIBUINTE'
  | 'ANTECIPACAO'
  | 'ST';

/**
 * Resultado da classificação de um item. Além da hipótese, carrega o motivo
 * (auditável) e a sinalização de ST retida, que a tarefa 2.5 usa para não
 * recolher em duplicidade. `null` em `hipotese` significa "item não pertinente
 * ao DIFAL" (operação interna, revenda sem antecipação etc.) — não é erro.
 */
export interface DifalClassificacao {
  hipotese: DifalHipotese | null;
  // Sentido escriturado do item ('ENTRADA' | 'SAIDA'), ecoado para auditoria.
  sentido: 'ENTRADA' | 'SAIDA';
  cfop: string;
  // Explicação curta e determinística de por que a hipótese foi escolhida.
  motivo: string;
  // Verdadeiro quando a operação está sob ST (imposto retido/responsabilidade
  // de terceiro). A tarefa 2.5 usa isto para NÃO recolher DIFAL em duplicidade.
  stRetida: boolean;
}

/**
 * Entrada mínima para classificar um item. São campos já presentes em
 * `documentos_fiscais_itens`; o classificador não consulta o banco.
 */
export interface DifalItemClassificavel {
  // Sentido escriturado do item ('ENTRADA' ou 'SAIDA').
  tipoOperacaoEscriturada: string;
  // CFOP escriturado (4 dígitos). O 1º dígito indica a abrangência:
  // 2.xxx/3.xxx = interestadual/exterior na entrada; 6.xxx/7.xxx na saída.
  cfop: string;
  // Indicador de ST na operação, derivado de campos do item (ex.: valorIcmsSt /
  // valorIcmsStRetido presentes, ou CST de substituído). Quando `true`, a
  // operação está sob substituição tributária.
  possuiSt?: boolean;
  // Verdadeiro quando o ICMS-ST já foi retido anteriormente (substituído).
  stRetidaAnteriormente?: boolean;
}

// CFOPs de ENTRADA interestadual de uso/consumo e ativo SEM ST. Geram DIFAL de
// entrada do contribuinte (a diferença de alíquota que o próprio adquirente
// recolhe). 2551 = ativo imobilizado; 2556 = material de uso/consumo.
const CFOPS_ENTRADA_CONTRIBUINTE = new Set(['2551', '2556']);

// CFOPs de ENTRADA interestadual que indicam ST (substituição tributária). O
// imposto é/foi retido pelo substituto. 2406 = ativo adquirido de substituído;
// 2407 = uso/consumo adquirido de substituído. Tratá-los como entrada-
// contribuinte recolheria DIFAL em duplicidade (design §DIFAL, R1.4).
const CFOPS_ENTRADA_ST = new Set(['2406', '2407']);

// CFOPs de SAÍDA interestadual a consumidor final (contribuinte ou não). O
// enquadramento como "não contribuinte" exige o indicador da operação; o CFOP
// sozinho identifica a venda interestadual a consumidor final. 6107/6108 são as
// vendas de produção/terceiros a não contribuinte; 6949/6108 variam por UF —
// mantemos o núcleo estável e deixamos a regra fina para o catálogo (2.2).
const CFOPS_SAIDA_CONSUMIDOR_FINAL = new Set(['6107', '6108']);

/**
 * Classifica UM item interestadual em uma das quatro hipóteses de DIFAL, ou em
 * `null` quando o item não é pertinente ao DIFAL.
 *
 * Ordem de decisão (determinística, do mais específico ao mais geral):
 *   1. ST explícita (indicador do item OU CFOP 2406/2407) → `ST`. Vem PRIMEIRO
 *      para nunca classificar como entrada-contribuinte algo já sob ST (R1.4,
 *      design "não incluir 2406/2407 sem analisar responsabilidade").
 *   2. Entrada de uso/consumo ou ativo (2551/2556) → `DIFAL_ENTRADA_CONTRIBUINTE`.
 *   3. Entrada interestadual com antecipação sinalizada → `ANTECIPACAO`.
 *   4. Saída interestadual a consumidor final não contribuinte → `DIFAL_SAIDA_NAO_CONTRIBUINTE`.
 *   5. Caso contrário → `null` (não pertinente).
 */
export function classificarDifalHipotese(
  item: DifalItemClassificavel,
  opcoes: { exigeAntecipacao?: boolean } = {},
): DifalClassificacao {
  const sentido = normalizarSentido(item.tipoOperacaoEscriturada);
  const cfop = (item.cfop ?? '').trim();
  const stPorCfop = CFOPS_ENTRADA_ST.has(cfop);
  const stRetida = Boolean(
    item.possuiSt || item.stRetidaAnteriormente || stPorCfop,
  );

  const base = { sentido, cfop, stRetida };

  // 1. ST tem precedência: imposto já retido/responsabilidade de terceiro.
  if (stRetida) {
    return {
      ...base,
      hipotese: 'ST',
      motivo: stPorCfop
        ? `CFOP ${cfop} de entrada sob substituição tributária (substituído); ` +
          'o ICMS é retido pelo substituto, não gera DIFAL de entrada próprio.'
        : 'Operação com ICMS-ST retido/responsabilidade de terceiro; ' +
          'classificada como ST para não recolher DIFAL em duplicidade.',
    };
  }

  if (sentido === 'ENTRADA') {
    // 2. Uso/consumo ou ativo imobilizado adquirido de outra UF, sem ST.
    if (CFOPS_ENTRADA_CONTRIBUINTE.has(cfop)) {
      return {
        ...base,
        hipotese: 'DIFAL_ENTRADA_CONTRIBUINTE',
        motivo:
          `CFOP ${cfop} de entrada interestadual para uso/consumo ou ativo; ` +
          'o adquirente contribuinte recolhe a diferença de alíquota.',
      };
    }
    // 3. Antecipação do ICMS na entrada interestadual (quando a UF exige).
    if (opcoes.exigeAntecipacao && isEntradaInterestadual(cfop)) {
      return {
        ...base,
        hipotese: 'ANTECIPACAO',
        motivo:
          `CFOP ${cfop} de entrada interestadual com antecipação exigida ` +
          'pela legislação estadual (recolhimento antecipado, não DIFAL de uso/consumo).',
      };
    }
  }

  if (sentido === 'SAIDA') {
    // 4. Venda interestadual a consumidor final não contribuinte (N10).
    if (CFOPS_SAIDA_CONSUMIDOR_FINAL.has(cfop)) {
      return {
        ...base,
        hipotese: 'DIFAL_SAIDA_NAO_CONTRIBUINTE',
        motivo:
          `CFOP ${cfop} de venda interestadual a consumidor final não ` +
          'contribuinte; o remetente é responsável pelo DIFAL à UF de destino.',
      };
    }
  }

  return {
    ...base,
    hipotese: null,
    motivo:
      `CFOP ${cfop} (${sentido}) não se enquadra em nenhuma hipótese de DIFAL ` +
      '(operação interna, revenda sem antecipação ou fora do escopo).',
  };
}

/**
 * Classifica uma lista de itens e os AGRUPA por hipótese. Itens não pertinentes
 * (`hipotese === null`) são devolvidos à parte, para auditoria, nunca somados a
 * uma hipótese. É a entrada natural do calculador por hipótese (tarefa 2.2):
 * cada grupo é calculado pela sua própria regra, não por uma fórmula única.
 */
export function separarPorHipotese<T extends DifalItemClassificavel>(
  itens: readonly T[],
  opcoes: { exigeAntecipacao?: boolean } = {},
): {
  grupos: Record<
    DifalHipotese,
    Array<{ item: T; classificacao: DifalClassificacao }>
  >;
  naoPertinentes: Array<{ item: T; classificacao: DifalClassificacao }>;
} {
  const grupos: Record<
    DifalHipotese,
    Array<{ item: T; classificacao: DifalClassificacao }>
  > = {
    DIFAL_ENTRADA_CONTRIBUINTE: [],
    DIFAL_SAIDA_NAO_CONTRIBUINTE: [],
    ANTECIPACAO: [],
    ST: [],
  };
  const naoPertinentes: Array<{
    item: T;
    classificacao: DifalClassificacao;
  }> = [];

  for (const item of itens) {
    const classificacao = classificarDifalHipotese(item, opcoes);
    if (classificacao.hipotese === null) {
      naoPertinentes.push({ item, classificacao });
    } else {
      grupos[classificacao.hipotese].push({ item, classificacao });
    }
  }

  return { grupos, naoPertinentes };
}

// Entrada interestadual/exterior quando o CFOP começa com 2 (outra UF) ou 3
// (exterior). O 1º dígito do CFOP codifica a abrangência da operação.
function isEntradaInterestadual(cfop: string): boolean {
  return /^[23]\d{3}$/.test(cfop);
}

function normalizarSentido(valor: string): 'ENTRADA' | 'SAIDA' {
  return (valor ?? '').trim().toUpperCase() === 'SAIDA' ? 'SAIDA' : 'ENTRADA';
}
