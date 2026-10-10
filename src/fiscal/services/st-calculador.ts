/**
 * CALCULADOR DE ST COM SEPARAÇÃO DOS COMPONENTES (Fase 4 / tarefa 4.3 — R3.2).
 *
 * As tarefas anteriores de ST entregaram a VERIFICAÇÃO da fonte (4.1 —
 * `st-verificacao.ts`) e o ENQUADRAMENTO produto/CEST/UF/vigência (4.2 —
 * `st-enquadramento.ts`), mas nenhuma CALCULA a ST. O estado legado (builder de
 * ST) totalizava ST/FCP num bolo único e admitia ajustes genéricos. O design
 * (§ST/FCP F18) e R3.2 exigem o contrário: "O sistema DEVE separar
 * substituto/substituído, imposto próprio, retenção, restituição/ressarcimento/
 * complemento e FCP." Este módulo é esse calculador — e sua razão de existir é
 * exatamente a SEPARAÇÃO: cada conceito sai como um componente próprio, tipado e
 * auditável, nunca amalgamado.
 *
 * OS CONCEITOS, SEPARADOS (R3.2):
 *   • SUBSTITUTO x SUBSTITUÍDO — papéis distintos na operação. O SUBSTITUTO é o
 *     contribuinte que RETÉM/recolhe a ST (tipicamente o remetente/industrial);
 *     o SUBSTITUÍDO é aquele cujo imposto foi retido (tipicamente o adquirente
 *     na cadeia seguinte). O papel determina QUEM calcula/retém e muda o sentido
 *     do resultado (há retenção a recolher x há imposto já retido na entrada).
 *   • IMPOSTO PRÓPRIO — o ICMS da OPERAÇÃO PRÓPRIA do substituto (base própria ×
 *     alíquota própria). É o imposto da operação em si, SEPARADO da ST.
 *   • RETENÇÃO (ICMS-ST retido) — o imposto da substituição: ICMS incidente
 *     sobre a base de ST (base própria acrescida da MVA) MENOS o imposto próprio.
 *     É o valor que o substituto RETÉM. Exposto por si, nunca somado ao próprio.
 *   • RESTITUIÇÃO / RESSARCIMENTO / COMPLEMENTO — ajustes do substituído sobre a
 *     ST já retida, decorrentes da diferença entre a base presumida (MVA) e a
 *     base de venda EFETIVA. São conceitos JURÍDICOS DISTINTOS (não um "ajuste
 *     genérico"): RESTITUIÇÃO (venda a consumidor final por valor MENOR que o
 *     presumido — ST paga a maior, a devolver), RESSARCIMENTO (saída para OUTRA
 *     UF/operação que desfaz a ST retida nesta UF) e COMPLEMENTO (venda por valor
 *     MAIOR que o presumido — ST paga a menor, a complementar). Cada um sai como
 *     entrada TIPADA própria (ver {@link StAjusteTipo}), não um número solto.
 *   • FCP (Fundo de Combate à Pobreza) — componente PRÓPRIO, separado da ST. O
 *     design é explícito (§ST/FCP): "Não transformar FCP em ajuste genérico para
 *     o TXT passar." Aqui o FCP-ST tem base e alíquota próprias e um valor que
 *     NUNCA se mistura ao ICMS-ST.
 *
 * GATE PELO ENQUADRAMENTO (4.2): este calculador NÃO decide se o produto é
 * sujeito à ST — isso é do enquadramento. Ele recebe o `StEnquadramentoStatus` e
 * só produz valores de guia quando o status HABILITA o cálculo
 * (`stEnquadramentoHabilitaCalculo` → `SUJEITO`). `NAO_SUJEITO`/`PENDENCIA`/
 * `BLOQUEADO` nunca viram guia: o resultado sai marcado (`PENDENTE`/`BLOQUEADO`)
 * com memória explicável (R3.4), espelhando `difalPodeGerarGuia`.
 *
 * PEÇA PURA, SEM BANCO: dada a regra já resolvida do catálogo (MVA, alíquotas) e
 * o item, calcula e separa. Não consulta banco nem resolve vigência — isso é do
 * serviço que o orquestra, exatamente como `calcularDifalHipotese`. Mantém a
 * decisão testável sem banco.
 *
 * NÃO FAZ (escopo de outras tarefas): não emite registros filhos C191/C195/C197/
 * E112/E113 (4.4), não faz o bloqueio de cenário não suportado além do gate já
 * herdado (4.5), não concilia com a obrigação (4.6). Produz apenas os
 * COMPONENTES SEPARADOS e a memória auditável.
 *
 * DECIMAIS SEMPRE COMO STRING (restrição da fase): toda a aritmética usa inteiros
 * escalados (`bigint`) via `sped-decimal`; nenhum valor passa por `Number`. MVA
 * e alíquotas chegam como strings e assim permanecem no resultado.
 */

