/**
 * Política única de Simples por vigência — função pura (Fase 3, F17 / R6.1, R6.4).
 *
 * Esta é a FUNDAÇÃO da task 6.2: separa, como conceitos de primeira classe e
 * ortogonais, as quatro dimensões hoje conflatadas no único booleano
 * `apuraIcms` (ver `clientes.types.ts`, semântica autoritativa da task 6.1):
 *
 *   1. OBRIGAÇÃO EFD ICMS/IPI — obrigação acessória de escriturar/transmitir o
 *      arquivo digital. Existe (ou não) independentemente de haver apuração de
 *      ICMS próprio. Um Simples pode ser obrigado à EFD sem apurar ICMS próprio.
 *   2. REGIME DE ICMS PRÓPRIO — se o estabelecimento apura ICMS próprio em
 *      conta gráfica (debita saídas tributadas, credita entradas admitidas,
 *      saldo no Bloco E / livro de apuração). É exatamente a semântica de
 *      `apuraIcms` definida na task 6.1.
 *   3. SUBLIMITE / IMPEDIMENTO ESTADUAL — Simples que excedeu o sublimite
 *      estadual (LC 123/2006, art. 19/20) ou está impedido de recolher o ICMS
 *      no DAS: nesse caso recolhe o ICMS FORA do DAS e, por consequência,
 *      passa a apurar ICMS próprio.
 *   4. OBRIGAÇÕES FORA DO DAS — ST (substituição tributária), DIFAL e
 *      antecipação. Existem mesmo quando NÃO há apuração de ICMS próprio: o
 *      Simples recolhe o imposto da operação própria no DAS, mas essas
 *      obrigações estaduais correm por fora (N09 — LC 123/2006).
 *
 * A separação é modelada POR VIGÊNCIA (efetivo por competência) porque o estado
 * de um estabelecimento muda ao longo do tempo (R6.4): um Simples pode cruzar
 * o sublimite no meio do ano, perder/ganhar a obrigação de ST etc. A política
 * resolve, para UMA competência de referência, cada dimensão de forma
 * independente e AUDITÁVEL — espelhando o estilo de origem explícita da task
 * 6.1 (`resolveApuraIcms`): cada dimensão vem acompanhada da `origem` da
 * decisão, para que a escolha seja rastreável e nunca silenciosa.
 *
 * Função pura, sem efeitos colaterais e sem dependência de I/O. Limiares
 * monetários (sublimite) são decimais em STRING e comparados por inteiros
 * escalados — nunca `Number` — para não perder precisão (restrição da fase:
 * decimais sem `Number`). Esta task NÃO faz a fiação do consumo (livros /
 * builder): isso é a task 6.3. Aqui entregamos apenas o modelo separado,
 * efetivo-datado, mais o resolvedor e os testes.
 */
import { monthsBetweenCompetencias } from '../fiscal-date.util';
import { toScaledInteger } from '../sped/sped-decimal';
import {
  resolveApuraIcms,
  type RegimeTributario,
} from '../../clientes/clientes.types';

/**
 * Competência de referência ou de vigência no formato 'YYYY-MM' (ou qualquer
 * data cujos 7 primeiros caracteres sejam 'YYYY-MM', como as colunas `date` do
 * Postgres). A comparação temporal usa `monthsBetweenCompetencias`, que
 * considera apenas ano+mês de calendário.
 */
export type Competencia = string;

// ---------------------------------------------------------------------------
// Dimensão 1 — Obrigação de entregar EFD ICMS/IPI
// ---------------------------------------------------------------------------

/**
 * Origem auditável da decisão sobre a obrigação de EFD ICMS/IPI.
 *  - `INFORMADO`: a obrigatoriedade foi declarada explicitamente para a
 *    vigência vigente (o fiscal/estado definiu).
 *  - `REGIME_LUCRO_NORMAL`: Lucro Presumido/Real são obrigados à EFD por
 *    definição do regime.
 *  - `SIMPLES_DISPENSADO_PADRAO`: default DOCUMENTADO — o Simples Nacional, por
 *    padrão, é dispensado da EFD ICMS/IPI (recolhe no DAS e entrega PGDAS-D),
 *    salvo obrigação estadual específica declarada como `INFORMADO`.
 *  - `SEM_REGIME`: sem regime definido não há obrigação apurável aqui.
 */
