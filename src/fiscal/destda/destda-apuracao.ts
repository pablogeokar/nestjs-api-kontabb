import { toScaledInteger } from '../sped/sped-decimal';
import { DESTDA_UFS, type DestdaIndTpSt } from './destda-leiaute';
import type {
  Centavos,
  DestdaInconsistencia,
  DestdaLinhaConsumoFinal,
  DestdaLinhaEntrada,
  DestdaLinhaSt,
  DestdaTotais,
} from './destda.types';

/**
 * Premissa fiscal (a confirmar com o usuário): os valores de FCP destacados
 * junto ao ICMS (FCP-ST na substituição, FCP UF destino no DIFAL de venda e FCP
 * no DIFAL de entrada) integram o valor a declarar, porque o leiaute não possui
 * campo próprio e o contribuinte recolhe o fundo na mesma guia do imposto.
 */
export const DESTDA_INCLUI_FCP = true;

const UFS_VALIDAS = new Set<string>(DESTDA_UFS);

/** Devolução de compra (CFOPs 6.20x, 6.410 e 6.411): ST ali não é do contribuinte. */
const CFOPS_DEVOLUCAO_COM_ST = new Set(['6410', '6411']);

export interface DestdaItemSaida {
  documentoFiscalId: string;
  numeroDocumento: string;
  ufDestino: string | null;
  cfop: string;
  csosnIcms: string | null;
  cstIcms: string | null;
  valorIcmsSt: string | null;
  valorFcpSt: string | null;
  valorIcmsUfDest: string | null;
  valorFcpUfDest: string | null;
}

export interface DestdaEntradaDifalItem {
  cfop: string;
  hipotese: string | null;
  statusCalculo: string | null;
  recolhimentoProprio: string;
  valorDifal: string;
  valorFcp: string;
}

export interface DestdaAntecipacaoItem {
  situacao: string;
  valorAntecipacao: string | null;
}

export interface ResultadoApuracaoDestda {
  totais: DestdaTotais;
  inconsistencias: DestdaInconsistencia[];
}

/** CFOPs de combustíveis com ST em operação interestadual (6.651 a 6.667). */
export function isCfopCombustivel(cfop: string): boolean {
  if (!/^6\d{3}$/u.test(cfop)) return false;
  const codigo = Number(cfop);
  return codigo >= 6651 && codigo <= 6667;
}

export function isDevolucaoComSt(cfop: string): boolean {
  return cfop.startsWith('620') || CFOPS_DEVOLUCAO_COM_ST.has(cfop);
}

function valor(...partes: Array<string | null | undefined>): Centavos {
  return partes.reduce<Centavos>(
    (soma, parte) => soma + toScaledInteger(parte ?? '0'),
    0n,
  );
}

/**
 * Totaliza as saídas interestaduais do declarante:
 *  - G615 (venda a consumidor final, EC 87): ICMS UF destino (+ FCP UF destino);
 *  - G625 (ICMS-ST retido como substituto): ICMS-ST (+ FCP-ST).
 * Somente operações interestaduais entram, conforme a descrição dos campos do
 * leiaute ("operações interestaduais").
 */
