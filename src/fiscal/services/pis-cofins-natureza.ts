/**
 * BASES DE PIS/COFINS POR NATUREZA DE RECEITA/CRÉDITO (Fase 4 / tarefa 3.1 —
 * R2.1).
 *
 * O estado anterior (`PisCofinsService`) decidia PIS/COFINS por uma TABELA DE
 * ALÍQUOTAS FIXA (`ALIQUOTAS.CUMULATIVO`/`NAO_CUMULATIVO`) e por `Set`s de CST
 * estáticos (`CST_TRIBUTADO`, `CST_SEM_DEBITO`, `CST_CREDITO`), presumindo o
 * regime cumulativo sempre que o cliente não é `LUCRO_REAL`. O design (§PIS/
 * COFINS por natureza F13) rejeita isso: as bases DEVEM ser organizadas "por
 * natureza de receita/crédito, alíquota, vinculação, regime e vigência (N07/
 * N08)", com os parâmetros vindos do CATÁLOGO NORMATIVO versionado
 * (`FiscalNormativeCatalogService` → `fiscal_regras_versoes`, tipo
 * `PIS_COFINS`), resolvido por NATUREZA + REGIME + VIGÊNCIA (competência) — não
 * por uma tabela embutida nem por ampliação de um `Set`.
 *
 * Este módulo é a PEÇA PURA do cálculo por natureza, espelhando
 * `difal-calculador.ts`: dada uma regra já resolvida do catálogo (os parâmetros
 * vigentes para a natureza/regime/competência) e a base apurada de UMA natureza,
 * calcula o débito (receita) ou o crédito (aquisição) daquela natureza. Não
 * consulta o banco nem resolve vigência — isso é do serviço que o orquestra
 * (`PisCofinsService`), que chama `FiscalNormativeCatalogService.
 * resolverRegraVigente` e repassa a regra aqui. Manter o cálculo puro deixa a
 * aritmética testável sem banco.
 *
 * PRINCÍPIO DE ESCOPO HONESTO (R2.1/R2.5, contexto R1.2): quando NÃO há regra
 * homologada para a natureza/regime/competência, o calculador NÃO inventa
 * alíquota (não cai no cumulativo presumido). Ele devolve um resultado marcado
 * como `PENDENTE` ou `SIMULACAO` (quando há regra vigente mas não aprovada),
 * nunca uma guia definitiva. Os estados espelham `DifalCalculoStatus`.
 *
 * DECIMAIS SEMPRE COMO STRING (restrição da fase): a aritmética usa inteiros
 * escalados (`bigint`) via `sped-decimal`; nenhum valor passa por `Number`. As
 * alíquotas da regra chegam como strings e assim permanecem no resultado.
 *
 * ESCOPO DESTA TAREFA (3.1): estabelecer a ESTRUTURA por natureza — base,
 * alíquota, vinculação, regime, vigência e o estado de guia — dirigida pelo
 * catálogo. As tarefas seguintes consomem/estendem esta estrutura SEM reescrevê-
 * la: 3.2 (razão de receitas não só do XML), 3.3 (saldo credor preservado, sem
 * corte em zero), 3.4 (CST 03 e CST 67 por hipótese, não por `Set`), 3.5 (regime
 * ausente → pendência). Por isso a `naturezaCredito` e a `vinculacao` já existem
 * aqui como eixos, ainda que o cálculo de crédito completo seja da 3.3/3.4.
 */

import {
  fromScaledInteger,
  toScaledInteger,
} from '../sped/sped-decimal';

// Escala monetária (centavos), padrão das colunas `numeric(_,2)` do fiscal.
const ESCALA_VALOR = 2;
// Escala das alíquotas (pontos percentuais, 4 casas), coerente com
// `aliquota_pis_percentual`/`aliquota_cofins_percentual` (numeric) do item.
const ESCALA_ALIQUOTA = 4;

