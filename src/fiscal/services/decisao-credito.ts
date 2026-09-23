/**
 * Decisão de crédito por tributo — função pura (F05 / R3.1, R3.3).
 *
 * Fonte única de verdade para a admissibilidade de crédito documental de um
 * item de entrada. Hoje a política está embutida em `totalIcmsDocumentos`
 * (efd-icms-ipi.builder.ts): vedação por CFOP (`cfopVedaCreditoIcms`), a
 * allow-list de CST `['00','10','20','70']`, o tratamento de CSOSN `101`/`201`
 * e o alerta `ICMS_CREDITO_EXIGE_REVISAO` (`reportAmbiguousCredit`). Esta
 * função encoda EXATAMENTE as mesmas regras para que possa, nas tarefas 3.3 e
 * 3.4, substituí-las e ser consumida tanto pelo simulador quanto pela apuração.
 *
 * É pura e sem efeitos colaterais: dado (CFOP, CST/CSOSN, valores, regra),
 * retorna `{ valorAdmitido, decisao, motivo, regraVersaoId }`. Nunca altera o
 * valor original do XML (a separação valor original × admitido acontece no
 * consumidor — ver tarefa 3.2). Trabalha em inteiros escalados (bigint) para
 * não perder precisão decimal, exatamente como o builder.
 */
import { toScaledInteger } from '../sped/sped-decimal';

/**
 * Resultado da decisão de crédito por tributo.
 *  - ADMITIDO: crédito documental pode ser apropriado (`valorAdmitido` > 0 é o
 *    montante admitido; pode ser 0 quando não há valor destacado).
 *  - VEDADO: apropriação proibida (CFOP de uso/consumo, ST-substituído, ativo);
 *    `valorAdmitido` é sempre 0n. O valor original do XML NÃO é zerado.
 *  - EXIGE_REVISAO: destaque presente mas CST/CSOSN não autoriza apropriação
 *    automática; requer ajuste fiscal após revisão. `valorAdmitido` é 0n.
 */
export type DecisaoCredito = 'ADMITIDO' | 'VEDADO' | 'EXIGE_REVISAO';

/**
 * Taxonomia estável de motivos. Alinha-se aos códigos de inconsistência já
 * emitidos pelo builder (`ICMS_CREDITO_EXIGE_REVISAO`) e à racional legal da
 * vedação por CFOP (`cfopVedaCreditoIcms`).
 */
export type MotivoDecisaoCredito =
  // Sem valor destacado a apropriar; nada a decidir (crédito 0, admitido).
  | 'SEM_VALOR_DESTACADO'
  // CST/CSOSN autoriza a apropriação do valor destacado.
  | 'CST_AUTORIZA_CREDITO'
  // CSOSN do Simples com permissão de crédito (101/201).
  | 'CSOSN_PERMITE_CREDITO'
  // CFOP escriturado veda o crédito (uso/consumo, ST-substituído, ativo).
  | 'CFOP_VEDA_CREDITO'
  // Regra fiscal aplicável define o crédito como não permitido.
  | 'REGRA_VEDA_CREDITO'
  // CST/CSOSN não está na lista autorizada para apropriação automática.
  | 'CST_NAO_AUTORIZADO';

/**
 * Regra fiscal aplicável ao item, na forma mínima que a decisão precisa.
 * Modela o subconjunto relevante de `regras_fiscais` (ver
 * fiscal-rule-engine.service.ts): a política de crédito de ICMS e a
 * identificação da versão da regra para rastreabilidade. `regraVersaoId` é
 * opaco — o versionamento formal matura na Fase 3; aqui apenas o ecoamos.
 */
export interface RegraDecisaoCredito {
  /**
   * Quando `false`, a regra veda explicitamente a apropriação do crédito de
   * ICMS (R3.1: uma regra que proíbe crédito realmente impede o crédito).
   * Quando `true` ou ausente, a regra não veda — a decisão recai sobre a
   * política documental (CFOP + CST/CSOSN).
   */
  apropriaCreditoIcms?: boolean | null;
  /**
   * Identificador da versão da regra aplicada, ecoado na saída para trilha de
   * auditoria. `null`/ausente quando não há regra versionada aplicável.
   */
  regraVersaoId?: string | null;
}

