/**
 * COMPOSIÇÃO DA BASE DO DIFAL (Fase 4 / tarefa 2.4 — R1.3, R1.5).
 *
 * As tarefas anteriores entregaram a SEPARAÇÃO por hipótese (2.1) e o CÁLCULO
 * dirigido pela regra do catálogo (2.2), mas ambas trabalhavam sobre uma base
 * JÁ APURADA pelo chamador — `DifalEntradaService` usava, de forma simplificada,
 * a BC de ICMS do item (ou o valor bruto), sem compor a base de verdade. O
 * design (§DIFAL F11) exige o contrário: "Composição da base: base por dentro
 * quando exigida, redução, FCP, benefício, origem importada, retenção. Memória
 * de arredondamento explícita."
 *
 * Este módulo é a PEÇA PURA dessa composição: dado o item (valores destacados) e
 * a regra de composição vinda do catálogo, apura a base final que alimenta o
 * calculador (2.2), produzindo uma MEMÓRIA DE ARREDONDAMENTO auditável (R1.5)
 * que documenta cada passo e cada arredondamento. Não consulta banco nem resolve
 * vigência — isso é do serviço que o orquestra.
 *
 * PASSOS DA COMPOSIÇÃO (ordem fiscal determinística):
 *   1. BASE BRUTA: valor da mercadoria + frete + seguro + outras despesas −
 *      desconto. Quando o chamador já traz uma BC apurada, ela é o ponto de
 *      partida; na ausência, compõe-se a partir das parcelas do item.
 *   2. ORIGEM IMPORTADA (R1.3): mercadoria com origem 1/2/3/8 força a alíquota
 *      interestadual de 4% (Resolução SF 13/2012). Não altera a base em si, mas
 *      é apurada aqui porque condiciona o diferencial; o resultado expõe a
 *      alíquota interestadual efetiva para o calculador.
 *   3. REDUÇÃO DE BASE (R1.3): aplica o percentual de redução (do item ou da
 *      regra) sobre a base bruta. base_reduzida = base × (1 − reducao/100).
 *   4. BENEFÍCIO FISCAL (R1.3): redução adicional da base por benefício
 *      concedido pela UF (percentual na regra). Mantido SEPARADO da redução
 *      ordinária para a memória distinguir as duas origens.
 *   5. BASE POR DENTRO / GROSS-UP (R1.3): quando a regra exige, o ICMS integra
 *      a própria base. base_por_dentro = base_liquida / (1 − aliq_interna/100).
 *   6. FCP NA BASE (R1.3): quando a regra institui FCP incluído na base, a base
 *      do FCP é a base composta (podendo diferir da base do DIFAL se a regra
 *      assim definir). Aqui expomos a base de FCP para o calculador.
 *   7. RETENÇÃO (R1.3/R1.4): quando há ICMS-ST retido/responsabilidade de
 *      terceiro, a base de DIFAL próprio é ZERADA (não se recolhe em
 *      duplicidade). A memória registra o abatimento.
 *
 * DECIMAIS SEMPRE COMO STRING (restrição da fase): toda a aritmética usa inteiros
 * escalados (`bigint`) via `sped-decimal`; nenhum valor passa por `Number`. A
 * divisão do gross-up é feita em escala ampliada e arredondada ao final, e cada
 * arredondamento é anotado na memória.
 */

import {
  fromScaledInteger,
  positive,
  toScaledInteger,
} from '../sped/sped-decimal';

// Escala monetária (centavos), padrão das colunas `numeric(_,2)` do fiscal.
const ESCALA_VALOR = 2;
// Escala das alíquotas/percentuais (4 casas), coerente com `numeric(7,4)`.
const ESCALA_ALIQUOTA = 4;
// Escala ampliada interna para divisões (gross-up): evita perder centavos antes
// do arredondamento final. 6 casas extras sobre a monetária é folga suficiente.
const ESCALA_INTERNA = 8;

