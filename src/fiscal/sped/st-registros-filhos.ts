/**
 * REGISTROS FILHOS DE ST/FCP — C191/C195/C197 e E112/E113 (Fase 4 / tarefa 4.4
 * — R3.3).
 *
 * As tarefas 4.1–4.3 entregaram a VERIFICAÇÃO da fonte, o ENQUADRAMENTO e o
 * CÁLCULO de ST com componentes SEPARADOS (`st-calculador.ts`:
 * `impostoProprio`, `baseSt`, `icmsStRetido`, `fcpSt`, ajustes tipados
 * RESTITUICAO/RESSARCIMENTO/COMPLEMENTO, e o status CALCULADO/SIMULACAO/
 * PENDENTE/BLOQUEADO + a guarda `stPodeGerarGuia`). Esta tarefa decide QUANDO os
 * registros filhos do SPED EFD ICMS/IPI são EXIGIDOS e os emite — e SÓ nos
 * cenários que de fato os exigem.
 *
 * R3.3 (requirements): "Os registros filhos C191/C195/C197, E112/E113 e demais
 * DEVEM ser planejados apenas nos cenários exigidos." design §ST/FCP:
 * "Registros filhos C191/C195/C197, E112/E113 planejados só nos cenários
 * exigidos." Este módulo é a materialização dessa regra: nada é emitido
 * incondicionalmente.
 *
 * O PRINCÍPIO (R3.6, escopo honesto): um registro que passa no regex NÃO
 * comprova validade normativa. Portanto, além de "o cenário exige?", aplica-se o
 * MESMO portão de guia dos cálculos: só resultados de ST que PODEM gerar guia
 * (`stPodeGerarGuia` → `CALCULADO`) produzem registros filhos DEFINITIVOS.
 * SIMULACAO/PENDENTE/BLOQUEADO não emitem registros definitivos — a decisão
 * devolve a lista de registros vazia e um MOTIVO auditável, espelhando o padrão
 * honesto de DIFAL/ST (`difalPodeGerarGuia`/`stPodeGerarGuia`). Isso evita um TXT
 * que "passa" sem validade normativa.
 *
 * CENÁRIOS EXIGIDOS, por registro:
 *   • C191 (filho do C190): só quando o grupo analítico (CST/CFOP/alíquota) tem
 *     ICMS-ST e/ou FCP-ST efetivo (base/valor > 0) produzido pelo cálculo de ST
 *     daquele grupo. Grupos SEM ST/FCP não emitem C191.
 *   • C195/C197 (filhos do C190): só quando há AJUSTE tipado do documento
 *     (restituição/ressarcimento/complemento) exigindo registro de outra
 *     obrigação/ajuste. O C195 (observação) só existe quando há ao menos um C197
 *     (ajuste) a abrigar; sem ajuste, nenhum dos dois é emitido.
 *   • E112/E113 (filhos do E111): só quando o ajuste da apuração (E111)
 *     referencia documento/informação adicional que os EXIGE — E112 quando há
 *     identificação do documento de arrecadação/processo do ajuste; E113 quando
 *     o ajuste é respaldado por documentos fiscais específicos a identificar.
 *     Um E111 que não referencia nada não emite E112/E113.
 *
 * PEÇA PURA, SEM BANCO E SEM `Number`: recebe os resultados de ST já calculados
 * (4.3), os grupos analíticos do C190 (`fiscal-c190-aggregator.ts`) e os ajustes
 * do E111, e decide/constrói os `SpedRecord` com os helpers do núcleo
 * (`createSpedRecord`, `decimalField`, `integerField`, `dateField`) e os
 * decimais em escala inteira via `sped-decimal`. Não totaliza ST num bolo único
 * (os componentes já vêm separados da 4.3). Pronta para ser costurada no
 * `efd-icms-ipi.builder.ts` quando o cenário for habilitado (4.5/4.6).
 */

