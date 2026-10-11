/**
 * VERIFICAÇÃO NORMATIVA DE ST ANTES DE IMPLEMENTAR O CÁLCULO (Fase 4 / tarefa
 * 4.1 — R3.1).
 *
 * Esta é a PRIMEIRA tarefa de ST/FCP e é, deliberadamente, um PASSO DE
 * VERIFICAÇÃO/FUNDAÇÃO — não o motor de cálculo. O plano (§4.1), os requisitos
 * ("Pré-condições fiscais": "Verificação do Convênio ICMS 142/2018 e legislação
 * estadual antes de implementar ST") e o design (§ST/FCP: "verificar Convênio
 * ICMS 142/2018 + legislação estadual antes") exigem que, ANTES de qualquer
 * enquadramento produto/CEST/UF ou cálculo de substituto/substituído/FCP, a
 * FONTE NORMATIVA esteja registrada e verificada no catálogo versionado
 * (`fiscal_catalogos_versoes`, tipo `ST_FCP`), com fonte, hash e vigência (R3.1).
 *
 * O Convênio ICMS 142/2018 é o ARCABOUÇO NACIONAL da substituição tributária
 * (regras gerais, CEST, MVA, âmbito), mas NÃO é suficiente sozinho: a ST só se
 * aplica a uma mercadoria/UF quando a LEGISLAÇÃO ESTADUAL do destino a institui
 * (acordo/protocolo/convênio específico, com MVA e vigência próprios). Por isso
 * a verificação é de DUAS CAMADAS: o arcabouço nacional (142/2018) E a
 * legislação estadual da UF do cenário. Faltando qualquer uma, o cenário NÃO é
 * suportado e permanece BLOQUEADO/PENDENTE — nunca vira guia (escopo honesto da
 * fase, espelhando `difalPodeGerarGuia`/`pisCofinsPodeApurarDefinitivo`).
 *
 * ESCOPO DESTA TAREFA (4.1): estabelecer o REGISTRO DE VERIFICAÇÃO e o portão
 * (gate) que decide se um cenário de ST tem fonte verificada o bastante para
 * sequer ser habilitado nas tarefas seguintes. NÃO implementa o calculador de
 * ST, o motor de enquadramento (4.2), a separação substituto/substituído (4.3),
 * registros filhos SPED (4.4) nem a conciliação (4.6). Produz apenas a FONTE e o
 * ESTADO de verificação que essas tarefas consumirão.
 *
 * DECIMAIS SEMPRE COMO STRING (restrição da fase): este módulo não faz
 * aritmética monetária. Qualquer MVA/alíquota citada permanece string; aqui só
 * se trata de fontes, vigências e estado de verificação.
 */

import type { CatalogoVersaoResolvida } from './fiscal-normative-catalog.service';

/**
 * Descritor imutável do Convênio ICMS 142/2018 como FONTE do catálogo de ST
 * (R3.1 "fonte, hash, vigência, UF"). É o arcabouço NACIONAL — por isso é
 * registrado uma vez e referenciado por toda UF, mas NÃO basta sozinho para
 * habilitar um cenário (ver {@link verificarCenarioSt}).
 *
 * `fonte` casa com o padrão textual já usado no catálogo (ex.:
 * `default_pendente_confirmacao` da migração 0015); `fonteUrl` é o ponteiro
 * verificável (sítio oficial do CONFAZ). `vigenciaInicio` é a produção de
 * efeitos do convênio (01/01/2019). A `vigenciaFim` fica aberta (`null`): o
 * convênio segue vigente até revogação/substituição, que entraria como nova
 * versão por competência — nunca sobrescrevendo esta.
 */
export const CONVENIO_ICMS_142_2018 = {
  // Identificador estável da fonte nacional dentro do catálogo `ST_FCP`.
  fonte: 'convenio_icms_142_2018',
  // Rótulo humano para memórias/relatórios de conciliação (4.6).
  descricao:
    'Convênio ICMS 142/2018 (CONFAZ) — arcabouço nacional da substituição ' +
    'tributária do ICMS: regras gerais, CEST e âmbito de aplicação por acordo.',
  // Ponteiro verificável para a fonte oficial (CONFAZ).
  fonteUrl:
    'https://www.confaz.fazenda.gov.br/legislacao/convenios/2018/CV142_18',
  // Produção de efeitos do convênio (cláusula de vigência). Primeiro dia do mês,
  // coerente com a seleção por competência do catálogo.
  vigenciaInicio: '2019-01-01',
  // Aberta: segue vigente até revogação/substituição (nova versão, nunca sobre-
  // escrita).
  vigenciaFim: null as string | null,
} as const;

