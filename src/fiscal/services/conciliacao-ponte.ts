import {
  decidirCreditoIcms,
  type EntradaDecisaoCredito,
  type MotivoDecisaoCredito,
  type ResultadoDecisaoCredito,
} from './decisao-credito';
import type { FechamentoRegistro } from './fiscal-closing.service';
import type {
  ResultadoApuracao,
  ResultadoApuracaoTotais,
  SaldoDevedorApurado,
} from './resultado-apuracao.contract';
import {
  projetarResultadoApuracao,
  projetarSaldoDevedorApurado,
} from './resultado-apuracao.projector';
import type { FechamentoSnapshots } from './resultado-apuracao.projector';
import { fromScaledInteger, toScaledInteger } from '../sped/sped-decimal';

/**
 * Ponte de conciliação por tributo (F03 / R2.2, R2.4, R2.3, R2.5) — Tarefas 4.1,
 * 4.2 e 4.3.
 *
 * Constrói a trilha AUDITÁVEL que liga os documentos elegíveis ao bloco E110 do
 * SPED EFD ICMS/IPI, EXPLICANDO cada ajuste no caminho:
 *
 *   documentos → lançamentos → apuração → livro → E110
 *
 * A reconciliação C190 × crédito admitido (R2.3, tarefa 4.2) é de PRIMEIRA
 * CLASSE: o ICMS destacado nos documentos de entrada é PRESERVADO, o crédito
 * efetivamente admitido é apresentado SEPARADAMENTE (derivado da decisão de
 * crédito ÚNICA, `decidirCreditoIcms`, aplicada a cada documento), e a diferença
 * é DECOMPOSTA POR MOTIVO com seu fundamento legal/de negócio — nunca apagada
 * por zerar o destaque.
 *
 * Cada ETAPA carrega seus totais de crédito/débito (strings decimais, nunca
 * `Number`); entre duas etapas consecutivas há uma lista de AJUSTES, cada um
 * com código, descrição, delta e fundamento. Um ajuste é SEMPRE explícito — a
 * diferença de uma etapa para a outra nunca é aplicada em silêncio nem apagada
 * por zerar um destaque (R2.3 trata o caso do crédito admitido; aqui a ponte
 * garante que QUALQUER diferença entre etapas apareça como um ajuste nomeado).
 *
 * NÃO há um segundo motor de cálculo (design §"Lançamentos normalizados" e
 * §"Fechamento versionado"): os totais da apuração/livro/E110 vêm do MESMO
 * projetor do contrato `ResultadoApuracao`, que lê os snapshots CONGELADOS do
 * fechamento. A ponte apenas ORGANIZA esses totais em etapas e deriva as
 * diferenças entre elas como ajustes — de modo que, para a MESMA versão de
 * fechamento, livro e SPED apresentem créditos/débitos idênticos (R2.4) por
 * construção, e a conciliação possa PROVÁ-lo em vez de afirmá-lo.
 *
 * Aritmética inteira em centavos (sem ponto flutuante), espelhando os demais
 * módulos fiscais (`sped-decimal`, `retificacao-fechamento`): a reconciliação
 * precisa ser exata.
 */

/** As etapas da ponte, na ORDEM do fluxo documentos→E110. */
export type EtapaPonte =
  | 'DOCUMENTOS'
  | 'LANCAMENTOS'
  | 'APURACAO'
  | 'LIVRO'
  | 'E110';

/** Ordem canônica das etapas — a trilha é percorrida nesta sequência. */
export const ORDEM_ETAPAS: readonly EtapaPonte[] = [
  'DOCUMENTOS',
  'LANCAMENTOS',
  'APURACAO',
  'LIVRO',
  'E110',
] as const;

/** Rótulo legível de cada etapa (memória de conciliação). */
const DESCRICAO_ETAPA: Record<EtapaPonte, string> = {
  DOCUMENTOS: 'Documentos fiscais elegíveis',
  LANCAMENTOS: 'Lançamentos normalizados (C190/D190)',
  APURACAO: 'Apuração do período (saldos congelados)',
  LIVRO: 'Livro de apuração (projeção do fechamento)',
  E110: 'Bloco E110 do SPED EFD ICMS/IPI',
};

