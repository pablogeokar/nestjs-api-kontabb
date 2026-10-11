/**
 * CALCULADOR DE DIFAL PARAMETRIZADO (Fase 4 / tarefa 2.2 — R1.1, R1.3).
 *
 * O estado anterior (`DifalEntradaService`) calculava o DIFAL por uma TABELA
 * MODAL FIXA por UF (`ALIQUOTA_INTERNA_PADRAO`), com fallback 18%/12% e uma
 * fórmula única aplicada a todos os itens. O design (§DIFAL F11) rejeita isso:
 * "nenhuma tabela estática é fonte de verdade"; a alíquota interna, a
 * interestadual e os demais parâmetros DEVEM vir do CATÁLOGO NORMATIVO
 * versionado (`FiscalNormativeCatalogService` → `fiscal_regras_versoes`),
 * resolvido por HIPÓTESE + UF + VIGÊNCIA (competência) + RESPONSABILIDADE.
 *
 * Este módulo é a PEÇA PURA do calculador: dada uma regra já resolvida do
 * catálogo (os parâmetros vigentes para a hipótese/UF/competência) e um item
 * classificado (tarefa 2.1), calcula o DIFAL daquela hipótese. Não consulta o
 * banco nem resolve vigência — isso é responsabilidade do serviço que o orquestra
 * (`DifalEntradaService`), que chama `FiscalNormativeCatalogService` e repassa a
 * regra aqui. Manter o cálculo puro deixa a aritmética testável sem banco.
 *
 * PRINCÍPIO DE ESCOPO HONESTO (R1.2): quando NÃO há regra homologada para a
 * hipótese/UF/competência, o calculador NÃO inventa alíquota. Ele devolve um
 * resultado marcado como `PENDENTE` ou `SIMULACAO` (quando há regra vigente mas
 * não aprovada), nunca uma guia definitiva. A tarefa 2.3 consome esse estado.
 *
 * DECIMAIS SEMPRE COMO STRING (restrição da fase): a aritmética usa inteiros
 * escalados (`bigint`) via `sped-decimal`; nenhum valor passa por `Number`. As
 * alíquotas da regra chegam como strings e assim permanecem no resultado.
 *
 * ESCOPO (2.2 + 2.4): dirigir o cálculo pela regra do catálogo, por hipótese/UF/
 * vigência/responsabilidade, substituindo a tabela fixa (2.2); e consumir a BASE
 * COMPOSTA por `comporBaseDifal` (`difal-base.ts`, tarefa 2.4) — por dentro,
 * redução, FCP, benefício, origem importada, retenção — com a MEMÓRIA DE
 * ARREDONDAMENTO anexada ao resultado (R1.3/R1.5). A composição em si é pura e
 * mora em `difal-base.ts`; aqui a base chega já composta pelo chamador
 * (`DifalEntradaService`), que também repassa a alíquota interestadual EFETIVA
 * (ex.: 4% quando importada). A não-duplicidade sob ST/retenção é a 2.5.
 */

import {
  fromScaledInteger,
  positive,
  toScaledInteger,
} from '../sped/sped-decimal';
import type { DifalHipotese } from './difal-hipotese';
import type { DifalBaseComposta } from './difal-base';

// Escala das alíquotas (pontos percentuais com 4 casas, ex.: '18.0000'),
// coerente com `fiscal_lancamentos.aliquota` (numeric(9,4)) e com o uso de
// escala 4 em `DifalEntradaService`.
const ESCALA_ALIQUOTA = 4;
// Escala monetária (centavos), padrão das colunas `numeric(_,2)` do fiscal.
const ESCALA_VALOR = 2;

/**
 * Estado do resultado quanto à existência de regra homologada (R1.2):
 * - `CALCULADO`: há regra aprovada e vigente; o valor é uma guia definitiva.
 * - `SIMULACAO`: há regra VIGENTE porém NÃO aprovada; o valor é uma simulação
 *   identificada, nunca guia (consumido pela tarefa 2.3).
 * - `PENDENTE`: não há sequer regra vigente para a hipótese/UF/competência; o
 *   calculador não produz valor de imposto, apenas registra a pendência.
 */
export type DifalCalculoStatus = 'CALCULADO' | 'SIMULACAO' | 'PENDENTE';

/**
 * Responsável pelo recolhimento, parte do eixo "responsabilidade" que dirige a
 * seleção da regra (R1.1). Em DIFAL de entrada o próprio ADQUIRENTE recolhe; em
 * saída a não contribuinte o REMETENTE é o responsável (N10); sob ST o imposto
 * é de responsabilidade de TERCEIRO (substituto), e a tarefa 2.5 trata a
 * não-duplicidade.
 */
