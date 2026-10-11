import type { FechamentoRegistro } from './fiscal-closing.service';
import type {
  ResultadoApuracao,
  ResultadoApuracaoDetalhamento,
  ResultadoApuracaoInconsistencia,
  ResultadoApuracaoMemoria,
  ResultadoApuracaoProjecaoOptions,
  ResultadoApuracaoTotais,
  SaldoDevedorApurado,
} from './resultado-apuracao.contract';
import {
  projetarResultadoApuracao,
  type FechamentoSnapshots,
} from './resultado-apuracao.projector';
import {
  aggregateC190Analitico,
  normalizeC190Cst,
  type C190Analitico,
  type C190ItemInput,
} from '../sped/fiscal-c190-aggregator';
import { fromScaledInteger, toScaledInteger } from '../sped/sped-decimal';

/**
 * Projetor PURO dos LIVROS como projeção do fechamento (F15 / R4.1, R4.3) —
 * Tarefa 5.1.
 *
 * Livros DERIVAM do fechamento, SEM um segundo motor de cálculo (design §9.2:
 * "Nada de recálculo no navegador"). As três visões — DETALHADO (cronológico),
 * RESUMO (CFOP/CST/alíquota, com drill-down) e APURAÇÃO (parcelas/ajustes/
 * saldos) — são projeções dos MESMOS snapshots CONGELADOS da versão de
 * fechamento, reaproveitando os projetores que já existem:
 *
 *  - DETALHADO reusa `projetarResultadoApuracao` → `detalhamento` (a mesma
 *    ponte documentos→lançamentos paginada do contrato `ResultadoApuracao`,
 *    R2.2);
 *  - RESUMO reusa o agregador analítico comum `aggregateC190Analitico` (o MESMO
 *    que UI e TXT consomem, R5.4) — a decomposição por CST/CFOP/alíquota é a do
 *    builder, não um recálculo próprio;
 *  - APURAÇÃO reusa os `totais`/`memorias`/`saldoDevedorApurado` já projetados
 *    do snapshot `saldos`.
 *
 * As TRÊS visões carregam o CABEÇALHO do fechamento (estado parcial/revisado/
 * fechado e número/versão), de modo que o livro sempre diga de QUAL versão
 * reproduzível ele é uma projeção (R4.1). O navegador apenas formata as strings
 * decimais; nenhum imposto é recomputado aqui nem no cliente (R4.3).
 *
 * É separado da parte com banco (o `FiscalBooksProjectionService` NestJS) para
 * ser testável de forma determinística: os mesmos snapshots sempre produzem o
 * mesmo livro.
 */

/** Zero decimal canônico, mesma convenção dos demais projetores. */
const ZERO = '0.00';

/**
 * Estado de UM valor do livro (R4.2 / design §9: "zero ≠ não informado ≠ não
 * aplicável"). Esta é a distinção de PRIMEIRA CLASSE que a tarefa 5.2 exige: o
 * navegador (tarefa 5.4) apenas FORMATA; a distinção entre os três estados vem
 * SEMPRE da projeção, nunca do layout. Os três estados são:
 *
 *  - `INFORMADO`: há um valor conhecido para o campo — inclusive quando esse
 *    valor é `0.00` (um ZERO legítimo, destacado/escriturado como zero). Carrega
 *    `valor` como string decimal.
 *  - `NAO_INFORMADO`: o campo é aplicável à linha, mas a origem não trouxe o
 *    dado (ausente/desconhecido). `valor` é `null` — o campo NUNCA pode ser
 *    impresso como `0.00`, pois isso afirmaria um zero que não foi informado.
 *  - `NAO_APLICAVEL`: o campo não se aplica a esta linha (p. ex. ICMS próprio
 *    numa operação isenta/não tributada, ou colunas de ST numa linha sem ST).
 *    `valor` é `null` — também NUNCA impresso como `0.00`.
 *
 * O nome do enum espelha `StatusIntegridadeDocumentoFiscal` (…`NAO_APLICAVEL`)
 * já usado na fase fiscal, para vocabulário consistente.
 */
export type EstadoValor = 'INFORMADO' | 'NAO_INFORMADO' | 'NAO_APLICAVEL';

/**
 * Um valor do livro com seu estado explícito (R4.2). Invariante: `valor` é uma
 * string decimal se e somente se `estado === 'INFORMADO'`; nos demais estados é
 * `null`, de modo que o consumidor seja OBRIGADO a tratar "não informado"/"não
 * aplicável" sem jamais cair num `0.00` implícito. Um ZERO legítimo é
 * `{ estado: 'INFORMADO', valor: '0.00' }` — distinto de um `null`.
 */
export interface ValorLivro {
  estado: EstadoValor;
  /** String decimal quando `INFORMADO`; `null` caso contrário (R4.2). */
  valor: string | null;
}

/** Constrói um valor INFORMADO (inclusive um ZERO legítimo `0.00`). */
function informado(valor: string): ValorLivro {
  return { estado: 'INFORMADO', valor };
}

/** Valor NÃO INFORMADO: aplicável mas ausente — nunca impresso como `0.00`. */
const NAO_INFORMADO: ValorLivro = { estado: 'NAO_INFORMADO', valor: null };

