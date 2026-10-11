/**
 * NÚCLEO PURO DOS CRITÉRIOS DE "HOMOLOGADO" E DA EXPANSÃO DE ROLLOUT
 * (Fase 5, tarefa 5.2 — R5.1).
 *
 * O design (§Rollout §13) define a liberação por cenário com CRITÉRIOS OBJETIVOS
 * e uma progressão de rollout: "Liberação por cenário com critérios objetivos
 * (regra vigente + testes + livro conciliado + PVA + revisão fiscal). Amostra
 * pequena → expansão por UF/perfil/regime." Esta é a SEGUNDA tarefa do grupo 5
 * (rollout), logo após o inventário read-only (5.1), e segue o MESMO padrão: um
 * RESOLVER PURO, determinístico e testável sem banco, que apenas CLASSIFICA e
 * DECIDE sobre fatos já conhecidos — não escreve nada, não migra nada.
 *
 * R5.1 é LITERAL e CONJUNTIVO: um cenário só passa a "homologado" QUANDO tem
 * TODOS de — regra/fonte vigente, teste unitário, integração de persistência
 * (QUANDO aplicável), livro conciliado, TXT validado no PVA e revisão fiscal
 * registrada. Modelamos cada critério como um booleano explícito de ENTRADA (um
 * fato observável, não uma inferência): o núcleo não "adivinha" se há teste ou
 * revisão — ele recebe esses sinais e aplica a conjunção. A ausência de QUALQUER
 * critério aplicável torna o cenário NÃO homologado e é LISTADA (`faltantes`),
 * para que a decisão de liberação seja auditável.
 *
 * O critério de INTEGRAÇÃO DE PERSISTÊNCIA é CONDICIONAL ("quando aplicável"):
 * quando o cenário não persiste nada (`persistenciaAplicavel = false`), esse
 * critério não é exigido e não entra em `faltantes` — espelhando a mesma postura
 * das demais fases, em que a ausência de um registro NÃO aplicável nunca é
 * defeito. Os demais cinco critérios são SEMPRE exigidos.
 *
 * A EXPANSÃO (amostra → UF/perfil/regime) opera APENAS sobre cenários
 * HOMOLOGADOS. Partimos de uma AMOSTRA PEQUENA (os primeiros N homologados, em
 * ordem estável) e expandimos agrupando os homologados por COORTE
 * (UF/perfil/regime). Cenários não homologados nunca entram na amostra nem em
 * nenhuma coorte de expansão — a liberação só avança sobre o que é objetivamente
 * homologado (R5.1).
 */

/**
 * Os SEIS critérios objetivos de homologação de R5.1, como booleanos de
 * ENTRADA (fatos observados, não inferidos). Cada campo é um critério:
 *  - `regraFonteVigente`: existe regra/fonte normativa VIGENTE para o cenário.
 *  - `testeUnitario`: há teste unitário cobrindo o cenário.
 *  - `persistenciaAplicavel`: o cenário PERSISTE estado (decide se a integração
 *    de persistência é exigida). Quando `false`, `integracaoPersistencia` é
 *    IGNORADO (critério não aplicável — não exigido, não faltante).
 *  - `integracaoPersistencia`: há teste de integração de persistência. Só é
 *    exigido quando `persistenciaAplicavel = true`.
 *  - `livroConciliado`: o livro/apuração do cenário está conciliado.
 *  - `txtValidadoPva`: o TXT do cenário foi validado no PVA.
 *  - `revisaoFiscalRegistrada`: há revisão fiscal registrada para o cenário.
 */
export interface CriteriosHomologacao {
  regraFonteVigente: boolean;
  testeUnitario: boolean;
  persistenciaAplicavel: boolean;
  integracaoPersistencia: boolean;
  livroConciliado: boolean;
  txtValidadoPva: boolean;
  revisaoFiscalRegistrada: boolean;
}

/**
 * Identificação da COORTE de rollout de um cenário: UF, perfil e regime. É por
 * esses três eixos que a expansão agrupa os cenários homologados (§Rollout §13).
 * Mantidos como strings frouxas (espelham os cadastros): a classificação não
 * reinterpreta os valores, só os usa como chave de agrupamento estável.
 */
export interface CoorteCenario {
  uf: string;
  perfil: string;
  regime: string;
}

/**
 * Um CENÁRIO candidato à homologação, com sua identificação, coorte
 * (UF/perfil/regime) e os critérios objetivos observados. É o fato de entrada do
 * núcleo puro: nenhum sinal é inferido aqui.
 */
export interface CenarioHomologacao {
  /** Identificador estável do cenário (ex.: 'T01', 'EFD_ICMS_IPI-SP-A'). */
  id: string;
  coorte: CoorteCenario;
  criterios: CriteriosHomologacao;
}