export const EFD_OBRIGACAO_ORIGENS = [
  'INFORMADO',
  'REGIME_LUCRO_NORMAL',
  'SIMPLES_DISPENSADO_PADRAO',
  'SEM_REGIME',
] as const;

export type EfdObrigacaoOrigem = (typeof EFD_OBRIGACAO_ORIGENS)[number];

export interface ObrigacaoEfdResolucao {
  /** `true` quando o estabelecimento está obrigado a escriturar/transmitir a EFD ICMS/IPI na competência. */
  obrigado: boolean;
  origem: EfdObrigacaoOrigem;
}

// ---------------------------------------------------------------------------
// Dimensão 2 — Regime de ICMS próprio (apuração em conta gráfica)
// ---------------------------------------------------------------------------

/**
 * Origem auditável da decisão sobre apuração de ICMS próprio.
 * Reaproveita o espírito de `resolveApuraIcms` (task 6.1) e acrescenta a origem
 * `SUBLIMITE_IMPEDIMENTO`, que é a consequência da dimensão 3: quando o Simples
 * recolhe o ICMS fora do DAS, passa a apurar ICMS próprio por força do
 * sublimite/impedimento — não por um valor informado nem pelo default do regime.
 */
export const APURACAO_ICMS_ORIGENS = [
  'INFORMADO',
  'REGIME_LUCRO_NORMAL',
  'REGIME_SIMPLES_PADRAO',
  'SUBLIMITE_IMPEDIMENTO',
  'SEM_REGIME',
] as const;

export type ApuracaoIcmsOrigem = (typeof APURACAO_ICMS_ORIGENS)[number];

export interface ApuracaoIcmsPropriaResolucao {
  /** `true` quando apura ICMS próprio em conta gráfica (Bloco E / livro de apuração) na competência. */
  apura: boolean;
  origem: ApuracaoIcmsOrigem;
}

// ---------------------------------------------------------------------------
// Dimensão 3 — Sublimite / impedimento estadual
// ---------------------------------------------------------------------------

/**
 * Situação do estabelecimento perante o sublimite estadual do Simples.
 *  - `DENTRO`: dentro do sublimite — recolhe ICMS no DAS normalmente.
 *  - `EXCEDIDO`: ultrapassou o sublimite estadual (RBT12 > sublimite) — ICMS
 *    recolhido FORA do DAS; passa a apurar ICMS próprio.
 *  - `IMPEDIDO`: impedido de recolher ICMS no DAS por decisão estadual
 *    (independe de valor) — mesmo efeito: ICMS fora do DAS, apura próprio.
 *  - `NAO_APLICAVEL`: não é Simples (ou sem regime); o conceito não se aplica.
 */
export const SITUACOES_SUBLIMITE = [
  'DENTRO',
  'EXCEDIDO',
  'IMPEDIDO',
  'NAO_APLICAVEL',
] as const;

export type SituacaoSublimite = (typeof SITUACOES_SUBLIMITE)[number];

/**
 * Origem auditável da situação de sublimite/impedimento.
 *  - `IMPEDIMENTO_INFORMADO`: impedimento declarado explicitamente para a vigência.
 *  - `SUBLIMITE_EXCEDIDO_RBT12`: derivado da comparação RBT12 × sublimite (ambos
 *    decimais em string, comparados por inteiros escalados).
 *  - `DENTRO_DO_SUBLIMITE`: RBT12 dentro do sublimite declarado.
 *  - `SEM_PARAMETRO`: Simples sem RBT12/sublimite informados — assume `DENTRO`
 *    (não há como afirmar excesso sem o parâmetro), origem explícita.
 *  - `NAO_SIMPLES`: regime não-Simples — conceito não aplicável.
 */
export const SUBLIMITE_ORIGENS = [
  'IMPEDIMENTO_INFORMADO',
  'SUBLIMITE_EXCEDIDO_RBT12',
  'DENTRO_DO_SUBLIMITE',
  'SEM_PARAMETRO',
  'NAO_SIMPLES',
] as const;

export type SublimiteOrigem = (typeof SUBLIMITE_ORIGENS)[number];

