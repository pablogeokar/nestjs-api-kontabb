/**
 * MOTOR DE ENQUADRAMENTO DE ST POR PRODUTO/CEST/UF/VIGÊNCIA (Fase 4 / tarefa
 * 4.2 — R3.1).
 *
 * O estado anterior (builder de ST) totalizava ST/FCP e admitia ajustes, mas
 * NÃO tinha um motor que decidisse se uma mercadoria, numa UF e competência, é
 * de fato SUJEITA À ST. O design (§ST/FCP F18) exige: "catálogo oficial
 * versionado (fonte, hash, vigência, UF) para enquadramento produto/CEST/UF"; e
 * R3.1: "O sistema DEVE ter um catálogo versionado (fonte, hash, vigência, UF)
 * para enquadramento produto/CEST/UF". Este módulo é esse motor.
 *
 * O enquadramento é a peça que PRECEDE o cálculo (4.3), os registros filhos SPED
 * (4.4) e a conciliação (4.6): dado o produto (CEST/NCM), a UF e a competência,
 * decide se o item está `SUJEITO`, `NAO_SUJEITO`, em `PENDENCIA` ou `BLOQUEADO`,
 * consumindo a REGRA do catálogo `ST_FCP` resolvida por competência pelo
 * `FiscalNormativeCatalogService` (chave = CEST) — nunca "a última".
 *
 * DOIS PORTÕES, NESTA ORDEM (ambos de 4.1/Task 1):
 *   1. PORTÃO DE VERIFICAÇÃO (4.1 — `st-verificacao.ts`): a FONTE normativa do
 *      cenário (arcabouço nacional 142/2018 + legislação estadual da UF) precisa
 *      estar VERIFICADA. Um cenário não verificado NUNCA produz enquadramento
 *      definitivo — fica `BLOQUEADO`, com o motivo de 4.1. É o escopo honesto da
 *      fase: sem fonte verificada, nada de ST.
 *   2. PORTÃO DE REGRA (Task 1): mesmo com a fonte verificada, a REGRA do CEST
 *      precisa existir, estar vigente na competência E aprovada para o
 *      enquadramento ser definitivo. Regra vigente porém não aprovada →
 *      `PENDENCIA` (não guia). Regra ausente → `PENDENCIA` (não se presume que o
 *      produto é/não é ST sem a regra). Só regra aprovada que diz "sujeito"
 *      produz `SUJEITO`; regra aprovada que diz "não sujeito" produz
 *      `NAO_SUJEITO`.
 *
 * Este é um RESOLVER PURO: não consulta o banco nem resolve vigência. Recebe a
 * versão do catálogo, a regra do CEST e o status de verificação (4.1) já
 * resolvidos pelo serviço que o orquestra, e apenas classifica. Isso espelha
 * `calcularDifalHipotese`/`calcularPisCofinsNatureza` (peças puras alimentadas
 * pelo catálogo) e deixa a decisão testável sem banco.
 *
 * NÃO FAZ (escopo de outras tarefas): não calcula ST (substituto/substituído/
 * retenção — 4.3), não emite registros filhos C191/C195/C197/E112/E113 (4.4),
 * não concilia (4.6). Produz apenas o ENQUADRAMENTO e a memória auditável.
 *
 * DECIMAIS SEMPRE COMO STRING (restrição da fase): este módulo não faz
 * aritmética monetária. MVA/alíquotas que a regra traga permanecem strings e são
 * apenas ecoadas; a aritmética de ST é da 4.3.
 */

import type { CatalogoVersaoResolvida } from './fiscal-normative-catalog.service';
import type { StVerificacaoStatus } from './st-verificacao';
import { stCenarioPodeSerHabilitado, stMotivoBloqueio } from './st-verificacao';

/**
 * Resultado do enquadramento de UM produto numa UF/competência (R3.1/R3.4). São
 * mutuamente exclusivos e cobrem todo o espaço de entrada:
 * - `SUJEITO`: a fonte está verificada (142/2018 + estadual) E há regra aprovada
 *   e vigente para o CEST que classifica o produto como sujeito à ST. Só neste
 *   estado o cálculo (4.3) pode prosseguir como guia definitiva.
 * - `NAO_SUJEITO`: fonte verificada E regra aprovada/vigente que classifica o
 *   produto como NÃO sujeito à ST na UF/competência (exclusão expressa). É uma
 *   decisão definitiva "não há ST" — distinta de pendência: aqui a norma diz que
 *   o produto não entra na ST.
 * - `PENDENCIA`: a fonte está verificada, mas a REGRA do CEST está ausente ou
 *   vigente-porém-não-aprovada. Não se presume enquadramento sem regra aprovada
 *   (R3.1); fica pendente até a regra entrar/ser aprovada. Nunca vira guia.
 * - `BLOQUEADO`: a FONTE do cenário não está verificada (portão 4.1). O cenário
 *   não é suportado; bloqueio explicável (R3.4). Precede o portão de regra.
 */