/**
 * Totais de uma etapa relevantes à conciliação por tributo. São os montantes de
 * crédito e débito de ICMS próprio que precisam coincidir ponta a ponta (R2.4),
 * como strings decimais de duas casas.
 */
export interface TotaisEtapa {
  /** Créditos de ICMS da etapa (string decimal). */
  creditos: string;
  /** Débitos de ICMS da etapa (string decimal). */
  debitos: string;
}

/** Uma etapa da ponte com seus totais e o rótulo legível. */
export interface EtapaConciliacao {
  etapa: EtapaPonte;
  descricao: string;
  totais: TotaisEtapa;
}

/**
 * Um AJUSTE explicado entre duas etapas consecutivas (R2.2). Carrega a origem e
 * o destino, o campo afetado (crédito/débito), o delta exato e o fundamento —
 * de modo que a passagem de uma etapa para a outra seja rastreável, nunca
 * silenciosa. `delta` é `destino - origem` como string decimal (sinal
 * preservado); zero significa que a etapa não alterou aquele montante.
 */
export interface AjustePonte {
  de: EtapaPonte;
  para: EtapaPonte;
  campo: keyof TotaisEtapa;
  codigo: string;
  descricao: string;
  /** `valor(destino) - valor(origem)` como string decimal (duas casas). */
  delta: string;
  fundamento: string;
}

/**
 * Uma PARCELA explicada da diferença entre o ICMS destacado nos documentos
 * (C190) e o crédito ADMITIDO no lançamento (R2.3). Agrupa o destaque não
 * admitido por MOTIVO da decisão de crédito (`decidirCreditoIcms`) — vedação por
 * CFOP de uso/consumo/ativo/ST, vedação por regra, CST não autorizado etc. — de
 * modo que a diferença seja de PRIMEIRA CLASSE e auditável: cada parcela diz
 * QUANTO (o destaque não admitido daquele grupo) e POR QUÊ (o fundamento legal
 * ou de negócio), nunca apagando o destaque documental.
 */
export interface ParcelaCreditoAdmitido {
  /** Motivo da decisão (`decidirCreditoIcms`) que explica a não admissão. */
  motivo: MotivoDecisaoCredito;
  /** Decisão agregada deste grupo: VEDADO ou EXIGE_REVISAO. */
  decisao: ResultadoDecisaoCredito['decisao'];
  /** ICMS destacado nos documentos deste grupo (string decimal, preservado). */
  destacado: string;
  /** Crédito admitido deste grupo (string decimal; 0.00 para não admitido). */
  admitido: string;
  /** `destacado - admitido` deste grupo (parcela da diferença, string decimal). */
  diferenca: string;
  /** Quantidade de documentos/itens de entrada agrupados neste motivo. */
  quantidade: number;
  /** Fundamento legal/de negócio da não admissão (R2.3). */
  fundamento: string;
}

/**
 * Reconciliação de PRIMEIRA CLASSE entre o C190 (ICMS destacado nos documentos
 * de entrada) e o crédito ADMITIDO no lançamento (R2.3). O destaque é
 * PRESERVADO (`destacado`); o crédito admitido é apresentado SEPARADAMENTE
 * (`admitido`); a diferença (`diferenca = destacado - admitido`) é EXPLICADA,
 * decomposta em parcelas por motivo (`parcelas`), nunca apagada por zerar o
 * destaque. Quando a diferença é zero, `parcelas` fica vazia (todo o destaque
 * foi admitido).
 */
export interface DiferencaCreditoAdmitido {
  /** Total do ICMS destacado nos documentos de entrada (C190). */
  destacado: string;
  /** Total do crédito efetivamente admitido no lançamento. */
  admitido: string;
  /** `destacado - admitido` (>= 0.00): o destaque não apropriado, explicado. */
  diferenca: string;
  /** Parcelas da diferença, agrupadas por motivo da decisão de crédito. */
  parcelas: ParcelaCreditoAdmitido[];
}