export type DifalResponsavel = 'ADQUIRENTE' | 'REMETENTE' | 'TERCEIRO';

/**
 * Regra de DIFAL resolvida do catálogo para uma hipótese/UF/competência. É o
 * `conteudo` de `fiscal_regras_versoes` já tipado para o DIFAL, com os campos
 * que o cálculo consome. Decimais permanecem strings. A ausência desta regra
 * (null no chamador) é o que gera o estado `PENDENTE`.
 */
export interface DifalRegra {
  // Alíquota interna da UF de destino (pontos percentuais, string). Substitui a
  // tabela modal fixa: vem do catálogo versionado, por UF e vigência.
  aliquotaInterna: string;
  // Alíquota interestadual aplicável à operação (pontos percentuais, string).
  // Quando a regra não a fixa, o chamador pode repassar a destacada no item.
  aliquotaInterestadual?: string | null;
  // Alíquota de FCP, quando a UF a institui para a hipótese (string). A
  // composição completa do FCP na base é a tarefa 2.4; aqui ela entra como
  // parâmetro informativo e, quando presente, soma ao resultado separadamente.
  aliquotaFcp?: string | null;
}

/**
 * Entrada do cálculo de UMA hipótese: a hipótese classificada (2.1), a UF de
 * destino, a competência (vigência), o responsável, a base já apurada pelo
 * chamador e, opcionalmente, a alíquota interestadual destacada no item (usada
 * quando a regra não a fixa).
 */
export interface DifalCalculoInput {
  hipotese: DifalHipotese;
  // UF de destino (sigla de 2 letras), eixo de seleção da regra (R1.1).
  ufDestino: string;
  // Competência mensal 'YYYY-MM', eixo de vigência (R1.1).
  competencia: string;
  responsavel: DifalResponsavel;
  // Base de cálculo já COMPOSTA pelo chamador (string decimal). A composição
  // fina (por dentro, redução, benefício, FCP, origem importada, retenção) é a
  // tarefa 2.4, em `comporBaseDifal`; aqui a base chega pronta.
  baseCalculo: string;
  // Alíquota interestadual destacada no item (string), usada quando a regra do
  // catálogo não a fixa. Nunca inventa um fallback silencioso aqui. Quando a
  // mercadoria é importada, o chamador repassa aqui a interestadual EFETIVA (4%)
  // apurada na composição (tarefa 2.4).
  aliquotaInterestadualItem?: string | null;
  // Composição da base (tarefa 2.4), quando o chamador a apurou. Serve para
  // anexar a MEMÓRIA DE ARREDONDAMENTO ao resultado (R1.5) e expor a base de FCP
  // composta. Opcional: na ausência, o cálculo usa `baseCalculo` como antes.
  baseComposta?: DifalBaseComposta | null;
}

/**
 * Resultado do cálculo de uma hipótese. Expõe os eixos de seleção (hipótese,
 * UF, competência, responsável), os parâmetros aplicados (alíquotas), a base, o
 * valor do DIFAL e do FCP, o estado (R1.2) e uma memória textual auditável. A
 * tarefa 2.6 amplia a exposição; aqui já saem os campos essenciais do cálculo.
 */
export interface DifalCalculoResultado {
  hipotese: DifalHipotese;
  ufDestino: string;
  competencia: string;
  responsavel: DifalResponsavel;
  status: DifalCalculoStatus;
  baseCalculo: string;
  aliquotaInterna: string | null;
  aliquotaInterestadual: string | null;
  aliquotaFcp: string | null;
  // Diferença de alíquota aplicada (interna - interestadual), em pontos.
  diferencialAliquota: string | null;
  valorDifal: string;
  valorFcp: string;
  // Memória de cálculo textual (auditoria): a fórmula aplicada em palavras.
  memoria: string;
  // Memória de ARREDONDAMENTO da composição da base (R1.5, tarefa 2.4): cada
  // passo (base bruta, redução, benefício, por dentro, FCP, retenção) e o
  // arredondamento aplicado. Null quando o chamador não compôs a base.
  memoriaArredondamento: string | null;
  // Verdadeiro quando o resultado NÃO é guia definitiva (SIMULACAO/PENDENTE).
  pendente: boolean;
}