/** Valor NÃO APLICÁVEL: não se aplica à linha — nunca impresso como `0.00`. */
const NAO_APLICAVEL: ValorLivro = { estado: 'NAO_APLICAVEL', valor: null };

/**
 * Estado de apuração apresentado no cabeçalho das três visões (R4.1). É o estado
 * do fechamento mapeado para o vocabulário dos livros: RASCUNHO/PENDENTE são uma
 * apuração PARCIAL (ainda em composição), REVISADO é REVISADO, FECHADO é
 * FECHADO. O livro sempre exibe este estado para que uma projeção parcial nunca
 * se apresente como completa.
 */
export type EstadoLivro = 'PARCIAL' | 'REVISADO' | 'FECHADO';

/** Mapeia o estado do fechamento para o estado de apresentação do livro. */
function estadoLivro(estado: FechamentoRegistro['estado']): EstadoLivro {
  switch (estado) {
    case 'FECHADO':
      return 'FECHADO';
    case 'REVISADO':
      return 'REVISADO';
    case 'RASCUNHO':
    case 'PENDENTE':
    default:
      return 'PARCIAL';
  }
}

/**
 * Um filtro ATIVO aplicado no cabeçalho do livro (R4.4) — p. ex. por CFOP,
 * participante, sub-intervalo de datas ou tipo de documento. É a representação
 * de PRIMEIRA CLASSE do recorte: a projeção carrega QUAIS filtros estão ativos
 * (campo + descrição legível), de modo que o cabeçalho possa exibi-los e o
 * consumidor NUNCA os perca. A presença de QUALQUER filtro torna o livro uma
 * visão PARCIAL (ver `cabecalhoFiltrado`): um recorte não pode se parecer com o
 * livro completo/oficial.
 */
export interface FiltroLivro {
  /** Chave do filtro (p. ex. `cfop`, `participante`, `periodo`, `tipoDoc`). */
  campo: string;
  /** Descrição legível do recorte (p. ex. `CFOP 1102`, `01/08 a 15/08`). */
  descricao: string;
}

/**
 * Aviso de "relatório auxiliar" (R4.5 / N02): estas projeções são livros
 * AUXILIARES de conferência/gestão — não a escrituração oficial (a EFD é que
 * abrange livros e apuração). O aviso é SEMPRE presente (nunca omitido) e
 * carrega um texto estável para que o layout apenas o renderize. É de primeira
 * classe no cabeçalho justamente para que não possa ser esquecido pelo layout.
 */
export interface AvisoAuxiliar {
  /** SEMPRE `true`: a projeção é um livro auxiliar, nunca o oficial. */
  auxiliar: true;
  /** Texto estável do aviso (o navegador apenas renderiza). */
  mensagem: string;
}

/** Texto canônico do aviso de livro auxiliar (R4.5). Nunca é omitido. */
const AVISO_AUXILIAR_MENSAGEM =
  'Relatório auxiliar para conferência da EFD ICMS/IPI. Não substitui o ' +
  'arquivo digital validado, assinado e transmitido ao Fisco.';

/** Monta o aviso auxiliar (sempre presente, R4.5). */
function montarAvisoAuxiliar(): AvisoAuxiliar {
  return { auxiliar: true, mensagem: AVISO_AUXILIAR_MENSAGEM };
}

/**
 * Texto do aviso de livro PARCIAL (R4.4), exibido quando há qualquer filtro
 * ativo. Deixa claro que o recorte não é o livro completo da competência.
 */
const AVISO_PARCIAL_MENSAGEM =
  'Visão PARCIAL: filtros ativos no cabeçalho recortam a competência. Este ' +
  'recorte não representa o livro completo e não deve ser lido como tal.';

/**
 * Cabeçalho comum às três visões (R4.1): identifica a versão de fechamento de
 * que o livro é projeção (número/versão + estado) e carrega a selagem
 * reproduzível (`motorVersao`/`hashEntradas`). Um livro sem este cabeçalho não
 * poderia dizer de qual entrega ele deriva — por isso ele é compartilhado por
 * DETALHADO, RESUMO e APURAÇÃO.
 */
