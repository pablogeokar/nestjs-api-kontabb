import type { PaginationParams } from '../../common/types';
import type {
  EstadoFechamento,
  ObrigacaoFechamento,
} from './fiscal-closing.service';

/**
 * Contrato `ResultadoApuracao` (plano §6.3) — Tarefa 3.3.
 *
 * É a PROJEÇÃO pública de um fechamento versionado (`FechamentoRegistro`) para
 * livros, painéis e SPED. NÃO há um segundo motor de cálculo: todos os valores
 * saem dos snapshots CONGELADOS do fechamento (`saldos`, `parametros`,
 * `documentos`), de modo que a mesma versão sempre projeta o mesmo resultado
 * (R1.1/R1.2). O detalhamento é a ponte documentos→lançamentos→apuração (R2.2),
 * paginado a partir do snapshot — nunca recomputado.
 *
 * COMPATIBILIDADE com os contratos atuais (validada antes de expor endpoint):
 * - Totais seguem a MESMA convenção de strings decimais do `SpedApuracaoPreview`
 *   (`debitos`, `creditos`, `saldoApurado`, …) e do `getApuracaoIcms`
 *   (`total_creditos`/`total_debitos`/`saldo_apurado`). Nenhum valor é `Number`.
 * - A paginação reusa `offset`/`limit`/`total` já presentes em
 *   `PaginationParams` (common/types), em vez de inventar um novo formato.
 * - O tipo é ADITIVO: não altera `SpedPreview`, `SpedApuracaoPreview` nem a
 *   resposta de `getApuracaoIcms`. Essas respostas continuam existindo e podem
 *   coexistir — `ResultadoApuracao` apenas as ENVELOPA sobre a versão congelada.
 */

/**
 * Totais da apuração como strings decimais (nunca `Number`). Reusa os mesmos
 * nomes/semântica do `SpedApuracaoPreview.icmsProprio`, para que uma projeção
 * do fechamento e o preview do SPED sejam diretamente conciliáveis (R2.1).
 */
export interface ResultadoApuracaoTotais {
  debitos: string;
  creditos: string;
  saldoCredorAnterior: string;
  ajustesDebitos: string;
  ajustesCreditos: string;
  estornosCreditos: string;
  estornosDebitos: string;
  deducoes: string;
  debitosEspeciais: string;
  saldoApurado: string;
  icmsRecolher: string;
  saldoCredorTransportar: string;
}

/**
 * Origem de um total projetado — espelha `SpedPreview.auditabilidade.apuracao`
 * para que a projeção carregue a mesma rastreabilidade (zero ≠ não informado,
 * R4.2) sem reclassificar nada.
 */
export type ResultadoApuracaoOrigem =
  | 'DOCUMENTOS_ESCRITURADOS'
  | 'INFORMADO'
  | 'PADRAO_ZERO';

/**
 * Uma linha de memória de cálculo: explica como um total foi composto a partir
 * das entradas congeladas (ponte de conciliação, R2.2). É descritiva — não
 * contém um valor recomputado, apenas a explicação do que já está no snapshot.
 */
export interface ResultadoApuracaoMemoria {
  codigo: string;
  descricao: string;
  valor: string;
  origem: ResultadoApuracaoOrigem;
  fundamento: string;
}

/** Severidade de uma inconsistência — mesmo domínio do `SpedInconsistencia`. */
export type ResultadoApuracaoSeveridade = 'ERRO' | 'AVISO';

/** Inconsistência projetada (mesma forma do `SpedInconsistencia`, aditiva). */
export interface ResultadoApuracaoInconsistencia {
  codigo: string;
  severidade: ResultadoApuracaoSeveridade;
  mensagem: string;
  campo?: string;
  documentoId?: string;
  numeroDocumento?: string;
  chaveAcesso?: string;
}

/**
 * Um item do detalhamento: a ponte documento→lançamento projetada do snapshot
 * congelado. Carrega a identidade do documento e os campos monetários como
 * strings decimais. Mantém `extras` para campos específicos do snapshot sem
 * engessar o formato — tudo vem do que foi congelado, nada é recalculado.
 */
export interface ResultadoApuracaoDetalhamentoItem {
  chave: string | null;
  numeroDocumento: string | null;
  participante: string | null;
  cfop: string | null;
  cst: string | null;
  valorContabil: string | null;
  baseIcms: string | null;
  valorIcms: string | null;
  /** Demais campos do documento congelado, preservados sem reclassificação. */
  extras: Record<string, unknown>;
}