export function apurarSaidasInterestaduais(
  itens: readonly DestdaItemSaida[],
  ufEmpresa: string,
): ResultadoApuracaoDestda {
  const consumoFinal = new Map<string, DestdaLinhaConsumoFinal>();
  const st = new Map<string, DestdaLinhaSt>();
  const inconsistencias: DestdaInconsistencia[] = [];
  const semUf = new Set<string>();

  for (const item of itens) {
    const difal = valor(
      item.valorIcmsUfDest,
      DESTDA_INCLUI_FCP ? item.valorFcpUfDest : null,
    );
    const retido = isDevolucaoComSt(item.cfop)
      ? 0n
      : valor(item.valorIcmsSt, DESTDA_INCLUI_FCP ? item.valorFcpSt : null);
    if (difal <= 0n && retido <= 0n) continue;

    const uf = item.ufDestino?.trim().toUpperCase() ?? '';
    if (!UFS_VALIDAS.has(uf)) {
      semUf.add(item.numeroDocumento);
      continue;
    }
    if (uf === ufEmpresa || uf === 'EX') continue;

    if (difal > 0n) {
      const atual = consumoFinal.get(uf) ?? { uf, totalNf: 0n, ajustes: 0n };
      atual.totalNf += difal;
      consumoFinal.set(uf, atual);
    }
    if (retido > 0n) {
      const indTpSt: DestdaIndTpSt = isCfopCombustivel(item.cfop) ? '3' : '0';
      const chave = `${uf}|${indTpSt}`;
      const atual = st.get(chave) ?? {
        indOper: '1' as const,
        indEmit: '0' as const,
        uf,
        indTpSt,
        totalNf: 0n,
        ajustes: 0n,
      };
      atual.totalNf += retido;
      st.set(chave, atual);
    }
  }

  if (semUf.size > 0) {
    inconsistencias.push({
      codigo: 'UF_DESTINO_AUSENTE',
      severidade: 'ERRO',
      mensagem: `Há ${semUf.size} documento(s) de saída com ICMS-ST ou DIFAL sem UF de destino válida: ${[...semUf].slice(0, 5).join(', ')}${semUf.size > 5 ? '…' : ''}.`,
      campo: 'destinatarioDados.uf',
    });
  }

  return {
    totais: {
      entradas: [],
      consumoFinal: [...consumoFinal.values()],
      st: [...st.values()],
    },
    inconsistencias,
  };
}

/**
 * Totaliza as entradas interestaduais (G605) a partir da apuração de DIFAL e
 * antecipação já existente no módulo fiscal. Qualquer item sem regra aprovada
 * (SIMULACAO/PENDENTE) impede a geração: declarar parcialmente o imposto seria
 * pior do que não declarar.
 */
export function apurarEntradasInterestaduais(input: {
  difal: readonly DestdaEntradaDifalItem[];
  antecipacao: readonly DestdaAntecipacaoItem[];
}): {
  entradas: DestdaLinhaEntrada[];
  inconsistencias: DestdaInconsistencia[];
} {
  const entradas = new Map<string, DestdaLinhaEntrada>();
  const inconsistencias: DestdaInconsistencia[] = [];
  let difalPendente = 0;
  let antecipacaoPendente = 0;

  for (const item of input.difal) {
    if (item.hipotese !== 'DIFAL_ENTRADA_CONTRIBUINTE') continue;
    if (item.statusCalculo !== 'CALCULADO') {
      difalPendente += 1;
      continue;
    }
    if (item.recolhimentoProprio !== 'SIM') continue;
    const total = valor(
      item.valorDifal,
      DESTDA_INCLUI_FCP ? item.valorFcp : null,
    );
    if (total <= 0n) continue;
    const indSit = item.cfop === '2551' ? '0' : '1';
    const atual = entradas.get(indSit) ?? {
      indSit,
      totalNf: 0n,
      ajustes: 0n,
    };
    atual.totalNf += total;
    entradas.set(indSit, atual);
  }

  for (const item of input.antecipacao) {
    if (item.situacao === 'PENDENTE' || item.situacao === 'SIMULACAO') {
      antecipacaoPendente += 1;
      continue;
    }
    if (item.situacao !== 'CALCULADO') continue;
    const total = valor(item.valorAntecipacao);
    if (total <= 0n) continue;
    // Antecipação parcial: o imposto é cobrado sem encerrar a fase de
    // tributação (a mercadoria segue tributada nas saídas).
    const atual = entradas.get('3') ?? {
      indSit: '3' as const,
      totalNf: 0n,
      ajustes: 0n,
    };
    atual.totalNf += total;
    entradas.set('3', atual);
  }

  if (difalPendente > 0) {
    inconsistencias.push({
      codigo: 'DIFAL_ENTRADA_PENDENTE',
      severidade: 'ERRO',
      mensagem: `${difalPendente} item(ns) de entrada interestadual com DIFAL sem regra aprovada (simulação ou pendência). Homologue a regra do estado antes de gerar a DeSTDA.`,
    });
  }
  if (antecipacaoPendente > 0) {
    inconsistencias.push({
      codigo: 'ANTECIPACAO_PENDENTE',
      severidade: 'ERRO',
      mensagem: `${antecipacaoPendente} item(ns) de entrada com antecipação sem enquadramento aprovado (simulação ou pendência). Resolva o enquadramento antes de gerar a DeSTDA.`,
    });
  }

  return { entradas: [...entradas.values()], inconsistencias };
}