export type StEnquadramentoStatus =
  | 'SUJEITO'
  | 'NAO_SUJEITO'
  | 'PENDENCIA'
  | 'BLOQUEADO';

/**
 * Identificação do produto a enquadrar. O CEST é a CHAVE do catálogo `ST_FCP`
 * (coerente com o `chave` de `fiscal_regras_versoes` — CEST/natureza), por isso
 * é obrigatório para o enquadramento definitivo: sem CEST não há como resolver a
 * regra, e o resultado é pendência. O NCM é carregado para a memória/auditoria e
 * para distinguir produtos com mesmo CEST, mas não é a chave de resolução.
 */
export interface StProduto {
  // CEST (Código Especificador da Substituição Tributária). Chave do catálogo.
  // 7 dígitos (com ou sem pontuação); normalizado para dígitos aqui.
  cest?: string | null;
  // NCM do produto (8 dígitos), para auditoria/memória. Não é a chave.
  ncm?: string | null;
}

/**
 * Regra de ST resolvida do catálogo `ST_FCP` para um CEST/UF/competência. É o
 * `conteudo` de `fiscal_regras_versoes` já tipado para o enquadramento. Decimais
 * (MVA/alíquotas) permanecem strings e aqui são apenas ecoados — o cálculo é da
 * 4.3. A AUSÊNCIA desta regra (null no chamador) gera `PENDENCIA`.
 */
export interface StRegraEnquadramento {
  // CEST ao qual a regra se aplica (ecoado; o chamador já resolveu por ele).
  cest: string;
  // Verdadeiro quando a norma institui ST para o CEST na UF/competência; falso
  // quando a norma o EXCLUI expressamente da ST. É o eixo da decisão sujeito/
  // não-sujeito. Nunca presumido: vem da regra do catálogo.
  sujeitoAst: boolean;
  // MVA/IVA-ST aplicável (string decimal), quando a regra o traz. Apenas ecoado
  // aqui para a memória; o uso aritmético é da 4.3. Opcional.
  mva?: string | null;
  // Alíquota de FCP-ST da UF, quando instituída (string decimal). Apenas ecoada;
  // a 4.3/4.5 trata o FCP sem transformá-lo em ajuste genérico. Opcional.
  aliquotaFcp?: string | null;
}

/**
 * Entrada do enquadramento de UM item: o produto (CEST/NCM), a UF de destino, a
 * competência (vigência), a VERSÃO do catálogo `ST_FCP` resolvida (fonte/hash/
 * vigência), a REGRA do CEST resolvida (ou null), e o STATUS DE VERIFICAÇÃO do
 * cenário vindo de 4.1 (`verificarCenarioSt`). Tudo já resolvido pelo chamador;
 * este módulo não consulta banco.
 */
export interface StEnquadramentoInput {
  produto: StProduto;
  // UF de destino (sigla de 2 letras), eixo de seleção/enquadramento. Ecoada.
  uf: string;
  // Competência mensal 'YYYY-MM', eixo de vigência. Ecoada.
  competencia: string;
  // Status de verificação da FONTE do cenário (4.1). O portão nacional+estadual.
  // Qualquer valor diferente de `VERIFICADO` bloqueia o enquadramento.
  verificacao: StVerificacaoStatus;
  // Versão de catálogo `ST_FCP` resolvida por competência (fonte/hash/vigência),
  // ou null quando não há versão vigente. Alimenta a fonte do resultado.
  catalogo: CatalogoVersaoResolvida | null;
  // Regra do CEST resolvida por competência (ou null quando ausente). Quando
  // presente mas de versão não aprovada, o enquadramento fica em pendência.
  regra: StRegraEnquadramento | null;
  // Aprovação da regra: só `true` (versão de catálogo aprovada) autoriza um
  // enquadramento definitivo (SUJEITO/NAO_SUJEITO). Espelha `opcoes.aprovada`
  // do DIFAL/PIS-COFINS. Default false (pendência).
  regraAprovada?: boolean;
}

/**
 * Resultado do enquadramento. Expõe os eixos (produto, UF, competência), o
 * status, se o cálculo pode prosseguir, a fonte do catálogo (para a conciliação
 * de 4.6) e uma memória textual auditável que CITA o portão que decidiu — a base
 * do bloqueio explicável (R3.4) e da "fonte" exigida por R3.5.
 */
