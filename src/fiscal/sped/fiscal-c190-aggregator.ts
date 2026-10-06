import { fromScaledInteger, positive, toScaledInteger } from './sped-decimal';

/**
 * Agregador analítico comum do C190/D190 (Fase 3, F03/F16, R5.1–R5.4).
 *
 * UI (`FiscalItensService.getC190`) e TXT (builder EFD) projetam a MESMA
 * decomposição a partir dos mesmos lançamentos documentais, eliminando os
 * caminhos de cálculo independentes que divergiam (F16). Como ambos consomem
 * este agregador, a decomposição do C190 coincide por construção (R5.4).
 *
 * Regras concentradas aqui, numa única fonte:
 *  - R5.1: redução de base só entra quando há percentual de redução EFETIVO
 *    (`percentualReducaoBcIcms` > 0). Qualquer diferença líquido×base de uma
 *    operação isenta/não tributada (ex.: CST 40) NÃO é classificada como
 *    redução.
 *  - R5.2: CST/origem normalizados ao domínio correto, prefixando a origem
 *    exatamente uma vez — sem dupla concatenação (`00`/`000` não vira `0000`).
 *  - R5.3: a alíquota é normalizada (decimal) ANTES de compor a chave de
 *    agrupamento, e a agregação é escopada POR DOCUMENTO (o chamador invoca
 *    com os itens de um único documento).
 */

/**
 * Escala de agrupamento da alíquota: 4 casas, espelhando a coluna, para que a
 * chave de agrupamento (R5.3) distinga alíquotas com fração fina. A emissão do
 * campo VL_ALIQ_ICMS do C190 usa 2 casas (convenção EFD).
 */
const ALIQUOTA_GROUP_SCALE = 4;
const ALIQUOTA_EMIT_SCALE = 2;

/**
 * Entrada mínima por item para o agregador. Modela só os campos que a
 * decomposição do C190 consome, para que builder (ItemRow) e UI (linha do
 * banco) alimentem a mesma função sem depender do schema completo.
 */
export interface C190ItemInput {
  cstIcms?: string | null;
  csosnIcms?: string | null;
  origemMercadoria?: string | null;
  cfop: string;
  aliquotaIcms?: string | null;
  percentualReducaoBcIcms?: string | null;
  valorBrutoProduto?: string | null;
  valorDesconto?: string | null;
  valorFrete?: string | null;
  valorSeguro?: string | null;
  valorOutrasDespesas?: string | null;
  valorBcIcms?: string | null;
  valorIcms?: string | null;
  valorBcIcmsSt?: string | null;
  valorIcmsSt?: string | null;
  valorFcpSt?: string | null;
  valorIpi?: string | null;
}

/** Linha analítica do C190: valores em inteiros escalados (nunca `Number`). */
export interface C190Analitico {
  cst: string;
  cfop: string;
  /** Alíquota decimal canônica (normalizada), já pronta para emissão. */
  aliquota: string;
  valorOperacao: bigint;
  valorBcIcms: bigint;
  valorIcms: bigint;
  valorBcIcmsSt: bigint;
  valorIcmsSt: bigint;
  valorReducaoBc: bigint;
  valorIpi: bigint;
}

/**
 * R5.2: compõe o CST de ICMS (origem + CST) do C170/C190 prefixando a origem
 * exatamente UMA vez. Se o valor já vem composto (3 dígitos, ex.: `000`), não
 * reprefixa (evita `0000`); se vem puro (2 dígitos, ex.: `00`), prefixa a
 * origem uma vez (→ `000`). Sem CST, usa o CSOSN como está (Simples). Nunca
 * inventa fallback para ausência total — o chamador trata essa inconsistência.
 */
export function normalizeC190Cst(item: C190ItemInput): string {
  const cstIcms = item.cstIcms?.trim();
  if (cstIcms) {
    if (cstIcms.length === 3) return cstIcms;
    if (cstIcms.length === 2) {
      return `${(item.origemMercadoria ?? '0').trim()}${cstIcms}`;
    }
    return cstIcms;
  }
  return item.csosnIcms?.trim() ?? '';
}