import {
  createSpedRecord,
  dateField,
  decimalField,
  integerField,
  type SpedRecord,
} from './core';
import { fromScaledInteger, toScaledInteger } from './sped-decimal';
import type { StAjusteTipo, StCalculoStatus } from '../services/st-calculador';
import { stPodeGerarGuia } from '../services/st-calculador';

// ─────────────────────────────────────────────────────────────────────────────
// Resultado comum da decisão: os registros a emitir (vazio quando o cenário não
// exige OU quando o resultado de ST não habilita guia definitiva) e o motivo
// auditável quando nada foi emitido (R3.3/R3.6).
// ─────────────────────────────────────────────────────────────────────────────

export interface RegistrosFilhosDecisao {
  // Registros filhos a serem emitidos, na ordem hierárquica correta. Vazio
  // quando o cenário não exige o registro ou quando o resultado de ST não pode
  // gerar guia (SIMULACAO/PENDENTE/BLOQUEADO).
  registros: SpedRecord[];
  // Verdadeiro quando ALGUM registro definitivo foi emitido. Falso quando a
  // lista está vazia por não-exigência ou por inelegibilidade.
  exigido: boolean;
  // Motivo textual auditável quando nada foi emitido (null quando `exigido`).
  // Espelha o `motivo` de inelegibilidade dos cálculos (R3.6).
  motivo: string | null;
}

function naoExigido(motivo: string): RegistrosFilhosDecisao {
  return { registros: [], exigido: false, motivo };
}

function emitido(registros: SpedRecord[]): RegistrosFilhosDecisao {
  return { registros, exigido: true, motivo: null };
}

// Portão de guia comum (R3.6): só `CALCULADO` produz registros DEFINITIVOS.
// Reaproveita a MESMA guarda da 4.3 para não divergir — um registro só é
// normativamente válido quando o cálculo que o origina pode virar guia.
function guiaBloqueada(status: StCalculoStatus): string | null {
  if (stPodeGerarGuia(status)) return null;
  return (
    `resultado de ST em ${status}: não gera guia definitiva, portanto nenhum ` +
    'registro filho definitivo é emitido (R3.3/R3.6 — passar no regex não ' +
    'comprova validade normativa).'
  );
}

// Testa se um valor decimal (string) é estritamente positivo em escala
// monetária, sem passar por `Number`.
function positivo(valor: string | null | undefined, escala = 2): boolean {
  return toScaledInteger(valor ?? '0', escala) > 0n;
}

// ─────────────────────────────────────────────────────────────────────────────
// C191 — filho do C190: ICMS-ST / FCP-ST do grupo analítico (R3.3).
//
// Layout (Guia Prático EFD ICMS/IPI), campos após REG:
//   02 VL_FCPUFDEST    — parcela de FCP-ST do grupo
//   03 VL_ICMSUFDEST   — ICMS-ST devido à UF de destino do grupo
//   04 VL_ICMSUFREMET  — ICMS-ST da UF do remetente (0 quando não aplicável)
//
// Emitido SÓ quando o grupo (CST/CFOP/alíquota) tem ICMS-ST e/ou FCP-ST efetivo
// produzido pelo cálculo de ST (4.3). Grupos sem ST/FCP não emitem C191.
// ─────────────────────────────────────────────────────────────────────────────

export interface C191Entrada {
  // ICMS-ST retido do grupo (string decimal). Vem do `icmsStRetido` da 4.3,
  // AGREGADO para o grupo analítico (CST/CFOP/alíquota) do C190.
  icmsStRetido: string;
  // FCP-ST do grupo (string decimal, componente SEPARADO — nunca somado à ST).
  fcpSt: string;
  // ICMS-ST da UF do remetente, quando aplicável (partilha). '0.00' por padrão.
  icmsStRemetente?: string | null;
  // Status do cálculo de ST do grupo (R3.6): só CALCULADO emite C191 definitivo.
  status: StCalculoStatus;
}