/**
 * Código de cada critério objetivo (R5.1), usado para LISTAR os faltantes de
 * forma estável e auditável. A ordem de declaração é a ordem de apresentação.
 */
export type CriterioCodigo =
  | 'REGRA_FONTE_VIGENTE'
  | 'TESTE_UNITARIO'
  | 'INTEGRACAO_PERSISTENCIA'
  | 'LIVRO_CONCILIADO'
  | 'TXT_VALIDADO_PVA'
  | 'REVISAO_FISCAL_REGISTRADA';

/** Rótulo humano de cada critério, para a memória/apresentação auditável. */
export const CRITERIO_LABEL: Record<CriterioCodigo, string> = {
  REGRA_FONTE_VIGENTE: 'Regra/fonte vigente',
  TESTE_UNITARIO: 'Teste unitário',
  INTEGRACAO_PERSISTENCIA: 'Integração de persistência (quando aplicável)',
  LIVRO_CONCILIADO: 'Livro conciliado',
  TXT_VALIDADO_PVA: 'TXT validado no PVA',
  REVISAO_FISCAL_REGISTRADA: 'Revisão fiscal registrada',
};

/**
 * A AVALIAÇÃO de homologação de um cenário (R5.1). Resultado puro e
 * determinístico: `homologado` é `true` SOMENTE quando TODOS os critérios
 * APLICÁVEIS estão satisfeitos; caso contrário, `faltantes` lista exatamente os
 * critérios aplicáveis não satisfeitos (nunca inclui o critério de persistência
 * quando este não é aplicável).
 */
export interface AvaliacaoHomologacao {
  id: string;
  coorte: CoorteCenario;
  /** `true` SOMENTE quando todos os critérios aplicáveis estão satisfeitos. */
  homologado: boolean;
  /** Critérios aplicáveis NÃO satisfeitos, em ordem estável. Vazio quando homologado. */
  faltantes: CriterioCodigo[];
  /**
   * `true` quando o cenário persiste estado e, portanto, exige o teste de
   * integração de persistência (eco do insumo, para apresentação auditável).
   */
  persistenciaAplicavel: boolean;
  /** Memória textual auditável do resultado (sempre preenchida). */
  memoria: string;
}

/**
 * AVALIA um único cenário contra os critérios objetivos de R5.1 (puro e
 * determinístico). Aplica a conjunção dos SEIS critérios, tratando a integração
 * de persistência como CONDICIONAL ("quando aplicável"): se o cenário não
 * persiste estado, esse critério não é exigido nem listado como faltante.
 *
 * Um cenário é `homologado` SOMENTE quando `faltantes` está vazio — a leitura
 * literal e conjuntiva de R5.1. Qualquer critério aplicável ausente → não
 * homologado, com o motivo listado.
 */
export function avaliarHomologacao(
  cenario: CenarioHomologacao,
): AvaliacaoHomologacao {
  const c = cenario.criterios;
  const faltantes: CriterioCodigo[] = [];

  // Cinco critérios SEMPRE exigidos (ordem estável de apresentação).
  if (!c.regraFonteVigente) faltantes.push('REGRA_FONTE_VIGENTE');
  if (!c.testeUnitario) faltantes.push('TESTE_UNITARIO');
  // Integração de persistência: CONDICIONAL (R5.1 — "quando aplicável"). Só é
  // exigida quando o cenário persiste estado; caso contrário, não entra na lista.
  if (c.persistenciaAplicavel && !c.integracaoPersistencia) {
    faltantes.push('INTEGRACAO_PERSISTENCIA');
  }
  if (!c.livroConciliado) faltantes.push('LIVRO_CONCILIADO');
  if (!c.txtValidadoPva) faltantes.push('TXT_VALIDADO_PVA');
  if (!c.revisaoFiscalRegistrada) faltantes.push('REVISAO_FISCAL_REGISTRADA');

  const homologado = faltantes.length === 0;

  return {
    id: cenario.id,
    coorte: cenario.coorte,
    homologado,
    faltantes,
    persistenciaAplicavel: c.persistenciaAplicavel,
    memoria: homologado
      ? 'Homologado: todos os critérios objetivos de R5.1 satisfeitos (regra/' +
        'fonte vigente, teste unitário' +
        (c.persistenciaAplicavel ? ', integração de persistência' : '') +
        ', livro conciliado, TXT validado no PVA e revisão fiscal registrada).' +
        (c.persistenciaAplicavel
          ? ''
          : ' Integração de persistência não aplicável (cenário não persiste ' +
            'estado) — não exigida.')
      : `Não homologado: ${faltantes.length} critério(s) objetivo(s) de R5.1 ` +
        `não satisfeito(s) (${faltantes
          .map((f) => CRITERIO_LABEL[f])
          .join(
            ', ',
          )}). O cenário não pode ser liberado até atendê-los (R5.1).`,
  };
}