/**
 * Calcula o DIFAL de uma hipótese consumindo a regra do catálogo.
 *
 * Fluxo:
 *  1. Sem regra (`regra == null`) → `PENDENTE`: não há parâmetro homologado nem
 *     vigente; devolve resultado sem valor de imposto, apenas a pendência.
 *  2. Com regra porém `aprovada === false` → `SIMULACAO`: calcula o valor com os
 *     parâmetros vigentes, mas marca que NÃO é guia (R1.2).
 *  3. Com regra aprovada → `CALCULADO`: valor é guia definitiva.
 *
 * O cálculo em si (quando há regra) é:
 *   difal = base * (aliquota_interna - aliquota_interestadual) / 100
 *   fcp   = base * aliquota_fcp / 100   (quando a regra institui FCP)
 *
 * A alíquota interestadual vem da regra; se a regra não a fixa, usa a destacada
 * no item (`aliquotaInterestadualItem`). Se nenhuma das duas existir, o
 * diferencial não pode ser apurado e o resultado cai em `PENDENTE` — nunca se
 * inventa 12% como a tabela legada fazia.
 */
export function calcularDifalHipotese(
  input: DifalCalculoInput,
  regra: DifalRegra | null,
  opcoes: { aprovada: boolean } = { aprovada: false },
): DifalCalculoResultado {
  const ufDestino = normalizarUf(input.ufDestino);
  // Memória de arredondamento da composição da base (R1.5), quando o chamador a
  // apurou (tarefa 2.4). Anexada a todos os estados do resultado para auditoria.
  const memoriaArredondamento =
    input.baseComposta?.memoriaArredondamento ?? null;
  const base = {
    hipotese: input.hipotese,
    ufDestino,
    competencia: input.competencia,
    responsavel: input.responsavel,
    memoriaArredondamento,
    baseCalculo: fromScaledInteger(
      toScaledInteger(input.baseCalculo, ESCALA_VALOR),
      ESCALA_VALOR,
    ),
  };

  // 1. Sem regra homologada nem vigente → PENDENTE (R1.2). O calculador não
  //    inventa alíquota; registra que falta regra para a hipótese/UF/competência.
  if (!regra) {
    return {
      ...base,
      status: 'PENDENTE',
      aliquotaInterna: null,
      aliquotaInterestadual: null,
      aliquotaFcp: null,
      diferencialAliquota: null,
      valorDifal: fromScaledInteger(0n, ESCALA_VALOR),
      valorFcp: fromScaledInteger(0n, ESCALA_VALOR),
      pendente: true,
      memoria:
        `Sem regra de DIFAL homologada/vigente para a hipótese ${input.hipotese} ` +
        `na UF ${ufDestino}, competência ${input.competencia}. Resultado em ` +
        'pendência (R1.2): nenhum valor é tratado como guia definitiva.',
    };
  }

  // Alíquota interestadual: preferir a da regra; cair para a destacada no item
  // apenas quando a regra não a fixa. Nunca um fallback fixo silencioso.
  const aliquotaInterestadualStr =
    naoVazio(regra.aliquotaInterestadual) ??
    naoVazio(input.aliquotaInterestadualItem);

  // Sem alíquota interestadual apurável, o diferencial é indefinido → PENDENTE.
  if (aliquotaInterestadualStr == null) {
    return {
      ...base,
      status: 'PENDENTE',
      aliquotaInterna: regra.aliquotaInterna,
      aliquotaInterestadual: null,
      aliquotaFcp: naoVazio(regra.aliquotaFcp) ?? null,
      diferencialAliquota: null,
      valorDifal: fromScaledInteger(0n, ESCALA_VALOR),
      valorFcp: fromScaledInteger(0n, ESCALA_VALOR),
      pendente: true,
      memoria:
        `Regra de DIFAL encontrada para ${input.hipotese}/${ufDestino}, porém ` +
        'sem alíquota interestadual na regra nem destacada no item. O ' +
        'diferencial não pode ser apurado; resultado em pendência (R1.2).',
    };
  }

  const baseScaled = toScaledInteger(input.baseCalculo, ESCALA_VALOR);
  const internaScaled = toScaledInteger(regra.aliquotaInterna, ESCALA_ALIQUOTA);
  const interScaled = toScaledInteger(
    aliquotaInterestadualStr,
    ESCALA_ALIQUOTA,
  );
  // Diferencial de alíquota em pontos (escala 4). `positive` evita diferencial
  // negativo quando a interestadual >= interna (não há DIFAL a recolher).
  const difScaled = positive(internaScaled - interScaled);

  // DIFAL = base(centavos) * dif(pontos * 1e4) / (100 * 1e4).
  const difalScaled =
    (baseScaled * difScaled) / (100n * 10n ** BigInt(ESCALA_ALIQUOTA));

  // FCP (quando a regra o institui) = base_fcp * aliquota_fcp / 100. Entra
  // separado do DIFAL. A BASE DO FCP vem da composição (tarefa 2.4) quando o
  // chamador a apurou — ela pode diferir da base do DIFAL (ex.: retenção zera
  // ambas, benefício reduz ambas); na ausência, usa a mesma base do DIFAL.
  const fcpStr = naoVazio(regra.aliquotaFcp);
  const baseFcpScaled =
    input.baseComposta != null
      ? toScaledInteger(input.baseComposta.baseFcp, ESCALA_VALOR)
      : baseScaled;
  const fcpScaled =
    fcpStr == null
      ? 0n
      : (baseFcpScaled * toScaledInteger(fcpStr, ESCALA_ALIQUOTA)) /
        (100n * 10n ** BigInt(ESCALA_ALIQUOTA));

  const status: DifalCalculoStatus = opcoes.aprovada
    ? 'CALCULADO'
    : 'SIMULACAO';
  const diferencialStr = fromScaledInteger(difScaled, ESCALA_ALIQUOTA);
  const valorDifalStr = fromScaledInteger(difalScaled, ESCALA_VALOR);
  const valorFcpStr = fromScaledInteger(fcpScaled, ESCALA_VALOR);

  return {
    ...base,
    status,
    aliquotaInterna: regra.aliquotaInterna,
    aliquotaInterestadual: aliquotaInterestadualStr,
    aliquotaFcp: fcpStr ?? null,
    diferencialAliquota: diferencialStr,
    valorDifal: valorDifalStr,
    valorFcp: valorFcpStr,
    pendente: status !== 'CALCULADO',
    memoria:
      `DIFAL ${input.hipotese} (${ufDestino}, ${input.competencia}, resp. ` +
      `${input.responsavel}): base ${base.baseCalculo} × (interna ` +
      `${regra.aliquotaInterna} − interestadual ${aliquotaInterestadualStr} = ` +
      `${diferencialStr}) / 100 = ${valorDifalStr}` +
      (fcpStr != null ? `; FCP ${fcpStr} = ${valorFcpStr}` : '') +
      (status === 'SIMULACAO'
        ? '. Regra vigente porém NÃO aprovada: simulação, não guia (R1.2).'
        : '.'),
  };
}

