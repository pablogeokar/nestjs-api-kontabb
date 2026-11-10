import {
  fromScaledInteger,
  positive,
  toScaledInteger,
} from '../sped/sped-decimal';
import type { RegraVersaoResolvida } from './fiscal-normative-catalog.service';

export const CFOP_ANTECIPACAO_PARCIAL_BA = '2102';

const CEM = 1_000_000n;
const ICMS_CST_ST = new Set(['10', '30', '60', '70']);
const ICMS_CSOSN_ST = new Set(['201', '202', '203', '500']);

export interface ParametrosAntecipacaoParcial {
  baseCalculo: string;
  aliquotaInterna: string;
  deducaoOrigem?: string;
  aliquotaInterestadual?: string;
  percentualReducao?: string;
}

export function calcularAntecipacaoParcial(
  input: ParametrosAntecipacaoParcial,
) {
  const base = toScaledInteger(input.baseCalculo);
  const aliquotaInterna = toScaledInteger(input.aliquotaInterna, 4);
  const interestadual =
    input.aliquotaInterestadual == null
      ? null
      : toScaledInteger(input.aliquotaInterestadual, 4);
  const icmsInterno = aplicarPercentual(base, aliquotaInterna);
  const deducao =
    interestadual == null
      ? toScaledInteger(input.deducaoOrigem)
      : aplicarPercentual(base, interestadual);
  const impostoApurado =
    interestadual == null
      ? positive(icmsInterno - deducao)
      : aplicarPercentual(base, positive(aliquotaInterna - interestadual));
  const reducao = aplicarPercentual(
    impostoApurado,
    toScaledInteger(input.percentualReducao, 4),
  );

  return {
    base_calculo: fromScaledInteger(base),
    aliquota_interna: fromScaledInteger(aliquotaInterna, 4),
    aliquota_interestadual:
      interestadual == null ? null : fromScaledInteger(interestadual, 4),
    icms_interno: fromScaledInteger(icmsInterno),
    deducao_origem: fromScaledInteger(deducao),
    imposto_apurado: fromScaledInteger(impostoApurado),
    reducao: fromScaledInteger(reducao),
    valor_antecipacao: fromScaledInteger(impostoApurado - reducao),
  };
}

interface ItemAntecipacaoParcial {
  documentoFiscalId: string;
  numeroDocumento: string;
  competenciaEmissao: string;
  itemId: string;
  numeroItem: number;
  ncm: string | null;
  cest: string | null;
  emitenteUf: string | null;
  origemMercadoria: string | null;
  cstIcms: string | null;
  csosnIcms: string | null;
  valorBrutoProduto: string | null;
  valorFrete: string | null;
  valorSeguro: string | null;
  valorOutrasDespesas: string | null;
  valorDesconto: string | null;
  valorIpi: string | null;
  aliquotaIcms: string | null;
  valorIcms: string | null;
  valorIcmsSt: string | null;
  valorIcmsStRetido: string | null;
}