/**
 * Estado do resultado quanto à existência de regra homologada (R2.1/R2.5,
 * mesmo contrato do DIFAL, R1.2):
 * - `CALCULADO`: há regra aprovada e vigente; o valor é apuração definitiva.
 * - `SIMULACAO`: há regra VIGENTE porém NÃO aprovada; o valor é uma simulação
 *   identificada, nunca guia.
 * - `PENDENTE`: não há sequer regra vigente para a natureza/regime/competência;
 *   o calculador não produz valor, apenas registra a pendência. É o estado que
 *   substitui o "cumulativo presumido" quando o regime/natureza não têm regra.
 */
export type PisCofinsCalculoStatus = 'CALCULADO' | 'SIMULACAO' | 'PENDENTE';

/**
 * Tributo apurado por este módulo. PIS e COFINS compartilham a mesma estrutura
 * de natureza/alíquota/regime, com alíquotas próprias cada.
 */
export type PisCofinsTributo = 'PIS' | 'COFINS';

/**
 * Regime de apuração — eixo de seleção da regra (R2.1). Diferente do estado
 * anterior, o regime NÃO é presumido: a ausência (`null`) é tratada pelo
 * chamador como pendência (tarefa 3.5), não como `CUMULATIVO`.
 * - `CUMULATIVO`: Lei 9.718/98 (tipicamente lucro presumido), sem créditos.
 * - `NAO_CUMULATIVO`: Leis 10.637/02 e 10.833/03 (tipicamente lucro real), com
 *   créditos das aquisições vinculadas.
 */
export type PisCofinsRegime = 'CUMULATIVO' | 'NAO_CUMULATIVO';

/**
 * NATUREZA da receita, o eixo central da organização (R2.1). Substitui os
 * `Set`s de CST estáticos: cada natureza carrega sua própria regra (alíquota,
 * se gera débito) resolvida do catálogo, em vez de um CST ser classificado por
 * pertencer a um `Set` embutido. A natureza é derivada do CST + hipótese pelo
 * chamador; aqui ela é um eixo de seleção/exposição.
 *
 * - `TRIBUTADA`: receita que gera débito próprio (CST 01/02 e equivalentes).
 * - `MONOFASICA`: receita de produto monofásico — não gera débito próprio na
 *   etapa (o tributo foi concentrado); a receita é registrada, mas sem débito.
 * - `SUBSTITUICAO`: receita sob substituição tributária (CST 05) — sem débito
 *   próprio.
 * - `ALIQUOTA_ZERO`: receita com alíquota zero/isenta/suspensa (CST 04/06/07/
 *   08/09) — sem débito, base registrada.
 * - `EXPORTACAO`: receita de exportação (imune/isenta) — sem débito, com direito
 *   a crédito vinculado (tratado nas tarefas de crédito).
 * - `OUTRA`: natureza não enquadrada acima; sem regra → pendência.
 */
export type PisCofinsNaturezaReceita =
  | 'TRIBUTADA'
  | 'MONOFASICA'
  | 'SUBSTITUICAO'
  | 'ALIQUOTA_ZERO'
  | 'EXPORTACAO'
  | 'OUTRA';

/**
 * NATUREZA do crédito (regime não-cumulativo). Mantida como eixo desde já para
 * que as tarefas 3.3/3.4 (CST 03, CST 67, saldo credor) a consumam SEM misturar
 * tipos de crédito num único `Set` (R2.4). O cálculo completo de crédito por
 * natureza é das tarefas seguintes; aqui ela entra como eixo de classificação.
 *
 * - `BASICO`: crédito básico das aquisições (CST 50–56).
 * - `PRESUMIDO`: crédito presumido (ex.: CST 60–66, agroindústria) — NÃO se
 *   mistura ao básico (R2.4).
 * - `IMPORTACAO`: crédito sobre importação.
 * - `NENHUM`: natureza de receita (sem crédito) ou regime cumulativo.
 */
export type PisCofinsNaturezaCredito =
  | 'BASICO'
  | 'PRESUMIDO'
  | 'IMPORTACAO'
  | 'NENHUM';