/**
 * Estado de verificação da FONTE de um cenário de ST (R3.1/R3.4). Precede e
 * condiciona qualquer cálculo:
 * - `VERIFICADO`: o arcabouço nacional (142/2018) E a legislação estadual da UF
 *   estão registrados, vigentes na competência e APROVADOS no catálogo. Só
 *   neste estado um cenário de ST pode ser habilitado para cálculo (4.2+).
 * - `PENDENTE_ESTADUAL`: o arcabouço nacional está verificado, mas a legislação
 *   ESTADUAL da UF ainda não foi registrada/aprovada. O cenário fica em
 *   pendência: a fonte nacional existe, mas a aplicação à mercadoria/UF depende
 *   da norma estadual (acordo/protocolo), que ainda não entrou.
 * - `PENDENTE_NACIONAL`: nem o arcabouço nacional (142/2018) está registrado/
 *   aprovado no catálogo. Nada de ST pode ser verificado sem a fonte nacional.
 */
export type StVerificacaoStatus =
  'VERIFICADO' | 'PENDENTE_ESTADUAL' | 'PENDENTE_NACIONAL';

/**
 * Entrada da verificação de UM cenário de ST para uma UF/competência. As fontes
 * são as versões do catálogo (`ST_FCP`) já resolvidas por competência pelo
 * `FiscalNormativeCatalogService` (nunca "a última"): a NACIONAL (arcabouço
 * 142/2018) e a ESTADUAL (legislação da UF do cenário). `null` em qualquer uma
 * significa que aquela camada não resolveu para a competência — logo, pendência.
 */
export interface StVerificacaoInput {
  // UF de destino do cenário (sigla de 2 letras), ecoada no resultado.
  uf: string;
  // Competência mensal 'YYYY-MM' da verificação, ecoada no resultado.
  competencia: string;
  // Versão de catálogo `ST_FCP` com a FONTE NACIONAL (arcabouço 142/2018)
  // vigente na competência, ou `null` quando não há. Resolvida pelo catálogo.
  fonteNacional: CatalogoVersaoResolvida | null;
  // Versão de catálogo `ST_FCP` com a LEGISLAÇÃO ESTADUAL da UF vigente na
  // competência, ou `null` quando não há. Resolvida pelo catálogo.
  fonteEstadual: CatalogoVersaoResolvida | null;
}

/**
 * Resultado da verificação de fonte de um cenário de ST. Expõe o estado, se o
 * cenário pode ser habilitado para cálculo, e uma memória textual auditável que
 * CITA cada camada (nacional/estadual) e por que o cenário está ou não liberado
 * — a base da "fonte" exigida por R3.5 e do bloqueio explicável de R3.4.
 */
export interface StVerificacaoResultado {
  uf: string;
  competencia: string;
  status: StVerificacaoStatus;
  // Verdadeiro só quando `status === 'VERIFICADO'`: ambas as camadas verificadas
  // e aprovadas. Enquanto falso, nenhum cálculo de ST pode ser habilitado (4.2+).
  habilitado: boolean;
  // Fonte nacional resolvida (142/2018), para a conciliação/registro da fonte.
  fonteNacional: string | null;
  fonteNacionalUrl: string | null;
  // Fonte estadual resolvida (legislação da UF), para a conciliação/registro.
  fonteEstadual: string | null;
  fonteEstadualUrl: string | null;
  // Memória textual auditável da verificação (sempre preenchida).
  memoria: string;
}

/**
 * VERIFICA a fonte normativa de um cenário de ST antes de qualquer cálculo
 * (tarefa 4.1 — R3.1/R3.4).
 *
 * Regra de decisão (determinística, da fonte mais básica à mais específica):
 *   1. Sem fonte NACIONAL verificada (ausente ou não aprovada) → `PENDENTE_
 *      NACIONAL`: sem o arcabouço 142/2018 registrado/aprovado no catálogo não
 *      há sobre o que verificar ST. Bloqueado.
 *   2. Fonte nacional verificada, mas sem fonte ESTADUAL verificada da UF
 *      (ausente ou não aprovada) → `PENDENTE_ESTADUAL`: o arcabouço existe, mas
 *      a aplicação à mercadoria/UF depende da legislação estadual que ainda não
 *      entrou. Bloqueado.
 *   3. Ambas verificadas e aprovadas → `VERIFICADO`: o cenário pode ser
 *      habilitado para cálculo nas tarefas seguintes.
 *
 * "Verificada" exige `escopoAprovado = true` na versão do catálogo: uma versão
 * vigente porém NÃO aprovada NÃO verifica a fonte (mesma postura do DIFAL/PIS-
 * COFINS, em que só o aprovado alimenta decisão definitiva). Isso garante que
 * sem revisão fiscal registrada o cenário permanece bloqueado (R3.4/R3.5).
 */
