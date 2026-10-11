import type {
  FechamentoRegistro,
  ObrigacaoFechamento,
} from './fiscal-closing.service';
import type {
  ResultadoApuracaoTotais,
} from './resultado-apuracao.contract';
import { projetarResultadoApuracao } from './resultado-apuracao.projector';
import type { FechamentoSnapshots } from './resultado-apuracao.projector';

/**
 * Retificação de fechamento (R1.5 / design §"Fechamento versionado") — Tarefa
 * 3.6.
 *
 * Uma retificação é uma NOVA versão de fechamento que SUBSTITUI uma entrega
 * anterior já FECHADA. Diferente de uma simples edição (que também cria nova
 * versão), a retificação carrega duas obrigações próprias:
 *
 * 1. **Aponta o original** — a nova versão referencia explicitamente a versão
 *    retificada (id/versão/hash), de modo que a cadeia "quem corrige quem" seja
 *    rastreável sem adivinhação por sequência.
 * 2. **Expõe a diferença** — o sistema sabe computar a diferença entre a versão
 *    retificadora e a original (R1.5: "apontar o original E a diferença").
 *
 * O vínculo com o COMPROVANTE/RECIBO do PVA (R1.5: "comprovante/recibo do PVA
 * ficam vinculados ao hash") é da **Fase 5** — aqui fica apenas o SEAM: o
 * contrato reserva o campo `recibo` como `null` e documenta onde a Fase 5 o
 * preencherá, sem implementá-lo nesta fase (ver {@link DiferencaRetificacao}).
 *
 * MODELAGEM SEM ALTERAR SCHEMA: o schema de `fiscal_fechamentos` não ganha
 * coluna nova nesta tarefa. A referência ao original é persistida DENTRO do
 * snapshot `parametros` (JSONB congelado) sob a chave bem-conhecida
 * {@link RETIFICACAO_PARAM_KEY}. Como `parametros` participa do `hashEntradas`,
 * a identidade da retificação (apontar o original) fica selada no hash junto
 * com o restante das entradas (R1.1/R1.2) — e o recibo da Fase 5, quando
 * vinculado ao hash, herda essa amarração.
 */

/**
 * Chave bem-conhecida sob a qual a referência ao fechamento original é gravada
 * no snapshot `parametros` da versão retificadora. É aditiva: parâmetros
 * pré-existentes do fechamento são preservados; apenas esta chave é acrescentada
 * para marcar a versão como retificação e apontar o original.
 */
export const RETIFICACAO_PARAM_KEY = 'retificacao';

/**
 * Referência "aponta o original" gravada em `parametros[RETIFICACAO_PARAM_KEY]`
 * (R1.5). Identifica a versão retificada por id/versão e carrega o hash dela —
 * o mesmo hash a que a Fase 5 vinculará o comprovante/recibo do PVA. Todos os
 * campos são serializáveis de forma estável (strings/ints), para entrarem no
 * `hashEntradas` sem quebrar a canonicalização.
 */
export interface RetificacaoReferencia {
  /** Id do fechamento original (versão retificada). */
  originalFechamentoId: string;
  /** Número da versão original retificada. */
  originalVersao: number;
  /** `hashEntradas` da versão original — âncora do recibo do PVA (Fase 5). */
  originalHashEntradas: string;
}

/**
 * Diferença de UM total entre a versão retificadora e a original (R1.5). Os
 * valores são strings decimais (restrição da fase: nunca `Number`); `delta` é a
 * diferença `retificadora - original` como string decimal com o mesmo número de
 * casas. `alterado` sinaliza se houve mudança de valor nesse total.
 */
export interface DiferencaTotal {
  /** Código do total (mesma chave de `ResultadoApuracaoTotais`). */
  codigo: keyof ResultadoApuracaoTotais;
  /** Valor do total na versão original (retificada). */
  original: string;
  /** Valor do total na versão retificadora. */
  retificado: string;
  /** `retificado - original` como string decimal (duas casas). */
  delta: string;
  /** `true` quando `original !== retificado`. */
  alterado: boolean;
}