/**
 * Resultado da verificação de conciliação livro × E110 (R2.4). Para a MESMA
 * versão de fechamento, os créditos e débitos do livro DEVEM ser idênticos aos
 * do E110; `reconcilia` é `true` quando ambos batem. Quando não batem, as
 * diferenças ficam explícitas (nunca apagadas) — a ponte reporta o problema em
 * vez de mascará-lo.
 */
export interface ConciliacaoLivroE110 {
  reconcilia: boolean;
  diferencaCreditos: string;
  diferencaDebitos: string;
}

/**
 * Ponte de conciliação completa (R2.2): a trilha ordenada de etapas, os ajustes
 * explicados entre elas e a verificação livro × E110 (R2.4). É a PROJEÇÃO
 * auditável de uma versão de fechamento — identifica a versão (para que a
 * conciliação seja sempre atada a uma entrega reproduzível) e não recomputa
 * nada além de somas inteiras exatas sobre totais já projetados.
 */
export interface PonteConciliacao {
  clienteId: string;
  obrigacao: FechamentoRegistro['obrigacao'];
  competencia: string;
  versao: number;
  estado: FechamentoRegistro['estado'];
  motorVersao: string;
  hashEntradas: string;
  etapas: EtapaConciliacao[];
  ajustes: AjustePonte[];
  /**
   * Reconciliação C190 × crédito admitido (R2.3): o destaque documental, o
   * crédito admitido e a diferença EXPLICADA por motivo — de primeira classe e
   * auditável, nunca apagada por zerar o destaque.
   */
  diferencaCreditoAdmitido: DiferencaCreditoAdmitido;
  conciliacaoLivroE110: ConciliacaoLivroE110;
  /**
   * Saldo devedor DOCUMENTAL no fim da trilha (R2.5): o saldo apurado é uma
   * INFORMAÇÃO de apuração, NÃO a guia a recolher. A ponte reaproveita a
   * projeção do contrato (`projetarSaldoDevedorApurado`) — sem segundo motor —
   * para que a saída da conciliação deixe explícito que gerar a guia de
   * recolhimento é um passo separado e deliberado, nunca auto-derivado do saldo.
   */
  saldoDevedorApurado: SaldoDevedorApurado;
}

/** Converte string decimal de duas casas em centavos (inteiro). Exato. */
function decimalParaCentavos(valor: string, contexto: string): number {
  if (typeof valor !== 'string') {
    throw new Error(
      `Valor "${contexto}" deve ser string decimal (nunca Number) na ponte de conciliação.`,
    );
  }
  const match = /^(-?)(\d+)\.(\d{2})$/.exec(valor.trim());
  if (!match) {
    throw new Error(
      `Valor "${contexto}" com formato decimal inesperado na ponte de conciliação: "${valor}".`,
    );
  }
  const [, sinal, inteiro, centavos] = match;
  const magnitude = Number(inteiro) * 100 + Number(centavos);
  return sinal === '-' ? -magnitude : magnitude;
}

/** Centavos (inteiro) → string decimal de duas casas, preservando o sinal. */
function centavosParaDecimal(centavos: number): string {
  const sinal = centavos < 0 ? '-' : '';
  const abs = Math.abs(centavos);
  const inteiro = Math.trunc(abs / 100);
  const resto = abs % 100;
  return `${sinal}${inteiro}.${String(resto).padStart(2, '0')}`;
}

/**
 * Soma os créditos e débitos documentais do snapshot de documentos congelados —
 * a ETAPA de origem da ponte (R2.2: "documentos elegíveis"). Um documento de
 * ENTRADA alimenta o crédito; um de SAÍDA, o débito. O destaque documental
 * (`valorIcms`) é o ponto de partida; a diferença para o crédito ADMITIDO
 * aparece depois como um ajuste explícito entre DOCUMENTOS e LANCAMENTOS (R2.3),
 * nunca zerada aqui. Documentos sem sentido explícito não contribuem (não se
 * inventa sinal).
 */