export interface StEnquadramentoResultado {
  cest: string | null;
  ncm: string | null;
  uf: string;
  competencia: string;
  status: StEnquadramentoStatus;
  // Verdadeiro só em `SUJEITO`: a fonte está verificada E a regra aprovada diz
  // que o produto é sujeito à ST. Único estado em que o cálculo (4.3) prossegue
  // como guia definitiva. `NAO_SUJEITO` é definitivo mas não há o que calcular.
  habilitadoParaCalculo: boolean;
  // Fonte normativa resolvida do catálogo `ST_FCP` (texto + URL + hash), para o
  // registro/conciliação da fonte (R3.5). Null quando não há versão resolvida.
  fonte: string | null;
  fonteUrl: string | null;
  hashConteudo: string | null;
  // MVA/FCP ecoados da regra (strings), quando aplicáveis. Apenas transportados
  // para a 4.3; nunca usados em aritmética aqui.
  mva: string | null;
  aliquotaFcp: string | null;
  // Memória textual auditável do enquadramento (sempre preenchida).
  memoria: string;
}

/**
 * ENQUADRA um produto na ST por produto/CEST/UF/competência (tarefa 4.2 —
 * R3.1).
 *
 * Ordem de decisão (determinística, do portão mais básico ao mais específico):
 *   1. PORTÃO DE VERIFICAÇÃO (4.1): se o cenário NÃO está `VERIFICADO`
 *      (`stCenarioPodeSerHabilitado`), o enquadramento é `BLOQUEADO` com o
 *      motivo de 4.1 (`stMotivoBloqueio`). Precede tudo: sem fonte verificada
 *      não se enquadra nada. (R3.4)
 *   2. PORTÃO DE CEST: fonte verificada, mas sem CEST no produto → `PENDENCIA`.
 *      O CEST é a chave do catálogo; sem ele não há como resolver a regra.
 *   3. PORTÃO DE REGRA (Task 1): sem regra do CEST, ou regra de versão NÃO
 *      aprovada → `PENDENCIA`. Não se presume enquadramento sem regra aprovada.
 *   4. REGRA APROVADA: `sujeitoAst === true` → `SUJEITO` (cálculo prossegue);
 *      `false` → `NAO_SUJEITO` (exclusão expressa, decisão definitiva).
 */
export function enquadrarSt(
  input: StEnquadramentoInput,
): StEnquadramentoResultado {
  const uf = normalizarUf(input.uf);
  const cest = normalizarCest(input.produto?.cest);
  const ncm = normalizarNcm(input.produto?.ncm);
  const base = {
    cest,
    ncm,
    uf,
    competencia: input.competencia,
    fonte: input.catalogo?.fonte ?? null,
    fonteUrl: input.catalogo?.fonteUrl ?? null,
    hashConteudo: input.catalogo?.hashConteudo ?? null,
    mva: naoVazio(input.regra?.mva) ?? null,
    aliquotaFcp: naoVazio(input.regra?.aliquotaFcp) ?? null,
  };

  // 1. PORTÃO DE VERIFICAÇÃO (4.1): fonte do cenário não verificada → bloqueio
  //    explicável. Reaproveita a MESMA guarda/motivo de 4.1 para não duplicar a
  //    regra: todo caminho de ST decide a habilitação no mesmo lugar.
  if (!stCenarioPodeSerHabilitado(input.verificacao)) {
    const motivo = stMotivoBloqueio(input.verificacao);
    return {
      ...base,
      status: 'BLOQUEADO',
      habilitadoParaCalculo: false,
      memoria:
        `ST ${uf} (${input.competencia}) CEST ${cest ?? '—'}: cenário ` +
        `BLOQUEADO — fonte não verificada (4.1, status ${input.verificacao}). ` +
        (motivo ?? '') +
        ' Enquadramento não produzido; nunca gera guia (R3.4).',
    };
  }

  // 2. PORTÃO DE CEST: sem a chave do catálogo não há como resolver a regra.
  if (cest == null) {
    return {
      ...base,
      status: 'PENDENCIA',
      habilitadoParaCalculo: false,
      memoria:
        `ST ${uf} (${input.competencia}): produto sem CEST (NCM ${ncm ?? '—'}). ` +
        'O CEST é a chave do catálogo ST_FCP; sem ele o enquadramento não pode ' +
        'ser resolvido. PENDÊNCIA (R3.1): nunca gera guia.',
    };
  }

  // 3. PORTÃO DE REGRA: regra ausente, ou presente mas de versão não aprovada →
  //    pendência. Não se presume que o produto é/não é ST sem regra aprovada.
  const regraAprovada = input.regraAprovada === true;
  if (!input.regra || !regraAprovada) {
    const motivoRegra = !input.regra
      ? 'sem regra de enquadramento vigente para o CEST na competência'
      : 'regra do CEST vigente porém NÃO aprovada (versão de catálogo pendente)';
    return {
      ...base,
      status: 'PENDENCIA',
      habilitadoParaCalculo: false,
      memoria:
        `ST ${uf} (${input.competencia}) CEST ${cest}: fonte verificada, porém ` +
        `${motivoRegra}. Enquadramento não presumido (R3.1): PENDÊNCIA até a ` +
        'regra aprovada entrar; nunca gera guia.',
    };
  }

  // 4. REGRA APROVADA: a norma diz se o CEST é ou não sujeito à ST.
  if (!input.regra.sujeitoAst) {
    return {
      ...base,
      status: 'NAO_SUJEITO',
      habilitadoParaCalculo: false,
      memoria:
        `ST ${uf} (${input.competencia}) CEST ${cest}: fonte verificada e regra ` +
        'aprovada EXCLUINDO o produto da ST na UF/competência. NAO_SUJEITO ' +
        '(decisão definitiva): não há ST a calcular para este item.',
    };
  }

  return {
    ...base,
    status: 'SUJEITO',
    habilitadoParaCalculo: true,
    memoria:
      `ST ${uf} (${input.competencia}) CEST ${cest}: fonte verificada em duas ` +
      `camadas (4.1) e regra aprovada classificando o produto como SUJEITO à ST` +
      (base.mva != null ? `, MVA ${base.mva}` : '') +
      (base.aliquotaFcp != null ? `, FCP ${base.aliquotaFcp}` : '') +
      '. Habilitado para o cálculo de ST (4.3) como guia definitiva (R3.1/R3.5).',
  };
}

