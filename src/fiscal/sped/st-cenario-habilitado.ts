/**
 * CENÁRIO DE ST HABILITADO: FONTE + REGISTRO + MEMÓRIA + CONCILIAÇÃO (Fase 4 /
 * tarefa 4.6 — R3.5).
 *
 * As tarefas 4.1–4.5 cobriram, cada uma, UMA face do cenário de ST:
 *   • 4.1 (`st-verificacao.ts`) — a FONTE normativa (142/2018 + estadual)
 *     verificada; status `VERIFICADO`.
 *   • 4.2 (`st-enquadramento.ts`) — o ENQUADRAMENTO produto/CEST/UF; status
 *     `SUJEITO`, expondo fonte/fonteUrl/hashConteudo.
 *   • 4.3 (`st-calculador.ts`) — o CÁLCULO com componentes SEPARADOS
 *     (`icmsStRetido`, `fcpSt`, ajustes), a MEMÓRIA e o status `CALCULADO`.
 *   • 4.4 (`st-registros-filhos.ts`) — os REGISTROS filhos (C191/C195/C197/
 *     E112/E113) emitidos só nos cenários exigidos.
 *   • 4.5 (`st-bloqueio.ts`) — o BLOQUEIO explicável quando o cenário NÃO é
 *     suportado (fonte não verificada / não enquadrado / não calculável).
 *
 * O que FALTAVA — e é o escopo desta tarefa — é a composição do caso POSITIVO:
 * quando um cenário É de fato habilitado, ele não pode ser um amontoado de
 * valores soltos. R3.5 (requirements): "QUANDO um cenário é habilitado, ele DEVE
 * ter fonte, registro correto, memória e conciliação com a obrigação." design
 * §ST/FCP + §Verificação: "Cada cenário habilitado exige fonte + teste +
 * conciliação + revisão fiscal registrada." Este módulo materializa esse
 * CONTRATO DO CENÁRIO HABILITADO, agregando as quatro faces numa peça única e
 * auditável:
 *
 *   (a) FONTE — a referência normativa vinda da VERSÃO DO CATÁLOGO `ST_FCP`
 *       (`fonte`, `fonteUrl`, `hashConteudo`, vigência) MAIS a REVISÃO FISCAL
 *       REGISTRADA (`escopoAprovado` + `aprovadoPor`). Sem fonte aprovada por um
 *       responsável, o cenário NÃO é habilitado — cai no bloqueio da 4.5.
 *   (b) REGISTRO correto — os registros filhos decididos pela 4.4
 *       (C191/C195/C197/E112/E113), já gated por `CALCULADO`. É a materialização
 *       SPED do cálculo.
 *   (c) MEMÓRIA — a memória de cálculo da 4.3 (`StCalculoResultado.memoria`),
 *       transportada íntegra; nunca reescrita aqui.
 *   (d) CONCILIAÇÃO com a obrigação — a garantia de que os COMPONENTES calculados
 *       (ICMS-ST retido + FCP-ST, separados) BATEM com o que foi efetivamente
 *       escriturado nos registros (soma dos C191: VL_ICMSUFDEST + VL_FCPUFDEST).
 *       Divergência é IMPEDITIVA, espelhando o padrão D190↔E110↔livro do
 *       `efd-icms-ipi.builder.ts` (`conciliarD190CteSaida`): os totais derivam
 *       da mesma fonte, logo têm de reconciliar; se não reconciliam, há erro de
 *       escrituração e a entrega bloqueia.
 *
 * O CONTRATO (todas as condições, nesta ordem): o cenário só é `HABILITADO`
 * quando (1) a fonte está VERIFICADA (4.1), (2) o enquadramento é `SUJEITO`
 * (4.2), (3) o cálculo é `CALCULADO` (4.3), (4) há FONTE do catálogo APROVADA por
 * um responsável (revisão fiscal registrada) e (5) os componentes RECONCILIAM
 * com os registros. Falhando QUALQUER uma, o cenário NÃO é habilitado: para as
 * condições 1–3 reaproveita-se o bloqueio da 4.5 (`aplicarBloqueioSt`); para a 4
 * (fonte ausente/não aprovada) e a 5 (divergência) produz-se uma
 * `SpedInconsistencia` IMPEDITIVA própria, com código estável e mensagem
 * explicável.
 *
 * PEÇA PURA, SEM BANCO E SEM `Number`: recebe os resultados já resolvidos pelas
 * tarefas anteriores (verificação, enquadramento, cálculo, registros) e a versão
 * do catálogo resolvida, e produz o cenário habilitado OU as inconsistências
 * impeditivas. Toda aritmética de conciliação usa inteiros escalados via
 * `sped-decimal`; decimais permanecem strings. Pronta para ser costurada no
 * `efd-icms-ipi.builder.ts` quando o cenário de ST for habilitado.
 */