/**
 * R5.3: normaliza a alíquota a inteiro escalado (4 casas) para a chave de
 * agrupamento, de modo que `18`, `18.00` e `18,0000` caiam no mesmo grupo.
 */
function aliquotaScaled(item: C190ItemInput): bigint {
  return toScaledInteger(item.aliquotaIcms ?? '0', ALIQUOTA_GROUP_SCALE);
}

/** Valor líquido do item (sem ST/IPI): base de comparação para a redução. */
function valorItemLiquido(item: C190ItemInput): bigint {
  return (
    toScaledInteger(item.valorBrutoProduto) -
    toScaledInteger(item.valorDesconto) +
    toScaledInteger(item.valorFrete) +
    toScaledInteger(item.valorSeguro) +
    toScaledInteger(item.valorOutrasDespesas)
  );
}

/** Valor da operação do C190 (campo VL_OPR): líquido + ST + FCP ST + IPI. */
function valorOperacao(item: C190ItemInput): bigint {
  return (
    valorItemLiquido(item) +
    toScaledInteger(item.valorIcmsSt) +
    toScaledInteger(item.valorFcpSt) +
    toScaledInteger(item.valorIpi)
  );
}

/**
 * Agrega os itens de UM documento (R5.3: escopo por documento) nas linhas
 * analíticas do C190, por (CST, CFOP, alíquota normalizada). O resultado é
 * ordenado de forma estável pela própria chave para reprodutibilidade (F20).
 */
export function aggregateC190Analitico(
  items: readonly C190ItemInput[],
): C190Analitico[] {
  const groups = new Map<string, C190Analitico>();
  for (const item of items) {
    const cst = normalizeC190Cst(item);
    const aliquota = aliquotaScaled(item);
    // R5.3: alíquota normalizada (decimal) ANTES da chave.
    const key = `${cst}|${item.cfop}|${aliquota.toString()}`;
    const group = groups.get(key) ?? {
      cst,
      cfop: item.cfop,
      // Emite a alíquota a 2 casas (convenção VL_ALIQ_ICMS); o agrupamento,
      // porém, usou a precisão de 4 casas (R5.3) acima.
      aliquota: fromScaledInteger(
        aliquota / 10n ** BigInt(ALIQUOTA_GROUP_SCALE - ALIQUOTA_EMIT_SCALE),
        ALIQUOTA_EMIT_SCALE,
      ),
      valorOperacao: 0n,
      valorBcIcms: 0n,
      valorIcms: 0n,
      valorBcIcmsSt: 0n,
      valorIcmsSt: 0n,
      valorReducaoBc: 0n,
      valorIpi: 0n,
    };
    group.valorOperacao += valorOperacao(item);
    group.valorBcIcms += toScaledInteger(item.valorBcIcms);
    group.valorIcms += toScaledInteger(item.valorIcms);
    group.valorBcIcmsSt += toScaledInteger(item.valorBcIcmsSt);
    group.valorIcmsSt += toScaledInteger(item.valorIcmsSt);
    // R5.1: só há redução de base quando o percentual de redução é efetivo.
    // Diferença líquido×base de operação isenta/não tributada (CST 40) NÃO é
    // redução.
    if (
      toScaledInteger(item.percentualReducaoBcIcms, ALIQUOTA_GROUP_SCALE) > 0n
    ) {
      group.valorReducaoBc += positive(
        valorItemLiquido(item) - toScaledInteger(item.valorBcIcms),
      );
    }
    group.valorIpi += toScaledInteger(item.valorIpi);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) =>
    `${a.cst}|${a.cfop}|${a.aliquota}`.localeCompare(
      `${b.cst}|${b.cfop}|${b.aliquota}`,
      'pt-BR',
    ),
  );
}