import { fromScaledInteger, positive, toScaledInteger } from '../sped/sped-decimal';
import type { StEnquadramentoStatus } from './st-enquadramento';
import { stEnquadramentoHabilitaCalculo } from './st-enquadramento';

// Escala monetária (centavos), padrão das colunas `numeric(_,2)` do fiscal.
const ESCALA_VALOR = 2;
// Escala de alíquotas/percentuais (4 casas), coerente com `numeric(_,4)` e com
// o uso de escala 4 no DIFAL. MVA também é um percentual, mesma escala.
const ESCALA_ALIQUOTA = 4;

/**
 * Estado do resultado do cálculo de ST quanto à habilitação (R3.2/R3.4),
 * espelhando `DifalCalculoStatus`:
 * - `CALCULADO`: o enquadramento HABILITA (SUJEITO) e a regra está aprovada; os
 *   valores são guia definitiva.
 * - `SIMULACAO`: o enquadramento habilita, porém a regra está vigente e NÃO
 *   aprovada; os componentes são calculados mas identificados como simulação,
 *   nunca guia.
 * - `PENDENTE`: o enquadramento não habilita por PENDÊNCIA (fonte verificada mas
 *   sem regra aprovada / produto sem CEST / exclusão). Sem valores de guia.
 * - `BLOQUEADO`: o enquadramento está BLOQUEADO (fonte não verificada, 4.1). Sem
 *   valores de guia; bloqueio explicável (R3.4).
 */
export type StCalculoStatus = 'CALCULADO' | 'SIMULACAO' | 'PENDENTE' | 'BLOQUEADO';

/**
 * PAPEL do contribuinte na operação de ST (R3.2 — "separar substituto/
 * substituído"). Determina o sentido do cálculo:
 * - `SUBSTITUTO`: retém/recolhe a ST (calcula imposto próprio + base de ST +
 *   retenção a recolher + FCP-ST). É a operação que ORIGINA a retenção.
 * - `SUBSTITUIDO`: teve o imposto retido na entrada. Não há NOVA retenção a
 *   calcular; o que existe é o ICMS-ST JÁ RETIDO (informado) e, eventualmente,
 *   ajustes (restituição/ressarcimento/complemento) sobre a saída efetiva.
 */
export type StPapel = 'SUBSTITUTO' | 'SUBSTITUIDO';

/**
 * TIPO do ajuste de ST do substituído (R3.2 — "restituição/ressarcimento/
 * complemento"), mantidos como conceitos JURÍDICOS DISTINTOS e nunca fundidos
 * num "ajuste genérico":
 * - `RESTITUICAO`: ST retida a MAIOR (venda a consumidor final por valor menor
 *   que o presumido) — valor a restituir ao substituído.
 * - `RESSARCIMENTO`: ST retida nesta UF desfeita por saída para OUTRA UF/
 *   operação — valor a ressarcir.
 * - `COMPLEMENTO`: ST retida a MENOR (venda por valor maior que o presumido) —
 *   valor a complementar/recolher.
 */
export type StAjusteTipo = 'RESTITUICAO' | 'RESSARCIMENTO' | 'COMPLEMENTO';

/**
 * Regra de ST resolvida do catálogo `ST_FCP` para o CEST/UF/competência (o
 * `conteudo` de `fiscal_regras_versoes` tipado para o cálculo). Decimais
 * permanecem strings. É a fonte dos parâmetros — nunca uma tabela fixa.
 */