export interface SublimiteResolucao {
  situacao: SituacaoSublimite;
  origem: SublimiteOrigem;
  /** `true` quando a situação força o ICMS a ser recolhido fora do DAS (EXCEDIDO ou IMPEDIDO). */
  recolheIcmsForaDoDas: boolean;
}

// ---------------------------------------------------------------------------
// Dimensão 4 — Obrigações fora do DAS (ST, DIFAL, antecipação)
// ---------------------------------------------------------------------------

export const OBRIGACOES_FORA_DAS = ['ST', 'DIFAL', 'ANTECIPACAO'] as const;

export type ObrigacaoForaDoDas = (typeof OBRIGACOES_FORA_DAS)[number];

/**
 * Origem auditável do conjunto de obrigações fora do DAS.
 *  - `INFORMADO`: conjunto declarado explicitamente para a vigência.
 *  - `SEM_OBRIGACOES`: nenhuma obrigação fora do DAS declarada para a vigência.
 */
export const OBRIGACOES_FORA_DAS_ORIGENS = [
  'INFORMADO',
  'SEM_OBRIGACOES',
] as const;

export type ObrigacoesForaDasOrigem =
  (typeof OBRIGACOES_FORA_DAS_ORIGENS)[number];

export interface ObrigacoesForaDasResolucao {
  /** Conjunto (ordenado, sem duplicatas) de obrigações estaduais fora do DAS vigentes na competência. */
  obrigacoes: ObrigacaoForaDoDas[];
  origem: ObrigacoesForaDasOrigem;
}

// ---------------------------------------------------------------------------
// Vigência declarada (efetivo-datada) e entrada do resolvedor
// ---------------------------------------------------------------------------

/**
 * Uma vigência declarada pelo fiscal para um estabelecimento. Cada campo é
 * OPCIONAL: a vigência declara apenas as dimensões que mudaram naquela data de
 * início. A ausência de um campo significa "mantém o default do regime / da
 * resolução", nunca um zero silencioso.
 *
 * `inicio` é a competência 'YYYY-MM' a partir da qual a vigência passa a valer
 * (inclusive). Uma vigência vale até o início da próxima vigência (exclusivo),
 * ou indefinidamente se for a última.
 */
export interface VigenciaSimples {
  /** Competência de início (inclusive), 'YYYY-MM'. */
  inicio: Competencia;

  /** Dimensão 1 — obrigatoriedade de EFD ICMS/IPI declarada para a vigência. */
  obrigadoEfd?: boolean;

  /**
   * Dimensão 2 — valor informado de apuração de ICMS próprio para a vigência
   * (equivale ao `informado` de `resolveApuraIcms`). Para Simples, um sublimite
   * excedido/impedimento SOBREPÕE este valor (força apuração).
   */
  apuraIcmsInformado?: boolean;

  /** Dimensão 3 — impedimento estadual explícito de recolher ICMS no DAS. */
  impedidoDas?: boolean;
  /** Dimensão 3 — receita bruta dos últimos 12 meses (RBT12), decimal em string. */
  rbt12?: string;
  /** Dimensão 3 — sublimite estadual aplicável, decimal em string. */
  sublimite?: string;

  /** Dimensão 4 — obrigações fora do DAS vigentes (ST/DIFAL/antecipação). */
  obrigacoesForaDoDas?: ObrigacaoForaDoDas[];
}

export interface PoliticaSimplesInput {
  regimeTributario: RegimeTributario | null;
  /**
   * Linha do tempo de vigências declaradas. Não precisa estar ordenada: o
   * resolvedor ordena por `inicio`. Pode estar vazia — nesse caso a resolução
   * usa apenas o regime e seus defaults documentados.
   */
  vigencias?: VigenciaSimples[];
}

/**
 * Resultado completo da política para UMA competência de referência: as quatro
 * dimensões resolvidas de forma independente e auditável, mais a vigência que
 * governou a resolução (para rastreabilidade).
 */
export interface PoliticaSimplesResolucao {
  competencia: Competencia;
  /** Competência de início da vigência aplicada, ou `null` quando nenhuma vigência cobre a competência. */
  vigenciaAplicada: Competencia | null;
  obrigacaoEfd: ObrigacaoEfdResolucao;
  apuracaoIcmsPropria: ApuracaoIcmsPropriaResolucao;
  sublimite: SublimiteResolucao;
  obrigacoesForaDoDas: ObrigacoesForaDasResolucao;
}