/**
 * Entrada da decisão de crédito de um item de entrada. Os valores decimais são
 * strings fiscais (ex.: "12.00"), como persistidos no XML/itens; internamente
 * são convertidos para inteiros escalados. `null`/ausente = não informado.
 */
export interface EntradaDecisaoCredito {
  /** CFOP escriturado do item (fonte de verdade da destinação). */
  cfop?: string | null;
  /** CST de ICMS do item (regime normal), quando aplicável. */
  cstIcms?: string | null;
  /** CSOSN do item (Simples Nacional), quando aplicável. */
  csosnIcms?: string | null;
  /** Valor de ICMS destacado no XML (regime normal). */
  valorIcms?: string | null;
  /** Valor de crédito de ICMS do Simples informado no XML (CSOSN). */
  valorCreditoIcmsSn?: string | null;
  /** Regra fiscal aplicável (opcional). */
  regra?: RegraDecisaoCredito | null;
}

/**
 * Saída da decisão. `valorAdmitido` é string fiscal escalada (2 casas), no
 * mesmo formato dos demais valores fiscais; é 0.00 salvo quando ADMITIDO com
 * destaque. `regraVersaoId` é ecoado da regra (ou null).
 */
export interface ResultadoDecisaoCredito {
  valorAdmitido: bigint;
  decisao: DecisaoCredito;
  motivo: MotivoDecisaoCredito;
  regraVersaoId: string | null;
}

/**
 * CSTs de ICMS (regime normal) que autorizam apropriação automática do crédito
 * de ICMS na entrada. Fonte única, consumida pelo builder e pelo relatório de
 * livros (via `cstIcmsAutorizaCreditoValores`).
 *  - 00: tributada integralmente
 *  - 10: tributada e com ST (parcela própria creditável)
 *  - 20: com redução de base de cálculo
 *  - 70: com redução de base e ST
 */
export const CST_ICMS_ENTRADA_CREDITO: readonly string[] = [
  '00',
  '10',
  '20',
  '70',
];
const CST_ICMS_ENTRADA_CREDITO_SET = new Set(CST_ICMS_ENTRADA_CREDITO);

/**
 * CSOSN (Simples Nacional) que permitem transferência de crédito de ICMS ao
 * adquirente. Fonte única, consumida pelo builder e pelo relatório de livros.
 *  - 101: tributada pelo Simples com permissão de crédito
 *  - 201: idem, com cobrança do ICMS por ST
 */
export const CSOSN_ICMS_PERMITE_CREDITO: readonly string[] = ['101', '201'];
const CSOSN_PERMITE_CREDITO = new Set(CSOSN_ICMS_PERMITE_CREDITO);

/**
 * Terminações (3 últimos dígitos) de CFOP de entrada que vedam a apropriação de
 * crédito de ICMS. Fonte única, consumida por `cfopVedaCreditoIcms` (builder) e
 * pelo relatório de livros/apuração (via `cfopVedaCreditoIcmsValores`):
 *  - 556/557: material de uso ou consumo (LC 87/96 art. 33, I) — sem crédito.
 *  - 407: uso/consumo sujeito a ST — sem crédito.
 *  - 401/403/405/406: aquisição como substituído tributário — sem crédito próprio.
 *  - 551/552: ativo imobilizado — crédito NÃO integral (via CIAP, 1/48).
 */
export const CFOP_FINAIS_VEDA_CREDITO: readonly string[] = [
  '556',
  '557',
  '407',
  '403',
  '405',
  '406',
  '401',
  '551',
  '552',
];
const CFOP_FINAIS_VEDA_CREDITO_SET = new Set(CFOP_FINAIS_VEDA_CREDITO);

/**
 * Prefixos de CFOP (primeiro dígito) que caracterizam operações de entrada. A
 * vedação de crédito por CFOP só se aplica a entradas.
 */
export const CFOP_PREFIXOS_ENTRADA: readonly string[] = ['1', '2', '3'];

/**
 * Indica se o CFOP de entrada veda a apropriação de crédito de ICMS.
 * Pura; mesma lógica de `cfopVedaCreditoIcms` do builder.
 */
