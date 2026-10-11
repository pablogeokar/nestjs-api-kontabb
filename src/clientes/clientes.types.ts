export const REGIMES_TRIBUTARIOS = [
  'SIMPLES_NACIONAL',
  'LUCRO_PRESUMIDO',
  'LUCRO_REAL',
] as const;

export type RegimeTributario = (typeof REGIMES_TRIBUTARIOS)[number];

export const TIPOS_CONTRIBUINTE_ICMS = [
  'CONTRIBUINTE',
  'ISENTO',
  'NAO_CONTRIBUINTE',
] as const;

export type TipoContribuinteIcms = (typeof TIPOS_CONTRIBUINTE_ICMS)[number];

export const FONTES_CONSULTA_CNPJ = ['OPEN_CNPJ', 'RECEITA_WS'] as const;

export type FonteConsultaCnpj = (typeof FONTES_CONSULTA_CNPJ)[number];

/**
 * Semântica formal de `apuraIcms` (clientes.apura_icms) — Fase 3, F17, R6.2.
 *
 * DEFINIÇÃO AUTORITATIVA
 * ----------------------
 * `apuraIcms` significa, de forma operacional e única:
 *
 *   «O estabelecimento apura ICMS próprio no período — ou seja, debita o
 *    imposto sobre as próprias saídas tributadas e credita o ICMS das
 *    entradas admitidas, com saldo apurado em conta gráfica (Bloco E do
 *    SPED / livro de apuração).»
 *
 * É um atributo de REGIME DE DÉBITO/CRÉDITO, não uma obrigação acessória.
 *
 * NÃO confundir com (cada um é um conceito distinto, separado na task 6.2):
 *  - Obrigação de entregar EFD ICMS/IPI (um Simples pode ser obrigado a
 *    escriturar documentos sem apurar ICMS próprio em conta gráfica);
 *  - Opção/condição de Simples Nacional em si (o regime recolhe ICMS no DAS,
 *    não em conta gráfica — por isso, por padrão, não apura ICMS próprio);
 *  - Sublimite/impedimento estadual (que pode obrigar o Simples a recolher o
 *    ICMS fora do DAS e, aí sim, a apurar ICMS próprio);
 *  - Obrigações fora do DAS (ST, DIFAL, antecipação) — que existem mesmo sem
 *    apuração de ICMS próprio.
 *
 * CONSEQUÊNCIA DE USO
 * -------------------
 * `apuraIcms === false` NÃO autoriza nem veda débito/crédito por si só: ele
 * apenas afirma que não há apuração de ICMS próprio em conta gráfica. A
 * decisão de creditar/debitar em cada documento é derivada desta semântica
 * mais o CST/CSOSN e a situação do documento (ver fiscal-cte / fiscal-itens).
 *
 * MIGRAÇÃO SEM INFERÊNCIA SILENCIOSA (R6.2)
 * -----------------------------------------
 * O valor de `apuraIcms` nunca deve ser escolhido de forma silenciosa. Toda
 * derivação a partir do regime (ou de qualquer outro atributo) passa pelo
 * resolvedor `resolveApuraIcms`, que devolve o valor JUNTO com a `origem`
 * (fonte auditável) da decisão, para que a escolha seja rastreável.
 */
export function simplesNacionalSemApuracaoIcms(config: {
  regimeTributario: RegimeTributario | null;
  apuraIcms: boolean;
}) {
  return config.regimeTributario === 'SIMPLES_NACIONAL' && !config.apuraIcms;
}

/**
 * Origem auditável de uma resolução de `apuraIcms`.
 *
 * - `INFORMADO`: valor fornecido explicitamente pelo usuário/consumidor.
 * - `REGIME_LUCRO_NORMAL`: regra fiscal — Lucro Presumido/Real apura ICMS
 *   próprio em conta gráfica, por definição do regime.
 * - `REGIME_SIMPLES_PADRAO`: default documentado — o Simples Nacional recolhe
 *   ICMS no DAS, portanto, por padrão, não apura ICMS próprio. É um default
 *   explícito (não silencioso); pode ser sobreposto por `INFORMADO` quando o
 *   fiscal confirmar sublimite/impedimento (separação completa na task 6.2).
 * - `SEM_REGIME`: sem regime definido não há apuração de ICMS próprio.
 */
export const APURA_ICMS_ORIGENS = [
  'INFORMADO',
  'REGIME_LUCRO_NORMAL',
  'REGIME_SIMPLES_PADRAO',
  'SEM_REGIME',
] as const;

export type ApuraIcmsOrigem = (typeof APURA_ICMS_ORIGENS)[number];

export interface ApuraIcmsResolucao {
  apuraIcms: boolean;
  /** Fonte auditável da decisão — torna a derivação rastreável, não silenciosa. */
  origem: ApuraIcmsOrigem;
}

/**
 * Resolve `apuraIcms` de forma EXPLÍCITA e AUDITÁVEL (R6.2).
 *
 * Em vez de inferir silenciosamente um valor a partir do regime, este
 * resolvedor devolve o valor acompanhado da `origem` da decisão. Regras:
 *
 *  1. Lucro Presumido/Real SEMPRE apuram ICMS próprio (origem
 *     `REGIME_LUCRO_NORMAL`). Um `informado` divergente é inconsistente com o
 *     regime e é ignorado em favor da regra — mas a origem registra que a
 *     decisão veio do regime, não de um default oculto.
 *  2. Simples Nacional: respeita o valor `informado` quando presente
 *     (origem `INFORMADO`); na ausência, aplica o default DOCUMENTADO de que
 *     o Simples não apura ICMS próprio (origem `REGIME_SIMPLES_PADRAO`).
 *  3. Sem regime: não apura (origem `SEM_REGIME`).
 *
 * A separação completa entre obrigação EFD, regime de ICMS próprio e
 * sublimite/impedimento é tratada na task 6.2; aqui apenas garantimos que a
 * resolução atual deixa de ser silenciosa.
 */
export function resolveApuraIcms(input: {
  regimeTributario: RegimeTributario | null;
  informado?: boolean;
}): ApuraIcmsResolucao {
  const { regimeTributario, informado } = input;

  if (
    regimeTributario === 'LUCRO_PRESUMIDO' ||
    regimeTributario === 'LUCRO_REAL'
  ) {
    return { apuraIcms: true, origem: 'REGIME_LUCRO_NORMAL' };
  }

  if (regimeTributario === 'SIMPLES_NACIONAL') {
    if (informado !== undefined) {
      return { apuraIcms: informado, origem: 'INFORMADO' };
    }
    return { apuraIcms: false, origem: 'REGIME_SIMPLES_PADRAO' };
  }

  return { apuraIcms: false, origem: 'SEM_REGIME' };
}