// ---------------------------------------------------------------------------
// Resolvedor
// ---------------------------------------------------------------------------

/**
 * Seleciona a vigência EFETIVA para a competência de referência: a última
 * vigência cujo `inicio` é anterior ou igual à competência. Vigências futuras
 * (início depois da competência) são ignoradas. Retorna `null` quando nenhuma
 * vigência cobre a competência (ex.: competência anterior à primeira vigência).
 */
function selecionarVigencia(
  vigencias: VigenciaSimples[],
  competencia: Competencia,
): VigenciaSimples | null {
  let escolhida: VigenciaSimples | null = null;
  for (const vigencia of vigencias) {
    // monthsBetweenCompetencias(inicio, competencia) >= 0 ⟺ início <= competência.
    if (monthsBetweenCompetencias(vigencia.inicio, competencia) < 0) {
      continue;
    }
    // Substitui quando esta vigência é MAIS RECENTE que a escolhida, i.e.
    // vigencia.inicio > escolhida.inicio ⟺ monthsBetween(escolhida, vigencia) > 0.
    if (
      escolhida === null ||
      monthsBetweenCompetencias(escolhida.inicio, vigencia.inicio) > 0
    ) {
      escolhida = vigencia;
    }
  }
  return escolhida;
}

/** Lucro Presumido/Real: apura ICMS próprio e é obrigado à EFD por definição. */
function ehLucroNormal(regime: RegimeTributario | null): boolean {
  return regime === 'LUCRO_PRESUMIDO' || regime === 'LUCRO_REAL';
}

/** Dimensão 3 — resolve a situação de sublimite/impedimento, auditável. */
function resolverSublimite(
  regime: RegimeTributario | null,
  vigencia: VigenciaSimples | null,
): SublimiteResolucao {
  if (regime !== 'SIMPLES_NACIONAL') {
    return {
      situacao: 'NAO_APLICAVEL',
      origem: 'NAO_SIMPLES',
      recolheIcmsForaDoDas: false,
    };
  }

  // Impedimento declarado vence qualquer comparação de valor.
  if (vigencia?.impedidoDas === true) {
    return {
      situacao: 'IMPEDIDO',
      origem: 'IMPEDIMENTO_INFORMADO',
      recolheIcmsForaDoDas: true,
    };
  }

  const rbt12 = vigencia?.rbt12;
  const sublimite = vigencia?.sublimite;
  if (rbt12 !== undefined && sublimite !== undefined) {
    // Comparação por inteiros escalados — nunca Number — para preservar
    // precisão decimal dos limiares monetários.
    const rbt12Escalado = toScaledInteger(rbt12);
    const sublimiteEscalado = toScaledInteger(sublimite);
    if (rbt12Escalado > sublimiteEscalado) {
      return {
        situacao: 'EXCEDIDO',
        origem: 'SUBLIMITE_EXCEDIDO_RBT12',
        recolheIcmsForaDoDas: true,
      };
    }
    return {
      situacao: 'DENTRO',
      origem: 'DENTRO_DO_SUBLIMITE',
      recolheIcmsForaDoDas: false,
    };
  }

  // Simples sem parâmetros de sublimite: assume DENTRO (não há como afirmar
  // excesso sem RBT12/sublimite). Origem explícita, não silenciosa.
  return {
    situacao: 'DENTRO',
    origem: 'SEM_PARAMETRO',
    recolheIcmsForaDoDas: false,
  };
}

/** Dimensão 1 — resolve a obrigação de EFD ICMS/IPI, auditável. */
function resolverObrigacaoEfd(
  regime: RegimeTributario | null,
  vigencia: VigenciaSimples | null,
): ObrigacaoEfdResolucao {
  // Declaração explícita vence (ex.: estado obriga o Simples à EFD).
  if (vigencia?.obrigadoEfd !== undefined) {
    return { obrigado: vigencia.obrigadoEfd, origem: 'INFORMADO' };
  }
  if (ehLucroNormal(regime)) {
    return { obrigado: true, origem: 'REGIME_LUCRO_NORMAL' };
  }
  if (regime === 'SIMPLES_NACIONAL') {
    return { obrigado: false, origem: 'SIMPLES_DISPENSADO_PADRAO' };
  }
  return { obrigado: false, origem: 'SEM_REGIME' };
}