export function apurarItemAntecipacaoParcial(
  item: ItemAntecipacaoParcial,
  regime: string | null,
  regra: RegraVersaoResolvida | null,
) {
  const valorOperacao =
    toScaledInteger(item.valorBrutoProduto) +
    toScaledInteger(item.valorFrete) +
    toScaledInteger(item.valorSeguro) +
    toScaledInteger(item.valorOutrasDespesas) -
    toScaledInteger(item.valorDesconto);

  const identificacao = {
    documento_fiscal_id: item.documentoFiscalId,
    numero_documento: item.numeroDocumento,
    competencia_emissao: item.competenciaEmissao,
    item_id: item.itemId,
    numero_item: item.numeroItem,
    uf_origem: item.emitenteUf,
    ncm: item.ncm,
    cest: item.cest,
    valor_operacao: fromScaledInteger(valorOperacao),
  };

  function pendente(motivo: string) {
    return {
      ...identificacao,
      situacao: 'PENDENTE' as const,
      motivo,
      calculo: null,
    };
  }

  if (
    ICMS_CST_ST.has(item.cstIcms?.slice(-2) ?? '') ||
    ICMS_CSOSN_ST.has(item.csosnIcms ?? '') ||
    toScaledInteger(item.valorIcmsSt) > 0n ||
    toScaledInteger(item.valorIcmsStRetido) > 0n
  ) {
    return {
      ...identificacao,
      situacao: 'ICMS_ST' as const,
      motivo:
        'O XML indica ICMS-ST. Confira o recolhimento pela hipótese de substituição tributária.',
      calculo: null,
    };
  }

  if (
    !regra ||
    !item.emitenteUf ||
    !regime ||
    !/^\d{8}$/.test(item.ncm ?? '')
  ) {
    return pendente(
      'Confira o enquadramento por produto e regime. É necessária uma regra vigente aplicável ao item.',
    );
  }

  const enquadramentos = regra.conteudo.enquadramentos;
  const aplicaveis = Array.isArray(enquadramentos)
    ? enquadramentos.filter(
        (e: unknown): e is Record<string, unknown> =>
          typeof e === 'object' &&
          e !== null &&
          'regime' in e &&
          e.regime === regime &&
          'ncm' in e &&
          e.ncm === item.ncm &&
          'cest' in e &&
          e.cest === item.cest &&
          (!('uf_origem' in e) || e.uf_origem === item.emitenteUf) &&
          (!('origem_mercadoria' in e) ||
            e.origem_mercadoria === item.origemMercadoria),
      )
    : [];
  const [enquadramento] = aplicaveis;
  if (aplicaveis.length !== 1) {
    return pendente(
      'Confira o enquadramento por produto e regime. É necessária uma regra vigente aplicável ao item.',
    );
  }

  if (
    enquadramento.tratamento === 'DISPENSADO' ||
    enquadramento.tratamento === 'ICMS_ST'
  ) {
    return regra.escopoAprovado
      ? {
          ...identificacao,
          situacao: enquadramento.tratamento,
          motivo: regra.fonte,
          calculo: null,
        }
      : pendente('O enquadramento ainda aguarda homologação.');
  }

  if (
    enquadramento.tratamento !== 'APLICAVEL' ||
    !percentualValido(enquadramento.aliquota_interna)
  ) {
    return pendente('O enquadramento tem parâmetros de cálculo incompletos.');
  }

  if (
    valorOperacao <= 0n ||
    item.valorBrutoProduto == null ||
    toScaledInteger(item.valorIpi) !== 0n
  ) {
    return pendente(
      'Confira a base de cálculo da operação e o tratamento do IPI.',
    );
  }

  const simples = regime === 'SIMPLES_NACIONAL';
  const aliquotaDaRegra =
    enquadramento.uf_origem === item.emitenteUf &&
    item.origemMercadoria != null &&
    enquadramento.origem_mercadoria === item.origemMercadoria
      ? enquadramento.aliquota_interestadual
      : undefined;
  const aliquotaOrigem = aliquotaDaRegra ?? item.aliquotaIcms;
  const aliquotaInterestadual =
    simples && percentualValido(aliquotaOrigem) ? aliquotaOrigem : undefined;
  const deducaoOrigem =
    !simples && item.valorIcms != null && toScaledInteger(item.valorIcms) >= 0n
      ? item.valorIcms
      : undefined;
  if (aliquotaInterestadual == null && deducaoOrigem == null) {
    return pendente(
      'Confira a alíquota interestadual aplicável ou o ICMS de origem, conforme o regime.',
    );
  }

  return {
    ...identificacao,
    situacao: regra.escopoAprovado
      ? ('CALCULADO' as const)
      : ('SIMULACAO' as const),
    motivo: regra.fonte,
    calculo: calcularAntecipacaoParcial({
      baseCalculo: identificacao.valor_operacao,
      aliquotaInterna: enquadramento.aliquota_interna,
      deducaoOrigem,
      aliquotaInterestadual,
    }),
  };
}

function aplicarPercentual(base: bigint, aliquota: bigint) {
  return (base * aliquota + CEM / 2n) / CEM;
}

function percentualValido(valor: unknown): valor is string {
  return (
    typeof valor === 'string' &&
    /^\d{1,2}(?:\.\d{1,4})?$/.test(valor) &&
    toScaledInteger(valor, 4) > 0n
  );
}