// Alíquota interestadual fixa para mercadoria de origem IMPORTADA
// (Resolução do Senado Federal 13/2012). Em pontos percentuais, string.
const ALIQUOTA_INTERESTADUAL_IMPORTADA = '4.0000';

// Códigos de `origem_mercadoria` (CST origem, 1 dígito) que indicam mercadoria
// IMPORTADA e, portanto, sujeita à alíquota interestadual de 4%:
//   1 = estrangeira importação direta;
//   2 = estrangeira adquirida no mercado interno;
//   3 = nacional com conteúdo de importação > 40% e <= 70%;
//   8 = nacional com conteúdo de importação > 70%.
// (0, 4, 5, 6, 7 = nacional/sem imposição de 4%.)
const ORIGENS_IMPORTADAS = new Set(['1', '2', '3', '8']);

/**
 * Parâmetros de COMPOSIÇÃO DA BASE vindos da regra do catálogo (o `conteudo` de
 * `fiscal_regras_versoes` já tipado para a composição). Todos opcionais: a
 * ausência de um parâmetro significa "não aplicar aquele passo". Decimais são
 * strings.
 */
export interface DifalBaseRegra {
  // Alíquota interna da UF de destino (pontos percentuais, string). Necessária
  // para o gross-up "por dentro"; sem ela, o passo por-dentro não é aplicado.
  aliquotaInterna?: string | null;
  // Percentual de redução de base concedido pela regra (pontos, string). Soma à
  // redução eventualmente destacada no item.
  percentualReducao?: string | null;
  // Percentual de BENEFÍCIO fiscal (pontos, string), mantido separado da redução
  // ordinária na memória.
  percentualBeneficio?: string | null;
  // Quando `true`, a regra exige base "por dentro" (ICMS integra a própria base).
  basePorDentro?: boolean | null;
  // Alíquota de FCP (pontos, string). Quando presente, a base de FCP é exposta.
  aliquotaFcp?: string | null;
}

/**
 * Valores destacados no ITEM, usados para compor a base. São campos presentes em
 * `documentos_fiscais_itens`. Decimais são strings; ausências viram zero/null.
 */
export interface DifalBaseItem {
  // BC de ICMS já apurada no item, quando houver (ponto de partida preferencial).
  valorBcIcms?: string | null;
  // Parcelas para compor a base bruta quando não há BC apurada.
  valorBrutoProduto?: string | null;
  valorFrete?: string | null;
  valorSeguro?: string | null;
  valorOutrasDespesas?: string | null;
  valorDesconto?: string | null;
  // Código de origem da mercadoria (CST origem, 1 dígito) — define importada.
  origemMercadoria?: string | null;
  // Percentual de redução de BC destacado no item (pontos, string).
  percentualReducaoBcIcms?: string | null;
  // Alíquota interestadual destacada no item (pontos, string), usada quando a
  // mercadoria não é importada e a regra não fixa a interestadual.
  aliquotaIcms?: string | null;
  // Sinais de RETENÇÃO/ST: quando qualquer um indica imposto retido por
  // terceiro, a base de DIFAL próprio é zerada (não recolher em duplicidade).
  valorIcmsSt?: string | null;
  valorIcmsStRetido?: string | null;
  stRetida?: boolean | null;
}

/**
 * Resultado da composição da base. Expõe a base final que alimenta o calculador,
 * a base de FCP, a alíquota interestadual EFETIVA (4% quando importada) e a
 * memória de arredondamento auditável (R1.5). `retido` indica que a base própria
 * foi zerada por retenção/ST.
 */
