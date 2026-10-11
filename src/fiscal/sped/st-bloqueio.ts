/**
 * BLOQUEIO EXPLICÁVEL DE CENÁRIO DE ST E GUARDA DE FCP (Fase 4 / tarefa 4.5 —
 * R3.4, R3.6).
 *
 * As tarefas 4.1–4.4 entregaram a VERIFICAÇÃO da fonte (`st-verificacao.ts`), o
 * ENQUADRAMENTO (`st-enquadramento.ts`), o CÁLCULO com componentes SEPARADOS
 * (`st-calculador.ts` — com o FCP-ST como componente PRÓPRIO `fcpSt`, nunca
 * somado à ST) e os REGISTROS FILHOS só nos cenários exigidos
 * (`st-registros-filhos.ts`). Cada peça já tinha o seu portão (`stPodeGerarGuia`
 * etc.) e o seu MOTIVO auditável. O que faltava — e é o escopo desta tarefa — é
 * transformar esses motivos no PADRÃO DE BLOQUEIO da entrega e materializar duas
 * garantias explícitas:
 *
 *   R3.4 — "QUANDO um cenário não é suportado, a entrega DEVE ser bloqueada de
 *   forma explicável." Em vez de silenciosamente deixar de emitir ST (ou, pior,
 *   emitir um TXT possivelmente inválido), um cenário de ST BLOQUEADO/PENDENTE
 *   vira uma `SpedInconsistencia` IMPEDITIVA (`severidade: 'ERRO'`), com `codigo`
 *   estável e `mensagem` que explica POR QUE o cenário está bloqueado. Reaproveita
 *   o PADRÃO DE BLOQUEIO da Fase 0 (o builder EFD empurra `SpedInconsistencia`
 *   para `input.inconsistencias`; um item `ERRO` impede a geração definitiva).
 *
 *   R3.6 — "O sistema NÃO DEVE transformar todo FCP em um ajuste genérico só
 *   para o TXT passar; um código que passa em regex não comprova validade
 *   normativa." Esta é a GUARDA DE FCP: um FCP só pode ser emitido como seu
 *   componente PRÓPRIO (o `fcpSt` da 4.3, com base e alíquota reais da regra
 *   homologada). Transformá-lo num "ajuste genérico" (um E111/C197 com código de
 *   ajuste inventado, só para o PVA aceitar) é RECUSADO: sem regra de FCP
 *   homologada, o FCP BLOQUEIA de forma explicável; nunca vira um código que
 *   meramente passa no regex.
 *
 * ESTE MÓDULO É UMA PEÇA PURA, SEM BANCO E SEM `Number`: recebe os status já
 * resolvidos pelas tarefas anteriores (verificação, enquadramento, cálculo) e as
 * decisões sobre FCP, e produz os `SpedInconsistencia` / decisões de guarda.
 * NÃO consulta banco, não resolve vigência, não serializa o TXT. Fica pronto
 * para ser costurado no `efd-icms-ipi.builder.ts` (o `wire` abaixo é o ponto
 * único de integração) quando o cenário for habilitado, exatamente como as
 * demais inconsistências do builder.
 *
 * Decimais permanecem strings; este módulo não faz aritmética monetária — apenas
 * testa positividade via escala inteira (`sped-decimal`), sem `Number`.
 */

import type {
  SpedInconsistencia,
  SpedInconsistenciaSeveridade,
} from './sped-efd.types';
import { toScaledInteger } from './sped-decimal';
import type { StVerificacaoStatus } from '../services/st-verificacao';
import {
  stCenarioPodeSerHabilitado,
  stMotivoBloqueio,
} from '../services/st-verificacao';
import type { StEnquadramentoStatus } from '../services/st-enquadramento';
import {
  stEnquadramentoHabilitaCalculo,
  stEnquadramentoMotivoInelegibilidade,
} from '../services/st-enquadramento';
import type { StCalculoStatus } from '../services/st-calculador';
import {
  stPodeGerarGuia,
  stCalculoMotivoInelegibilidade,
} from '../services/st-calculador';