export function cfopVedaCreditoIcms(cfop: string | null | undefined): boolean {
  if (!cfop) return false;
  const codigo = cfop.replace(/\D/g, '');
  if (codigo.length !== 4) return false;
  // Só se aplica a entradas (1xxx/2xxx/3xxx).
  if (!CFOP_PREFIXOS_ENTRADA.includes(codigo[0])) return false;
  return CFOP_FINAIS_VEDA_CREDITO_SET.has(codigo.slice(1));
}

function normalizaCst(value: string | null | undefined): string | null {
  if (value == null) return null;
  const cst = value.slice(-2);
  return cst.length ? cst : null;
}

/**
 * Decide a admissibilidade do crédito de ICMS de um item de entrada.
 *
 * Ordem de avaliação (idêntica ao fluxo de `totalIcmsDocumentos`):
 *  1. Regra explícita com `apropriaCreditoIcms === false` → VEDADO (R3.1).
 *  2. CSOSN com crédito informado (`valorCreditoIcmsSn` > 0):
 *       - CSOSN 101/201 → ADMITIDO (valor = crédito SN);
 *       - caso contrário → EXIGE_REVISAO.
 *  3. ICMS destacado (`valorIcms` > 0):
 *       - CFOP veda crédito → VEDADO;
 *       - CST em {00,10,20,70} → ADMITIDO (valor = ICMS destacado);
 *       - caso contrário → EXIGE_REVISAO.
 *  4. Sem valor destacado → ADMITIDO com valorAdmitido 0 (nada a apropriar).
 *
 * `regraVersaoId` é sempre ecoado da regra (ou null). `valorAdmitido` nunca
 * excede o valor destacado e é 0 para VEDADO/EXIGE_REVISAO. Não altera o XML.
 */
export function decidirCreditoIcms(
  entrada: EntradaDecisaoCredito,
): ResultadoDecisaoCredito {
  const regraVersaoId = entrada.regra?.regraVersaoId ?? null;
  const vedado = (motivo: MotivoDecisaoCredito): ResultadoDecisaoCredito => ({
    valorAdmitido: 0n,
    decisao: 'VEDADO',
    motivo,
    regraVersaoId,
  });
  const revisao = (motivo: MotivoDecisaoCredito): ResultadoDecisaoCredito => ({
    valorAdmitido: 0n,
    decisao: 'EXIGE_REVISAO',
    motivo,
    regraVersaoId,
  });
  const admitido = (
    valorAdmitido: bigint,
    motivo: MotivoDecisaoCredito,
  ): ResultadoDecisaoCredito => ({
    valorAdmitido,
    decisao: 'ADMITIDO',
    motivo,
    regraVersaoId,
  });

  // 1. Regra fiscal explícita que veda o crédito prevalece (R3.1).
  if (entrada.regra && entrada.regra.apropriaCreditoIcms === false) {
    return vedado('REGRA_VEDA_CREDITO');
  }

  // 2. Crédito de ICMS do Simples Nacional (CSOSN).
  const creditoSn = toScaledInteger(entrada.valorCreditoIcmsSn);
  if (creditoSn > 0n) {
    const csosn = entrada.csosnIcms ?? null;
    if (csosn && CSOSN_PERMITE_CREDITO.has(csosn)) {
      return admitido(creditoSn, 'CSOSN_PERMITE_CREDITO');
    }
    return revisao('CST_NAO_AUTORIZADO');
  }

  // 3. Crédito de ICMS do regime normal (CST + CFOP).
  const creditoIcms = toScaledInteger(entrada.valorIcms);
  if (creditoIcms > 0n) {
    // Vedação por CFOP tem precedência sobre a allow-list de CST: o CFOP
    // escriturado é a fonte de verdade da destinação.
    if (cfopVedaCreditoIcms(entrada.cfop)) {
      return vedado('CFOP_VEDA_CREDITO');
    }
    const cst = normalizaCst(entrada.cstIcms);
    if (cst && CST_ICMS_ENTRADA_CREDITO_SET.has(cst)) {
      return admitido(creditoIcms, 'CST_AUTORIZA_CREDITO');
    }
    return revisao('CST_NAO_AUTORIZADO');
  }

  // 4. Sem valor destacado: nada a apropriar, mas não é vedação nem revisão.
  return admitido(0n, 'SEM_VALOR_DESTACADO');
}
