import type { FechamentoRegistro } from './fiscal-closing.service';
import type {
  ResultadoApuracao,
  ResultadoApuracaoDetalhamento,
  ResultadoApuracaoDetalhamentoItem,
  ResultadoApuracaoInconsistencia,
  ResultadoApuracaoMemoria,
  ResultadoApuracaoOrigem,
  ResultadoApuracaoProjecaoOptions,
  ResultadoApuracaoTotais,
  SaldoDevedorApurado,
} from './resultado-apuracao.contract';
import { fromScaledInteger, toScaledInteger } from '../sped/sped-decimal';

/**
 * Projetor PURO do contrato `ResultadoApuracao` (plano §6.3) — Tarefa 3.3.
 *
 * Transforma um `FechamentoRegistro` + seus snapshots CONGELADOS numa
 * `ResultadoApuracao`, sem recomputar nada (R2.2 — ponte projetada do snapshot,
 * não um segundo motor). É separado do `FiscalClosingService` (que faz a parte
 * com banco) para ser testável de forma determinística: dados os mesmos
 * snapshots e a mesma janela de paginação, produz sempre o mesmo resultado.
 */

/** Zero decimal canônico, mesma convenção de `SpedApuracaoPreview`. */
const ZERO = '0.00';

/** Default de página 1 do detalhamento quando o chamador não especifica. */
const DEFAULT_LIMIT = 15;

/**
 * Snapshots congelados necessários à projeção. São os mesmos `jsonb` persistidos
 * em `fiscal_fechamentos` (documentos/saldos/parametros) — valores monetários
 * sempre strings decimais.
 */
export interface FechamentoSnapshots {
  documentos: ReadonlyArray<Record<string, unknown>>;
  saldos: Record<string, unknown>;
  parametros: Record<string, unknown>;
}

/**
 * Lê um valor monetário do snapshot como string decimal. Só aceita strings
 * (restrição da fase: decimais nunca são `Number`); ausência vira `null` para
 * que o projetor distinga "não informado" de zero (R4.2).
 */
function lerDecimalOpcional(
  fonte: Record<string, unknown>,
  chave: string,
): string | null {
  const valor = fonte[chave];
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== 'string') {
    throw new Error(
      `Valor monetário "${chave}" do snapshot de fechamento deve ser string ` +
      `decimal (nunca Number); recebido: ${typeof valor}.`,
    );
  }
  return valor;
}

/** Lê um campo de texto opcional do documento congelado. */
function lerTextoOpcional(
  fonte: Record<string, unknown>,
  ...chaves: string[]
): string | null {
  for (const chave of chaves) {
    const valor = fonte[chave];
    if (typeof valor === 'string' && valor.length > 0) return valor;
    if (typeof valor === 'number') return String(valor);
  }
  return null;
}

/**
 * Projeta um total do snapshot `saldos`, classificando a ORIGEM sem reclassificar
 * valor: ausente → `PADRAO_ZERO` com `0.00` (zero ≠ não informado é tratado na
 * `origem`, não zerando um valor informado), presente → `INFORMADO`.
 */
function projetarTotal(
  saldos: Record<string, unknown>,
  chave: string,
): { valor: string; origem: ResultadoApuracaoOrigem } {
  const valor = lerDecimalOpcional(saldos, chave);
  if (valor === null) {
    return { valor: ZERO, origem: 'PADRAO_ZERO' };
  }
  return { valor, origem: 'INFORMADO' };
}

/** Chaves de total do `ResultadoApuracaoTotais`, na ordem da memória. */
const CHAVES_TOTAIS: ReadonlyArray<keyof ResultadoApuracaoTotais> = [
  'debitos',
  'creditos',
  'saldoCredorAnterior',
  'ajustesDebitos',
  'ajustesCreditos',
  'estornosCreditos',
  'estornosDebitos',
  'deducoes',
  'debitosEspeciais',
  'saldoApurado',
  'icmsRecolher',
  'saldoCredorTransportar',
];

/** Rótulos legíveis dos totais (memória de cálculo). */
const DESCRICAO_TOTAIS: Record<keyof ResultadoApuracaoTotais, string> = {
  debitos: 'Débitos por saídas',
  creditos: 'Créditos por entradas',
  saldoCredorAnterior: 'Saldo credor do período anterior',
  ajustesDebitos: 'Ajustes a débito',
  ajustesCreditos: 'Ajustes a crédito',
  estornosCreditos: 'Estornos de crédito',
  estornosDebitos: 'Estornos de débito',
  deducoes: 'Deduções',
  debitosEspeciais: 'Débitos especiais',
  saldoApurado: 'Saldo apurado',
  icmsRecolher: 'ICMS a recolher',
  saldoCredorTransportar: 'Saldo credor a transportar',
};