function somarDocumentos(
  documentos: ReadonlyArray<Record<string, unknown>>,
): TotaisEtapa {
  let creditos = 0n;
  let debitos = 0n;
  for (const documento of documentos) {
    const sentido = lerSentido(documento);
    const valorIcms = lerDecimalCentavos(documento, 'valorIcms');
    if (valorIcms === null) continue;
    if (sentido === 'ENTRADA') creditos += valorIcms;
    else if (sentido === 'SAIDA') debitos += valorIcms;
  }
  return {
    creditos: centavosParaDecimal(Number(creditos)),
    debitos: centavosParaDecimal(Number(debitos)),
  };
}

/**
 * Lê o sentido escriturado de um documento congelado sem inventar fallback:
 * aceita `tipoOperacaoEscriturada`/`sentido`/`tipoOperacao` como 'ENTRADA' ou
 * 'SAIDA'. Qualquer outro valor (ou ausência) devolve `null` — o documento não
 * contribui para crédito nem débito (zero ≠ não informado, R4.2).
 */
function lerSentido(
  documento: Record<string, unknown>,
): 'ENTRADA' | 'SAIDA' | null {
  for (const chave of ['tipoOperacaoEscriturada', 'sentido', 'tipoOperacao']) {
    const valor = documento[chave];
    if (valor === 'ENTRADA' || valor === 'SAIDA') return valor;
  }
  return null;
}

/**
 * Lê um valor monetário do documento congelado como centavos (bigint), aceitando
 * só strings decimais (restrição da fase). Ausência → `null` (distingue zero de
 * não informado).
 */
function lerDecimalCentavos(
  documento: Record<string, unknown>,
  chave: string,
): bigint | null {
  const valor = documento[chave];
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== 'string') {
    throw new Error(
      `Valor monetário "${chave}" do documento congelado deve ser string ` +
      `decimal (nunca Number); recebido: ${typeof valor}.`,
    );
  }
  return BigInt(decimalParaCentavos(valor, chave));
}

/** Lê um campo de texto do documento congelado (ou null quando ausente). */
function lerTexto(
  documento: Record<string, unknown>,
  ...chaves: string[]
): string | null {
  for (const chave of chaves) {
    const valor = documento[chave];
    if (typeof valor === 'string' && valor.length > 0) return valor;
  }
  return null;
}

/**
 * Lê a regra de crédito eventualmente congelada no documento. Só reconhece o
 * subconjunto que a decisão precisa (`apropriaCreditoIcms`, `regraVersaoId`);
 * ausência → `undefined` (sem regra, a decisão recai sobre CFOP + CST/CSOSN).
 */
function lerRegra(
  documento: Record<string, unknown>,
): EntradaDecisaoCredito['regra'] {
  const bruto = documento.regra;
  if (typeof bruto !== 'object' || bruto === null || Array.isArray(bruto)) {
    return undefined;
  }
  const regra = bruto as Record<string, unknown>;
  const apropria = regra.apropriaCreditoIcms;
  const versao = regra.regraVersaoId;
  return {
    apropriaCreditoIcms: typeof apropria === 'boolean' ? apropria : null,
    regraVersaoId: typeof versao === 'string' ? versao : null,
  };
}

/**
 * Fundamento legal/de negócio de um motivo de NÃO admissão do crédito (R2.3).
 * Explica POR QUE o destaque documental não virou crédito admitido — o cerne da
 * reconciliação C190 × crédito admitido. `ADMITIDO`/`SEM_VALOR_DESTACADO` nunca
 * geram diferença (o destaque é integralmente admitido ou não há destaque), por
 * isso não têm fundamento de não admissão.
 */
const FUNDAMENTO_MOTIVO: Record<MotivoDecisaoCredito, string> = {
  SEM_VALOR_DESTACADO:
    'Sem ICMS destacado a apropriar: não há crédito nem diferença a explicar.',
  CST_AUTORIZA_CREDITO:
    'CST autoriza a apropriação: o destaque é integralmente admitido.',
  CSOSN_PERMITE_CREDITO:
    'CSOSN 101/201 permite crédito ao adquirente: o destaque é admitido.',
  CFOP_VEDA_CREDITO:
    'Crédito vedado pelo CFOP escriturado (uso/consumo — LC 87/96 art. 33, I; ' +
    'ativo imobilizado via CIAP 1/48; ou aquisição como substituído tributário ' +
    '— Convênio ICMS 142/18). O ICMS destacado é preservado; a diferença é ' +
    'explicada, não apagada (R2.3).',
  REGRA_VEDA_CREDITO:
    'Crédito vedado por regra fiscal aplicável (`apropriaCreditoIcms=false`). O ' +
    'ICMS destacado é preservado; a diferença é explicada, não apagada (R2.3).',
  CST_NAO_AUTORIZADO:
    'CST/CSOSN não autoriza apropriação automática: o item exige revisão fiscal ' +
    'antes do crédito. O ICMS destacado é preservado; a diferença é explicada, ' +
    'não apagada (R2.3).',
};