import type { SpedInconsistencia } from './sped-efd.types';
import type { SpedRecord, SpedTypedField } from './core';
import { fromScaledInteger, toScaledInteger } from './sped-decimal';
import type { CatalogoVersaoResolvida } from '../services/fiscal-normative-catalog.service';
import type { StVerificacaoStatus } from '../services/st-verificacao';
import type { StEnquadramentoStatus } from '../services/st-enquadramento';
import type { StCalculoResultado } from '../services/st-calculador';
import { stPodeGerarGuia } from '../services/st-calculador';
import {
  aplicarBloqueioSt,
  type AplicarBloqueioStInput,
  type StCenarioContexto,
} from './st-bloqueio';

// ─────────────────────────────────────────────────────────────────────────────
// Códigos de inconsistência estáveis (padrão da Fase 0), próprios do cenário
// habilitado. Os bloqueios de camada (fonte/enquadramento/cálculo) já têm os
// seus códigos na 4.5; aqui ficam os dois casos que SÓ existem no caso positivo.
// ─────────────────────────────────────────────────────────────────────────────

export const ST_CENARIO_HABILITADO_CODIGOS = {
  // Cálculo CALCULADO, porém sem FONTE do catálogo aprovada por um responsável
  // (revisão fiscal registrada). Um cenário habilitado exige fonte (R3.5).
  FONTE_NAO_REGISTRADA: 'ST_CENARIO_FONTE_NAO_REGISTRADA',
  // Os componentes calculados (ICMS-ST + FCP-ST) NÃO reconciliam com a soma dos
  // registros escriturados (C191). Divergência impeditiva (R3.5), espelhando o
  // padrão D190↔E110 do builder.
  CONCILIACAO_DIVERGENTE: 'ST_CENARIO_CONCILIACAO_DIVERGENTE',
} as const;

// Tolerância de conciliação em escala monetária (centavos). Igual à usada no
// restante do fiscal (`differenceWithinTolerance` default '0.02'): dois
// arredondamentos independentes podem diferir de um centavo cada.
const TOLERANCIA_CONCILIACAO = '0.02';
const ESCALA_VALOR = 2;

// ─────────────────────────────────────────────────────────────────────────────
// FONTE do cenário habilitado (R3.5): a referência normativa + a revisão fiscal
// registrada. Derivada da VERSÃO DO CATÁLOGO `ST_FCP` resolvida por competência.
// ─────────────────────────────────────────────────────────────────────────────

export interface StCenarioFonte {
  // Fonte normativa textual (ex.: 'convenio_icms_142_2018' + estadual).
  fonte: string;
  // Ponteiro verificável para a fonte oficial (quando houver).
  fonteUrl: string | null;
  // Hash do conteúdo carregado (imutabilidade/auditoria), quando presente.
  hashConteudo: string | null;
  // Janela de vigência resolvida (contém a competência consultada).
  vigenciaInicio: string;
  vigenciaFim: string | null;
  // REVISÃO FISCAL REGISTRADA: só uma versão aprovada por um responsável conta
  // como fonte de cenário habilitado (R3.5 — "revisão fiscal registrada").
  aprovadoPor: string;
}