export interface LivroCabecalho {
  clienteId: string;
  obrigacao: FechamentoRegistro['obrigacao'];
  competencia: string;
  /** Número/versão do fechamento (R4.1). */
  versao: number;
  /** `true` quando esta é a versão corrente do escopo. */
  corrente: boolean;
  /**
   * Estado de apresentação do livro (parcial/revisado/fechado, R4.1/R4.4).
   * Quando há FILTROS ativos (`parcial === true`), este estado é FORÇADO a
   * `PARCIAL` INDEPENDENTE do estado do fechamento — um recorte filtrado nunca
   * se apresenta como `FECHADO`/`REVISADO` completo (R4.4).
   */
  estado: EstadoLivro;
  /** Estado bruto do fechamento (RASCUNHO/PENDENTE/REVISADO/FECHADO). */
  estadoFechamento: FechamentoRegistro['estado'];
  /**
   * `true` quando o livro é uma visão PARCIAL (R4.4): verdadeiro se houver
   * QUALQUER filtro ativo OU se o próprio fechamento ainda for parcial
   * (RASCUNHO/PENDENTE). É o sinal único que o layout usa para invalidar a
   * aparência de "livro completo".
   */
  parcial: boolean;
  /**
   * Filtros ATIVOS no cabeçalho (R4.4). Vazio quando o livro é a visão completa
   * da competência. Qualquer item aqui força `parcial`/`estado = PARCIAL`.
   */
  filtros: FiltroLivro[];
  /**
   * Aviso de livro PARCIAL (R4.4): texto a exibir quando `parcial === true` por
   * causa de filtros; `null` quando não há recorte filtrado. Carregado como
   * dado para que o layout apenas o renderize.
   */
  avisoParcial: string | null;
  /** Aviso de "relatório auxiliar" (R4.5), SEMPRE presente — nunca omitido. */
  avisoAuxiliar: AvisoAuxiliar;
  motorVersao: string;
  hashEntradas: string;
}

/**
 * Visão DETALHADA (cronológica) do livro: a ponte documentos→lançamentos
 * paginada do contrato `ResultadoApuracao`, SEM reclassificação (R4.2: campos
 * ausentes ficam `null`, não zero). Reusa `detalhamento` do projetor — o livro
 * não tem sua própria enumeração de documentos.
 */
export interface LivroDetalhado {
  cabecalho: LivroCabecalho;
  detalhamento: ResultadoApuracaoDetalhamento;
}

/**
 * Uma linha do RESUMO por CST/CFOP/alíquota (decomposição do C190 do agregador
 * comum, R5.4). Cada coluna monetária é um `ValorLivro` com estado explícito
 * (R4.2): um `0.00` INFORMADO é distinto de um campo NÃO INFORMADO ou NÃO
 * APLICÁVEL — o navegador só formata, a distinção já vem daqui. Carrega o
 * DRILL-DOWN (`documentos`): quais documentos congelados compõem a linha, para
 * que o resumo possa ser aberto até o detalhe sem recomputar nada.
 */
export interface LivroResumoLinha {
  cst: string;
  cfop: string;
  aliquota: string;
  valorOperacao: ValorLivro;
  valorBcIcms: ValorLivro;
  valorIcms: ValorLivro;
  valorBcIcmsSt: ValorLivro;
  valorIcmsSt: ValorLivro;
  valorReducaoBc: ValorLivro;
  valorIpi: ValorLivro;
  /** Drill-down: chaves/identificadores dos documentos que compõem a linha. */
  documentos: string[];
}

/**
 * Visão RESUMO (CFOP/CST/alíquota com drill-down, R4.1). As linhas vêm do
 * agregador analítico comum (`aggregateC190Analitico`) aplicado POR DOCUMENTO
 * (R5.3), de modo que a decomposição coincida com a do builder/TXT (R5.4). O
 * agrupamento final consolida as linhas por (CST, CFOP, alíquota) e acumula o
 * drill-down.
 */
export interface LivroResumo {
  cabecalho: LivroCabecalho;
  linhas: LivroResumoLinha[];
}

/**
 * Uma linha de apuração do livro com o VALOR em tri-estado (R4.2). Envolve a
 * memória de cálculo projetada do contrato (`ResultadoApuracaoMemoria`) e
 * expõe, além dela, um `ValorLivro`: a origem `INFORMADO`/`DOCUMENTOS_
 * ESCRITURADOS` vira INFORMADO (`0.00` legítimo incluso); `PADRAO_ZERO` — que o
 * projetor documenta como "ausente no snapshot: apresentado como zero (não
 * informado)" — vira NÃO INFORMADO, de modo que o campo NUNCA seja impresso como
 * `0.00`. O navegador só formata (R4.3).
 */
export interface LivroApuracaoLinha {
  codigo: string;
  descricao: string;
  memoria: ResultadoApuracaoMemoria;
  valor: ValorLivro;
}

/**
 * Visão APURAÇÃO (parcelas/ajustes/saldos, R4.1): os totais, a memória de
 * cálculo e o saldo devedor JÁ projetados do snapshot `saldos` — nenhum segundo
 * motor. O saldo devedor é informação de apuração, nunca guia automática (R2.5).
 * `linhas` adiciona o VALOR em tri-estado por total (R4.2), sem recomputar: cada
 * uma apenas reclassifica a origem já projetada em ZERO/NÃO INFORMADO/NÃO
 * APLICÁVEL para o layout.
 */
export interface LivroApuracao {
  cabecalho: LivroCabecalho;
  totais: ResultadoApuracaoTotais;
  memorias: ResultadoApuracaoMemoria[];
  /** Totais em tri-estado por código (R4.2) — derivado de `memorias`. */
  linhas: LivroApuracaoLinha[];
  inconsistencias: ResultadoApuracaoInconsistencia[];
  saldoDevedorApurado: SaldoDevedorApurado;
}

/**
 * Projeção completa dos livros de uma versão de fechamento: as três visões
 * (DETALHADO, RESUMO, APURAÇÃO), todas sob o mesmo cabeçalho de versão/estado.
 */