/**
 * Natureza do saldo devedor documental projetado (R2.5). É SEMPRE `'APURACAO'`:
 * o resultado é uma informação de apuração/saldo, NUNCA uma guia de recolhimento
 * (DAE/GNRE/DARF/DAS). O tipo é propositalmente DISTINTO de `TipoGuia`
 * (`fiscal-guias.service`) para que o sistema de tipos impeça tratar um saldo
 * apurado como se fosse uma guia pagável.
 */
export type SaldoDevedorNatureza = 'APURACAO';

/**
 * Saldo devedor DOCUMENTAL projetado do fechamento (R2.5). Um saldo devedor
 * derivado puramente dos documentos/apuração é uma INFORMAÇÃO de apuração — NÃO
 * é, e NÃO DEVE ser apresentado como, a guia a recolher. Este contrato torna
 * essa distinção de primeira classe e explícita:
 *
 * - `natureza` é `'APURACAO'` (nunca um `TipoGuia`): o saldo é informativo.
 * - `guiaAutomatica` é SEMPRE `false`: nada aqui autoriza/gera uma guia.
 * - `exigeEmissaoDeliberada` é `true`: emitir uma guia de recolhimento
 *   (`FiscalGuiasService.criarGuia`) é um passo SEPARADO e DELIBERADO, nunca
 *   derivado automaticamente deste saldo.
 *
 * O valor (`valor`) é o saldo devedor documental como string decimal (nunca
 * `Number`); `possuiSaldoDevedor` é `true` apenas quando há saldo a recolher
 * (> 0.00) — um saldo credor ou zero não é saldo devedor.
 */
export interface SaldoDevedorApurado {
  /** Natureza do resultado: SEMPRE `'APURACAO'`, nunca uma guia. */
  natureza: SaldoDevedorNatureza;
  /** Saldo devedor documental apurado (string decimal; `0.00` quando não há). */
  valor: string;
  /** `true` apenas quando há saldo devedor a recolher (> 0.00). */
  possuiSaldoDevedor: boolean;
  /** SEMPRE `false`: um saldo apurado NÃO é uma guia automática (R2.5). */
  guiaAutomatica: false;
  /** SEMPRE `true`: emitir a guia é um passo separado e deliberado (R2.5). */
  exigeEmissaoDeliberada: true;
  /** Rótulo informativo que deixa clara a natureza de apuração (não guia). */
  rotulo: string;
}

/** Metadados de paginação do detalhamento (reusa `offset`/`limit`/`total`). */
export interface ResultadoApuracaoPaginacao {
  total: number;
  limit: number;
  offset: number;
}

/** Detalhamento PAGINADO: itens da página + metadados de paginação. */
export interface ResultadoApuracaoDetalhamento {
  items: ResultadoApuracaoDetalhamentoItem[];
  pagination: ResultadoApuracaoPaginacao;
}

/**
 * Contrato de apuração de referência (plano §6.3): a projeção completa de uma
 * versão de fechamento. Todos os campos de identificação vêm do
 * `FechamentoRegistro`; os totais/memórias/inconsistências e o detalhamento
 * vêm dos snapshots congelados dessa mesma versão.
 */
export interface ResultadoApuracao {
  clienteId: string;
  obrigacao: ObrigacaoFechamento;
  competencia: string;
  versao: number;
  estado: EstadoFechamento;
  corrente: boolean;
  motorVersao: string;
  hashEntradas: string;
  totais: ResultadoApuracaoTotais;
  /**
   * Saldo devedor DOCUMENTAL como informação de APURAÇÃO (R2.5): nunca uma guia
   * automática. Deixa explícito que gerar a guia de recolhimento é um passo
   * separado e deliberado — o saldo apurado não é, por si, a guia a pagar.
   */
  saldoDevedorApurado: SaldoDevedorApurado;
  memorias: ResultadoApuracaoMemoria[];
  inconsistencias: ResultadoApuracaoInconsistencia[];
  detalhamento: ResultadoApuracaoDetalhamento;
}

/** Opções de projeção: janela de paginação do detalhamento. */
export interface ResultadoApuracaoProjecaoOptions {
  /** Página de paginação (reusa `PaginationParams`); default = página 1. */
  pagination?: Pick<PaginationParams, 'offset' | 'limit'>;
}