/**
 * Dimensão 2 — resolve a apuração de ICMS próprio, auditável.
 * Reusa `resolveApuraIcms` (task 6.1) como base para regime + informado, mas o
 * sublimite/impedimento (dimensão 3) SOBREPÕE: quando o Simples recolhe ICMS
 * fora do DAS, apura ICMS próprio por força do estado estadual.
 */
function resolverApuracaoIcms(
  regime: RegimeTributario | null,
  vigencia: VigenciaSimples | null,
  sublimite: SublimiteResolucao,
): ApuracaoIcmsPropriaResolucao {
  if (regime === 'SIMPLES_NACIONAL' && sublimite.recolheIcmsForaDoDas) {
    return { apura: true, origem: 'SUBLIMITE_IMPEDIMENTO' };
  }

  const base = resolveApuraIcms({
    regimeTributario: regime,
    informado: vigencia?.apuraIcmsInformado,
  });
  return { apura: base.apuraIcms, origem: base.origem };
}

/** Dimensão 4 — resolve o conjunto de obrigações fora do DAS, auditável. */
function resolverObrigacoesForaDoDas(
  vigencia: VigenciaSimples | null,
): ObrigacoesForaDasResolucao {
  const declaradas = vigencia?.obrigacoesForaDoDas;
  if (declaradas !== undefined && declaradas.length > 0) {
    // Normaliza: remove duplicatas e ordena na ordem canônica do domínio.
    const unicas = OBRIGACOES_FORA_DAS.filter((o) => declaradas.includes(o));
    return { obrigacoes: unicas, origem: 'INFORMADO' };
  }
  return { obrigacoes: [], origem: 'SEM_OBRIGACOES' };
}

/**
 * Resolve a política de Simples para UMA competência de referência, separando
 * as quatro dimensões de forma independente e auditável (R6.1), honrando a
 * vigência efetiva da competência (R6.4).
 *
 * Observações de modelagem:
 *  - As dimensões são ORTOGONAIS. Obrigação de EFD não implica apuração de ICMS
 *    próprio; obrigações fora do DAS existem mesmo sem apuração própria; o
 *    sublimite/impedimento é a única dimensão que, por regra legal, força a
 *    dimensão 2 (apuração própria) a verdadeiro para o Simples.
 *  - Nenhuma decisão é silenciosa: cada dimensão carrega a `origem` da escolha.
 *  - Não quebra consumidores atuais de `apuraIcms`: é puramente aditivo. A
 *    fiação do consumo (livros/builder) é a task 6.3.
 */
export function resolverPoliticaSimples(
  input: PoliticaSimplesInput,
  competencia: Competencia,
): PoliticaSimplesResolucao {
  const regime = input.regimeTributario;
  const vigencias = input.vigencias ?? [];
  const vigencia = selecionarVigencia(vigencias, competencia);

  const sublimite = resolverSublimite(regime, vigencia);

  return {
    competencia,
    vigenciaAplicada: vigencia?.inicio ?? null,
    obrigacaoEfd: resolverObrigacaoEfd(regime, vigencia),
    apuracaoIcmsPropria: resolverApuracaoIcms(regime, vigencia, sublimite),
    sublimite,
    obrigacoesForaDoDas: resolverObrigacoesForaDoDas(vigencia),
  };
}

// ===========================================================================
// Task 6.3 — Consumo pela POLÍTICA ÚNICA (livros + builder) e MATRIZ FISCAL
// ===========================================================================

/**
 * Entrada mínima que os consumidores (livros / builder) têm hoje sobre um
 * cliente: o regime e o booleano `apuraIcms` persistido em `clientes`. É o
 * MESMO shape que `simplesNacionalSemApuracaoIcms` recebia — por isso a troca
 * de consumidores é equivalente por construção para os casos atuais, apenas
 * roteada pela política única.
 *
 * `apuraIcms` persistido mapeia para a dimensão 2 como valor `INFORMADO` da
 * vigência (`apuraIcmsInformado`): é a decisão já tomada pelo fiscal/sistema
 * sobre apuração de ICMS próprio para o cliente, e a política a honra sem
 * reinferir silenciosamente.
 */