export interface LivrosProjecao {
  cabecalho: LivroCabecalho;
  detalhado: LivroDetalhado;
  resumo: LivroResumo;
  apuracao: LivroApuracao;
}

/**
 * Opções da projeção de livros: além da paginação do detalhamento (herdada do
 * contrato `ResultadoApuracao`), carrega os FILTROS ativos no cabeçalho (R4.4).
 * A presença de qualquer filtro torna o livro uma visão PARCIAL (ver
 * `montarCabecalho`). Os filtros são apenas METADADO de apresentação — eles NÃO
 * recalculam nem reselecionam os snapshots congelados; apenas descrevem o
 * recorte para que o cabeçalho invalide a aparência de livro completo.
 */
export interface LivrosProjecaoOptions extends ResultadoApuracaoProjecaoOptions {
  /** Filtros ativos no cabeçalho; qualquer item torna o livro PARCIAL (R4.4). */
  filtros?: ReadonlyArray<FiltroLivro>;
}

/**
 * Normaliza/filtra os filtros ATIVOS: descarta entradas sem campo ou descrição
 * (um filtro sem rótulo não é um recorte apresentável) e preserva a ordem de
 * entrada para reprodutibilidade (F20).
 */
function normalizarFiltros(
  filtros: ReadonlyArray<FiltroLivro> | undefined,
): FiltroLivro[] {
  if (!filtros) return [];
  return filtros
    .filter(
      (f): f is FiltroLivro =>
        typeof f?.campo === 'string' &&
        f.campo.length > 0 &&
        typeof f?.descricao === 'string' &&
        f.descricao.length > 0,
    )
    .map((f) => ({ campo: f.campo, descricao: f.descricao }));
}

/**
 * Monta o cabeçalho comum a partir de uma apuração já projetada e dos filtros
 * ativos (R4.4/R4.5). Regras:
 *
 *  - QUALQUER filtro ativo torna o livro PARCIAL e FORÇA `estado = PARCIAL`,
 *    mesmo que o fechamento esteja FECHADO/REVISADO (R4.4): um recorte nunca se
 *    apresenta como o livro completo oficial.
 *  - Sem filtros, o estado segue o do fechamento, mas `parcial` ainda é `true`
 *    quando o próprio fechamento é parcial (RASCUNHO/PENDENTE).
 *  - O aviso de "relatório auxiliar" é SEMPRE anexado (R4.5), nunca omitido.
 */
function montarCabecalho(
  apuracao: ResultadoApuracao,
  filtros: ReadonlyArray<FiltroLivro> | undefined,
): LivroCabecalho {
  const filtrosAtivos = normalizarFiltros(filtros);
  const temFiltros = filtrosAtivos.length > 0;
  const estadoBase = estadoLivro(apuracao.estado);
  // R4.4: filtros ativos forçam PARCIAL sobre qualquer estado do fechamento.
  const estado: EstadoLivro = temFiltros ? 'PARCIAL' : estadoBase;
  const parcial = temFiltros || estadoBase === 'PARCIAL';
  return {
    clienteId: apuracao.clienteId,
    obrigacao: apuracao.obrigacao,
    competencia: apuracao.competencia,
    versao: apuracao.versao,
    corrente: apuracao.corrente,
    estado,
    estadoFechamento: apuracao.estado,
    parcial,
    filtros: filtrosAtivos,
    avisoParcial: temFiltros ? AVISO_PARCIAL_MENSAGEM : null,
    avisoAuxiliar: montarAvisoAuxiliar(),
    motorVersao: apuracao.motorVersao,
    hashEntradas: apuracao.hashEntradas,
  };
}

/**
 * Lê um campo de texto do documento congelado (ou `null` quando ausente). Só
 * aceita strings/números — alinhado ao projetor; números viram texto para
 * identificar o documento no drill-down.
 */
function lerTexto(
  documento: Record<string, unknown>,
  ...chaves: string[]
): string | null {
  for (const chave of chaves) {
    const valor = documento[chave];
    if (typeof valor === 'string' && valor.length > 0) return valor;
    if (typeof valor === 'number') return String(valor);
  }
  return null;
}

/**
 * Identificador do documento congelado para o drill-down do RESUMO. Prioriza a
 * chave de acesso, depois o número, caindo num rótulo posicional estável quando
 * o documento não traz identificação — o drill-down nunca inventa dado, só o
 * aponta.
 */
function identificarDocumento(
  documento: Record<string, unknown>,
  indice: number,
): string {
  return (
    lerTexto(documento, 'chave', 'chaveAcesso', 'numeroDocumento', 'numero') ??
    `doc#${indice}`
  );
}

/**
 * Lê um valor monetário/alíquota do documento como string decimal, aceitando só
 * strings (restrição da fase: decimais nunca são `Number`). Ausência → `null`,
 * que o agregador trata como zero sem reclassificar.
 */