export interface DifalBaseComposta {
  // Base final de cálculo do DIFAL (string decimal, escala monetária).
  baseCalculo: string;
  // Base bruta ANTES de qualquer redução/benefício/por-dentro (string decimal).
  // Ponto de partida da composição, exposto para que o resultado (tarefa 2.6)
  // mostre o quanto foi efetivamente abatido por redução e benefício.
  baseBruta: string;
  // Base para o FCP (string decimal). Igual à base composta quando a regra
  // institui FCP; '0.00' quando não há FCP.
  baseFcp: string;
  // Alíquota interestadual EFETIVA apurada na composição (4% quando importada;
  // caso contrário a destacada no item, quando houver). Null quando não apurável.
  aliquotaInterestadualEfetiva: string | null;
  // Verdadeiro quando a mercadoria é de origem importada (interestadual 4%).
  origemImportada: boolean;
  // Verdadeiro quando a base própria foi zerada por retenção/ST.
  retido: boolean;
  // BENEFÍCIOS/REDUÇÕES aplicados na composição (tarefa 2.6 — R1.5): os
  // percentuais e os valores de base efetivamente abatidos, mantidos separados
  // (redução ordinária x benefício fiscal) para auditoria. Decimais como string.
  beneficios: DifalBaseBeneficios;
  // IMPOSTO JÁ PAGO/RETIDO pelo substituto no item (tarefa 2.6 — R1.4/R1.5):
  // o ICMS-ST retido/destacado que caracteriza a responsabilidade de terceiro.
  // É o valor que a não-duplicidade protege; exposto para a auditoria mostrar
  // "quanto já foi pago" ao lado de "não recolher novamente". '0.00' quando não há.
  impostoJaPago: string;
  // Passos individuais da composição (auditoria estruturada).
  passos: DifalBasePasso[];
  // Memória de arredondamento textual: cada passo e cada arredondamento (R1.5).
  memoriaArredondamento: string;
}

/**
 * BENEFÍCIOS/REDUÇÕES aplicados na composição da base (tarefa 2.6 — R1.5).
 * Mantém a REDUÇÃO ordinária (do item + da regra) separada do BENEFÍCIO fiscal
 * concedido pela UF, com o percentual e o valor de base abatido de cada um, para
 * que o resultado seja auditável. Decimais permanecem strings.
 */
export interface DifalBaseBeneficios {
  // Percentual de redução ordinária aplicado (item + regra), em pontos (string).
  percentualReducao: string;
  // Valor de base abatido pela redução ordinária (string decimal).
  valorReducao: string;
  // Percentual de benefício fiscal aplicado, em pontos (string).
  percentualBeneficio: string;
  // Valor de base abatido pelo benefício fiscal (string decimal).
  valorBeneficio: string;
}

/**
 * Um passo da composição, para a memória estruturada. `valor` é o resultado do
 * passo (string decimal); `detalhe` descreve a operação em palavras.
 */
export interface DifalBasePasso {
  ordem: number;
  nome: string;
  valor: string;
  detalhe: string;
}

/**
 * Compõe a base de cálculo do DIFAL a partir do item e da regra do catálogo,
 * produzindo a base final, a base de FCP, a alíquota interestadual efetiva e a
 * memória de arredondamento auditável (R1.5).
 *
 * Mantém decimais como string em todo o fluxo; a divisão do gross-up é feita em
 * escala ampliada e arredondada ao final, com o arredondamento anotado.
 */