export interface StRegraCalculo {
  // Alíquota interna da UF de destino aplicável à ST (pontos percentuais,
  // string). Incide sobre a base de ST para apurar o ICMS-ST total.
  aliquotaInterna: string;
  // Alíquota da operação PRÓPRIA do substituto (pontos percentuais, string).
  // Incide sobre a base própria para apurar o imposto próprio, que é ABATIDO do
  // ICMS-ST total para chegar à retenção. Quando ausente, usa a interna.
  aliquotaPropria?: string | null;
  // MVA/IVA-ST (margem de valor agregado, em pontos percentuais, string) que
  // compõe a base de ST a partir da base própria. Sem MVA apurável, não há como
  // formar a base presumida → PENDENTE.
  mva?: string | null;
  // Alíquota de FCP-ST da UF (pontos percentuais, string), quando instituída. O
  // FCP é componente PRÓPRIO; sua base é a mesma base de ST, salvo regra diversa.
  aliquotaFcp?: string | null;
}

/**
 * Um ajuste de ST do substituído a aplicar sobre a saída EFETIVA (R3.2). Cada
 * ajuste é TIPADO ({@link StAjusteTipo}) e traz a base e a memória do seu
 * fundamento, para que a separação restituição/ressarcimento/complemento seja
 * auditável, não um número agregado.
 */
export interface StAjusteEntrada {
  tipo: StAjusteTipo;
  // Valor do ajuste (string decimal). Para RESTITUICAO/RESSARCIMENTO é o valor a
  // devolver/ressarcir ao substituído; para COMPLEMENTO é o valor a complementar.
  // Sempre não-negativo: o SENTIDO vem do `tipo`, não do sinal.
  valor: string;
  // Fundamento textual do ajuste (ex.: "venda a consumidor por valor inferior ao
  // presumido"), para a memória auditável. Opcional.
  fundamento?: string | null;
}

/**
 * Entrada do cálculo de ST de UM item. Traz o enquadramento (gate 4.2), o papel
 * (substituto/substituído), a UF/competência (eixos), a base própria da operação
 * e os ajustes do substituído. A regra do catálogo e a aprovação chegam à parte
 * (como no DIFAL).
 */
export interface StCalculoInput {
  // Status do enquadramento (4.2). SÓ `SUJEITO` habilita o cálculo de guia.
  enquadramento: StEnquadramentoStatus;
  // Papel do contribuinte na operação (R3.2). Dirige o sentido do cálculo.
  papel: StPapel;
  // UF de destino (sigla de 2 letras), eixo de seleção da regra. Ecoada.
  uf: string;
  // Competência mensal 'YYYY-MM', eixo de vigência. Ecoada.
  competencia: string;
  // Base de cálculo da operação PRÓPRIA (string decimal). Ponto de partida: a
  // base de ST é formada aplicando a MVA sobre ela. Para o SUBSTITUIDO, serve de
  // referência das memórias; o imposto novo não é retido por ele.
  basePropria: string;
  // ICMS-ST JÁ RETIDO na entrada (string decimal), relevante ao SUBSTITUIDO: é o
  // imposto que terceiro (substituto) já reteve. Exposto como RETENÇÃO existente,
  // nunca recalculado como se fosse novo. Opcional ('0.00' quando não há).
  icmsStRetidoAnterior?: string | null;
  // Ajustes do substituído (restituição/ressarcimento/complemento), já apurados
  // pelo chamador a partir da saída efetiva. Cada um TIPADO. Opcional.
  ajustes?: StAjusteEntrada[] | null;
}

/**
 * Resultado do cálculo de ST com os COMPONENTES SEPARADOS (R3.2). Cada conceito
 * tem seu campo; nada é amalgamado. Além do estado (R3.4) e da memória, expõe:
 * substituto/substituído (papel), imposto próprio, base de ST, retenção, FCP-ST
 * e os ajustes tipados — além do total agregado dos ajustes apenas para
 * conferência (a separação permanece em `ajustes`).
 */
export interface StCalculoResultado {
  uf: string;
  competencia: string;
  // Papel ecoado (R3.2 — substituto/substituído explícito no resultado).
  papel: StPapel;
  status: StCalculoStatus;
  // Verdadeiro quando o resultado NÃO é guia definitiva (SIMULACAO/PENDENTE/
  // BLOQUEADO). Espelha o `pendente` do DIFAL.
  pendente: boolean;

  // Parâmetros aplicados (strings; null quando não há cálculo).
  aliquotaInterna: string | null;
  aliquotaPropria: string | null;
  mva: string | null;
  aliquotaFcp: string | null;