function lerDecimalOpcional(
  fonte: Record<string, unknown>,
  ...chaves: string[]
): string | null {
  for (const chave of chaves) {
    const valor = fonte[chave];
    if (valor === undefined || valor === null) continue;
    if (typeof valor !== 'string') {
      throw new Error(
        `Valor "${chave}" do documento congelado deve ser string decimal ` +
          `(nunca Number) na projeção de livros; recebido: ${typeof valor}.`,
      );
    }
    return valor;
  }
  return null;
}

/**
 * Converte um registro congelado (documento ou item de documento) na entrada do
 * agregador comum (`C190ItemInput`). Mapeia só os campos que a decomposição
 * consome; ausências ficam `null` (o agregador soma como zero sem inventar
 * sinal). O CFOP é obrigatório para compor a chave — sem ele, o registro não é
 * agregável e é descartado pelo chamador.
 */
function paraItemC190(fonte: Record<string, unknown>): C190ItemInput | null {
  const cfop = lerTexto(fonte, 'cfop');
  if (cfop === null) return null;
  return {
    cstIcms: lerTexto(fonte, 'cstIcms', 'cst'),
    csosnIcms: lerTexto(fonte, 'csosnIcms'),
    origemMercadoria: lerTexto(fonte, 'origemMercadoria', 'origem'),
    cfop,
    aliquotaIcms: lerDecimalOpcional(fonte, 'aliquotaIcms'),
    percentualReducaoBcIcms: lerDecimalOpcional(
      fonte,
      'percentualReducaoBcIcms',
    ),
    valorBrutoProduto: lerDecimalOpcional(fonte, 'valorBrutoProduto'),
    valorDesconto: lerDecimalOpcional(fonte, 'valorDesconto'),
    valorFrete: lerDecimalOpcional(fonte, 'valorFrete'),
    valorSeguro: lerDecimalOpcional(fonte, 'valorSeguro'),
    valorOutrasDespesas: lerDecimalOpcional(fonte, 'valorOutrasDespesas'),
    valorBcIcms: lerDecimalOpcional(fonte, 'valorBcIcms', 'baseIcms'),
    valorIcms: lerDecimalOpcional(fonte, 'valorIcms'),
    valorBcIcmsSt: lerDecimalOpcional(fonte, 'valorBcIcmsSt'),
    valorIcmsSt: lerDecimalOpcional(fonte, 'valorIcmsSt'),
    valorFcpSt: lerDecimalOpcional(fonte, 'valorFcpSt'),
    valorIpi: lerDecimalOpcional(fonte, 'valorIpi'),
  };
}

/**
 * Extrai os itens C190 de um documento congelado. Quando o documento traz um
 * array `itens`, usa cada item (o caso rico, por item do C170); caso contrário,
 * trata o próprio documento como um único item (o caso simples/flat). Registros
 * sem CFOP não são agregáveis e são omitidos — não se inventa chave.
 */
function itensDoDocumento(documento: Record<string, unknown>): C190ItemInput[] {
  const itens = documento.itens;
  if (Array.isArray(itens)) {
    return itens
      .filter(
        (i): i is Record<string, unknown> =>
          typeof i === 'object' && i !== null && !Array.isArray(i),
      )
      .map((i) => paraItemC190(i))
      .filter((i): i is C190ItemInput => i !== null);
  }
  const unico = paraItemC190(documento);
  return unico ? [unico] : [];
}

/**
 * Colunas monetárias de uma linha do RESUMO. Serve de domínio comum para o
 * rastreio de presença (quais colunas foram INFORMADAS) e para a montagem do
 * `ValorLivro` por coluna.
 */
type ColunaResumo =
  | 'valorOperacao'
  | 'valorBcIcms'
  | 'valorIcms'
  | 'valorBcIcmsSt'
  | 'valorIcmsSt'
  | 'valorReducaoBc'
  | 'valorIpi';

const COLUNAS_RESUMO: readonly ColunaResumo[] = [
  'valorOperacao',
  'valorBcIcms',
  'valorIcms',
  'valorBcIcmsSt',
  'valorIcmsSt',
  'valorReducaoBc',
  'valorIpi',
];

/**
 * Presença POR COLUNA de uma linha: `true` quando ao menos um item do grupo
 * trouxe um valor para a coluna (R4.2 — distinguir ZERO informado de NÃO
 * INFORMADO). O agregador soma ausência como `0`, perdendo essa informação; por
 * isso o rastreio é feito aqui, sobre os `C190ItemInput` crus, em paralelo às
 * somas inteiras.
 */
type PresencaColunas = Record<ColunaSumRaw, boolean>;

/** Colunas cuja presença é lida DIRETO de uma chave do `C190ItemInput`. */
type ColunaSumRaw =
  | 'valorBcIcms'
  | 'valorIcms'
  | 'valorBcIcmsSt'
  | 'valorIcmsSt'
  | 'valorIpi'
  | 'valorBrutoProduto'
  | 'valorDesconto'
  | 'valorFrete'
  | 'valorSeguro'
  | 'valorOutrasDespesas'
  | 'valorFcpSt'
  | 'percentualReducaoBcIcms';