export function verificarCenarioSt(
  input: StVerificacaoInput,
): StVerificacaoResultado {
  const uf = normalizarUf(input.uf);
  const base = {
    uf,
    competencia: input.competencia,
    fonteNacional: input.fonteNacional?.fonte ?? null,
    fonteNacionalUrl: input.fonteNacional?.fonteUrl ?? null,
    fonteEstadual: input.fonteEstadual?.fonte ?? null,
    fonteEstadualUrl: input.fonteEstadual?.fonteUrl ?? null,
  };

  const nacionalVerificada = fonteVerificada(input.fonteNacional);
  const estadualVerificada = fonteVerificada(input.fonteEstadual);

  // 1. Sem o arcabouço nacional verificado → bloqueio na camada nacional.
  if (!nacionalVerificada) {
    return {
      ...base,
      status: 'PENDENTE_NACIONAL',
      habilitado: false,
      memoria:
        `ST ${uf} (${input.competencia}): arcabouço nacional não verificado. ` +
        'É necessário registrar e aprovar o Convênio ICMS 142/2018 ' +
        '(fonte, hash, vigência) no catálogo ST_FCP antes de implementar ST ' +
        '(R3.1). Cenário BLOQUEADO: nunca gera guia.',
    };
  }

  // 2. Nacional ok, mas falta a legislação estadual verificada da UF.
  if (!estadualVerificada) {
    return {
      ...base,
      status: 'PENDENTE_ESTADUAL',
      habilitado: false,
      memoria:
        `ST ${uf} (${input.competencia}): arcabouço nacional (Convênio ICMS ` +
        '142/2018) verificado, porém SEM legislação estadual verificada para a ' +
        'UF. A aplicação da ST à mercadoria/UF depende do acordo/protocolo ' +
        'estadual (MVA, vigência). Cenário em PENDÊNCIA (R3.4): BLOQUEADO até a ' +
        'norma estadual ser registrada e aprovada; nunca gera guia.',
    };
  }

  // 3. Ambas as camadas verificadas e aprovadas → cenário pode ser habilitado.
  return {
    ...base,
    status: 'VERIFICADO',
    habilitado: true,
    memoria:
      `ST ${uf} (${input.competencia}): fonte verificada em DUAS camadas — ` +
      `nacional (${base.fonteNacional}) e estadual (${base.fonteEstadual}), ` +
      'ambas vigentes e aprovadas no catálogo ST_FCP (R3.1/R3.5). Cenário ' +
      'habilitado para enquadramento/cálculo nas tarefas seguintes (4.2+).',
  };
}

/**
 * GUARDA DE HABILITAÇÃO DE CÁLCULO DE ST (tarefa 4.1 — R3.4).
 *
 * Único ponto de decisão sobre "este cenário de ST pode ser calculado/habilitado
 * para uma guia?". SIM apenas quando a verificação está `VERIFICADO`. Espelha
 * `difalPodeGerarGuia`/`pisCofinsPodeApurarDefinitivo`: isolar a condição num só
 * lugar garante que todo caminho que habilite ST (motor de enquadramento 4.2,
 * cálculo 4.3, registros SPED 4.4) consulte a MESMA regra, e nunca habilite um
 * cenário cuja fonte não foi verificada.
 */
export function stCenarioPodeSerHabilitado(
  status: StVerificacaoStatus,
): boolean {
  return status === 'VERIFICADO';
}

/**
 * Motivo textual auditável de por que um cenário de ST NÃO pode ser habilitado
 * (R3.4): o bloqueio EXPLICÁVEL exigido pela fase. `null` para `VERIFICADO` (não
 * há recusa a explicar). Espelha `difalMotivoInelegibilidadeGuia`.
 */
export function stMotivoBloqueio(status: StVerificacaoStatus): string | null {
  switch (status) {
    case 'VERIFICADO':
      return null;
    case 'PENDENTE_NACIONAL':
      return (
        'ST BLOQUEADA: o arcabouço nacional (Convênio ICMS 142/2018) ainda não ' +
        'foi registrado e aprovado no catálogo. Sem a fonte nacional verificada ' +
        'nenhum cenário de ST é suportado (R3.1/R3.4).'
      );
    case 'PENDENTE_ESTADUAL':
      return (
        'ST BLOQUEADA: a legislação estadual da UF (acordo/protocolo/convênio ' +
        'específico) ainda não foi registrada e aprovada. O arcabouço nacional ' +
        'não basta sozinho para aplicar a ST à mercadoria/UF (R3.4).'
      );
  }
}

// Uma fonte está VERIFICADA quando a versão do catálogo existe, resolveu para a
// competência E está aprovada (revisão fiscal registrada). Uma versão vigente
// porém não aprovada NÃO verifica a fonte — mantém o cenário em pendência.
function fonteVerificada(
  versao: CatalogoVersaoResolvida | null,
): versao is CatalogoVersaoResolvida {
  return versao != null && versao.escopoAprovado === true;
}

function normalizarUf(uf: string): string {
  return (uf ?? '').trim().toUpperCase();
}