/**
 * GUARDA DE HABILITAÇÃO DE CÁLCULO DE ST A PARTIR DO ENQUADRAMENTO (4.2 —
 * R3.4).
 *
 * Único ponto de decisão sobre "este enquadramento autoriza o cálculo de ST
 * (4.3)?". SIM apenas quando o status é `SUJEITO`: fonte verificada E regra
 * aprovada dizendo que o produto entra na ST. `NAO_SUJEITO` é definitivo mas não
 * há o que calcular; `PENDENCIA`/`BLOQUEADO` nunca calculam. Espelha
 * `difalPodeGerarGuia`/`stCenarioPodeSerHabilitado`: isolar a condição garante
 * que o cálculo (4.3) e os registros (4.4) consultem a MESMA regra.
 */
export function stEnquadramentoHabilitaCalculo(
  status: StEnquadramentoStatus,
): boolean {
  return status === 'SUJEITO';
}

/**
 * Motivo textual auditável de por que um enquadramento NÃO habilita o cálculo
 * de ST (R3.4): o bloqueio/pendência EXPLICÁVEL da fase. `null` para `SUJEITO`
 * (não há recusa a explicar). Espelha `difalMotivoInelegibilidadeGuia`.
 */
export function stEnquadramentoMotivoInelegibilidade(
  status: StEnquadramentoStatus,
): string | null {
  switch (status) {
    case 'SUJEITO':
      return null;
    case 'NAO_SUJEITO':
      return (
        'ST NÃO APLICÁVEL: regra aprovada exclui o produto da ST na ' +
        'UF/competência. Não há imposto de ST a calcular para este item (R3.1).'
      );
    case 'PENDENCIA':
      return (
        'ST em PENDÊNCIA: fonte verificada, porém sem regra de enquadramento ' +
        'aprovada e vigente para o CEST (ou produto sem CEST). O enquadramento ' +
        'não é presumido; nenhum valor vira guia (R3.1).'
      );
    case 'BLOQUEADO':
      return (
        'ST BLOQUEADA: a fonte do cenário (Convênio ICMS 142/2018 + legislação ' +
        'estadual) não está verificada (4.1). Cenário não suportado (R3.4).'
      );
  }
}

// Normaliza o CEST para apenas dígitos; devolve `null` quando ausente/sem
// dígitos. O CEST oficial tem 7 dígitos (SS.NNN.NN); aceita com ou sem
// pontuação, mas não valida o comprimento aqui — a validação fina é do cadastro
// do catálogo. O importante é ter uma chave estável para casar com a regra.
function normalizarCest(cest: string | null | undefined): string | null {
  if (cest == null) return null;
  const digitos = cest.replace(/\D/g, '');
  return digitos === '' ? null : digitos;
}

// Normaliza o NCM para apenas dígitos (auditoria/memória). `null` quando ausente.
function normalizarNcm(ncm: string | null | undefined): string | null {
  if (ncm == null) return null;
  const digitos = ncm.replace(/\D/g, '');
  return digitos === '' ? null : digitos;
}

// Devolve a string quando ela não é nula/vazia; `null` caso contrário. Mantém
// os decimais como string e evita tratar '' como valor por engano.
function naoVazio(valor: string | null | undefined): string | null {
  if (valor == null) return null;
  const t = valor.trim();
  return t === '' ? null : t;
}

function normalizarUf(uf: string): string {
  return (uf ?? '').trim().toUpperCase();
}