/**
 * VINCULAÇÃO da receita/crédito à natureza da operação — eixo exigido por R2.1
 * (N07/N08) e pela segregação do Bloco M da EFD-Contribuições. Determina a que
 * tipo de receita o crédito se vincula (base para rateio de crédito nas tarefas
 * seguintes). Mantida aqui como eixo estrutural.
 *
 * - `MERCADO_INTERNO_TRIBUTADO`: operação tributada no mercado interno.
 * - `MERCADO_INTERNO_NAO_TRIBUTADO`: operação não tributada no mercado interno
 *   (monofásica/alíquota zero/ST/isenta).
 * - `EXPORTACAO`: operação de exportação (receita imune, crédito vinculado).
 * - `NAO_APLICAVEL`: quando a vinculação não se aplica.
 */
export type PisCofinsVinculacao =
  | 'MERCADO_INTERNO_TRIBUTADO'
  | 'MERCADO_INTERNO_NAO_TRIBUTADO'
  | 'EXPORTACAO'
  | 'NAO_APLICAVEL';

/**
 * Regra de PIS/COFINS resolvida do catálogo para uma natureza/regime/
 * competência. É o `conteudo` de `fiscal_regras_versoes` (tipo `PIS_COFINS`) já
 * tipado, com os campos que o cálculo consome. Decimais permanecem strings. A
 * ausência desta regra (`null` no chamador) é o que gera o estado `PENDENTE` —
 * jamais o cumulativo presumido.
 */
export interface PisCofinsRegra {
  // Regime que a regra parametriza (eixo de seleção; ecoado no resultado).
  regime: PisCofinsRegime;
  // Alíquota de PIS aplicável à natureza (pontos percentuais, string).
  aliquotaPis: string;
  // Alíquota de COFINS aplicável à natureza (pontos percentuais, string).
  aliquotaCofins: string;
  // Verdadeiro quando a natureza GERA DÉBITO próprio (receita tributada). Falso
  // para monofásica/ST/alíquota zero/exportação: a base é registrada, mas não
  // há débito. Substitui a decisão por `Set` de CST (R2.4).
  geraDebito: boolean;
  // Verdadeiro quando a natureza/regime DÁ DIREITO A CRÉDITO sobre a base
  // (regime não-cumulativo). O cálculo de crédito completo é das tarefas 3.3/
  // 3.4; aqui o campo determina se a base alimenta débito ou crédito.
  geraCredito: boolean;
  // Natureza do crédito, quando `geraCredito` (R2.4 — não misturar tipos).
  naturezaCredito?: PisCofinsNaturezaCredito | null;
}

/**
 * Entrada do cálculo de UMA natureza: o tributo (PIS/COFINS), a natureza da
 * receita, a vinculação, o regime, a competência (vigência) e a base já apurada
 * pelo chamador para aquela natureza. A `aliquotaItem` permite honrar a alíquota
 * destacada no item (ex.: CST 02, diferenciada), caindo na alíquota da regra
 * apenas quando o item não a informa (espelha o padrão R5.2 do serviço atual).
 */
export interface PisCofinsCalculoInput {
  tributo: PisCofinsTributo;
  natureza: PisCofinsNaturezaReceita;
  vinculacao: PisCofinsVinculacao;
  // Regime do cliente na competência; `null` quando ausente → PENDENTE (3.5).
  regime: PisCofinsRegime | null;
  // Competência mensal 'YYYY-MM', eixo de vigência (R2.1).
  competencia: string;
  // Base de cálculo já apurada pelo chamador para esta natureza (string
  // decimal). A composição do razão de receitas (não só do XML) é a tarefa 3.2.
  base: string;
  // Alíquota destacada no item, usada quando a regra não fixa a da natureza.
  // Mantém decimais como string; nunca inventa fallback silencioso.
  aliquotaItem?: string | null;
}

/**
 * Resultado do cálculo de uma natureza. Expõe os eixos de seleção (tributo,
 * natureza, vinculação, regime, competência), os parâmetros aplicados
 * (alíquota, naturezas de crédito), a base, o débito/crédito apurados, o estado
 * (R2.1) e uma memória textual auditável. As tarefas seguintes ampliam a
 * exposição (saldo credor, pendências de receita); aqui já saem os campos
 * essenciais da estrutura por natureza.
 */