/**
 * Projeta os totais e a memória de cálculo correspondente a partir do snapshot
 * `saldos`. Cada total vira uma linha de memória explicando sua origem — a ponte
 * que torna a apuração auditável (R2.2) sem recomputar nada.
 */
function projetarTotaisEMemorias(saldos: Record<string, unknown>): {
  totais: ResultadoApuracaoTotais;
  memorias: ResultadoApuracaoMemoria[];
} {
  const totais = {} as ResultadoApuracaoTotais;
  const memorias: ResultadoApuracaoMemoria[] = [];
  for (const chave of CHAVES_TOTAIS) {
    const { valor, origem } = projetarTotal(saldos, chave);
    totais[chave] = valor;
    memorias.push({
      codigo: chave,
      descricao: DESCRICAO_TOTAIS[chave],
      valor,
      origem,
      fundamento:
        origem === 'INFORMADO'
          ? 'Projetado do snapshot congelado do fechamento.'
          : 'Ausente no snapshot: apresentado como zero (não informado).',
    });
  }
  return { totais, memorias };
}

/**
 * Projeta inconsistências do snapshot `parametros.inconsistencias` quando
 * presentes (mesma forma do `SpedInconsistencia`). Ausência → lista vazia.
 */
function projetarInconsistencias(
  parametros: Record<string, unknown>,
): ResultadoApuracaoInconsistencia[] {
  const bruto = parametros.inconsistencias;
  if (!Array.isArray(bruto)) return [];
  return bruto
    .filter((i): i is Record<string, unknown> => typeof i === 'object' && i !== null)
    .map((i) => ({
      codigo: String(i.codigo ?? ''),
      severidade: i.severidade === 'ERRO' ? 'ERRO' : 'AVISO',
      mensagem: String(i.mensagem ?? ''),
      ...(typeof i.campo === 'string' ? { campo: i.campo } : {}),
      ...(typeof i.documentoId === 'string'
        ? { documentoId: i.documentoId }
        : {}),
      ...(typeof i.numeroDocumento === 'string'
        ? { numeroDocumento: i.numeroDocumento }
        : {}),
      ...(typeof i.chaveAcesso === 'string'
        ? { chaveAcesso: i.chaveAcesso }
        : {}),
    }));
}

/** Projeta um item do detalhamento a partir de um documento congelado. */
function projetarItem(
  documento: Record<string, unknown>,
): ResultadoApuracaoDetalhamentoItem {
  const conhecidos = new Set([
    'chave',
    'chaveAcesso',
    'numeroDocumento',
    'numero',
    'participante',
    'cfop',
    'cst',
    'valorContabil',
    'valorTotal',
    'baseIcms',
    'valorIcms',
  ]);
  const extras: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(documento)) {
    if (!conhecidos.has(k)) extras[k] = v;
  }
  return {
    chave: lerTextoOpcional(documento, 'chave', 'chaveAcesso'),
    numeroDocumento: lerTextoOpcional(documento, 'numeroDocumento', 'numero'),
    participante: lerTextoOpcional(documento, 'participante'),
    cfop: lerTextoOpcional(documento, 'cfop'),
    cst: lerTextoOpcional(documento, 'cst'),
    valorContabil: lerDecimalOpcional(
      documento,
      'valorContabil' in documento ? 'valorContabil' : 'valorTotal',
    ),
    baseIcms: lerDecimalOpcional(documento, 'baseIcms'),
    valorIcms: lerDecimalOpcional(documento, 'valorIcms'),
    extras,
  };
}

/**
 * Pagina o detalhamento (ponte documentos→lançamentos) sobre os documentos
 * congelados. A janela usa `offset`/`limit` (reusa `PaginationParams`); `total`
 * é a contagem completa do snapshot, não da página — para o chamador saber
 * quantas páginas existem. A ORDEM é a do snapshot (estável e reproduzível).
 */