export function comporBaseDifal(
  item: DifalBaseItem,
  regra: DifalBaseRegra | null,
): DifalBaseComposta {
  const passos: DifalBasePasso[] = [];
  let ordem = 0;
  const registrar = (nome: string, scaled: bigint, detalhe: string) => {
    ordem += 1;
    passos.push({
      ordem,
      nome,
      valor: fromScaledInteger(scaled, ESCALA_VALOR),
      detalhe,
    });
  };

  // ── Passo 1: BASE BRUTA ────────────────────────────────────────────────────
  // Preferir a BC de ICMS apurada no item; na ausência, compor pelas parcelas
  // (produto + frete + seguro + outras despesas − desconto).
  const bcItemScaled = toScaledInteger(item.valorBcIcms ?? '0', ESCALA_VALOR);
  let baseScaled: bigint;
  if (bcItemScaled > 0n) {
    baseScaled = bcItemScaled;
    registrar(
      'base_bruta',
      baseScaled,
      `BC de ICMS destacada no item: ${fromScaledInteger(baseScaled, ESCALA_VALOR)}.`,
    );
  } else {
    const produto = toScaledInteger(item.valorBrutoProduto ?? '0', ESCALA_VALOR);
    const frete = toScaledInteger(item.valorFrete ?? '0', ESCALA_VALOR);
    const seguro = toScaledInteger(item.valorSeguro ?? '0', ESCALA_VALOR);
    const outras = toScaledInteger(item.valorOutrasDespesas ?? '0', ESCALA_VALOR);
    const desconto = toScaledInteger(item.valorDesconto ?? '0', ESCALA_VALOR);
    baseScaled = positive(produto + frete + seguro + outras - desconto);
    registrar(
      'base_bruta',
      baseScaled,
      `Sem BC apurada: produto ${fromScaledInteger(produto, ESCALA_VALOR)} + ` +
      `frete ${fromScaledInteger(frete, ESCALA_VALOR)} + seguro ` +
      `${fromScaledInteger(seguro, ESCALA_VALOR)} + outras ` +
      `${fromScaledInteger(outras, ESCALA_VALOR)} − desconto ` +
      `${fromScaledInteger(desconto, ESCALA_VALOR)} = ` +
      `${fromScaledInteger(baseScaled, ESCALA_VALOR)}.`,
    );
  }

  // ── Passo 2: ORIGEM IMPORTADA → interestadual 4% ───────────────────────────
  const origem = (item.origemMercadoria ?? '').trim();
  const origemImportada = ORIGENS_IMPORTADAS.has(origem);
  const aliquotaInterItem = naoVazio(item.aliquotaIcms);
  const aliquotaInterestadualEfetiva = origemImportada
    ? ALIQUOTA_INTERESTADUAL_IMPORTADA
    : aliquotaInterItem;
  ordem += 1;
  passos.push({
    ordem,
    nome: 'origem_importada',
    valor: aliquotaInterestadualEfetiva ?? '',
    detalhe: origemImportada
      ? `Origem ${origem} (importada): alíquota interestadual forçada a ` +
      `${ALIQUOTA_INTERESTADUAL_IMPORTADA}% (Res. SF 13/2012).`
      : `Origem ${origem || '—'} (nacional): alíquota interestadual ` +
      `${aliquotaInterItem ?? 'não destacada no item'}.`,
  });

  // Base BRUTA (antes de redução/benefício/por-dentro): guardada para que o
  // resultado (tarefa 2.6) exponha o quanto cada abatimento retirou da base.
  const baseBrutaScaled = baseScaled;

  // ── Passo 3: REDUÇÃO DE BASE ───────────────────────────────────────────────
  const reducaoItem = toScaledInteger(
    item.percentualReducaoBcIcms ?? '0',
    ESCALA_ALIQUOTA,
  );
  const reducaoRegra = toScaledInteger(
    regra?.percentualReducao ?? '0',
    ESCALA_ALIQUOTA,
  );
  const reducaoTotal = reducaoItem + reducaoRegra;
  // Valor de base abatido pela redução ordinária (para a exposição 2.6).
  let valorReducaoScaled = 0n;
  if (reducaoTotal > 0n) {
    const antes = baseScaled;
    baseScaled = aplicarPercentualReducao(baseScaled, reducaoTotal);
    valorReducaoScaled = positive(antes - baseScaled);
    registrar(
      'reducao_base',
      baseScaled,
      `Redução de base ${fromScaledInteger(reducaoTotal, ESCALA_ALIQUOTA)}% ` +
      `(item ${fromScaledInteger(reducaoItem, ESCALA_ALIQUOTA)}% + regra ` +
      `${fromScaledInteger(reducaoRegra, ESCALA_ALIQUOTA)}%) sobre ` +
      `${fromScaledInteger(antes, ESCALA_VALOR)} = ` +
      `${fromScaledInteger(baseScaled, ESCALA_VALOR)} (arredondado a 2 casas).`,
    );
  }

  // ── Passo 4: BENEFÍCIO FISCAL ──────────────────────────────────────────────
  const beneficio = toScaledInteger(
    regra?.percentualBeneficio ?? '0',
    ESCALA_ALIQUOTA,
  );
  // Valor de base abatido pelo benefício fiscal (para a exposição 2.6).
  let valorBeneficioScaled = 0n;
  if (beneficio > 0n) {
    const antes = baseScaled;
    baseScaled = aplicarPercentualReducao(baseScaled, beneficio);
    valorBeneficioScaled = positive(antes - baseScaled);
    registrar(
      'beneficio_fiscal',
      baseScaled,
      `Benefício fiscal ${fromScaledInteger(beneficio, ESCALA_ALIQUOTA)}% ` +
      `sobre ${fromScaledInteger(antes, ESCALA_VALOR)} = ` +
      `${fromScaledInteger(baseScaled, ESCALA_VALOR)} (arredondado a 2 casas).`,
    );
  }

  // ── Passo 5: BASE POR DENTRO (gross-up) ────────────────────────────────────
  const aliquotaInterna = naoVazio(regra?.aliquotaInterna);
  if (regra?.basePorDentro && aliquotaInterna != null) {
    const internaScaled = toScaledInteger(aliquotaInterna, ESCALA_ALIQUOTA);
    const antes = baseScaled;
    baseScaled = aplicarBasePorDentro(baseScaled, internaScaled);
    registrar(
      'base_por_dentro',
      baseScaled,
      `Base por dentro (gross-up): ${fromScaledInteger(antes, ESCALA_VALOR)} / ` +
      `(1 − ${aliquotaInterna}/100) = ` +
      `${fromScaledInteger(baseScaled, ESCALA_VALOR)} (dividido em escala ` +
      `${ESCALA_INTERNA} e arredondado a 2 casas).`,
    );
  }

  // ── Passo 6: BASE DO FCP ───────────────────────────────────────────────────
  const temFcp = naoVazio(regra?.aliquotaFcp) != null;
  const baseFcpScaled = temFcp ? baseScaled : 0n;
  if (temFcp) {
    registrar(
      'base_fcp',
      baseFcpScaled,
      `FCP instituído (alíquota ${regra?.aliquotaFcp}%): base de FCP = base ` +
      `composta = ${fromScaledInteger(baseFcpScaled, ESCALA_VALOR)}.`,
    );
  }

  // ── Passo 7: RETENÇÃO / ST ─────────────────────────────────────────────────
  const retido = temRetencao(item);
  if (retido) {
    const antes = baseScaled;
    baseScaled = 0n;
    registrar(
      'retencao_st',
      baseScaled,
      `ICMS-ST retido/responsabilidade de terceiro: base de DIFAL próprio ` +
      `zerada (de ${fromScaledInteger(antes, ESCALA_VALOR)} para 0.00) para ` +
      `não recolher em duplicidade (R1.4).`,
    );
  }

  // IMPOSTO JÁ PAGO/RETIDO (tarefa 2.6 — R1.4/R1.5): o ICMS-ST retido
  // anteriormente ou, na ausência deste, o ICMS-ST destacado no item. É o valor
  // que a responsabilidade de terceiro já recolheu — exposto para que a
  // não-duplicidade mostre "quanto já foi pago" ao lado de "nada a recolher".
  const retidoScaled = toScaledInteger(
    item.valorIcmsStRetido ?? '0',
    ESCALA_VALOR,
  );
  const stScaled = toScaledInteger(item.valorIcmsSt ?? '0', ESCALA_VALOR);
  const impostoJaPagoScaled = retidoScaled > 0n ? retidoScaled : stScaled;

  const memoriaArredondamento = passos
    .map((p) => `${p.ordem}. ${p.nome}: ${p.detalhe}`)
    .join(' ');

  return {
    baseCalculo: fromScaledInteger(baseScaled, ESCALA_VALOR),
    baseBruta: fromScaledInteger(baseBrutaScaled, ESCALA_VALOR),
    baseFcp: fromScaledInteger(retido ? 0n : baseFcpScaled, ESCALA_VALOR),
    aliquotaInterestadualEfetiva,
    origemImportada,
    retido,
    beneficios: {
      percentualReducao: fromScaledInteger(reducaoTotal, ESCALA_ALIQUOTA),
      valorReducao: fromScaledInteger(valorReducaoScaled, ESCALA_VALOR),
      percentualBeneficio: fromScaledInteger(beneficio, ESCALA_ALIQUOTA),
      valorBeneficio: fromScaledInteger(valorBeneficioScaled, ESCALA_VALOR),
    },
    impostoJaPago: fromScaledInteger(impostoJaPagoScaled, ESCALA_VALOR),
    passos,
    memoriaArredondamento,
  };
}