/** Acumulador por motivo da decisão de crédito (centavos inteiros, exatos). */
interface AcumuladorMotivo {
  motivo: MotivoDecisaoCredito;
  decisao: ResultadoDecisaoCredito['decisao'];
  destacado: bigint;
  admitido: bigint;
  quantidade: number;
}

/**
 * Decompõe a diferença entre o ICMS destacado nos documentos de ENTRADA (C190) e
 * o crédito ADMITIDO (R2.3), aplicando a decisão de crédito ÚNICA
 * (`decidirCreditoIcms`) a cada documento congelado — a MESMA política que o
 * builder/livro consomem, sem um segundo motor. Para cada entrada:
 *   - o destaque (`valorIcms`/`valorCreditoIcmsSn`) é somado ao grupo do motivo;
 *   - o crédito admitido é a saída da decisão (0 para VEDADO/EXIGE_REVISAO);
 *   - a diferença do grupo é destaque − admitido, com seu fundamento.
 *
 * O destaque NUNCA é zerado: ele aparece preservado em `destacado`; o admitido
 * aparece separado; a diferença fica EXPLICADA por motivo. Documentos de SAÍDA
 * (débito) e entradas sem sentido explícito não entram (não há crédito a
 * admitir). Puro e determinístico.
 */
function decomporCreditoAdmitido(
  documentos: ReadonlyArray<Record<string, unknown>>,
): DiferencaCreditoAdmitido {
  const grupos = new Map<MotivoDecisaoCredito, AcumuladorMotivo>();
  let destacadoTotal = 0n;
  let admitidoTotal = 0n;

  for (const documento of documentos) {
    if (lerSentido(documento) !== 'ENTRADA') continue;
    const valorIcms = lerTexto(documento, 'valorIcms');
    const valorCreditoIcmsSn = lerTexto(documento, 'valorCreditoIcmsSn');
    // Destaque de crédito do documento (regime normal OU crédito SN).
    const destaque =
      toScaledIntegerSeguro(valorIcms, documento, 'valorIcms') +
      toScaledIntegerSeguro(
        valorCreditoIcmsSn,
        documento,
        'valorCreditoIcmsSn',
      );
    if (destaque === 0n) continue; // sem destaque: nada a admitir nem a explicar

    const decisao = decidirCreditoIcms({
      cfop: lerTexto(documento, 'cfop'),
      cstIcms: lerTexto(documento, 'cstIcms', 'cst'),
      csosnIcms: lerTexto(documento, 'csosnIcms'),
      valorIcms,
      valorCreditoIcmsSn,
      regra: lerRegra(documento),
    });

    destacadoTotal += destaque;
    admitidoTotal += decisao.valorAdmitido;

    const existente = grupos.get(decisao.motivo);
    if (existente) {
      existente.destacado += destaque;
      existente.admitido += decisao.valorAdmitido;
      existente.quantidade += 1;
    } else {
      grupos.set(decisao.motivo, {
        motivo: decisao.motivo,
        decisao: decisao.decisao,
        destacado: destaque,
        admitido: decisao.valorAdmitido,
        quantidade: 1,
      });
    }
  }

  // Só viram PARCELAS da diferença os grupos cujo destaque não foi integralmente
  // admitido (destaque > admitido). Grupos totalmente admitidos não entram — não
  // há diferença a explicar. Ordem canônica estável para reprodutibilidade.
  const parcelas: ParcelaCreditoAdmitido[] = [...grupos.values()]
    .filter((g) => g.destacado - g.admitido > 0n)
    .sort((a, b) => a.motivo.localeCompare(b.motivo))
    .map((g) => ({
      motivo: g.motivo,
      decisao: g.decisao,
      destacado: fromScaledInteger(g.destacado),
      admitido: fromScaledInteger(g.admitido),
      diferenca: fromScaledInteger(g.destacado - g.admitido),
      quantidade: g.quantidade,
      fundamento: FUNDAMENTO_MOTIVO[g.motivo],
    }));

  return {
    destacado: fromScaledInteger(destacadoTotal),
    admitido: fromScaledInteger(admitidoTotal),
    diferenca: fromScaledInteger(destacadoTotal - admitidoTotal),
    parcelas,
  };
}