const COLUNAS_SUM_RAW: readonly ColunaSumRaw[] = [
  'valorBcIcms',
  'valorIcms',
  'valorBcIcmsSt',
  'valorIcmsSt',
  'valorIpi',
  'valorBrutoProduto',
  'valorDesconto',
  'valorFrete',
  'valorSeguro',
  'valorOutrasDespesas',
  'valorFcpSt',
  'percentualReducaoBcIcms',
];

/** Presença inicial (nenhuma coluna informada). */
function presencaVazia(): PresencaColunas {
  return COLUNAS_SUM_RAW.reduce((acc, chave) => {
    acc[chave] = false;
    return acc;
  }, {} as PresencaColunas);
}

/** Registra, no acumulador de presença, as colunas informadas por um item. */
function registrarPresenca(
  destino: PresencaColunas,
  item: C190ItemInput,
): void {
  for (const chave of COLUNAS_SUM_RAW) {
    if (item[chave] != null) destino[chave] = true;
  }
}

/** Normaliza a alíquota emitida (2 casas) de um item, p/ casar com o grupo. */
function aliquotaEmitida(item: C190ItemInput): string {
  return fromScaledInteger(toScaledInteger(item.aliquotaIcms ?? '0'));
}

/**
 * Um item pertence à linha analítica `linha` quando compartilham a MESMA chave
 * (CST normalizado, CFOP e alíquota emitida). Reusa `normalizeC190Cst` do
 * agregador para que a chave coincida com a do builder (R5.4).
 */
function itemCasaLinha(item: C190ItemInput, linha: C190Analitico): boolean {
  return (
    normalizeC190Cst(item) === linha.cst &&
    item.cfop === linha.cfop &&
    aliquotaEmitida(item) === linha.aliquota
  );
}

/**
 * Código de tributação do ICMS (2 últimos dígitos do CST). Para CSOSN/Simples
 * (ou CST curto) devolve o próprio valor — a aplicabilidade abaixo só decide por
 * CST do regime normal, e trata o resto como aplicável/por-presença.
 */
function tributacaoIcms(cst: string): string {
  return cst.length >= 2 ? cst.slice(-2) : cst;
}

/**
 * CSTs em que NÃO há ICMS próprio destacado/escriturado na operação (isenta,
 * não tributada, suspensão, diferimento, ICMS já cobrado por ST). Para essas
 * situações as colunas de ICMS próprio e BC do ICMS são NÃO APLICÁVEIS — não um
 * zero (R4.2 / design §9).
 */
const TRIBUTACAO_SEM_ICMS_PROPRIO = new Set(['40', '41', '50', '51', '60']);

/**
 * CSTs com débito de ICMS por substituição tributária na própria operação
 * (`10`, `30`, `70`). Nos demais, as colunas de ST são NÃO APLICÁVEIS a menos
 * que a origem traga explicitamente valores de ST (então são INFORMADAS). `60`
 * (ICMS cobrado anteriormente por ST) é tratado por presença: pode trazer base
 * de ST retida informada.
 */
const TRIBUTACAO_COM_ST = new Set(['10', '30', '70']);

/**
 * Resolve o `ValorLivro` de uma coluna a partir de (1) sua aplicabilidade dada o
 * CST e (2) se a coluna foi informada por algum item do grupo. Ordem das
 * decisões (R4.2):
 *
 *  1. NÃO APLICÁVEL vence: se a coluna não se aplica ao CST, é `NAO_APLICAVEL`
 *     mesmo que a origem tenha mandado um zero — não existe ICMS próprio numa
 *     isenta, p. ex.
 *  2. INFORMADO: a coluna é aplicável e algum item trouxe o valor — devolve a
 *     soma formatada (inclusive quando a soma é `0.00`, um ZERO legítimo).
 *  3. NÃO INFORMADO: a coluna é aplicável mas nenhum item trouxe o valor —
 *     `null`, NUNCA impresso como `0.00`.
 */
function resolverColuna(
  aplicavel: boolean,
  foiInformado: boolean,
  soma: bigint,
): ValorLivro {
  if (!aplicavel) return NAO_APLICAVEL;
  if (!foiInformado) return NAO_INFORMADO;
  return informado(fromScaledInteger(soma));
}

/**
 * Decide a aplicabilidade de cada coluna da linha a partir do CST normalizado.
 * As decisões são conservadoras e fiscalmente defensáveis (design §9):
 *
 *  - ICMS próprio e BC do ICMS: NÃO APLICÁVEIS quando o CST indica operação sem
 *    ICMS próprio (isenta/não tributada/suspensão/diferimento/ST anterior).
 *  - Redução de BC: NÃO APLICÁVEL quando não há percentual de redução informado
 *    (R5.1 — sem percentual efetivo não há redução; ausência de percentual não
 *    é "redução zero"). Caso contrário, por presença.
 *  - Colunas de ST: NÃO APLICÁVEIS quando o CST não é de ST E a origem não
 *    trouxe valores de ST; se houver valor de ST informado, prevalece INFORMADO.
 *  - Valor da operação e IPI: sempre aplicáveis (compõem o valor contábil);
 *    ficam por presença (informado vs não informado).
 */