/**
 * Decide e constrói o C191 de UM grupo analítico do C190 (R3.3). Emite SÓ quando
 * (a) o cálculo de ST do grupo é CALCULADO (pode gerar guia — R3.6) E (b) há
 * ICMS-ST ou FCP-ST efetivo (> 0). Caso contrário, não emite e explica o motivo.
 */
export function decidirC191(entrada: C191Entrada): RegistrosFilhosDecisao {
  const bloqueio = guiaBloqueada(entrada.status);
  if (bloqueio) return naoExigido(`C191 não emitido: ${bloqueio}`);

  const temSt = positivo(entrada.icmsStRetido);
  const temFcp = positivo(entrada.fcpSt);
  if (!temSt && !temFcp) {
    return naoExigido(
      'C191 não exigido: grupo analítico sem ICMS-ST nem FCP-ST efetivo ' +
        '(base/valor > 0). Registro filho não é emitido para grupos sem ST/FCP ' +
        '(R3.3).',
    );
  }

  return emitido([
    createSpedRecord(
      'C191',
      decimalField(normalizarDecimal(entrada.fcpSt)), // 02 VL_FCPUFDEST
      decimalField(normalizarDecimal(entrada.icmsStRetido)), // 03 VL_ICMSUFDEST
      decimalField(normalizarDecimal(entrada.icmsStRemetente ?? '0')), // 04 VL_ICMSUFREMET
    ),
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// C195/C197 — filhos do C190: observação + ajuste/outra obrigação (R3.3).
//
// C195 (observação do lançamento) campos após REG:
//   02 COD_OBS   — código da observação (0460)
//   03 TXT_COMPL — descrição complementar da observação
//
// C197 (outras obrigações/ajustes/informações do documento) campos após REG:
//   02 COD_AJ          — código do ajuste (tabela 5.3)
//   03 DESCR_COMPL_AJ  — descrição complementar do ajuste
//   04 COD_ITEM        — item do documento (opcional)
//   05 VL_BC_ICMS      — base de cálculo do ICMS
//   06 ALIQ_ICMS       — alíquota do ICMS
//   07 VL_ICMS         — valor do ICMS
//   08 VL_OUTROS       — outros valores
//
// Emitidos SÓ quando há AJUSTE tipado do documento (restituição/ressarcimento/
// complemento). O C195 só existe para abrigar ao menos um C197; sem ajuste,
// nenhum dos dois é emitido.
// ─────────────────────────────────────────────────────────────────────────────

export interface C197Ajuste {
  tipo: StAjusteTipo;
  // Código de ajuste da tabela estadual 5.3 (ex.: 'SP10000000'). Sem código
  // apurado, o ajuste não é emitido — não se inventa código (R3.6).
  codigoAjuste: string;
  descricao?: string | null;
  codigoItem?: string | null;
  valorBcIcms?: string | null;
  aliquotaIcms?: string | null;
  valorIcms?: string | null;
  // Valor do ajuste (VL_OUTROS) — restituição/ressarcimento/complemento.
  valor: string;
}

export interface C195C197Entrada {
  // Código da observação (0460) que o C195 referencia. Exigido para emitir o
  // C195 que abriga os C197; sem código não há observação válida (R3.6).
  codigoObservacao: string;
  textoObservacao?: string | null;
  // Ajustes do documento (do substituído), cada um TIPADO. O C195/C197 só
  // existem quando há ao menos um ajuste.
  ajustes: C197Ajuste[];
  // Status do cálculo de ST do documento (R3.6): só CALCULADO emite definitivo.
  status: StCalculoStatus;
}

/**
 * Decide e constrói o par C195 + C197 de um documento (R3.3). Emite SÓ quando
 * (a) o cálculo de ST do documento é CALCULADO (R3.6), (b) há ao menos um ajuste
 * tipado com código de ajuste apurado e (c) há código de observação. O C195 é
 * emitido uma vez e abriga todos os C197. Sem ajuste, não emite nada.
 */
export function decidirC195C197(
  entrada: C195C197Entrada,
): RegistrosFilhosDecisao {
  const bloqueio = guiaBloqueada(entrada.status);
  if (bloqueio) return naoExigido(`C195/C197 não emitido: ${bloqueio}`);

  // Só ajustes com código de ajuste efetivo entram — não se inventa código.
  const ajustes = entrada.ajustes.filter((a) => a.codigoAjuste.trim() !== '');
  if (ajustes.length === 0) {
    return naoExigido(
      'C195/C197 não exigido: documento sem ajuste de ST (restituição/' +
        'ressarcimento/complemento) com código apurado. Observação e ajuste ' +
        'não são emitidos por padrão (R3.3).',
    );
  }
  if (entrada.codigoObservacao.trim() === '') {
    return naoExigido(
      'C195/C197 não emitido: há ajuste de ST, porém sem código de observação ' +
        '(0460) para abrigar o C197. Não se inventa observação (R3.6).',
    );
  }

  const registros: SpedRecord[] = [
    createSpedRecord(
      'C195',
      entrada.codigoObservacao, // 02 COD_OBS
      entrada.textoObservacao ?? null, // 03 TXT_COMPL
    ),
  ];
  for (const ajuste of ajustes) {
    registros.push(
      createSpedRecord(
        'C197',
        ajuste.codigoAjuste, // 02 COD_AJ
        ajuste.descricao ?? null, // 03 DESCR_COMPL_AJ
        ajuste.codigoItem ?? null, // 04 COD_ITEM
        ajuste.valorBcIcms != null // 05 VL_BC_ICMS
          ? decimalField(normalizarDecimal(ajuste.valorBcIcms))
          : null,
        ajuste.aliquotaIcms != null // 06 ALIQ_ICMS
          ? decimalField(normalizarDecimal(ajuste.aliquotaIcms, 4))
          : null,
        ajuste.valorIcms != null // 07 VL_ICMS
          ? decimalField(normalizarDecimal(ajuste.valorIcms))
          : null,
        decimalField(normalizarDecimal(ajuste.valor)), // 08 VL_OUTROS
      ),
    );
  }
  return emitido(registros);
}

// ─────────────────────────────────────────────────────────────────────────────
// E112/E113 — filhos do E111: informações adicionais e documentos do ajuste da
// apuração do ICMS (R3.3).
//
// E112 (informações adicionais do ajuste) campos após REG:
//   02 NUM_DA    — número do documento de arrecadação (opcional)
//   03 NUM_PROC  — número do processo (opcional)
//   04 IND_PROC  — origem do processo
//   05 PROC      — descrição do processo
//   06 TXT_COMPL — descrição complementar
//
// E113 (identificação dos documentos fiscais do ajuste) campos após REG:
//   02 COD_PART  — participante (0150)
//   03 COD_MOD   — modelo do documento
//   04 SER       — série
//   05 SUB       — subsérie
//   06 NUM_DOC   — número do documento
//   07 DT_DOC    — data do documento
//   08 COD_ITEM  — item do documento (opcional)
//   09 VL_AJ_ITEM— valor do ajuste do item/documento
//   10 CHV_DOCe  — chave do documento eletrônico (opcional)
//
// Emitidos SÓ quando o ajuste da apuração (E111) referencia documento/processo
// (E112) ou documentos fiscais (E113). Um E111 que não referencia nada não emite
// nenhum dos dois.
// ─────────────────────────────────────────────────────────────────────────────

export interface E112Entrada {
  numeroDocumentoArrecadacao?: string | null;
  numeroProcesso?: string | null;
  // Origem do processo (IND_PROC): '0' SEFAZ, '1' Justiça Federal, '2' Justiça
  // Estadual, '9' outros. Exigido quando há número de processo.
  indicadorOrigemProcesso?: string | null;
  descricaoProcesso?: string | null;
  textoComplementar?: string | null;
}

export interface E113Documento {
  participanteCodigo: string;
  codigoModelo: string;
  serie?: string | null;
  subserie?: string | null;
  numeroDocumento: string;
  dataDocumento: Date;
  codigoItem?: string | null;
  valorAjusteItem: string;
  chaveEletronica?: string | null;
}

export interface E112E113Entrada {
  // Informações adicionais do ajuste (E112). Ausente/vazio quando o ajuste não
  // tem documento de arrecadação/processo a identificar.
  informacoesAdicionais?: E112Entrada | null;
  // Documentos fiscais que respaldam o ajuste (E113). Vazio quando o ajuste não
  // é respaldado por documentos específicos.
  documentos?: E113Documento[] | null;
  // Status do cálculo de ST que originou o ajuste do E111 (R3.6): só CALCULADO
  // emite registros definitivos.
  status: StCalculoStatus;
}

// Verdadeiro quando o E112 tem ALGUM campo preenchido — do contrário não há
// informação adicional a registrar e o E112 não é exigido.
function e112TemConteudo(e112: E112Entrada | null | undefined): boolean {
  if (!e112) return false;
  return [
    e112.numeroDocumentoArrecadacao,
    e112.numeroProcesso,
    e112.indicadorOrigemProcesso,
    e112.descricaoProcesso,
    e112.textoComplementar,
  ].some((v) => v != null && v.trim() !== '');
}

/**
 * Decide e constrói os filhos do E111 (E112 e/ou E113) de UM ajuste da apuração
 * (R3.3). Emite SÓ quando (a) o cálculo de ST que originou o ajuste é CALCULADO
 * (R3.6) e (b) há informação adicional (E112) e/ou documentos (E113) a
 * identificar. Um E111 sem referências não emite E112/E113.
 */
export function decidirE112E113(
  entrada: E112E113Entrada,
): RegistrosFilhosDecisao {
  const bloqueio = guiaBloqueada(entrada.status);
  if (bloqueio) return naoExigido(`E112/E113 não emitido: ${bloqueio}`);

  const temE112 = e112TemConteudo(entrada.informacoesAdicionais);
  const documentos = entrada.documentos ?? [];
  const temE113 = documentos.length > 0;
  if (!temE112 && !temE113) {
    return naoExigido(
      'E112/E113 não exigido: o ajuste da apuração (E111) não referencia ' +
        'documento de arrecadação/processo nem documentos fiscais. Registros ' +
        'filhos não são emitidos para ajustes sem referência (R3.3).',
    );
  }

  const registros: SpedRecord[] = [];
  if (temE112) {
    const e112 = entrada.informacoesAdicionais!;
    registros.push(
      createSpedRecord(
        'E112',
        e112.numeroDocumentoArrecadacao ?? null, // 02 NUM_DA
        e112.numeroProcesso ?? null, // 03 NUM_PROC
        e112.indicadorOrigemProcesso ?? null, // 04 IND_PROC
        e112.descricaoProcesso ?? null, // 05 PROC
        e112.textoComplementar ?? null, // 06 TXT_COMPL
      ),
    );
  }
  for (const doc of documentos) {
    registros.push(
      createSpedRecord(
        'E113',
        doc.participanteCodigo, // 02 COD_PART
        doc.codigoModelo, // 03 COD_MOD
        doc.serie ?? null, // 04 SER
        doc.subserie ?? null, // 05 SUB
        doc.numeroDocumento, // 06 NUM_DOC
        dateField(doc.dataDocumento), // 07 DT_DOC
        doc.codigoItem ?? null, // 08 COD_ITEM
        decimalField(normalizarDecimal(doc.valorAjusteItem)), // 09 VL_AJ_ITEM
        doc.chaveEletronica ?? null, // 10 CHV_DOCe
      ),
    );
  }
  return emitido(registros);
}

// Normaliza um decimal (string) via escala inteira e de volta a string, para
// que o campo emitido seja canônico (ex.: '18' → '18.00') sem passar por
// `Number`. A escala monetária é 2; alíquotas usam 4.
function normalizarDecimal(valor: string, escala = 2): string {
  return fromScaledInteger(toScaledInteger(valor, escala), escala);
}