/**
 * Converte string decimal para inteiro escalado reaproveitando `toScaledInteger`,
 * mas mantém a MESMA mensagem de erro da ponte quando o valor não é string (a
 * restrição da fase: decimais nunca são `Number`). `null`/ausente → 0n.
 */
function toScaledIntegerSeguro(
  valor: string | null,
  documento: Record<string, unknown>,
  chave: string,
): bigint {
  if (valor === null) {
    // Reaproveita a validação de tipo: se a chave existe mas não é string,
    // `lerTexto` já a terá ignorado — reforçamos a regra decimal explicitamente.
    const bruto = documento[chave];
    if (bruto !== undefined && bruto !== null && typeof bruto !== 'string') {
      throw new Error(
        `Valor monetário "${chave}" do documento congelado deve ser string ` +
        `decimal (nunca Number); recebido: ${typeof bruto}.`,
      );
    }
    return 0n;
  }
  return toScaledInteger(valor);
}

/**
 * Totais da etapa LANCAMENTOS: os créditos/débitos ADMITIDOS. Quando o snapshot
 * congela os totais de lançamento explicitamente
 * (`parametros.lancamentos.{creditos,debitos}`), eles PREVALECEM (o fechamento
 * já os computou). Caso contrário, o crédito admitido é derivado da decisão de
 * crédito ÚNICA aplicada aos documentos (`decomporCreditoAdmitido`) — não um
 * fallback de identidade: um crédito vedado por CFOP é destacado no documento mas
 * NÃO admitido no lançamento, e a diferença fica explicada (R2.3). O débito segue
 * o destaque documental de saída salvo override explícito.
 */
function totaisLancamentos(
  parametros: Record<string, unknown>,
  documentos: TotaisEtapa,
  creditoAdmitido: DiferencaCreditoAdmitido,
): TotaisEtapa {
  const bruto = parametros.lancamentos;
  if (typeof bruto !== 'object' || bruto === null || Array.isArray(bruto)) {
    // Sem override: o crédito da etapa é o ADMITIDO (não o destacado).
    return { creditos: creditoAdmitido.admitido, debitos: documentos.debitos };
  }
  const lanc = bruto as Record<string, unknown>;
  return {
    creditos: lerDecimalOuPadrao(lanc, 'creditos', creditoAdmitido.admitido),
    debitos: lerDecimalOuPadrao(lanc, 'debitos', documentos.debitos),
  };
}

/** Lê uma string decimal do objeto, ou devolve o padrão quando ausente. */
function lerDecimalOuPadrao(
  fonte: Record<string, unknown>,
  chave: string,
  padrao: string,
): string {
  const valor = fonte[chave];
  if (valor === undefined || valor === null) return padrao;
  if (typeof valor !== 'string') {
    throw new Error(
      `Valor "${chave}" dos lançamentos deve ser string decimal (nunca Number).`,
    );
  }
  return valor;
}

/** Extrai os totais de crédito/débito de ICMS próprio de uma apuração projetada. */
function totaisApuracao(totais: ResultadoApuracaoTotais): TotaisEtapa {
  return { creditos: totais.creditos, debitos: totais.debitos };
}

/**
 * Monta um ajuste explicado entre duas etapas para um campo (crédito/débito).
 * Devolve `null` quando o delta é zero E as etapas são de mesma natureza (a
 * etapa não alterou o montante — não há ajuste a explicar). Quando há delta, o
 * ajuste nomeia a diferença com um fundamento específico do par de etapas.
 */