  // ── COMPONENTES SEPARADOS (R3.2) ───────────────────────────────────────────
  // IMPOSTO PRÓPRIO: ICMS da operação própria do substituto = base própria ×
  // alíquota própria / 100. Separado da ST.
  basePropria: string;
  impostoProprio: string;
  // BASE DE ST: base própria acrescida da MVA = base × (1 + MVA/100).
  baseSt: string;
  // ICMS-ST TOTAL: base de ST × alíquota interna / 100 (antes de abater o
  // próprio). Exposto para a memória; a RETENÇÃO é o que efetivamente se recolhe.
  icmsStTotal: string;
  // RETENÇÃO (ICMS-ST retido a recolher pelo substituto) = ICMS-ST total −
  // imposto próprio. É o componente de retenção, separado do próprio.
  icmsStRetido: string;
  // ICMS-ST JÁ RETIDO na entrada (do substituído), ecoado como retenção
  // existente — não recalculado. '0.00' quando não há.
  icmsStRetidoAnterior: string;
  // FCP-ST: componente PRÓPRIO = base de ST × alíquota FCP / 100. Nunca somado
  // ao ICMS-ST. '0.00' quando a UF não institui FCP para o CEST.
  fcpSt: string;
  // AJUSTES tipados (restituição/ressarcimento/complemento), cada um preservado
  // separadamente. Vazio quando não há ajustes.
  ajustes: StAjusteResultado[];
  // Totais por tipo de ajuste, só para conferência — a separação canônica é a
  // lista `ajustes` acima. Decimais como string.
  totalRestituicao: string;
  totalRessarcimento: string;
  totalComplemento: string;

  // Memória de cálculo textual auditável (sempre preenchida).
  memoria: string;
}

/**
 * Um ajuste no resultado: o tipo, o valor normalizado (escala monetária) e o
 * fundamento. Preserva a tipagem jurídica da entrada no resultado.
 */
export interface StAjusteResultado {
  tipo: StAjusteTipo;
  valor: string;
  fundamento: string | null;
}

/**
 * CALCULA a ST de um item SEPARANDO os componentes (tarefa 4.3 — R3.2),
 * consumindo a regra do catálogo e GATED pelo enquadramento (4.2).
 *
 * Fluxo:
 *  1. GATE DO ENQUADRAMENTO (4.2): se `stEnquadramentoHabilitaCalculo` é falso
 *     (qualquer status != SUJEITO), não há cálculo de guia. O resultado sai
 *     `BLOQUEADO` (enquadramento BLOQUEADO) ou `PENDENTE` (NAO_SUJEITO/
 *     PENDENCIA), com memória explicável. Nunca inventa valores.
 *  2. Sem regra (`regra == null`) ou sem MVA apurável → `PENDENTE`: a base de ST
 *     não pode ser formada; não se presume MVA.
 *  3. Com regra habilitada:
 *       imposto_proprio = base_propria × aliq_propria / 100
 *       base_st         = base_propria × (1 + MVA/100)
 *       icms_st_total   = base_st × aliq_interna / 100
 *       retencao        = icms_st_total − imposto_proprio   (nunca negativa)
 *       fcp_st          = base_st × aliq_fcp / 100           (quando instituído)
 *     Status `CALCULADO` quando a regra é aprovada; `SIMULACAO` quando vigente
 *     porém não aprovada.
 *
 * Os ajustes do substituído (restituição/ressarcimento/complemento) são
 * normalizados e preservados TIPADOS em qualquer estado habilitado — eles podem
 * existir independentemente da retenção (incidem sobre a saída efetiva).
 */