/** Uma COORTE de expansão (UF/perfil/regime) com seus cenários homologados. */
export interface CoorteExpansao {
  uf: string;
  perfil: string;
  regime: string;
  /** Ids dos cenários HOMOLOGADOS da coorte, em ordem estável. */
  cenarios: string[];
}

/**
 * O PLANO DE ROLLOUT derivado dos cenários (R5.1 + §Rollout §13). Projeção pura:
 * avalia cada cenário, separa os homologados, define a AMOSTRA pequena (os
 * primeiros `tamanhoAmostra` homologados em ordem estável) e a EXPANSÃO agrupada
 * por coorte (UF/perfil/regime) — sempre e somente sobre os homologados.
 */
export interface PlanoRollout {
  /** Avaliação de cada cenário de entrada, em ordem estável por id. */
  avaliacoes: AvaliacaoHomologacao[];
  /** Ids dos cenários homologados (ordem estável), base da amostra/expansão. */
  homologados: string[];
  /** Ids dos cenários NÃO homologados (ordem estável) — nunca liberados. */
  naoHomologados: string[];
  /** AMOSTRA pequena: os primeiros `tamanhoAmostra` homologados (ordem estável). */
  amostra: string[];
  /** EXPANSÃO por coorte (UF/perfil/regime), apenas sobre os homologados. */
  expansao: CoorteExpansao[];
  resumo: {
    totalCenarios: number;
    totalHomologados: number;
    totalNaoHomologados: number;
    tamanhoAmostra: number;
    totalCoortes: number;
  };
}

/**
 * MONTA o plano de rollout a partir dos cenários e do tamanho da amostra (R5.1
 * + §Rollout §13). Puro e determinístico: os mesmos cenários sempre produzem o
 * mesmo plano.
 *
 * Fluxo:
 *  1. AVALIA cada cenário (ordem estável por id) contra os critérios de R5.1.
 *  2. SEPARA homologados × não homologados.
 *  3. AMOSTRA = os primeiros `tamanhoAmostra` homologados (amostra pequena); se
 *     houver menos homologados que o pedido, a amostra é o que houver.
 *  4. EXPANSÃO = os homologados agrupados por coorte (UF/perfil/regime), em
 *     ordem estável de coorte. Nenhum não homologado entra em qualquer coorte.
 *
 * `tamanhoAmostra` negativo é tratado como `0` (sem amostra). A expansão nunca
 * depende da amostra: é a cobertura completa dos homologados por coorte.
 */
export function montarPlanoRollout(
  cenarios: CenarioHomologacao[],
  tamanhoAmostra: number,
): PlanoRollout {
  const avaliacoes = [...cenarios]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(avaliarHomologacao);

  const homologadosAval = avaliacoes.filter((a) => a.homologado);
  const homologados = homologadosAval.map((a) => a.id);
  const naoHomologados = avaliacoes
    .filter((a) => !a.homologado)
    .map((a) => a.id);

  const n = Math.max(0, Math.trunc(tamanhoAmostra));
  const amostra = homologados.slice(0, n);

  const expansao = agruparPorCoorte(homologadosAval);

  return {
    avaliacoes,
    homologados,
    naoHomologados,
    amostra,
    expansao,
    resumo: {
      totalCenarios: avaliacoes.length,
      totalHomologados: homologados.length,
      totalNaoHomologados: naoHomologados.length,
      tamanhoAmostra: amostra.length,
      totalCoortes: expansao.length,
    },
  };
}

/**
 * Agrupa as avaliações HOMOLOGADAS por coorte (UF/perfil/regime), em ordem
 * estável de coorte (UF, depois perfil, depois regime) e com os cenários de cada
 * coorte também em ordem estável. Só homologados entram — a expansão nunca
 * libera cenário não homologado.
 */
function agruparPorCoorte(
  homologados: AvaliacaoHomologacao[],
): CoorteExpansao[] {
  const grupos = new Map<string, CoorteExpansao>();
  for (const aval of homologados) {
    const { uf, perfil, regime } = aval.coorte;
    const chave = `${uf}|${perfil}|${regime}`;
    const grupo = grupos.get(chave);
    if (grupo) grupo.cenarios.push(aval.id);
    else grupos.set(chave, { uf, perfil, regime, cenarios: [aval.id] });
  }

  const coortes = [...grupos.values()];
  for (const coorte of coortes) {
    coorte.cenarios.sort((a, b) => a.localeCompare(b));
  }
  return coortes.sort((a, b) => {
    const u = a.uf.localeCompare(b.uf);
    if (u !== 0) return u;
    const p = a.perfil.localeCompare(b.perfil);
    if (p !== 0) return p;
    return a.regime.localeCompare(b.regime);
  });
}
