// Validações puras da criação de guia (ICMS nacional, P0 / A1).
//
// Nada aqui consulta banco. O serviço carrega o fechamento e delega a estas
// funções a decisão de elegibilidade, para que o vínculo guia ↔ apuração seja
// verificado contra a obrigação registrada, nunca contra o que o cliente HTTP
// afirma.

import type { TributoGuia } from './fiscal-guias.service';

/** As 27 UFs (26 estados + Distrito Federal). */
export const UFS_BRASIL: ReadonlySet<string> = new Set([
  'AC',
  'AL',
  'AM',
  'AP',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MG',
  'MS',
  'MT',
  'PA',
  'PB',
  'PE',
  'PI',
  'PR',
  'RJ',
  'RN',
  'RO',
  'RR',
  'RS',
  'SC',
  'SE',
  'SP',
  'TO',
]);

export function ufValida(uf: string): boolean {
  return UFS_BRASIL.has(uf.trim().toUpperCase());
}

/** `true` apenas para uma data de calendário real no formato AAAA-MM-DD. */
export function dataCalendarioValida(valor: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
  if (!m) return false;
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (ano < 2000 || ano > 2100) return false;
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return (
    d.getUTCFullYear() === ano &&
    d.getUTCMonth() === mes - 1 &&
    d.getUTCDate() === dia
  );
}

/**
 * Obrigações de fechamento que podem originar cada tributo. Um fechamento de
 * outra obrigação (ex.: DAS para guia de ICMS-ST) não demonstra a obrigação.
 */
const OBRIGACOES_POR_TRIBUTO: Readonly<Record<TributoGuia, readonly string[]>> =
  {
    ICMS_PROPRIO: ['EFD_ICMS_IPI', 'GIA', 'DAPI'],
    ICMS_ST: ['EFD_ICMS_IPI', 'GIA', 'DAPI'],
    DIFAL_ENTRADA: ['EFD_ICMS_IPI', 'GIA', 'DAPI'],
    DIFAL_SAIDA: ['EFD_ICMS_IPI', 'GIA', 'DAPI'],
    FCP: ['EFD_ICMS_IPI', 'GIA', 'DAPI'],
    IPI: ['EFD_ICMS_IPI'],
    PIS: ['EFD_CONTRIBUICOES'],
    COFINS: ['EFD_CONTRIBUICOES'],
    DAS_SIMPLES: ['DAS'],
  };

export interface FechamentoParaGuia {
  id: string;
  clienteId: string;
  obrigacao: string;
  /** `YYYY-MM-01` (coluna date). */
  competencia: string;
  estado: string;
  corrente: boolean;
}

/**
 * Retorna a mensagem de recusa, ou `null` quando o fechamento sustenta a guia.
 * Exige estado FECHADO e corrente (versão retificada substitui a anterior),
 * mesmo cliente, competência igual e obrigação compatível com o tributo.
 */
export function motivoFechamentoInelegivelParaGuia(
  fechamento: FechamentoParaGuia,
  guia: { clienteId: string; competencia: string; tributo: TributoGuia },
): string | null {
  if (fechamento.clienteId !== guia.clienteId) {
    return 'O fechamento pertence a outro estabelecimento.';
  }
  if (fechamento.estado !== 'FECHADO') {
    return (
      `O fechamento está em ${fechamento.estado}; só uma apuração FECHADA ` +
      'pode originar guia.'
    );
  }
  if (!fechamento.corrente) {
    return (
      'O fechamento não é a versão corrente. Use a versão vigente da ' +
      'apuração para evitar guia sobre versão substituída.'
    );
  }
  if (fechamento.competencia.slice(0, 7) !== guia.competencia.slice(0, 7)) {
    return (
      `A competência da guia (${guia.competencia.slice(0, 7)}) difere da do ` +
      `fechamento (${fechamento.competencia.slice(0, 7)}).`
    );
  }
  if (!OBRIGACOES_POR_TRIBUTO[guia.tributo].includes(fechamento.obrigacao)) {
    return (
      `O fechamento de ${fechamento.obrigacao} não origina guia de ` +
      `${guia.tributo}.`
    );
  }
  return null;
}