export function calcularSt(
  input: StCalculoInput,
  regra: StRegraCalculo | null,
  opcoes: { aprovada: boolean } = { aprovada: false },
): StCalculoResultado {
  const uf = normalizarUf(input.uf);
  const basePropriaScaled = toScaledInteger(input.basePropria, ESCALA_VALOR);
  const base = {
    uf,
    competencia: input.competencia,
    papel: input.papel,
    basePropria: fromScaledInteger(basePropriaScaled, ESCALA_VALOR),
    icmsStRetidoAnterior: fromScaledInteger(
      toScaledInteger(input.icmsStRetidoAnterior ?? '0', ESCALA_VALOR),
      ESCALA_VALOR,
    ),
    ajustes: normalizarAjustes(input.ajustes),
  };
  const totaisAjuste = totalizarAjustes(base.ajustes);

  // Esqueleto de resultado "sem cálculo" (pendência/bloqueio): componentes
  // zerados, parâmetros nulos, ajustes preservados (podem existir mesmo sem guia).
  const semCalculo = (
    status: StCalculoStatus,
    memoria: string,
  ): StCalculoResultado => ({
    ...base,
    status,
    pendente: true,
    aliquotaInterna: null,
    aliquotaPropria: null,
    mva: null,
    aliquotaFcp: null,
    impostoProprio: fromScaledInteger(0n, ESCALA_VALOR),
    baseSt: fromScaledInteger(0n, ESCALA_VALOR),
    icmsStTotal: fromScaledInteger(0n, ESCALA_VALOR),
    icmsStRetido: fromScaledInteger(0n, ESCALA_VALOR),
    fcpSt: fromScaledInteger(0n, ESCALA_VALOR),
    ...totaisAjuste,
    memoria,
  });

  // 1. GATE DO ENQUADRAMENTO (4.2). Reaproveita a MESMA guarda de 4.2 para não
  //    duplicar a regra: o cálculo só prossegue quando o enquadramento diz
  //    SUJEITO. Distingue BLOQUEADO (fonte não verificada) de PENDENTE (demais).
  if (!stEnquadramentoHabilitaCalculo(input.enquadramento)) {
    const bloqueado = input.enquadramento === 'BLOQUEADO';
    return semCalculo(
      bloqueado ? 'BLOQUEADO' : 'PENDENTE',
      `ST ${uf} (${input.competencia}, papel ${input.papel}): enquadramento ` +
      `${input.enquadramento} NÃO habilita cálculo (4.2). ` +
      (bloqueado
        ? 'Fonte do cenário não verificada (4.1): BLOQUEADO, nunca gera guia (R3.4).'
        : 'Produto não sujeito à ST ou pendência de regra: nenhum valor é ' +
        'tratado como guia (R3.2/R3.4).'),
    );
  }

  // 2. Sem regra homologada/vigente → PENDENTE. Não inventa MVA/alíquota.
  if (!regra) {
    return semCalculo(
      'PENDENTE',
      `ST ${uf} (${input.competencia}, papel ${input.papel}): enquadramento ` +
      'SUJEITO porém sem regra de ST (MVA/alíquotas) resolvida para o CEST na ' +
      'competência. Resultado em pendência (R3.2): base de ST não formada.',
    );
  }

  // MVA é indispensável para formar a base de ST; sem ela não se presume margem.
  const mvaStr = naoVazio(regra.mva);
  if (mvaStr == null) {
    return semCalculo(
      'PENDENTE',
      `ST ${uf} (${input.competencia}, papel ${input.papel}): regra de ST sem ` +
      'MVA/IVA-ST apurável. A base de ST não pode ser formada sem a margem; ' +
      'nenhum valor é presumido (R3.2). Pendência.',
    );
  }

  // ── CÁLCULO E SEPARAÇÃO DOS COMPONENTES (R3.2) ─────────────────────────────
  const internaStr = regra.aliquotaInterna;
  // Alíquota própria: preferir a da regra; cair para a interna quando ausente
  // (operação própria do substituto tributada à interna). Nunca fallback oculto
  // além desse — ambas vêm do catálogo.
  const propriaStr = naoVazio(regra.aliquotaPropria) ?? internaStr;
  const fcpStr = naoVazio(regra.aliquotaFcp);

  const internaScaled = toScaledInteger(internaStr, ESCALA_ALIQUOTA);
  const propriaScaled = toScaledInteger(propriaStr, ESCALA_ALIQUOTA);
  const mvaScaled = toScaledInteger(mvaStr, ESCALA_ALIQUOTA);
  const cemAliquota = 100n * 10n ** BigInt(ESCALA_ALIQUOTA);

  // IMPOSTO PRÓPRIO = base_propria × aliq_propria / 100 (componente separado).
  const impostoProprioScaled = aplicarAliquota(basePropriaScaled, propriaScaled);

  // BASE DE ST = base_propria × (1 + MVA/100). Componente próprio da ST.
  const baseStScaled = aplicarAgregadoMva(basePropriaScaled, mvaScaled);

  // ICMS-ST TOTAL = base_st × aliq_interna / 100 (antes de abater o próprio).
  const icmsStTotalScaled = aplicarAliquota(baseStScaled, internaScaled);

  // RETENÇÃO = ICMS-ST total − imposto próprio (componente de retenção, nunca
  // somado ao próprio). `positive` evita retenção negativa quando o próprio
  // excede o total (não há ST a recolher nesse caso).
  const retencaoScaled = positive(icmsStTotalScaled - impostoProprioScaled);

  // FCP-ST = base_st × aliq_fcp / 100. Componente PRÓPRIO; nunca somado à ST.
  const fcpStScaled =
    fcpStr == null
      ? 0n
      : aplicarAliquota(baseStScaled, toScaledInteger(fcpStr, ESCALA_ALIQUOTA));

  const status: StCalculoStatus = opcoes.aprovada ? 'CALCULADO' : 'SIMULACAO';
  const impostoProprioStr = fromScaledInteger(impostoProprioScaled, ESCALA_VALOR);
  const baseStStr = fromScaledInteger(baseStScaled, ESCALA_VALOR);
  const icmsStTotalStr = fromScaledInteger(icmsStTotalScaled, ESCALA_VALOR);
  const retencaoStr = fromScaledInteger(retencaoScaled, ESCALA_VALOR);
  const fcpStStr = fromScaledInteger(fcpStScaled, ESCALA_VALOR);

  const papelMem =
    input.papel === 'SUBSTITUTO'
      ? 'SUBSTITUTO (retém/recolhe a ST)'
      : 'SUBSTITUÍDO (imposto retido por terceiro)';
  const ajusteMem =
    base.ajustes.length > 0
      ? ' Ajustes do substituído: ' +
      base.ajustes
        .map((a) => `${a.tipo} ${a.valor}`)
        .join(', ') +
      '.'
      : '';

  return {
    ...base,
    status,
    pendente: status !== 'CALCULADO',
    aliquotaInterna: internaStr,
    aliquotaPropria: propriaStr,
    mva: mvaStr,
    aliquotaFcp: fcpStr ?? null,
    impostoProprio: impostoProprioStr,
    baseSt: baseStStr,
    icmsStTotal: icmsStTotalStr,
    icmsStRetido: retencaoStr,
    fcpSt: fcpStStr,
    ...totaisAjuste,
    memoria:
      `ST ${uf} (${input.competencia}), papel ${papelMem}: base própria ` +
      `${base.basePropria} × aliq. própria ${propriaStr} = imposto próprio ` +
      `${impostoProprioStr}; base ST = ${base.basePropria} × (1 + MVA ${mvaStr}%) ` +
      `= ${baseStStr}; ICMS-ST total = ${baseStStr} × interna ${internaStr} = ` +
      `${icmsStTotalStr}; RETENÇÃO = total − próprio = ${retencaoStr}` +
      (fcpStr != null
        ? `; FCP-ST (separado) = ${baseStStr} × ${fcpStr} = ${fcpStStr}`
        : '; sem FCP-ST na UF') +
      '.' +
      ajusteMem +
      (status === 'SIMULACAO'
        ? ' Regra vigente porém NÃO aprovada: simulação, não guia (R3.2).'
        : ''),
  };
}