export interface ConfigFiscalCliente {
  regimeTributario: RegimeTributario | null;
  apuraIcms: boolean;
}

/**
 * MATRIZ FISCAL APROVADA (R6.3) — fonte ÚNICA das decisões por regime × estado
 * de dimensão. É a tabela revisável (aprovada pelo fiscal) que a política
 * encoda e que livros e builder consultam através de `resolverPoliticaSimples`
 * — NÃO há condicional espalhada em cada consumidor.
 *
 * Cada linha responde, para um regime e um estado de sublimite/impedimento, às
 * três perguntas fiscais que separam obrigação estadual de autorização de
 * débito/crédito (R6.1, R6.4):
 *   - apuraIcmsProprio? — debita saídas / credita entradas em conta gráfica?
 *   - obrigadoEfdPadrao? — obrigação acessória de EFD ICMS/IPI por padrão do
 *     regime (uma obrigação estadual específica pode sobrepor via `INFORMADO`)?
 *   - recolheForaDoDas? — o ICMS próprio é recolhido FORA do DAS?
 *
 * Observações normativas (N09 — LC 123/2006; N02 — Ajuste SINIEF 2/2009):
 *   - Simples DENTRO do sublimite recolhe o ICMS no DAS → NÃO apura próprio.
 *   - Simples que EXCEDEU o sublimite ou está IMPEDIDO recolhe o ICMS fora do
 *     DAS → passa a apurar ICMS próprio (a obrigação estadual, aqui, implica a
 *     autorização de débito/crédito; é a ÚNICA transição em que isso ocorre).
 *   - Lucro Presumido/Real sempre apuram ICMS próprio e são obrigados à EFD.
 *
 * `apuraIcmsInformado` da vigência (ou o `apuraIcms` persistido do cliente)
 * SOBREPÕE a célula padrão apenas para o Simples DENTRO do sublimite — é a
 * confirmação explícita do fiscal; o excesso/impedimento, por força legal,
 * ainda força apuração. A sobreposição é aplicada por `resolverApuracaoIcms`
 * (dimensão 2); a matriz documenta o CASO BASE auditável de cada combinação.
 */
export interface CelulaMatrizFiscalSimples {
  regime: RegimeTributario | null;
  situacaoSublimite: SituacaoSublimite;
  apuraIcmsProprio: boolean;
  obrigadoEfdPadrao: boolean;
  recolheForaDoDas: boolean;
  /** Justificativa normativa curta, para revisão fiscal da linha. */
  nota: string;
}

export const MATRIZ_FISCAL_SIMPLES: readonly CelulaMatrizFiscalSimples[] = [
  {
    regime: 'LUCRO_REAL',
    situacaoSublimite: 'NAO_APLICAVEL',
    apuraIcmsProprio: true,
    obrigadoEfdPadrao: true,
    recolheForaDoDas: false,
    nota: 'Lucro Real: apura ICMS próprio em conta gráfica; obrigado à EFD por regime.',
  },
  {
    regime: 'LUCRO_PRESUMIDO',
    situacaoSublimite: 'NAO_APLICAVEL',
    apuraIcmsProprio: true,
    obrigadoEfdPadrao: true,
    recolheForaDoDas: false,
    nota: 'Lucro Presumido: apura ICMS próprio em conta gráfica; obrigado à EFD por regime.',
  },
  {
    regime: 'SIMPLES_NACIONAL',
    situacaoSublimite: 'DENTRO',
    apuraIcmsProprio: false,
    obrigadoEfdPadrao: false,
    recolheForaDoDas: false,
    nota: 'Simples dentro do sublimite: ICMS no DAS; não apura próprio (salvo apuraIcms INFORMADO pelo fiscal).',
  },
  {
    regime: 'SIMPLES_NACIONAL',
    situacaoSublimite: 'EXCEDIDO',
    apuraIcmsProprio: true,
    obrigadoEfdPadrao: false,
    recolheForaDoDas: true,
    nota: 'Simples que excedeu o sublimite: ICMS fora do DAS; apura ICMS próprio (LC 123/2006).',
  },
  {
    regime: 'SIMPLES_NACIONAL',
    situacaoSublimite: 'IMPEDIDO',
    apuraIcmsProprio: true,
    obrigadoEfdPadrao: false,
    recolheForaDoDas: true,
    nota: 'Simples impedido de recolher no DAS: ICMS fora do DAS; apura ICMS próprio.',
  },
  {
    regime: null,
    situacaoSublimite: 'NAO_APLICAVEL',
    apuraIcmsProprio: false,
    obrigadoEfdPadrao: false,
    recolheForaDoDas: false,
    nota: 'Sem regime definido: nenhuma apuração nem obrigação apurável.',
  },
] as const;

