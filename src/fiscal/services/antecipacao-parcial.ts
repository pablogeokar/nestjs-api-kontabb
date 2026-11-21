import {
  fromScaledInteger,
  positive,
  toScaledInteger,
} from '../sped/sped-decimal';
import type { RegraVersaoResolvida } from './fiscal-normative-catalog.service';

export const CFOP_ANTECIPACAO_PARCIAL = '2102';
/** @deprecated use CFOP_ANTECIPACAO_PARCIAL; o CFOP não é exclusivo da BA. */
export const CFOP_ANTECIPACAO_PARCIAL_BA = CFOP_ANTECIPACAO_PARCIAL;

const CEM = 1_000_000n;
const ICMS_CST_ST = new Set(['10', '30', '60', '70']);
const ICMS_CSOSN_ST = new Set(['201', '202', '203', '500']);

export interface ParametrosAntecipacaoParcial {
  baseCalculo: string;
  baseCalculoOrigem?: string;
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
  const baseOrigem =
    input.baseCalculoOrigem == null
      ? base
      : toScaledInteger(input.baseCalculoOrigem);
  const icmsInterno = aplicarPercentual(base, aliquotaInterna);
  const deducao =
    interestadual == null
      ? toScaledInteger(input.deducaoOrigem)
      : aplicarPercentual(baseOrigem, interestadual);
  const impostoApurado =
    interestadual == null || input.baseCalculoOrigem != null
      ? positive(icmsInterno - deducao)
      : aplicarPercentual(base, positive(aliquotaInterna - interestadual));
  const reducao = aplicarPercentual(
    impostoApurado,
    toScaledInteger(input.percentualReducao, 4),
  );

  return {
    base_calculo: fromScaledInteger(base),
    base_calculo_origem:
      input.baseCalculoOrigem == null ? null : fromScaledInteger(baseOrigem),
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
  dataFato?: string | null;
  serieDocumento?: string | null;
  chaveAcesso?: string | null;
  competenciaEmissao: string;
  itemId: string;
  numeroItem: number;
  cfop?: string | null;
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
  ufDestino = 'BA',
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
    data_fato: item.dataFato ?? null,
    serie_documento: item.serieDocumento ?? null,
    chave_acesso: item.chaveAcesso ?? null,
    competencia_emissao: item.competenciaEmissao,
    item_id: item.itemId,
    numero_item: item.numeroItem,
    cfop: item.cfop ?? null,
    regime_tributario: regime,
    origem_mercadoria: item.origemMercadoria,
    uf_origem: item.emitenteUf,
    ncm: item.ncm,
    cest: item.cest,
    valor_operacao: fromScaledInteger(valorOperacao),
    composicao_operacao: {
      produto: fromScaledInteger(toScaledInteger(item.valorBrutoProduto)),
      frete: fromScaledInteger(toScaledInteger(item.valorFrete)),
      seguro: fromScaledInteger(toScaledInteger(item.valorSeguro)),
      outras_despesas: fromScaledInteger(
        toScaledInteger(item.valorOutrasDespesas),
      ),
      desconto: fromScaledInteger(toScaledInteger(item.valorDesconto)),
    },
    valor_ipi: fromScaledInteger(toScaledInteger(item.valorIpi)),
  };

  function pendente(motivo: string) {
    return {
      ...identificacao,
      situacao: 'PENDENTE' as const,
      motivo,
      calculo: null,
    };
  }

  const sinalStXml =
    ICMS_CST_ST.has(item.cstIcms?.slice(-2) ?? '') ||
    ICMS_CSOSN_ST.has(item.csosnIcms ?? '') ||
    toScaledInteger(item.valorIcmsSt) > 0n ||
    toScaledInteger(item.valorIcmsStRetido) > 0n;