/**
 * SEAM para a Fase 5: o vínculo do comprovante/recibo do PVA ao hash da entrega.
 * Nesta fase NÃO é preenchido — fica `null`. A Fase 5 passará a preencher
 * `hashVinculado` com o `hashEntradas` da entrega e `recibo` com os dados do
 * comprovante, sem alterar o restante do contrato (campo aditivo e opcional).
 */
export interface ReciboRetificacaoSeam {
  /**
   * Hash da entrega ao qual o recibo do PVA se vincula (Fase 5). Já conhecido
   * aqui (é o `hashEntradas` da versão retificadora), exposto para a Fase 5
   * amarrar o comprovante sem recomputar.
   */
  hashVinculado: string;
  /**
   * Dados do comprovante/recibo do PVA. SEMPRE `null` nesta fase — a Fase 5
   * preenche. Mantido no contrato como seam explícito de que a vinculação é
   * conhecida e deliberadamente adiada, não esquecida.
   */
  recibo: null;
}

/**
 * Resultado de uma consulta de retificação (R1.5): aponta o original E expõe a
 * diferença. Reúne a identidade das duas versões, a diferença por total e o
 * seam do recibo (Fase 5).
 */
export interface DiferencaRetificacao {
  clienteId: string;
  obrigacao: ObrigacaoFechamento;
  competencia: string;
  /** Identidade da versão ORIGINAL (retificada). */
  original: {
    fechamentoId: string;
    versao: number;
    hashEntradas: string;
  };
  /** Identidade da versão RETIFICADORA. */
  retificadora: {
    fechamentoId: string;
    versao: number;
    hashEntradas: string;
  };
  /** Diferença total a total entre retificadora e original. */
  diferencas: DiferencaTotal[];
  /** `true` quando ao menos um total mudou entre as versões. */
  houveAlteracao: boolean;
  /** Vínculo do recibo do PVA ao hash — preenchido na Fase 5 (ver seam). */
  recibo: ReciboRetificacaoSeam;
}

/**
 * Lê a referência de retificação de um snapshot `parametros`, validando a forma.
 * Retorna `null` quando a versão NÃO é uma retificação (chave ausente) — o que
 * permite ao chamador distinguir uma edição comum de uma retificação (R1.4 vs
 * R1.5). Lança quando a chave existe mas está malformada (erro de dado).
 */
export function lerReferenciaRetificacao(
  parametros: Record<string, unknown>,
): RetificacaoReferencia | null {
  const bruto = parametros[RETIFICACAO_PARAM_KEY];
  if (bruto === undefined || bruto === null) return null;
  if (typeof bruto !== 'object' || Array.isArray(bruto)) {
    throw new Error(
      `Referência de retificação malformada em parametros.${RETIFICACAO_PARAM_KEY}.`,
    );
  }
  const ref = bruto as Record<string, unknown>;
  const originalFechamentoId = ref.originalFechamentoId;
  const originalVersao = ref.originalVersao;
  const originalHashEntradas = ref.originalHashEntradas;
  if (
    typeof originalFechamentoId !== 'string' ||
    typeof originalVersao !== 'number' ||
    typeof originalHashEntradas !== 'string'
  ) {
    throw new Error(
      `Referência de retificação incompleta em parametros.${RETIFICACAO_PARAM_KEY}.`,
    );
  }
  return { originalFechamentoId, originalVersao, originalHashEntradas };
}

/**
 * Grava a referência de retificação num snapshot `parametros`, de forma ADITIVA
 * (preserva os demais parâmetros do fechamento). Devolve um novo objeto — não
 * muta a entrada — para manter a imutabilidade do congelamento de entradas.
 */
export function comReferenciaRetificacao(
  parametros: Record<string, unknown>,
  referencia: RetificacaoReferencia,
): Record<string, unknown> {
  return {
    ...parametros,
    [RETIFICACAO_PARAM_KEY]: {
      originalFechamentoId: referencia.originalFechamentoId,
      originalVersao: referencia.originalVersao,
      originalHashEntradas: referencia.originalHashEntradas,
    },
  };
}

/**
 * Soma de centavos → string decimal de duas casas, preservando o sinal. É a
 * MESMA aritmética inteira (em centavos) que os módulos fiscais usam para não
 * depender de ponto flutuante: `-5` → `'-0.05'`, `130` → `'1.30'`.
 */