export function projetarDetalhamento(
  documentos: ReadonlyArray<Record<string, unknown>>,
  options?: ResultadoApuracaoProjecaoOptions,
): ResultadoApuracaoDetalhamento {
  const total = documentos.length;
  const rawOffset = options?.pagination?.offset ?? 0;
  const rawLimit = options?.pagination?.limit ?? DEFAULT_LIMIT;
  // Normaliza a janela: offset não-negativo, limit >= 1 (uma página sempre
  // tenta trazer ao menos um item quando há dados).
  const offset = Math.max(0, Math.trunc(rawOffset));
  const limit = Math.max(1, Math.trunc(rawLimit));
  const items = documentos
    .slice(offset, offset + limit)
    .map((documento) => projetarItem(documento));
  return {
    items,
    pagination: { total, limit, offset },
  };
}

/**
 * Rótulo informativo do saldo devedor documental (R2.5). Deixa EXPLÍCITO que o
 * resultado é uma apuração/saldo e que a guia de recolhimento é um passo
 * separado — nunca sugere que "esta é a guia a pagar".
 */
const ROTULO_SALDO_DEVEDOR =
  'Saldo devedor apurado (informativo). Não é guia de recolhimento: emitir a ' +
  'guia (DAE/GNRE/DARF/DAS) é um passo separado e deliberado.';

const ROTULO_SEM_SALDO_DEVEDOR =
  'Apuração sem saldo devedor documental a recolher (informativo).';

/**
 * Projeta o saldo devedor DOCUMENTAL como INFORMAÇÃO de apuração (R2.5), nunca
 * como guia automática. O saldo devedor é derivado dos totais já projetados do
 * fechamento — prioriza `icmsRecolher` (o valor que o fechamento marcou como a
 * recolher) e recai sobre `saldoApurado` quando aquele não está informado — sem
 * um segundo motor. O resultado:
 *
 * - É SEMPRE da natureza `'APURACAO'` (nunca um `TipoGuia`).
 * - NUNCA é uma guia automática (`guiaAutomatica: false`).
 * - SEMPRE sinaliza que emitir a guia é um passo deliberado
 *   (`exigeEmissaoDeliberada: true`).
 *
 * Um saldo credor ou zero NÃO é saldo devedor: `possuiSaldoDevedor` só é `true`
 * quando o saldo a recolher é estritamente positivo. Puro e determinístico.
 */
export function projetarSaldoDevedorApurado(
  totais: ResultadoApuracaoTotais,
): SaldoDevedorApurado {
  // `icmsRecolher` é o montante que o fechamento marcou como a recolher; quando
  // ausente/zero, o saldo apurado positivo (devedor) é o valor documental. Um
  // saldo apurado negativo é CREDOR — não é saldo devedor.
  const recolher = toScaledInteger(totais.icmsRecolher);
  const apurado = toScaledInteger(totais.saldoApurado);
  const devedor = recolher > 0n ? recolher : apurado > 0n ? apurado : 0n;
  const possuiSaldoDevedor = devedor > 0n;
  return {
    natureza: 'APURACAO',
    valor: fromScaledInteger(devedor),
    possuiSaldoDevedor,
    guiaAutomatica: false,
    exigeEmissaoDeliberada: true,
    rotulo: possuiSaldoDevedor
      ? ROTULO_SALDO_DEVEDOR
      : ROTULO_SEM_SALDO_DEVEDOR,
  };
}

/**
 * Projeta uma `ResultadoApuracao` completa a partir do registro de fechamento e
 * dos seus snapshots congelados. Esta é a ÚNICA fonte de projeção do contrato —
 * não existe um segundo motor; livros, painéis e SPED devem consumir daqui.
 */
export function projetarResultadoApuracao(
  registro: FechamentoRegistro,
  snapshots: FechamentoSnapshots,
  options?: ResultadoApuracaoProjecaoOptions,
): ResultadoApuracao {
  const { totais, memorias } = projetarTotaisEMemorias(snapshots.saldos);
  return {
    clienteId: registro.clienteId,
    obrigacao: registro.obrigacao,
    competencia: registro.competencia,
    versao: registro.versao,
    estado: registro.estado,
    corrente: registro.corrente,
    motorVersao: registro.motorVersao,
    hashEntradas: registro.hashEntradas,
    totais,
    saldoDevedorApurado: projetarSaldoDevedorApurado(totais),
    memorias,
    inconsistencias: projetarInconsistencias(snapshots.parametros),
    detalhamento: projetarDetalhamento(snapshots.documentos, options),
  };
}