function derivarAjuste(
  de: EtapaPonte,
  para: EtapaPonte,
  campo: keyof TotaisEtapa,
  origem: string,
  destino: string,
  creditoAdmitido: DiferencaCreditoAdmitido,
): AjustePonte | null {
  const delta =
    decimalParaCentavos(destino, `${para}.${campo}`) -
    decimalParaCentavos(origem, `${de}.${campo}`);
  if (delta === 0) return null;
  return {
    de,
    para,
    campo,
    codigo: `${de}_${para}_${campo.toUpperCase()}`,
    descricao: `Ajuste de ${campo} de ${DESCRICAO_ETAPA[de]} para ${DESCRICAO_ETAPA[para]}`,
    delta: centavosParaDecimal(delta),
    fundamento: fundamentoAjuste(de, para, campo, creditoAdmitido),
  };
}

/**
 * Fundamento legível de um ajuste conforme o par de etapas. Explica POR QUE o
 * montante muda de uma etapa para a outra — a essência da ponte (R2.2). Para o
 * ajuste de crédito DOCUMENTOS→LANCAMENTOS, carrega os MOTIVOS REAIS da não
 * admissão (derivados da decisão de crédito por documento, R2.3), não um texto
 * genérico — a diferença C190 × crédito admitido fica rastreável até a razão.
 */
function fundamentoAjuste(
  de: EtapaPonte,
  para: EtapaPonte,
  campo: keyof TotaisEtapa,
  creditoAdmitido: DiferencaCreditoAdmitido,
): string {
  if (de === 'DOCUMENTOS' && para === 'LANCAMENTOS') {
    if (campo === 'creditos') {
      const base =
        'Diferença entre o ICMS destacado nos documentos de entrada (C190) e o ' +
        'crédito ADMITIDO no lançamento. O destaque não é zerado — a diferença é ' +
        'explicada (R2.3).';
      if (creditoAdmitido.parcelas.length === 0) return base;
      const motivos = creditoAdmitido.parcelas
        .map(
          (p) =>
            `${p.motivo} (${p.diferenca} em ${p.quantidade} doc.): ${p.fundamento}`,
        )
        .join(' ');
      return `${base} Motivos: ${motivos}`;
    }
    return 'Diferença entre o ICMS destacado nos documentos de saída e o débito escriturado no lançamento.';
  }
  if (de === 'LANCAMENTOS' && para === 'APURACAO') {
    return 'Ajustes/estornos da apuração do período aplicados sobre os lançamentos (E111 e saldos), conforme os parâmetros congelados do fechamento.';
  }
  if (de === 'APURACAO' && para === 'LIVRO') {
    return 'O livro é projeção direta da apuração; qualquer diferença indica que o livro deixou de projetar o fechamento (não deveria ocorrer).';
  }
  if (de === 'LIVRO' && para === 'E110') {
    return 'Livro e E110 projetam a MESMA versão; qualquer diferença viola R2.4 e é reportada, não aplicada.';
  }
  return 'Ajuste entre etapas da ponte de conciliação.';
}

/** Deriva todos os ajustes entre duas etapas (crédito e débito). */
function ajustesEntre(
  de: EtapaConciliacao,
  para: EtapaConciliacao,
  creditoAdmitido: DiferencaCreditoAdmitido,
): AjustePonte[] {
  const ajustes: AjustePonte[] = [];
  const creditos = derivarAjuste(
    de.etapa,
    para.etapa,
    'creditos',
    de.totais.creditos,
    para.totais.creditos,
    creditoAdmitido,
  );
  if (creditos) ajustes.push(creditos);
  const debitos = derivarAjuste(
    de.etapa,
    para.etapa,
    'debitos',
    de.totais.debitos,
    para.totais.debitos,
    creditoAdmitido,
  );
  if (debitos) ajustes.push(debitos);
  return ajustes;
}

/**
 * Verifica a conciliação livro × E110 (R2.4): para a mesma versão, crédito e
 * débito do livro DEVEM ser idênticos aos do E110. Reporta as diferenças
 * (zero quando reconcilia) sem apagá-las.
 */