  if (!regra) {
    return pendente(
      sinalStXml
        ? 'O XML indica ICMS-ST, mas não há regra normativa vigente para confirmar o enquadramento. Confira a retenção e a obrigação de ST.'
        : `Não há regra normativa de Antecipação Parcial vigente para ${ufDestino} nesta competência. Corrigir o CFOP seleciona a operação, mas não define o tratamento tributário do produto.`,
    );
  }
  if (
    !item.emitenteUf ||
    item.emitenteUf === ufDestino ||
    !regime ||
    !/^\d{8}$/.test(item.ncm ?? '')
  ) {
    return pendente(
      'Confira a UF de origem, o regime tributário e o NCM de oito dígitos antes de calcular.',
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
  if (aplicaveis.length === 0) {
    return pendente(
      `A regra vigente não contém enquadramento para NCM ${item.ncm}, ` +
        `CEST ${item.cest ?? 'não informado'}, regime ${regime} e origem ${item.emitenteUf}.`,
    );
  }
  if (aplicaveis.length > 1) {
    return pendente(
      `Há ${aplicaveis.length} enquadramentos conflitantes para este NCM, CEST, regime e origem. Revise a regra normativa.`,
    );
  }

  const regraAplicada = {
    id: regra.id,
    chave: regra.chave,
    revisao: regra.revisao,
    fonte: regra.fonte,
    vigencia_inicio: regra.vigenciaInicio,
    vigencia_fim: regra.vigenciaFim,
    tratamento:
      typeof enquadramento.tratamento === 'string'
        ? enquadramento.tratamento
        : 'CONFERIR',
  };
  const pendenteComRegra = (motivo: string) => ({
    ...pendente(motivo),
    regra_aplicada: regraAplicada,
  });
  const enquadramentoAprovado =
    regra.escopoAprovado ||
    (enquadramento.confirmado_fiscalmente === true &&
      typeof enquadramento.fundamento === 'string' &&
      Boolean(enquadramento.fundamento.trim()) &&
      Boolean(regra.fonteUrl) &&
      (enquadramento.tratamento !== 'ICMS_ST' || Boolean(enquadramento.cest)));

  if (enquadramento.tratamento === 'CONFERIR') {
    return pendenteComRegra(
      typeof enquadramento.motivo === 'string' && enquadramento.motivo.trim()
        ? enquadramento.motivo
        : 'O enquadramento exige revisão fiscal antes do cálculo.',
    );
  }

  // O XML é evidência da tributação declarada pelo fornecedor, não substitui
  // a classificação fiscal aprovada para o produto e a operação.
  if (sinalStXml && enquadramento.tratamento !== 'ICMS_ST') {
    return pendenteComRegra(
      'O XML indica ICMS-ST, mas o enquadramento cadastrado diverge. Confira NCM, CEST e recolhimento antes de apurar.',
    );
  }
  if (enquadramento.tratamento === 'ICMS_ST' && !sinalStXml) {
    return pendenteComRegra(
      'A regra indica ICMS-ST, mas o XML não comprova retenção. Confira a responsabilidade pelo recolhimento.',
    );
  }

  if (
    enquadramento.tratamento === 'DISPENSADO' ||
    enquadramento.tratamento === 'ICMS_ST'
  ) {
    return enquadramentoAprovado
      ? {
          ...identificacao,
          situacao: enquadramento.tratamento,
          motivo:
            enquadramento.tratamento === 'ICMS_ST'
              ? `Regra homologada e XML indicam ICMS-ST (${regra.fonte}). Confira a retenção e o responsável pelo recolhimento.`
              : regra.fonte,
          calculo: null,
          regra_aplicada: regraAplicada,
        }
      : pendenteComRegra(
          'Este enquadramento ainda aguarda conferência e aprovação individual.',
        );
  }

  const aliquotaInterna = enquadramento.aliquota_interna;
  if (
    enquadramento.tratamento !== 'APLICAVEL' ||
    !percentualValido(aliquotaInterna)
  ) {
    return pendenteComRegra(
      'O enquadramento tem parâmetros de cálculo incompletos.',
    );
  }

  if (valorOperacao <= 0n || item.valorBrutoProduto == null)
    return pendenteComRegra('Confira a base de cálculo da operação.');
  const valorIpi = toScaledInteger(item.valorIpi);
  if (valorIpi < 0n)
    return pendenteComRegra(
      'O valor de IPI do XML é negativo; confira o documento.',
    );

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
    return pendenteComRegra(
      'Confira a alíquota interestadual aplicável ou o ICMS de origem, conforme o regime.',
    );
  }

  const reducao = reducaoMeEppDaRegra(regra.conteudo);
  if (reducao === 'INVALIDA') {
    return pendenteComRegra(
      'A regra vigente traz a redução para ME/EPP com parâmetros inválidos (percentual e fundamento).',
    );
  }
  const reducaoCondicionada =
    reducao != null && adquirenteMeEpp(regime) ? reducao : null;

  const calcularComBase = (base: bigint, percentualReducao?: string) =>
    calcularAntecipacaoParcial({
      baseCalculo: fromScaledInteger(base),
      baseCalculoOrigem:
        simples && base !== valorOperacao
          ? fromScaledInteger(valorOperacao)
          : undefined,
      aliquotaInterna,
      deducaoOrigem,
      aliquotaInterestadual,
      percentualReducao,
    });

  const ipiNaBase =
    enquadramento.ipi_na_base === 'INCLUIR' ||
    enquadramento.ipi_na_base === 'EXCLUIR'
      ? enquadramento.ipi_na_base
      : null;
  const fundamentoIpi =
    typeof enquadramento.fundamento_ipi === 'string' &&
    enquadramento.fundamento_ipi.trim()
      ? enquadramento.fundamento_ipi.trim()
      : null;
  if (valorIpi > 0n && (ipiNaBase == null || fundamentoIpi == null)) {
    return {
      ...identificacao,
      situacao: 'PENDENTE' as const,
      motivo:
        'O XML contém IPI. Defina e fundamente, na regra do item, se o IPI integra a base da antecipação (Lei 7.014/96, arts. 17, § 2º, e 23, III).',
      calculo: null,
      regra_aplicada: regraAplicada,
      cenarios_ipi: {
        sem_ipi: calcularComBase(valorOperacao),
        com_ipi: calcularComBase(valorOperacao + valorIpi),
      },
    };
  }

  const baseCalculo =
    valorIpi > 0n && ipiNaBase === 'INCLUIR'
      ? valorOperacao + valorIpi
      : valorOperacao;

  const calculo = calcularComBase(baseCalculo);
  const calculoComReducao = reducaoCondicionada
    ? calcularComBase(baseCalculo, reducaoCondicionada.percentual)
    : null;

  return {
    ...identificacao,
    situacao: enquadramentoAprovado
      ? ('CALCULADO' as const)
      : ('SIMULACAO' as const),
    motivo: regra.fonte,
    regra_aplicada: regraAplicada,
    tratamento_ipi: valorIpi > 0n ? ipiNaBase : null,
    fundamento_ipi: valorIpi > 0n ? fundamentoIpi : null,
    // Sem comprovação do recolhimento tempestivo, o total e a DeSTDA usam o
    // imposto integral. O benefício fica disponível como cenário condicionado.
    calculo,
    reducao_condicionada: reducaoCondicionada
      ? {
          percentual: reducaoCondicionada.percentual,
          fundamento: reducaoCondicionada.fundamento,
          condicao: reducaoCondicionada.condicao,
          valor_reducao: calculoComReducao!.reducao,
          valor_com_reducao: calculoComReducao!.valor_antecipacao,
        }
      : null,
  };
}

/**
 * Redução do imposto apurado concedida a ME/EPP, parametrizada na REGRA
 * (`conteudo.reducao_me_epp`), por exemplo RICMS-BA art. 274: 20% quando o
 * recolhimento ocorrer no prazo regulamentar. O motor não presume a redução:
 * sem o parâmetro na regra vigente, nada é reduzido.
 */
export interface ReducaoMeEpp {
  percentual: string;
  fundamento: string;
  condicao: string | null;
}

export function reducaoMeEppDaRegra(
  conteudo: Record<string, unknown> | undefined,
): ReducaoMeEpp | null | 'INVALIDA' {
  const bruto = conteudo?.reducao_me_epp;
  if (bruto == null) return null;
  if (typeof bruto !== 'object') return 'INVALIDA';
  const r = bruto as Record<string, unknown>;
  const percentual = r.percentual;
  const fundamento = r.fundamento;
  if (
    typeof percentual !== 'string' ||
    !/^\d{1,3}(?:\.\d{1,4})?$/.test(percentual) ||
    toScaledInteger(percentual, 4) <= 0n ||
    toScaledInteger(percentual, 4) > CEM ||
    typeof fundamento !== 'string' ||
    !fundamento.trim()
  ) {
    return 'INVALIDA';
  }
  return {
    percentual,
    fundamento: fundamento.trim(),
    condicao:
      typeof r.condicao === 'string' && r.condicao.trim()
        ? r.condicao.trim()
        : null,
  };
}

/**
 * Optante pelo Simples Nacional é necessariamente ME ou EPP (LC 123/06, art.
 * 3º). ME/EPP fora do Simples não é identificável pelo cadastro atual e não
 * recebe a redução (resultado conservador, sinalizado na memória).
 */
function adquirenteMeEpp(regime: string | null): boolean {
  return regime === 'SIMPLES_NACIONAL';
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