/**
 * GUARDA DE ELEGIBILIDADE DE GUIA DE ST (tarefa 4.3 — R3.2/R3.4).
 *
 * Único ponto de decisão sobre "este resultado de ST pode virar guia de
 * recolhimento?". SIM apenas quando o estado é `CALCULADO`. `SIMULACAO`
 * (regra não aprovada), `PENDENTE` (sem regra/MVA ou não sujeito) e `BLOQUEADO`
 * (fonte não verificada) NUNCA geram guia. Espelha `difalPodeGerarGuia`/
 * `stEnquadramentoHabilitaCalculo`: isolar a condição garante que todo caminho
 * (registros SPED 4.4, conciliação 4.6) consulte a MESMA regra.
 */
export function stPodeGerarGuia(status: StCalculoStatus): boolean {
  return status === 'CALCULADO';
}

/**
 * Motivo textual auditável de por que um resultado de ST NÃO pode virar guia
 * (R3.2/R3.4). `null` para `CALCULADO` (não há recusa a explicar). Espelha
 * `difalMotivoInelegibilidadeGuia`.
 */
export function stCalculoMotivoInelegibilidade(
  status: StCalculoStatus,
): string | null {
  switch (status) {
    case 'CALCULADO':
      return null;
    case 'SIMULACAO':
      return (
        'ST em SIMULAÇÃO: há regra vigente porém NÃO aprovada. Simulação ' +
        'identificada, nunca guia de recolhimento (R3.2).'
      );
    case 'PENDENTE':
      return (
        'ST em PENDÊNCIA: enquadramento não habilita (não sujeito/pendência) ou ' +
        'falta regra/MVA aprovada. Nenhum valor é tratado como guia (R3.2).'
      );
    case 'BLOQUEADO':
      return (
        'ST BLOQUEADA: a fonte do cenário (Convênio ICMS 142/2018 + legislação ' +
        'estadual) não está verificada (4.1). Cenário não suportado (R3.4).'
      );
  }
}