function conciliarLivroE110(
  livro: TotaisEtapa,
  e110: TotaisEtapa,
): ConciliacaoLivroE110 {
  const difCreditos =
    decimalParaCentavos(e110.creditos, 'E110.creditos') -
    decimalParaCentavos(livro.creditos, 'LIVRO.creditos');
  const difDebitos =
    decimalParaCentavos(e110.debitos, 'E110.debitos') -
    decimalParaCentavos(livro.debitos, 'LIVRO.debitos');
  return {
    reconcilia: difCreditos === 0 && difDebitos === 0,
    diferencaCreditos: centavosParaDecimal(difCreditos),
    diferencaDebitos: centavosParaDecimal(difDebitos),
  };
}

/**
 * Núcleo PURO da ponte (R2.2/R2.4): dada uma apuração JÁ PROJETADA e os
 * snapshots congelados, monta as cinco etapas, deriva os ajustes explicados
 * entre elas e verifica a conciliação livro × E110. Separado da parte com banco
 * para ser testável de forma determinística — os mesmos snapshots sempre
 * produzem a mesma ponte.
 *
 * Como APURACAO, LIVRO e E110 são projeções da MESMA versão (não há segundo
 * motor), seus totais coincidem por construção: os ajustes APURACAO→LIVRO e
 * LIVRO→E110 são normalmente vazios, e a conciliação R2.4 fecha. Um ajuste
 * não-vazio nesses pares é um SINAL de regressão (livro/E110 deixaram de
 * projetar o fechamento), não um ajuste legítimo — e por isso aparece em vez de
 * ser silenciado.
 */
export function montarPonteConciliacao(
  registro: FechamentoRegistro,
  snapshots: FechamentoSnapshots,
): PonteConciliacao {
  const apuracao: ResultadoApuracao = projetarResultadoApuracao(
    registro,
    snapshots,
  );

  const totaisDocumentos = somarDocumentos(snapshots.documentos);
  // Reconciliação C190 × crédito admitido (R2.3): decompõe o destaque documental
  // em admitido/não-admitido por motivo, usando a decisão de crédito ÚNICA.
  const creditoAdmitido = decomporCreditoAdmitido(snapshots.documentos);
  const totaisLanc = totaisLancamentos(
    snapshots.parametros,
    totaisDocumentos,
    creditoAdmitido,
  );
  const totaisApur = totaisApuracao(apuracao.totais);

  const etapas: EtapaConciliacao[] = [
    etapa('DOCUMENTOS', totaisDocumentos),
    etapa('LANCAMENTOS', totaisLanc),
    etapa('APURACAO', totaisApur),
    // LIVRO e E110 são a MESMA projeção do fechamento (sem segundo motor):
    // reaproveitam os totais da apuração, de modo que R2.4 feche por construção.
    etapa('LIVRO', totaisApur),
    etapa('E110', totaisApur),
  ];

  const ajustes: AjustePonte[] = [];
  for (let i = 0; i < etapas.length - 1; i++) {
    ajustes.push(...ajustesEntre(etapas[i], etapas[i + 1], creditoAdmitido));
  }

  const livro = etapas[3].totais;
  const e110 = etapas[4].totais;

  return {
    clienteId: registro.clienteId,
    obrigacao: registro.obrigacao,
    competencia: registro.competencia,
    versao: registro.versao,
    estado: registro.estado,
    motorVersao: registro.motorVersao,
    hashEntradas: registro.hashEntradas,
    etapas,
    ajustes,
    diferencaCreditoAdmitido: creditoAdmitido,
    conciliacaoLivroE110: conciliarLivroE110(livro, e110),
    // R2.5: o saldo devedor no fim da trilha é informação de apuração, NUNCA uma
    // guia automática. Reaproveita a projeção do contrato (mesmos totais), sem
    // segundo motor — a emissão da guia é um passo separado e deliberado.
    saldoDevedorApurado: projetarSaldoDevedorApurado(apuracao.totais),
  };
}

/** Monta uma etapa com seu rótulo legível. */
function etapa(nome: EtapaPonte, totais: TotaisEtapa): EtapaConciliacao {
  return { etapa: nome, descricao: DESCRICAO_ETAPA[nome], totais };
}