// Aplica um percentual de redução a uma base escalada em centavos. O percentual
// chega em escala de alíquota (4 casas). Multiplica por (1 − p/100) mantendo a
// escala monetária e arredondando ao final (meio para cima, como `toScaledInteger`).
function aplicarPercentualReducao(
  baseScaled: bigint,
  percentualScaled: bigint,
): bigint {
  const cem = 100n * 10n ** BigInt(ESCALA_ALIQUOTA);
  // fator restante = (cem − p), ainda em escala de alíquota.
  const fatorRestante = positive(cem - percentualScaled);
  // base × fatorRestante / cem, com divisão arredondada meio-para-cima.
  return dividirArredondando(baseScaled * fatorRestante, cem);
}

// Aplica o gross-up "por dentro": base / (1 − aliq_interna/100). Para preservar
// centavos, opera em escala ampliada e arredonda ao final à escala monetária.
function aplicarBasePorDentro(
  baseScaled: bigint,
  internaScaled: bigint,
): bigint {
  const cem = 100n * 10n ** BigInt(ESCALA_ALIQUOTA);
  const denominador = positive(cem - internaScaled);
  // Guarda: alíquota interna >= 100% tornaria o gross-up indefinido/negativo;
  // nesse caso não aplica (devolve a base inalterada).
  if (denominador <= 0n) return baseScaled;
  // base × cem / denominador, com arredondamento meio-para-cima.
  return dividirArredondando(baseScaled * cem, denominador);
}