// Verdadeiro quando a versão do catálogo está aprovada E tem responsável
// (revisão fiscal registrada). Sem isso NÃO há fonte de cenário habilitado.
function catalogoTemFonteRegistrada(
  catalogo: CatalogoVersaoResolvida | null,
): catalogo is CatalogoVersaoResolvida & { aprovadoPor: string } {
  return (
    catalogo != null &&
    catalogo.escopoAprovado === true &&
    naoVazio(catalogo.aprovadoPor) != null
  );
}

// Extrai a FONTE do cenário a partir da versão do catálogo aprovada. Precondição:
// `catalogoTemFonteRegistrada(catalogo)` é verdadeiro.
function montarFonte(
  catalogo: CatalogoVersaoResolvida & { aprovadoPor: string },
): StCenarioFonte {
  return {
    fonte: catalogo.fonte,
    fonteUrl: catalogo.fonteUrl ?? null,
    hashConteudo: catalogo.hashConteudo ?? null,
    vigenciaInicio: catalogo.vigenciaInicio,
    vigenciaFim: catalogo.vigenciaFim ?? null,
    aprovadoPor: catalogo.aprovadoPor,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CONCILIAÇÃO: componentes calculados (4.3) ↔ registros escriturados (C191).
//
// Espelha `conciliarD190CteSaida` do builder: os dois lados derivam da MESMA
// fonte (o cálculo da 4.3 e os registros que ele originou na 4.4), logo têm de
// reconciliar. O lado "calculado" é a OBRIGAÇÃO (o que se deve recolher/informar:
// ICMS-ST retido + FCP-ST); o lado "escriturado" é a soma dos C191 efetivamente
// emitidos (VL_ICMSUFDEST + VL_FCPUFDEST). Divergência além da tolerância é
// IMPEDITIVA (R3.5).
// ─────────────────────────────────────────────────────────────────────────────

export interface StConciliacaoResultado {
  // ICMS-ST retido calculado (obrigação), string decimal.
  icmsStCalculado: string;
  // FCP-ST calculado (obrigação, componente separado), string decimal.
  fcpStCalculado: string;
  // Soma do ICMS-ST escriturado nos C191 (VL_ICMSUFDEST), string decimal.
  icmsStRegistrado: string;
  // Soma do FCP-ST escriturado nos C191 (VL_FCPUFDEST), string decimal.
  fcpStRegistrado: string;
  // Diferença absoluta total (|calculado − escriturado| de ICMS-ST + FCP-ST),
  // string decimal. Dentro da tolerância reconcilia.
  divergencia: string;
  // Verdadeiro quando os dois lados batem dentro da tolerância.
  reconcilia: boolean;
}

/**
 * CONCILIA os componentes calculados de ST (4.3) com os registros C191
 * efetivamente escriturados (4.4), por componente separado (R3.5).
 *
 * O ICMS-ST retido e o FCP-ST são conciliados SEPARADAMENTE (nunca somados num
 * bolo) e a divergência total é a soma das diferenças absolutas de cada
 * componente. Reconcilia quando a divergência total está dentro da tolerância
 * de arredondamento. Pura, sem `Number`.
 */
export function conciliarCenarioSt(
  calculo: Pick<StCalculoResultado, 'icmsStRetido' | 'fcpSt'>,
  registrosC191: readonly SpedRecord[],
): StConciliacaoResultado {
  const icmsStCalc = toScaledInteger(calculo.icmsStRetido, ESCALA_VALOR);
  const fcpStCalc = toScaledInteger(calculo.fcpSt, ESCALA_VALOR);

  let icmsStReg = 0n;
  let fcpStReg = 0n;
  for (const registro of registrosC191) {
    if (registro.reg !== 'C191') continue;
    // Layout C191 (ver st-registros-filhos.ts): após REG →
    //   [0] VL_FCPUFDEST (FCP-ST), [1] VL_ICMSUFDEST (ICMS-ST), [2] VL_ICMSUFREMET
    fcpStReg += valorDoCampo(registro.fields[0]);
    icmsStReg += valorDoCampo(registro.fields[1]);
  }

  const difIcms = absoluto(icmsStCalc - icmsStReg);
  const difFcp = absoluto(fcpStCalc - fcpStReg);
  const divergenciaScaled = difIcms + difFcp;
  const tolerancia = toScaledInteger(TOLERANCIA_CONCILIACAO, ESCALA_VALOR);

  return {
    icmsStCalculado: fromScaledInteger(icmsStCalc, ESCALA_VALOR),
    fcpStCalculado: fromScaledInteger(fcpStCalc, ESCALA_VALOR),
    icmsStRegistrado: fromScaledInteger(icmsStReg, ESCALA_VALOR),
    fcpStRegistrado: fromScaledInteger(fcpStReg, ESCALA_VALOR),
    divergencia: fromScaledInteger(divergenciaScaled, ESCALA_VALOR),
    reconcilia: divergenciaScaled <= tolerancia,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSIÇÃO do cenário habilitado (R3.5): fonte + registro + memória +
// conciliação, com todas as condições do contrato.
// ─────────────────────────────────────────────────────────────────────────────

export interface StCenarioHabilitadoInput {
  contexto: StCenarioContexto;
  // Estado da verificação da fonte (4.1).
  verificacao: StVerificacaoStatus;
  // Estado do enquadramento (4.2).
  enquadramento: StEnquadramentoStatus;
  // Resultado completo do cálculo (4.3): expõe o status, os componentes
  // separados e a memória.
  calculo: StCalculoResultado;
  // Versão do catálogo `ST_FCP` resolvida por competência (fonte/hash/vigência/
  // aprovação). A fonte do cenário habilitado sai daqui (R3.5).
  catalogo: CatalogoVersaoResolvida | null;
  // Registros filhos decididos pela 4.4 (C191/C195/C197/E112/E113). Os C191
  // alimentam a conciliação; os demais são transportados para a entrega.
  registros: readonly SpedRecord[];
}

/**
 * Um cenário de ST HABILITADO (R3.5): a agregação auditável das quatro faces.
 * Só é produzido quando TODO o contrato é satisfeito (ver
 * {@link avaliarCenarioHabilitadoSt}).
 */
export interface StCenarioHabilitado {
  contexto: StCenarioContexto;
  // (a) FONTE + revisão fiscal registrada.
  fonte: StCenarioFonte;
  // (b) REGISTRO correto (filhos SPED decididos pela 4.4).
  registros: readonly SpedRecord[];
  // (c) MEMÓRIA de cálculo (da 4.3, íntegra).
  memoria: string;
  // (d) CONCILIAÇÃO com a obrigação (reconcilia === true neste ponto).
  conciliacao: StConciliacaoResultado;
}

/**
 * Resultado da avaliação do contrato do cenário habilitado (R3.5).
 */
export interface StCenarioHabilitadoResultado {
  // Verdadeiro quando TODAS as condições do contrato foram satisfeitas.
  habilitado: boolean;
  // O cenário habilitado agregado (fonte/registro/memória/conciliação) quando
  // `habilitado`; `null` caso contrário.
  cenario: StCenarioHabilitado | null;
  // Inconsistências IMPEDITIVAS quando NÃO habilitado: o bloqueio de camada
  // (4.5) e/ou a fonte não registrada / a conciliação divergente. Vazio quando
  // habilitado.
  inconsistencias: SpedInconsistencia[];
  // A conciliação computada (sempre presente — útil mesmo quando bloqueado por
  // outra razão, para relatório).
  conciliacao: StConciliacaoResultado;
  // Motivo textual auditável quando NÃO habilitado; `null` quando habilitado.
  motivo: string | null;
}

/**
 * AVALIA o contrato do cenário de ST habilitado (tarefa 4.6 — R3.5).
 *
 * Ordem (da camada mais básica à mais específica; para na PRIMEIRA falha):
 *   1–3. BLOQUEIO DE CAMADA (4.5): fonte não verificada (4.1), enquadramento não
 *        habilita (4.2) ou cálculo não gera guia (4.3). Reaproveita
 *        `aplicarBloqueioSt` para não duplicar a regra; devolve as mesmas
 *        inconsistências impeditivas da 4.5.
 *   4.   FONTE REGISTRADA: mesmo com cálculo CALCULADO, exige a versão do
 *        catálogo APROVADA por um responsável (revisão fiscal registrada). Sem
 *        ela → `FONTE_NAO_REGISTRADA` (R3.5).
 *   5.   CONCILIAÇÃO: os componentes calculados (ICMS-ST + FCP-ST) têm de
 *        reconciliar com os C191 escriturados. Divergência → `CONCILIACAO_
 *        DIVERGENTE` (R3.5), espelhando o padrão D190↔E110.
 *   OK.  Todas satisfeitas → cenário HABILITADO com fonte + registro + memória +
 *        conciliação.
 */
export function avaliarCenarioHabilitadoSt(
  input: StCenarioHabilitadoInput,
): StCenarioHabilitadoResultado {
  const ctx = input.contexto;
  const prefixo = `ST ${normalizarUf(ctx.uf)} (${ctx.competencia}): `;

  // A conciliação é sempre computada (serve a relatório mesmo quando bloqueado).
  const conciliacao = conciliarCenarioSt(input.calculo, input.registros);

  const inconsistencias: SpedInconsistencia[] = [];

  // 1–3. BLOQUEIO DE CAMADA (4.5). Reaproveita a MESMA costura da 4.5.
  const bloqueioInput: AplicarBloqueioStInput = {
    contexto: ctx,
    verificacao: input.verificacao,
    enquadramento: input.enquadramento,
    calculo: input.calculo.status,
  };
  const bloqueio = aplicarBloqueioSt(bloqueioInput, inconsistencias);
  if (bloqueio.bloqueado) {
    return naoHabilitado(
      inconsistencias,
      conciliacao,
      prefixo +
        'cenário não habilitado: bloqueado em uma das camadas (fonte/' +
        'enquadramento/cálculo). Ver inconsistência(s) de bloqueio (4.5).',
    );
  }

  // Nota: se chegou aqui, `stPodeGerarGuia(input.calculo.status)` é verdadeiro
  // (o bloqueio da 4.5 já teria barrado SIMULACAO/PENDENTE/BLOQUEADO). A guarda
  // explícita abaixo documenta a invariante e protege contra uso fora de ordem.
  if (!stPodeGerarGuia(input.calculo.status)) {
    const inc = montarInconsistencia(
      ST_CENARIO_HABILITADO_CODIGOS.FONTE_NAO_REGISTRADA,
      prefixo + 'cálculo não gera guia definitiva; cenário não habilitado.',
      ctx,
    );
    inconsistencias.push(inc);
    return naoHabilitado(inconsistencias, conciliacao, inc.mensagem);
  }

  // 4. FONTE REGISTRADA (revisão fiscal registrada).
  if (!catalogoTemFonteRegistrada(input.catalogo)) {
    const motivo =
      prefixo +
      'cenário CALCULADO porém SEM fonte do catálogo ST_FCP aprovada por um ' +
      'responsável (revisão fiscal registrada). Um cenário habilitado exige ' +
      'fonte, registro, memória e conciliação (R3.5): sem a fonte registrada o ' +
      'cenário não é habilitado.';
    const inc = montarInconsistencia(
      ST_CENARIO_HABILITADO_CODIGOS.FONTE_NAO_REGISTRADA,
      motivo,
      ctx,
    );
    inconsistencias.push(inc);
    return naoHabilitado(inconsistencias, conciliacao, motivo);
  }

  // 5. CONCILIAÇÃO com a obrigação (divergência é impeditiva).
  if (!conciliacao.reconcilia) {
    const motivo =
      prefixo +
      'os componentes calculados de ST (ICMS-ST retido ' +
      `${conciliacao.icmsStCalculado} + FCP-ST ${conciliacao.fcpStCalculado}) ` +
      'NÃO reconciliam com os registros escriturados C191 (ICMS-ST ' +
      `${conciliacao.icmsStRegistrado} + FCP-ST ${conciliacao.fcpStRegistrado}; ` +
      `divergência ${conciliacao.divergencia}). Divergência impeditiva (R3.5): ` +
      'reveja o cálculo e os registros filhos antes de gerar o SPED.';
    const inc = montarInconsistencia(
      ST_CENARIO_HABILITADO_CODIGOS.CONCILIACAO_DIVERGENTE,
      motivo,
      ctx,
    );
    inconsistencias.push(inc);
    return naoHabilitado(inconsistencias, conciliacao, motivo);
  }

  // OK: contrato satisfeito. Cenário HABILITADO com as quatro faces.
  return {
    habilitado: true,
    cenario: {
      contexto: ctx,
      fonte: montarFonte(input.catalogo),
      registros: input.registros,
      memoria: input.calculo.memoria,
      conciliacao,
    },
    inconsistencias: [],
    conciliacao,
    motivo: null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRAÇÃO (wire) — ponto único para o builder costurar o cenário habilitado.
//
// Avalia o contrato e empurra as inconsistências impeditivas para a lista do
// SPED (o mesmo `input.inconsistencias` do builder). Devolve o cenário habilitado
// (quando habilitado) e se a entrega está bloqueada por ST. Não serializa nada.
// ─────────────────────────────────────────────────────────────────────────────

export function aplicarCenarioHabilitadoSt(
  input: StCenarioHabilitadoInput,
  inconsistencias: SpedInconsistencia[],
): { habilitado: boolean; cenario: StCenarioHabilitado | null } {
  const resultado = avaliarCenarioHabilitadoSt(input);
  for (const inc of resultado.inconsistencias) inconsistencias.push(inc);
  return { habilitado: resultado.habilitado, cenario: resultado.cenario };
}

// ─────────────────────────────────────────────────────────────────────────────
// Auxiliares
// ─────────────────────────────────────────────────────────────────────────────

function naoHabilitado(
  inconsistencias: SpedInconsistencia[],
  conciliacao: StConciliacaoResultado,
  motivo: string,
): StCenarioHabilitadoResultado {
  return {
    habilitado: false,
    cenario: null,
    inconsistencias,
    conciliacao,
    motivo,
  };
}

function montarInconsistencia(
  codigo: string,
  mensagem: string,
  ctx: StCenarioContexto,
): SpedInconsistencia {
  const item: SpedInconsistencia = {
    codigo,
    severidade: 'ERRO',
    mensagem,
  };
  if (naoVazio(ctx.documentoId) != null) item.documentoId = ctx.documentoId!;
  if (naoVazio(ctx.numeroDocumento) != null) {
    item.numeroDocumento = ctx.numeroDocumento!;
  }
  if (naoVazio(ctx.chaveAcesso) != null) item.chaveAcesso = ctx.chaveAcesso!;
  return item;
}

// Extrai o valor decimal (em escala monetária) de um campo do SpedRecord. Os
// campos monetários são `SpedTypedField` produzidos por `decimalField` (um
// discriminado `{ kind: 'decimal', value }`); valores simples (string) são lidos
// direto. Lê a string ORIGINAL do campo (nunca o formato SPED com vírgula) e a
// escala para inteiro, sem passar por `Number`.
function valorDoCampo(campo: SpedRecord['fields'][number]): bigint {
  if (campo == null) return 0n;
  if (typeof campo === 'string') return toScaledInteger(campo, ESCALA_VALOR);
  const tipado = campo;
  if (tipado.value == null) return 0n;
  // `value` de um decimalField é string | bigint. bigint já está em escala?
  // Não: `decimalField` recebe o valor decimal (string ex. '18.00' ou bigint em
  // unidades inteiras). O layout C191 sempre usa `decimalField(string)`; aqui
  // normalizamos string → inteiro escalado. Um bigint seria unidade inteira,
  // tratado como inteiro de reais; o C191 nunca o usa, mas cobrimos por robustez.
  if (typeof tipado.value === 'bigint') {
    return tipado.value * 10n ** BigInt(ESCALA_VALOR);
  }
  return toScaledInteger(String(tipado.value), ESCALA_VALOR);
}

function absoluto(valor: bigint): bigint {
  return valor < 0n ? -valor : valor;
}

function naoVazio(valor: string | null | undefined): string | null {
  if (valor == null) return null;
  const t = valor.trim();
  return t === '' ? null : t;
}

function normalizarUf(uf: string): string {
  return (uf ?? '').trim().toUpperCase();
}