export interface PisCofinsCalculoResultado {
  tributo: PisCofinsTributo;
  natureza: PisCofinsNaturezaReceita;
  vinculacao: PisCofinsVinculacao;
  // Regime efetivamente aplicado (da regra). `null` quando PENDENTE por regime
  // ausente ou por falta de regra.
  regime: PisCofinsRegime | null;
  competencia: string;
  status: PisCofinsCalculoStatus;
  base: string;
  // Alíquota aplicada à natureza (string) ou `null` quando não apurável.
  aliquota: string | null;
  // Natureza do crédito, quando a natureza/regime dá direito a crédito.
  naturezaCredito: PisCofinsNaturezaCredito | null;
  // Débito apurado (receita tributada). '0.00' quando a natureza não gera
  // débito ou quando pendente.
  debito: string;
  // Crédito apurado (aquisição vinculada, não-cumulativo). '0.00' quando a
  // natureza não gera crédito ou quando pendente. O transporte de saldo credor
  // (sem corte em zero) é a tarefa 3.3.
  credito: string;
  // Memória de cálculo textual (auditoria): a fórmula aplicada em palavras.
  memoria: string;
  // Verdadeiro quando o resultado NÃO é apuração definitiva (SIMULACAO/PENDENTE).
  pendente: boolean;
}

/**
 * Calcula o débito/crédito de UMA natureza de PIS/COFINS consumindo a regra do
 * catálogo.
 *
 * Fluxo (espelha `calcularDifalHipotese`):
 *  1. Regime ausente no input (`input.regime == null`) → `PENDENTE` (3.5/R2.5):
 *     o regime NÃO é presumido cumulativo; sem regime não se apura.
 *  2. Sem regra (`regra == null`) → `PENDENTE` (R2.1): não há parâmetro
 *     homologado nem vigente para a natureza/regime/competência; devolve
 *     resultado sem valor, apenas a pendência.
 *  3. Sem alíquota apurável para uma natureza que GERA débito/crédito →
 *     `PENDENTE`: não inventa a alíquota do regime como a tabela fixa fazia.
 *  4. Com regra porém `aprovada === false` → `SIMULACAO`: calcula o valor com
 *     os parâmetros vigentes, mas marca que NÃO é guia (R2.1).
 *  5. Com regra aprovada → `CALCULADO`.
 *
 * O cálculo em si (quando há regra e alíquota):
 *   - natureza que gera débito: debito = base * aliquota / 100.
 *   - natureza que gera crédito (não-cumulativo): credito = base * aliquota /
 *     100. O transporte de saldo credor (sem corte em zero) é a tarefa 3.3; a
 *     separação débito × crédito já é respeitada aqui.
 *   - natureza sem débito nem crédito (monofásica/ST/alíquota zero/exportação):
 *     a base é registrada, débito e crédito ficam em '0.00'.
 */