function aplicabilidadeColunas(
  cst: string,
  presenca: PresencaColunas,
): Record<ColunaResumo, boolean> {
  const trib = tributacaoIcms(cst);
  const temIcmsProprio = !TRIBUTACAO_SEM_ICMS_PROPRIO.has(trib);
  const temReducao = presenca.percentualReducaoBcIcms;
  const stPorCst = TRIBUTACAO_COM_ST.has(trib);
  const temAlgumSt =
    presenca.valorBcIcmsSt || presenca.valorIcmsSt || presenca.valorFcpSt;
  const aplicavelSt = stPorCst || temAlgumSt;
  return {
    valorOperacao: true,
    valorBcIcms: temIcmsProprio,
    valorIcms: temIcmsProprio,
    valorBcIcmsSt: aplicavelSt,
    valorIcmsSt: aplicavelSt,
    valorReducaoBc: temReducao,
    valorIpi: true,
  };
}

/** Presença EFETIVA por coluna do RESUMO (derivadas incluídas). */
function presencaColunasResumo(
  presenca: PresencaColunas,
): Record<ColunaResumo, boolean> {
  // Valor da operação = líquido (bruto/desconto/frete/seguro/outras) + ST + FCP
  // ST + IPI: informado se QUALQUER componente foi informado.
  const operacaoInformada =
    presenca.valorBrutoProduto ||
    presenca.valorDesconto ||
    presenca.valorFrete ||
    presenca.valorSeguro ||
    presenca.valorOutrasDespesas ||
    presenca.valorIcmsSt ||
    presenca.valorFcpSt ||
    presenca.valorIpi;
  return {
    valorOperacao: operacaoInformada,
    valorBcIcms: presenca.valorBcIcms,
    valorIcms: presenca.valorIcms,
    valorBcIcmsSt: presenca.valorBcIcmsSt,
    valorIcmsSt: presenca.valorIcmsSt,
    // A redução só é "informada" quando há percentual de redução (R5.1); a soma
    // vem do agregador, mas a presença segue o percentual efetivo.
    valorReducaoBc: presenca.percentualReducaoBcIcms,
    valorIpi: presenca.valorIpi,
  };
}

/** Acumulador de uma linha de RESUMO (inteiros escalados + presença + drill). */
interface AcumuladorResumo {
  cst: string;
  cfop: string;
  aliquota: string;
  somas: Record<ColunaResumo, bigint>;
  presenca: PresencaColunas;
  documentos: Set<string>;
}

/** Soma uma linha analítica (de um documento) ao acumulador do grupo. */
function acumular(
  destino: AcumuladorResumo,
  linha: C190Analitico,
  documentoId: string,
): void {
  destino.somas.valorOperacao += linha.valorOperacao;
  destino.somas.valorBcIcms += linha.valorBcIcms;
  destino.somas.valorIcms += linha.valorIcms;
  destino.somas.valorBcIcmsSt += linha.valorBcIcmsSt;
  destino.somas.valorIcmsSt += linha.valorIcmsSt;
  destino.somas.valorReducaoBc += linha.valorReducaoBc;
  destino.somas.valorIpi += linha.valorIpi;
  destino.documentos.add(documentoId);
}

/** Cria o acumulador zerado de um grupo (CST, CFOP, alíquota). */
function novoAcumulador(linha: C190Analitico): AcumuladorResumo {
  return {
    cst: linha.cst,
    cfop: linha.cfop,
    aliquota: linha.aliquota,
    somas: {
      valorOperacao: 0n,
      valorBcIcms: 0n,
      valorIcms: 0n,
      valorBcIcmsSt: 0n,
      valorIcmsSt: 0n,
      valorReducaoBc: 0n,
      valorIpi: 0n,
    },
    presenca: presencaVazia(),
    documentos: new Set<string>(),
  };
}

/**
 * Projeta o RESUMO (CFOP/CST/alíquota com drill-down, R4.1/R5.4) a partir dos
 * documentos congelados. Aplica o agregador comum POR DOCUMENTO (R5.3: escopo
 * por documento) e consolida as linhas analíticas por (CST, CFOP, alíquota),
 * somando em inteiros escalados (exato) e acumulando o drill-down. Em paralelo
 * rastreia, por coluna, se algum item TROUXE o valor — para que o resultado
 * distinga ZERO informado, NÃO INFORMADO e NÃO APLICÁVEL (R4.2). O navegador só
 * formata (R4.3). A ordem é canônica (chave CST|CFOP|alíquota) para
 * reprodutibilidade (F20).
 */