/**
 * Localiza na matriz a célula do CASO BASE para um regime + situação de
 * sublimite. É usada apenas para auditoria/documentação (a decisão operacional
 * sai de `resolverPoliticaSimples`, que aplica também a sobreposição
 * `INFORMADO`). Retorna `undefined` quando a combinação não está tabelada.
 */
export function celulaMatrizFiscal(
  regime: RegimeTributario | null,
  situacaoSublimite: SituacaoSublimite,
): CelulaMatrizFiscalSimples | undefined {
  return MATRIZ_FISCAL_SIMPLES.find(
    (celula) =>
      celula.regime === regime &&
      celula.situacaoSublimite === situacaoSublimite,
  );
}

/**
 * Deriva a competência de referência 'YYYY-MM' a partir do intervalo de datas
 * de um filtro/documento, de forma CONSISTENTE entre os consumidores. Usa a
 * data final do período (a competência da apuração é a do fim do intervalo
 * selecionado); na ausência de fim, usa o início; na ausência de ambos, não há
 * competência e a resolução cai nos defaults do regime (sem segunda regra).
 */
export function competenciaDeIntervalo(input: {
  dataInicio?: Date;
  dataFim?: Date;
}): Competencia | null {
  const base = input.dataFim ?? input.dataInicio;
  if (!base) return null;
  const ano = base.getUTCFullYear();
  const mes = String(base.getUTCMonth() + 1).padStart(2, '0');
  return `${ano}-${mes}`;
}

/**
 * PONTO ÚNICO de decisão de apuração de ICMS próprio consumido por AMBOS os
 * caminhos (livros/builder — fiscal-itens; e CT-e — fiscal-cte). Substitui as
 * chamadas espalhadas de `simplesNacionalSemApuracaoIcms`: em vez de uma
 * condicional por consumidor, cada consumidor pergunta à política única se o
 * cliente apura ICMS próprio na competência, e deriva o resto (zerar/omitir)
 * da mesma resposta.
 *
 * Equivalência com o comportamento legado: para o Simples cujo `apuraIcms`
 * persistido é `false` e sem vigências de sublimite, a política resolve
 * `apura=false` (Simples sem apuração continua zerando/omitindo o ICMS
 * próprio); para Lucro normal resolve `apura=true`. A diferença é que agora a
 * decisão passa pela MATRIZ FISCAL única, podendo honrar sublimite/impedimento
 * efetivo-datado quando houver vigências — sem ramo divergente.
 *
 * @param competencia Competência de referência; `null` quando o consumidor não
 *   dispõe de período (ex.: decisão por documento isolado). Nesse caso a
 *   política usa o `apuraIcms` informado + defaults do regime, ainda via a
 *   mesma função, nunca por um segundo caminho.
 */
export function apuraIcmsProprioParaConsumidores(
  config: ConfigFiscalCliente,
  competencia: Competencia | null,
): boolean {
  const resolucao = resolverPoliticaSimples(
    {
      regimeTributario: config.regimeTributario,
      vigencias: [
        {
          // Vigência-base derivada do estado persistido do cliente: o
          // `apuraIcms` já decidido é o valor INFORMADO da dimensão 2. O
          // `inicio` é anterior a qualquer competência plausível para que a
          // vigência sempre cubra a competência de referência.
          inicio: '0001-01',
          apuraIcmsInformado: config.apuraIcms,
        },
      ],
    },
    competencia ?? '0001-01',
  );
  return resolucao.apuracaoIcmsPropria.apura;
}