export function calcularPisCofinsNatureza(
  input: PisCofinsCalculoInput,
  regra: PisCofinsRegra | null,
  opcoes: { aprovada: boolean } = { aprovada: false },
): PisCofinsCalculoResultado {
  const base = {
    tributo: input.tributo,
    natureza: input.natureza,
    vinculacao: input.vinculacao,
    competencia: input.competencia,
    base: fromScaledInteger(
      toScaledInteger(input.base, ESCALA_VALOR),
      ESCALA_VALOR,
    ),
  };
  const zero = fromScaledInteger(0n, ESCALA_VALOR);

  // 1. Regime ausente → PENDENTE (3.5/R2.5). NÃO presume cumulativo.
  if (input.regime == null) {
    return {
      ...base,
      regime: null,
      status: 'PENDENTE',
      aliquota: null,
      naturezaCredito: null,
      debito: zero,
      credito: zero,
      pendente: true,
      memoria:
        `${input.tributo} natureza ${input.natureza}: regime de apuração ausente ` +
        `para a competência ${input.competencia}. Resultado em pendência ` +
        '(R2.5): o regime NÃO é presumido cumulativo.',
    };
  }

  // 2. Sem regra homologada nem vigente → PENDENTE (R2.1). Não inventa alíquota.
  if (!regra) {
    return {
      ...base,
      regime: input.regime,
      status: 'PENDENTE',
      aliquota: null,
      naturezaCredito: null,
      debito: zero,
      credito: zero,
      pendente: true,
      memoria:
        `Sem regra de PIS/COFINS homologada/vigente para a natureza ` +
        `${input.natureza} no regime ${input.regime}, competência ` +
        `${input.competencia}. Resultado em pendência (R2.1): nenhum valor é ` +
        'tratado como guia definitiva.',
    };
  }

  const geraValor = regra.geraDebito || regra.geraCredito;
  const aliquotaRegra =
    input.tributo === 'PIS' ? regra.aliquotaPis : regra.aliquotaCofins;
  // Preferir a alíquota da regra; cair para a destacada no item apenas quando a
  // regra não a fixa (espelha R5.2). Nunca um fallback fixo silencioso.
  const aliquotaStr = naoVazio(aliquotaRegra) ?? naoVazio(input.aliquotaItem);

  // 3. Natureza que gera débito/crédito mas sem alíquota apurável → PENDENTE.
  //    A tabela fixa legada caía na alíquota do regime; aqui não se presume.
  if (geraValor && aliquotaStr == null) {
    return {
      ...base,
      regime: regra.regime,
      status: 'PENDENTE',
      aliquota: null,
      naturezaCredito: regra.geraCredito
        ? regra.naturezaCredito ?? 'BASICO'
        : null,
      debito: zero,
      credito: zero,
      pendente: true,
      memoria:
        `Regra de PIS/COFINS encontrada para ${input.natureza}/${regra.regime}, ` +
        'porém sem alíquota na regra nem destacada no item. O valor não pode ser ' +
        'apurado; resultado em pendência (R2.1).',
    };
  }

  const baseScaled = toScaledInteger(input.base, ESCALA_VALOR);
  const aliqScaled =
    aliquotaStr == null ? 0n : toScaledInteger(aliquotaStr, ESCALA_ALIQUOTA);
  const denom = 100n * 10n ** BigInt(ESCALA_ALIQUOTA);

  // valor = base(centavos) * aliquota(pontos * 1e4) / (100 * 1e4), arredondado
  // meia casa para cima — mesmo critério do ROUND(.,2) usado no débito por item
  // do serviço atual (R5.5), para não divergir ao integrar.
  const debitoScaled = regra.geraDebito
    ? roundScaledDivision(baseScaled * aliqScaled, denom)
    : 0n;
  const creditoScaled =
    regra.geraCredito && regra.regime === 'NAO_CUMULATIVO'
      ? roundScaledDivision(baseScaled * aliqScaled, denom)
      : 0n;

  const status: PisCofinsCalculoStatus = opcoes.aprovada
    ? 'CALCULADO'
    : 'SIMULACAO';
  const debitoStr = fromScaledInteger(debitoScaled, ESCALA_VALOR);
  const creditoStr = fromScaledInteger(creditoScaled, ESCALA_VALOR);
  const naturezaCredito = regra.geraCredito
    ? regra.naturezaCredito ?? 'BASICO'
    : null;

  return {
    ...base,
    regime: regra.regime,
    status,
    aliquota: geraValor ? aliquotaStr : null,
    naturezaCredito,
    debito: debitoStr,
    credito: creditoStr,
    pendente: status !== 'CALCULADO',
    memoria: montarMemoria({
      input,
      regra,
      aliquotaStr,
      debitoStr,
      creditoStr,
      status,
      base: base.base,
    }),
  };
}

/**
 * GUARDA DE ELEGIBILIDADE DE APURAÇÃO DEFINITIVA (Fase 4 / tarefa 3.1 — R2.1).
 *
 * Único ponto de decisão sobre "este resultado de PIS/COFINS pode virar
 * apuração/guia definitiva?". A resposta é SIM apenas quando o estado é
 * `CALCULADO`. `SIMULACAO` (regra vigente não aprovada) e `PENDENTE` (sem regra/
 * regime) NUNCA viram guia definitiva — mantêm o rótulo "demonstrativo" (3.6).
 * Espelha `difalPodeGerarGuia`, isolando a regra num só lugar.
 */