// ─────────────────────────────────────────────────────────────────────────────
// Códigos de inconsistência estáveis (padrão da Fase 0: um `codigo` por hipótese
// de bloqueio, usado por relatórios/testes). Prefixo `ST_` para o domínio de ST.
// ─────────────────────────────────────────────────────────────────────────────

export const ST_BLOQUEIO_CODIGOS = {
  // Fonte do cenário (142/2018 + estadual) não verificada (4.1).
  FONTE_NAO_VERIFICADA: 'ST_CENARIO_FONTE_NAO_VERIFICADA',
  // Enquadramento não habilita (pendência de regra, produto sem CEST) (4.2).
  ENQUADRAMENTO_NAO_SUPORTADO: 'ST_CENARIO_ENQUADRAMENTO_NAO_SUPORTADO',
  // Cálculo não pode virar guia (simulação/pendência/bloqueio) (4.3).
  CALCULO_NAO_SUPORTADO: 'ST_CENARIO_CALCULO_NAO_SUPORTADO',
  // FCP sem regra homologada tentando virar ajuste genérico (R3.6).
  FCP_AJUSTE_GENERICO_RECUSADO: 'ST_FCP_AJUSTE_GENERICO_RECUSADO',
} as const;

// Contexto comum do cenário, ecoado nas mensagens para localizar o bloqueio.
export interface StCenarioContexto {
  // UF de destino (sigla), eixo do cenário.
  uf: string;
  // Competência mensal 'YYYY-MM'.
  competencia: string;
  // Documento de origem, para rastrear a inconsistência (opcional, como no
  // builder: `documentoId`/`numeroDocumento`/`chaveAcesso`).
  documentoId?: string | null;
  numeroDocumento?: string | null;
  chaveAcesso?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. BLOQUEIO EXPLICÁVEL DO CENÁRIO (R3.4)
//
// Dado o estado de ST de um cenário (verificação 4.1, enquadramento 4.2 e/ou
// cálculo 4.3), decide se a ENTREGA deve ser bloqueada e, em caso afirmativo,
// produz a `SpedInconsistencia` IMPEDITIVA (ERRO) explicando o porquê — nunca um
// silêncio que deixaria passar um TXT possivelmente inválido.
// ─────────────────────────────────────────────────────────────────────────────

export interface StBloqueioCenarioInput {
  contexto: StCenarioContexto;
  // Estado da verificação da fonte (4.1). Qualquer valor != VERIFICADO bloqueia.
  verificacao: StVerificacaoStatus;
  // Estado do enquadramento (4.2), quando já resolvido. Opcional: um cenário
  // pode ser bloqueado já na verificação, antes do enquadramento.
  enquadramento?: StEnquadramentoStatus | null;
  // Estado do cálculo (4.3), quando já resolvido. Opcional pela mesma razão.
  calculo?: StCalculoStatus | null;
}

/**
 * Resultado da análise de bloqueio de UM cenário de ST (R3.4). Expõe se a
 * entrega está bloqueada, a inconsistência IMPEDITIVA a empurrar (quando
 * bloqueada) e o motivo textual — a base do "bloqueio explicável".
 */
export interface StBloqueioCenarioResultado {
  // Verdadeiro quando o cenário NÃO é suportado e a entrega deve ser bloqueada.
  bloqueado: boolean;
  // A inconsistência impeditiva (severidade ERRO) a adicionar às
  // `inconsistencias` do SPED. `null` quando o cenário é suportado.
  inconsistencia: SpedInconsistencia | null;
  // Motivo textual auditável do bloqueio (null quando suportado). Espelha os
  // `*MotivoInelegibilidade` das tarefas anteriores.
  motivo: string | null;
}

/**
 * Decide o BLOQUEIO EXPLICÁVEL de um cenário de ST (tarefa 4.5 — R3.4).
 *
 * Ordem de decisão, da camada mais básica à mais específica (espelha a ordem dos
 * portões de 4.1→4.2→4.3), parando no PRIMEIRO bloqueio e reaproveitando o
 * MOTIVO já definido por cada tarefa (nunca reescrevendo a regra):
 *   1. Fonte não verificada (4.1) → ERRO `FONTE_NAO_VERIFICADA`.
 *   2. Enquadramento não habilita o cálculo (4.2) → ERRO
 *      `ENQUADRAMENTO_NAO_SUPORTADO`. (Só avaliado quando `enquadramento` é
 *      informado; a verificação já passou.)
 *   3. Cálculo não pode virar guia (4.3) → ERRO `CALCULO_NAO_SUPORTADO`. (Só
 *      quando `calculo` é informado e a fonte/enquadramento já passaram.)
 *   4. Nada bloqueia → cenário suportado, sem inconsistência.
 *
 * A severidade é SEMPRE `ERRO` (impeditiva): um cenário não suportado não pode
 * virar guia definitiva, logo não pode ser um mero AVISO. Isso reusa o padrão da
 * Fase 0, em que um item `ERRO` em `inconsistencias` impede a geração.
 */
export function analisarBloqueioCenarioSt(
  input: StBloqueioCenarioInput,
): StBloqueioCenarioResultado {
  const ctx = input.contexto;
  const prefixo = `ST ${normalizarUf(ctx.uf)} (${ctx.competencia}): `;

  // 1. PORTÃO DE VERIFICAÇÃO (4.1).
  if (!stCenarioPodeSerHabilitado(input.verificacao)) {
    const motivo = stMotivoBloqueio(input.verificacao) ?? 'cenário bloqueado.';
    return bloqueio(
      ST_BLOQUEIO_CODIGOS.FONTE_NAO_VERIFICADA,
      prefixo + motivo,
      ctx,
    );
  }

  // 2. PORTÃO DE ENQUADRAMENTO (4.2), quando resolvido.
  if (
    input.enquadramento != null &&
    !stEnquadramentoHabilitaCalculo(input.enquadramento)
  ) {
    const motivo =
      stEnquadramentoMotivoInelegibilidade(input.enquadramento) ??
      'enquadramento não habilita o cálculo.';
    return bloqueio(
      ST_BLOQUEIO_CODIGOS.ENQUADRAMENTO_NAO_SUPORTADO,
      prefixo + motivo,
      ctx,
    );
  }

  // 3. PORTÃO DE CÁLCULO (4.3), quando resolvido.
  if (input.calculo != null && !stPodeGerarGuia(input.calculo)) {
    const motivo =
      stCalculoMotivoInelegibilidade(input.calculo) ??
      'cálculo não pode virar guia.';
    return bloqueio(
      ST_BLOQUEIO_CODIGOS.CALCULO_NAO_SUPORTADO,
      prefixo + motivo,
      ctx,
    );
  }

  // 4. Cenário suportado em todas as camadas resolvidas: não bloqueia.
  return { bloqueado: false, inconsistencia: null, motivo: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. GUARDA DE FCP: NÃO VIRAR AJUSTE GENÉRICO (R3.6)
//
// O FCP só é legítimo como componente PRÓPRIO (`fcpSt` da 4.3), com base e
// alíquota reais vindas de regra homologada. Esta guarda recusa a tentativa de
// emitir o FCP como um "ajuste genérico" (um código de ajuste E111/C197
// inventado, só para o PVA aceitar o TXT). Passar no regex do PVA não comprova
// validade normativa.
// ─────────────────────────────────────────────────────────────────────────────

export interface FcpGuardaInput {
  contexto: StCenarioContexto;
  // Alíquota de FCP vinda da regra do catálogo (string). `null`/vazia quando a
  // UF/CEST não tem FCP homologado — nesse caso NÃO há componente próprio e
  // qualquer emissão de FCP seria um ajuste inventado.
  aliquotaFcp?: string | null;
  // Valor de FCP-ST calculado como COMPONENTE PRÓPRIO (`fcpSt` da 4.3), string.
  // Só é legítimo quando > 0 E há alíquota homologada.
  fcpStComponente?: string | null;
  // Verdadeiro quando o chamador pretende emitir o FCP como AJUSTE GENÉRICO (um
  // E111/C197 com código de ajuste), em vez do componente próprio. Esta é
  // exatamente a tentativa que R3.6 proíbe quando não há regra homologada.
  tentandoAjusteGenerico: boolean;
}

export interface FcpGuardaResultado {
  // Verdadeiro quando o FCP pode seguir como COMPONENTE PRÓPRIO (há alíquota
  // homologada e valor efetivo), sem virar ajuste genérico.
  fcpComponenteValido: boolean;
  // Verdadeiro quando a tentativa de ajuste genérico foi RECUSADA (R3.6).
  ajusteGenericoRecusado: boolean;
  // Inconsistência IMPEDITIVA quando a emissão de FCP como ajuste genérico foi
  // recusada; `null` quando não há recusa a sinalizar.
  inconsistencia: SpedInconsistencia | null;
  // Motivo textual auditável (null quando não há recusa).
  motivo: string | null;
}

/**
 * GUARDA que impede o FCP de virar ajuste genérico (tarefa 4.5 — R3.6).
 *
 * Regras:
 *   • Há FCP como componente próprio quando (a) existe alíquota de FCP homologada
 *     (não vazia) E (b) o valor de FCP-ST calculado é > 0. Esse é o único FCP
 *     legítimo (o `fcpSt` da 4.3).
 *   • Se o chamador NÃO está tentando ajuste genérico, nada a recusar: devolve só
 *     se o componente próprio é válido.
 *   • Se o chamador ESTÁ tentando emitir o FCP como ajuste genérico, a guarda
 *     RECUSA e produz uma `SpedInconsistencia` ERRO: o FCP deve sair como
 *     componente próprio (quando homologado) ou bloquear — nunca como um código
 *     de ajuste inventado que só passa no regex (R3.6). A recusa vale mesmo que
 *     exista alíquota: FCP homologado se emite como componente, não como ajuste
 *     genérico.
 */
export function guardarFcpNaoGenerico(
  input: FcpGuardaInput,
): FcpGuardaResultado {
  const ctx = input.contexto;
  const temAliquotaHomologada = naoVazio(input.aliquotaFcp) != null;
  const temValorEfetivo = positivo(input.fcpStComponente);
  const fcpComponenteValido = temAliquotaHomologada && temValorEfetivo;

  if (!input.tentandoAjusteGenerico) {
    return {
      fcpComponenteValido,
      ajusteGenericoRecusado: false,
      inconsistencia: null,
      motivo: null,
    };
  }

  // Tentativa de ajuste genérico → sempre recusada (R3.6). A mensagem distingue
  // o caso "sem regra homologada" (não há FCP válido de forma alguma) do caso
  // "há regra, mas o FCP deve ser componente, não ajuste".
  const motivo = temAliquotaHomologada
    ? `ST ${normalizarUf(ctx.uf)} (${ctx.competencia}): FCP homologado NÃO ` +
      'pode ser emitido como ajuste genérico (E111/C197). Deve sair como ' +
      'componente próprio (FCP-ST, base e alíquota reais). Ajuste genérico ' +
      'recusado (R3.6): passar no regex do PVA não comprova validade normativa.'
    : `ST ${normalizarUf(ctx.uf)} (${ctx.competencia}): não há regra de FCP ` +
      'homologada para o cenário; transformar o FCP num ajuste genérico só ' +
      'para o TXT passar é RECUSADO (R3.6). Sem FCP próprio homologado o ' +
      'cenário bloqueia de forma explicável — nunca vira um código inventado.';

  return {
    fcpComponenteValido,
    ajusteGenericoRecusado: true,
    inconsistencia: montarInconsistencia(
      ST_BLOQUEIO_CODIGOS.FCP_AJUSTE_GENERICO_RECUSADO,
      motivo,
      ctx,
    ),
    motivo,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. INTEGRAÇÃO (wire) — ponto único para o builder empurrar as inconsistências.
//
// Pronto para ser chamado do `efd-icms-ipi.builder.ts` quando o cenário de ST
// for habilitado: analisa o bloqueio do cenário e a guarda de FCP e empurra as
// inconsistências impeditivas para a lista do SPED, exatamente como os demais
// bloqueios da Fase 0. Devolve se a entrega está bloqueada por ST.
// ─────────────────────────────────────────────────────────────────────────────

export interface AplicarBloqueioStInput extends StBloqueioCenarioInput {
  // Guarda de FCP opcional (quando o cenário envolve FCP). Reaproveita o mesmo
  // contexto do cenário.
  fcp?: Omit<FcpGuardaInput, 'contexto'> | null;
}

/**
 * Aplica os bloqueios de ST (cenário + FCP) a uma lista de inconsistências do
 * SPED (tarefa 4.5). Empurra os itens `ERRO` em `inconsistencias` (o mesmo
 * `input.inconsistencias` do builder) e devolve se a entrega está bloqueada por
 * ST. Não serializa nada: é só o costurador do padrão de bloqueio.
 */
export function aplicarBloqueioSt(
  input: AplicarBloqueioStInput,
  inconsistencias: SpedInconsistencia[],
): { bloqueado: boolean } {
  let bloqueado = false;

  const cenario = analisarBloqueioCenarioSt(input);
  if (cenario.bloqueado && cenario.inconsistencia) {
    inconsistencias.push(cenario.inconsistencia);
    bloqueado = true;
  }

  if (input.fcp) {
    const guarda = guardarFcpNaoGenerico({
      contexto: input.contexto,
      ...input.fcp,
    });
    if (guarda.ajusteGenericoRecusado && guarda.inconsistencia) {
      inconsistencias.push(guarda.inconsistencia);
      bloqueado = true;
    }
  }

  return { bloqueado };
}

// ─────────────────────────────────────────────────────────────────────────────
// Auxiliares
// ─────────────────────────────────────────────────────────────────────────────

const SEVERIDADE_IMPEDITIVA: SpedInconsistenciaSeveridade = 'ERRO';

function bloqueio(
  codigo: string,
  mensagem: string,
  ctx: StCenarioContexto,
): StBloqueioCenarioResultado {
  return {
    bloqueado: true,
    inconsistencia: montarInconsistencia(codigo, mensagem, ctx),
    motivo: mensagem,
  };
}

// Monta a `SpedInconsistencia` IMPEDITIVA (ERRO), carregando os rastreadores de
// documento quando disponíveis — mesmo formato que o builder já empurra.
function montarInconsistencia(
  codigo: string,
  mensagem: string,
  ctx: StCenarioContexto,
): SpedInconsistencia {
  const item: SpedInconsistencia = {
    codigo,
    severidade: SEVERIDADE_IMPEDITIVA,
    mensagem,
  };
  if (naoVazio(ctx.documentoId) != null) item.documentoId = ctx.documentoId!;
  if (naoVazio(ctx.numeroDocumento) != null) {
    item.numeroDocumento = ctx.numeroDocumento!;
  }
  if (naoVazio(ctx.chaveAcesso) != null) item.chaveAcesso = ctx.chaveAcesso!;
  return item;
}

// Positividade em escala monetária, sem `Number`.
function positivo(valor: string | null | undefined, escala = 2): boolean {
  return toScaledInteger(valor ?? '0', escala) > 0n;
}

function naoVazio(valor: string | null | undefined): string | null {
  if (valor == null) return null;
  const t = valor.trim();
  return t === '' ? null : t;
}

function normalizarUf(uf: string): string {
  return (uf ?? '').trim().toUpperCase();
}