function centavosParaDecimal(centavos: number): string {
  const sinal = centavos < 0 ? '-' : '';
  const abs = Math.abs(centavos);
  const inteiro = Math.trunc(abs / 100);
  const resto = abs % 100;
  return `${sinal}${inteiro}.${String(resto).padStart(2, '0')}`;
}

/**
 * Converte uma string decimal de duas casas em centavos (inteiro). Rejeita
 * `Number`/formatos inesperados — a restrição da fase exige strings decimais, e
 * a diferença precisa ser exata (sem ponto flutuante).
 */
function decimalParaCentavos(valor: string, codigo: string): number {
  if (typeof valor !== 'string') {
    throw new Error(
      `Total "${codigo}" deve ser string decimal (nunca Number) para a diferença da retificação.`,
    );
  }
  const match = /^(-?)(\d+)\.(\d{2})$/.exec(valor.trim());
  if (!match) {
    throw new Error(
      `Total "${codigo}" com formato decimal inesperado na diferença da retificação: "${valor}".`,
    );
  }
  const [, sinal, inteiro, centavos] = match;
  const magnitude = Number(inteiro) * 100 + Number(centavos);
  return sinal === '-' ? -magnitude : magnitude;
}

/**
 * Núcleo PURO da diferença (R1.5): compara os totais de duas versões já
 * projetadas (original × retificadora) total a total, devolvendo o delta exato
 * (aritmética inteira em centavos) e marcando o que mudou. Não lê banco nem
 * recomputa apuração — apenas subtrai os totais congelados projetados, de modo
 * a ser determinístico e testável isoladamente.
 */
export function diferencaTotais(
  original: ResultadoApuracaoTotais,
  retificado: ResultadoApuracaoTotais,
): DiferencaTotal[] {
  const codigos = Object.keys(original) as Array<keyof ResultadoApuracaoTotais>;
  return codigos.map((codigo) => {
    const valorOriginal = original[codigo];
    const valorRetificado = retificado[codigo];
    const delta =
      decimalParaCentavos(valorRetificado, codigo) -
      decimalParaCentavos(valorOriginal, codigo);
    return {
      codigo,
      original: valorOriginal,
      retificado: valorRetificado,
      delta: centavosParaDecimal(delta),
      alterado: valorOriginal !== valorRetificado,
    };
  });
}

/**
 * Monta a {@link DiferencaRetificacao} completa (R1.5) a partir dos dois
 * registros + snapshots (original e retificadora). PURO: projeta os totais de
 * cada versão pelo MESMO projetor do contrato `ResultadoApuracao` (sem segundo
 * motor) e computa a diferença. O seam do recibo (Fase 5) fica com `recibo:
 * null`, ancorado ao hash da versão retificadora.
 */
export function montarDiferencaRetificacao(input: {
  original: FechamentoRegistro;
  originalSnapshots: FechamentoSnapshots;
  retificadora: FechamentoRegistro;
  retificadoraSnapshots: FechamentoSnapshots;
}): DiferencaRetificacao {
  const projOriginal = projetarResultadoApuracao(
    input.original,
    input.originalSnapshots,
  );
  const projRetificadora = projetarResultadoApuracao(
    input.retificadora,
    input.retificadoraSnapshots,
  );
  const diferencas = diferencaTotais(
    projOriginal.totais,
    projRetificadora.totais,
  );
  return {
    clienteId: input.retificadora.clienteId,
    obrigacao: input.retificadora.obrigacao,
    competencia: input.retificadora.competencia,
    original: {
      fechamentoId: input.original.id,
      versao: input.original.versao,
      hashEntradas: input.original.hashEntradas,
    },
    retificadora: {
      fechamentoId: input.retificadora.id,
      versao: input.retificadora.versao,
      hashEntradas: input.retificadora.hashEntradas,
    },
    diferencas,
    houveAlteracao: diferencas.some((d) => d.alterado),
    recibo: {
      // Já sabemos a que hash o recibo do PVA se vinculará (Fase 5): o da
      // entrega retificadora. O recibo em si é da Fase 5 — seam explícito.
      hashVinculado: input.retificadora.hashEntradas,
      recibo: null,
    },
  };
}
