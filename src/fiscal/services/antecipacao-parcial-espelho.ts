import { fromScaledInteger, toScaledInteger } from '../sped/sped-decimal';
import type { DifalEntradaService } from './difal-entrada.service';
import type {
  EspelhoMemoria,
  EspelhoNotaMemoria,
} from './espelho-recolhimento.pdf';

type Item = Awaited<
  ReturnType<DifalEntradaService['apurarCompetencia']>
>['antecipacao_parcial']['itens'][number];

/** Projeta a memória já produzida pelo motor; nunca executa uma segunda apuração. */
export function montarMemoriaAntecipacaoParcial(itens: Item[]): EspelhoMemoria {
  const notas = new Map<string, EspelhoNotaMemoria>();
  let valorIntegral = 0n;

  for (const item of itens) {
    let nota = notas.get(item.documento_fiscal_id);
    if (!nota) {
      nota = {
        id: item.documento_fiscal_id,
        numero: item.numero_documento,
        serie: item.serie_documento,
        chaveAcesso: item.chave_acesso,
        ufOrigem: item.uf_origem,
        itens: [],
      };
      notas.set(item.documento_fiscal_id, nota);
    }
    const calculo = item.situacao === 'CALCULADO' ? item.calculo : null;
    if (calculo) valorIntegral += toScaledInteger(calculo.imposto_apurado);
    const reducao =
      'reducao_condicionada' in item ? item.reducao_condicionada : null;
    const regra = 'regra_aplicada' in item ? item.regra_aplicada : null;
    const cenariosIpi = 'cenarios_ipi' in item ? item.cenarios_ipi : null;
    nota.itens.push({
      numero: item.numero_item,
      cfop: item.cfop,
      regimeTributario: item.regime_tributario,
      origemMercadoria: item.origem_mercadoria,
      ncm: item.ncm,
      cest: item.cest,
      situacao: item.situacao,
      motivo: item.motivo,
      valorOperacao: item.valor_operacao,
      composicaoOperacao: item.composicao_operacao
        ? {
            produto: item.composicao_operacao.produto,
            frete: item.composicao_operacao.frete,
            seguro: item.composicao_operacao.seguro,
            outrasDespesas: item.composicao_operacao.outras_despesas,
            desconto: item.composicao_operacao.desconto,
          }
        : null,
      valorIpi: item.valor_ipi,
      calculo: calculo
        ? {
            baseCalculo: calculo.base_calculo,
            baseCalculoOrigem: calculo.base_calculo_origem,
            aliquotaInterna: calculo.aliquota_interna,
            aliquotaInterestadual: calculo.aliquota_interestadual,
            icmsInterno: calculo.icms_interno,
            deducaoOrigem: calculo.deducao_origem,
            impostoIntegral: calculo.imposto_apurado,
          }
        : null,
      tratamentoIpi: 'tratamento_ipi' in item ? item.tratamento_ipi : null,
      fundamentoIpi: 'fundamento_ipi' in item ? item.fundamento_ipi : null,
      reducaoCondicionada: reducao
        ? {
            percentual: reducao.percentual,
            fundamento: reducao.fundamento,
            condicao: reducao.condicao,
            valorReducao: reducao.valor_reducao,
            valorComReducao: reducao.valor_com_reducao,
          }
        : null,
      regra: regra
        ? {
            chave: regra.chave,
            revisao: regra.revisao,
            fonte: regra.fonte,
            vigenciaInicio: regra.vigencia_inicio,
            vigenciaFim: regra.vigencia_fim,
            tratamento: regra.tratamento,
          }
        : null,
      cenariosIpi: cenariosIpi
        ? {
            semIpi: cenariosIpi.sem_ipi.valor_antecipacao,
            comIpi: cenariosIpi.com_ipi.valor_antecipacao,
          }
        : null,
    });
  }

  const lista = [...notas.values()];
  return {
    quantidadeNotas: lista.length,
    quantidadeNotasCalculadas: lista.filter((nota) =>
      nota.itens.some((item) => item.situacao === 'CALCULADO'),
    ).length,
    valorIntegralSemReducao20: fromScaledInteger(valorIntegral),
    notas: lista,
  };
}