export function pisCofinsPodeApurarDefinitivo(
  status: PisCofinsCalculoStatus,
): boolean {
  return status === 'CALCULADO';
}

/**
 * Motivo textual auditável de por que um resultado em `SIMULACAO`/`PENDENTE`
 * NÃO é apuração definitiva (R2.1). `null` para `CALCULADO`. Espelha
 * `difalMotivoInelegibilidadeGuia`.
 */
export function pisCofinsMotivoInelegibilidade(
  status: PisCofinsCalculoStatus,
): string | null {
  switch (status) {
    case 'CALCULADO':
      return null;
    case 'SIMULACAO':
      return (
        'PIS/COFINS em SIMULAÇÃO: há regra vigente porém NÃO aprovada. É uma ' +
        'simulação identificada (demonstrativo), nunca apuração definitiva (R2.1).'
      );
    case 'PENDENTE':
      return (
        'PIS/COFINS em PENDÊNCIA: não há regra homologada/vigente para a ' +
        'natureza/regime/competência (ou o regime está ausente). Nenhum valor é ' +
        'tratado como apuração definitiva (R2.1/R2.5).'
      );
  }
}

// Monta a memória de cálculo textual conforme a natureza (débito, crédito ou
// base sem valor), citando o estado quando é simulação.
function montarMemoria(args: {
  input: PisCofinsCalculoInput;
  regra: PisCofinsRegra;
  aliquotaStr: string | null;
  debitoStr: string;
  creditoStr: string;
  status: PisCofinsCalculoStatus;
  base: string;
}): string {
  const { input, regra, aliquotaStr, debitoStr, creditoStr, status, base } =
    args;
  const cabecalho =
    `${input.tributo} natureza ${input.natureza} ` +
    `(vinc. ${input.vinculacao}, regime ${regra.regime}, ${input.competencia})`;

  let corpo: string;
  if (regra.geraDebito) {
    corpo = `débito: base ${base} × alíquota ${aliquotaStr} / 100 = ${debitoStr}`;
  } else if (regra.geraCredito && regra.regime === 'NAO_CUMULATIVO') {
    corpo =
      `crédito (${regra.naturezaCredito ?? 'BASICO'}): base ${base} × alíquota ` +
      `${aliquotaStr} / 100 = ${creditoStr}`;
  } else {
    corpo =
      `base ${base} registrada SEM débito próprio (natureza não tributada na ` +
      'etapa); nenhum valor apurado.';
  }

  const sufixo =
    status === 'SIMULACAO'
      ? ' Regra vigente porém NÃO aprovada: simulação/demonstrativo, não guia (R2.1).'
      : '';
  return `${cabecalho}: ${corpo}.${sufixo}`;
}

/**
 * Divisão inteira de bigint com arredondamento meia casa para cima (half-up),
 * equivalente ao `ROUND(x, 2)` do PostgreSQL. Idêntica à usada em
 * `PisCofinsService` (R5.5), para que o cálculo por natureza NÃO divirja do
 * débito por item ao ser integrado nas tarefas seguintes.
 */
function roundScaledDivision(numerator: bigint, divisor: bigint): bigint {
  if (divisor === 0n) return 0n;
  const negative = numerator < 0n !== divisor < 0n;
  const absNum = numerator < 0n ? -numerator : numerator;
  const absDiv = divisor < 0n ? -divisor : divisor;
  const rounded = (absNum + absDiv / 2n) / absDiv;
  return negative ? -rounded : rounded;
}

// Devolve a string quando ela não é nula/vazia; `null` caso contrário. Mantém
// os decimais como string e evita tratar '' como alíquota zero por engano.
function naoVazio(valor: string | null | undefined): string | null {
  if (valor == null) return null;
  const t = valor.trim();
  return t === '' ? null : t;
}