// Aplica uma alíquota (escala 4) a um valor em centavos (escala 2), com
// arredondamento meio-para-cima, mantendo a escala monetária.
function aplicarAliquota(valorScaled: bigint, aliquotaScaled: bigint): bigint {
  const cem = 100n * 10n ** BigInt(ESCALA_ALIQUOTA);
  return dividirArredondando(valorScaled * aliquotaScaled, cem);
}

// Agrega a MVA à base: base × (1 + MVA/100) = base × (cem + mva) / cem.
// Arredonda meio-para-cima à escala monetária.
function aplicarAgregadoMva(baseScaled: bigint, mvaScaled: bigint): bigint {
  const cem = 100n * 10n ** BigInt(ESCALA_ALIQUOTA);
  const fator = cem + positive(mvaScaled);
  return dividirArredondando(baseScaled * fator, cem);
}

// Divisão de inteiros com arredondamento meio-para-cima (coerente com
// `toScaledInteger`/`difal-base`). Numerador/denominador não-negativos aqui.
function dividirArredondando(numerador: bigint, denominador: bigint): bigint {
  if (denominador <= 0n) return 0n;
  return (numerador + denominador / 2n) / denominador;
}

// Normaliza os ajustes do substituído: tipo preservado, valor em escala
// monetária (sempre não-negativo — o sentido vem do tipo), fundamento opcional.
// Ignora entradas sem tipo válido.
function normalizarAjustes(
  ajustes: StAjusteEntrada[] | null | undefined,
): StAjusteResultado[] {
  if (!ajustes || ajustes.length === 0) return [];
  const tiposValidos = new Set<StAjusteTipo>([
    'RESTITUICAO',
    'RESSARCIMENTO',
    'COMPLEMENTO',
  ]);
  const resultado: StAjusteResultado[] = [];
  for (const ajuste of ajustes) {
    if (!ajuste || !tiposValidos.has(ajuste.tipo)) continue;
    // Magnitude não-negativa: o SENTIDO (devolver/complementar) vem do `tipo`,
    // não do sinal. Um valor acidentalmente negativo preserva sua magnitude
    // (valor absoluto), não vira zero.
    const bruto = toScaledInteger(ajuste.valor, ESCALA_VALOR);
    const valorScaled = bruto < 0n ? -bruto : bruto;
    resultado.push({
      tipo: ajuste.tipo,
      valor: fromScaledInteger(valorScaled, ESCALA_VALOR),
      fundamento: naoVazio(ajuste.fundamento) ?? null,
    });
  }
  return resultado;
}

// Totaliza os ajustes POR TIPO (restituição/ressarcimento/complemento),
// mantendo-os SEPARADOS — nunca um único "ajuste genérico". Só para conferência;
// a separação canônica é a lista `ajustes`.
function totalizarAjustes(ajustes: StAjusteResultado[]): {
  totalRestituicao: string;
  totalRessarcimento: string;
  totalComplemento: string;
} {
  let restituicao = 0n;
  let ressarcimento = 0n;
  let complemento = 0n;
  for (const a of ajustes) {
    const v = toScaledInteger(a.valor, ESCALA_VALOR);
    if (a.tipo === 'RESTITUICAO') restituicao += v;
    else if (a.tipo === 'RESSARCIMENTO') ressarcimento += v;
    else complemento += v;
  }
  return {
    totalRestituicao: fromScaledInteger(restituicao, ESCALA_VALOR),
    totalRessarcimento: fromScaledInteger(ressarcimento, ESCALA_VALOR),
    totalComplemento: fromScaledInteger(complemento, ESCALA_VALOR),
  };
}

// Devolve a string quando não é nula/vazia; `null` caso contrário. Mantém os
// decimais como string e evita tratar '' como zero por engano.
function naoVazio(valor: string | null | undefined): string | null {
  if (valor == null) return null;
  const t = valor.trim();
  return t === '' ? null : t;
}

function normalizarUf(uf: string): string {
  return (uf ?? '').trim().toUpperCase();
}