export function projetarResumoLivro(
  documentos: ReadonlyArray<Record<string, unknown>>,
): LivroResumoLinha[] {
  const grupos = new Map<string, AcumuladorResumo>();
  documentos.forEach((documento, indice) => {
    const documentoId = identificarDocumento(documento, indice);
    const itens = itensDoDocumento(documento);
    if (itens.length === 0) return;
    // R5.3: o agregador é escopado por documento — invocamos com os itens de UM
    // documento por vez e consolidamos as linhas resultantes entre documentos.
    for (const analitico of aggregateC190Analitico(itens)) {
      const key = `${analitico.cst}|${analitico.cfop}|${analitico.aliquota}`;
      const grupo = grupos.get(key) ?? novoAcumulador(analitico);
      acumular(grupo, analitico, documentoId);
      // Presença: marca as colunas informadas pelos itens deste documento que
      // compõem ESTA linha analítica (mesma chave CST/CFOP/alíquota).
      for (const item of itens) {
        if (itemCasaLinha(item, analitico)) {
          registrarPresenca(grupo.presenca, item);
        }
      }
      grupos.set(key, grupo);
    }
  });
  return [...grupos.values()]
    .sort((a, b) =>
      `${a.cst}|${a.cfop}|${a.aliquota}`.localeCompare(
        `${b.cst}|${b.cfop}|${b.aliquota}`,
        'pt-BR',
      ),
    )
    .map((g) => montarLinhaResumo(g));
}

/**
 * Monta a linha final do RESUMO resolvendo cada coluna no tri-estado (R4.2):
 * combina a aplicabilidade (pelo CST) com a presença (algum item informou) para
 * decidir entre INFORMADO (`0.00` legítimo incluso), NÃO INFORMADO e NÃO
 * APLICÁVEL. Chave (CST/CFOP/alíquota) permanece como string simples.
 */
function montarLinhaResumo(g: AcumuladorResumo): LivroResumoLinha {
  const aplicavel = aplicabilidadeColunas(g.cst, g.presenca);
  const informadoPorColuna = presencaColunasResumo(g.presenca);
  const resolver = (coluna: ColunaResumo): ValorLivro =>
    resolverColuna(
      aplicavel[coluna],
      informadoPorColuna[coluna],
      g.somas[coluna],
    );
  const colunas = COLUNAS_RESUMO.reduce(
    (acc, coluna) => {
      acc[coluna] = resolver(coluna);
      return acc;
    },
    {} as Record<ColunaResumo, ValorLivro>,
  );
  return {
    cst: g.cst,
    cfop: g.cfop,
    aliquota: g.aliquota,
    valorOperacao: colunas.valorOperacao,
    valorBcIcms: colunas.valorBcIcms,
    valorIcms: colunas.valorIcms,
    valorBcIcmsSt: colunas.valorBcIcmsSt,
    valorIcmsSt: colunas.valorIcmsSt,
    valorReducaoBc: colunas.valorReducaoBc,
    valorIpi: colunas.valorIpi,
    documentos: [...g.documentos],
  };
}

/**
 * Converte uma memória de cálculo projetada numa linha de APURAÇÃO em tri-estado
 * (R4.2). NÃO recomputa: apenas reclassifica a `origem` já projetada do snapshot
 * em `ValorLivro`. `INFORMADO`/`DOCUMENTOS_ESCRITURADOS` → INFORMADO (um `0.00`
 * aqui é um ZERO legítimo e é preservado); `PADRAO_ZERO` → NÃO INFORMADO (o
 * total estava ausente no snapshot, logo NUNCA deve ser impresso como `0.00`).
 */
function memoriaParaLinha(
  memoria: ResultadoApuracaoMemoria,
): LivroApuracaoLinha {
  const valor: ValorLivro =
    memoria.origem === 'PADRAO_ZERO' ? NAO_INFORMADO : informado(memoria.valor);
  return {
    codigo: memoria.codigo,
    descricao: memoria.descricao,
    memoria,
    valor,
  };
}

/**
 * Núcleo PURO da projeção de livros (R4.1/R4.3): dada a apuração JÁ PROJETADA e
 * os snapshots congelados, monta as três visões sob o cabeçalho comum. Não
 * recomputa imposto — DETALHADO e APURAÇÃO vêm diretamente do contrato
 * `ResultadoApuracao`; RESUMO reusa o agregador comum (R5.4). Separado da parte
 * com banco para ser determinístico e testável.
 *
 * `normalizeC190Cst` é reexportado implicitamente pelo RESUMO (o agregador o
 * aplica), de modo que a chave CST do livro coincida com a do builder.
 */
export function projetarLivros(
  registro: FechamentoRegistro,
  snapshots: FechamentoSnapshots,
  options?: LivrosProjecaoOptions,
): LivrosProjecao {
  const apuracao = projetarResultadoApuracao(registro, snapshots, options);
  const cabecalho = montarCabecalho(apuracao, options?.filtros);

  const detalhado: LivroDetalhado = {
    cabecalho,
    detalhamento: apuracao.detalhamento,
  };

  const resumo: LivroResumo = {
    cabecalho,
    linhas: projetarResumoLivro(snapshots.documentos),
  };

  const apuracaoView: LivroApuracao = {
    cabecalho,
    linhas: apuracao.memorias.map(memoriaParaLinha),
    totais: apuracao.totais,
    memorias: apuracao.memorias,
    inconsistencias: apuracao.inconsistencias,
    saldoDevedorApurado: apuracao.saldoDevedorApurado,
  };

  return { cabecalho, detalhado, resumo, apuracao: apuracaoView };
}

// `ZERO` e `normalizeC190Cst` reexportados para os testes do livro conferirem a
// convenção de zero e a normalização de CST compartilhada com o builder.
export { ZERO as LIVRO_ZERO, normalizeC190Cst };