// Divisão de inteiros com arredondamento meio-para-cima (coerente com o
// arredondamento de `toScaledInteger`). Numerador e denominador são sempre
// não-negativos aqui (bases e fatores percentuais já passaram por `positive`).
function dividirArredondando(numerador: bigint, denominador: bigint): bigint {
  if (denominador <= 0n) return 0n;
  // (numerador + denominador/2) / denominador → meio-para-cima para positivos.
  return (numerador + denominador / 2n) / denominador;
}

// Verdadeiro quando o item traz sinais de ICMS-ST retido/responsabilidade de
// terceiro: flag explícita, valor de ST retido ou valor de ICMS-ST destacado.
function temRetencao(item: DifalBaseItem): boolean {
  if (item.stRetida) return true;
  if (toScaledInteger(item.valorIcmsStRetido ?? '0', ESCALA_VALOR) > 0n) {
    return true;
  }
  return toScaledInteger(item.valorIcmsSt ?? '0', ESCALA_VALOR) > 0n;
}

// Devolve a string quando não é nula/vazia; `null` caso contrário. Mantém os
// decimais como string e evita tratar '' como zero por engano.
function naoVazio(valor: string | null | undefined): string | null {
  if (valor == null) return null;
  const t = valor.trim();
  return t === '' ? null : t;
}