/**
 * GUARDA DE ELEGIBILIDADE DE GUIA (Fase 4 / tarefa 2.3 — R1.2).
 *
 * Único ponto de decisão sobre "este resultado de DIFAL pode virar guia de
 * recolhimento?". A resposta é SIM apenas quando o estado é `CALCULADO`: há
 * regra homologada e vigente, o valor é guia definitiva. `SIMULACAO` (regra
 * vigente não aprovada) e `PENDENTE` (sem regra) NUNCA geram guia (R1.2).
 *
 * Isolar a regra aqui — e não espalhar `status === 'CALCULADO'` por serviços e
 * controllers — garante que todo caminho que gera guia (hoje `FiscalGuiasService`,
 * amanhã qualquer apuração automática) consulte a MESMA condição. O argumento é
 * só o status, de propósito: a decisão não depende do valor nem de quem chama.
 */
export function difalPodeGerarGuia(status: DifalCalculoStatus): boolean {
  return status === 'CALCULADO';
}

/**
 * Motivo textual auditável de por que um resultado de DIFAL em estado
 * `SIMULACAO`/`PENDENTE` NÃO pode virar guia (R1.2). Usado por chamadores que
 * precisam EXPLICAR a recusa (ex.: a geração de guia ao bloquear um item não
 * calculado). Para `CALCULADO` devolve `null` (não há recusa a explicar).
 */
export function difalMotivoInelegibilidadeGuia(
  status: DifalCalculoStatus,
): string | null {
  switch (status) {
    case 'CALCULADO':
      return null;
    case 'SIMULACAO':
      return (
        'DIFAL em SIMULAÇÃO: há regra vigente porém NÃO aprovada. É uma ' +
        'simulação identificada, nunca guia de recolhimento (R1.2).'
      );
    case 'PENDENTE':
      return (
        'DIFAL em PENDÊNCIA: não há regra homologada/vigente para a ' +
        'hipótese/UF/competência. Nenhum valor é tratado como guia (R1.2).'
      );
  }
}

// Devolve a string quando ela não é nula/vazia; `null` caso contrário. Mantém
// os decimais como string e evita tratar '' como alíquota zero por engano.
function naoVazio(valor: string | null | undefined): string | null {
  if (valor == null) return null;
  const t = valor.trim();
  return t === '' ? null : t;
}

function normalizarUf(uf: string): string {
  return (uf ?? '').trim().toUpperCase();
}
