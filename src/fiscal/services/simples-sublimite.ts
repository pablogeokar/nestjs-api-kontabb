import { fromScaledInteger, toScaledInteger } from '../sped/sped-decimal';

export interface SublimiteInput {
  competencia: string;
  dataAberturaCnpj: string | null;
  sublimiteAnual: string;
  sublimiteAnoAnterior?: string;
  receitaAnoAnterior: string;
  receitaAnoCorrenteAntesPa: string;
  receitaAnoCorrenteAtePa: string;
}

export function resolverSublimite(input: SublimiteInput) {
  const ano = Number(input.competencia.slice(0, 4));
  const anoAbertura = input.dataAberturaCnpj
    ? Number(input.dataAberturaCnpj.slice(0, 4))
    : null;
  const limiteAnual = toScaledInteger(input.sublimiteAnual);
  const proporcional = (anoReferencia: number, valorAnual: bigint) =>
    anoAbertura === anoReferencia
      ? (valorAnual *
          BigInt(13 - Number(input.dataAberturaCnpj!.slice(5, 7)))) /
        12n
      : valorAnual;
  const limite = proporcional(ano, limiteAnual);
  const limiteAnterior = proporcional(
    ano - 1,
    toScaledInteger(input.sublimiteAnoAnterior ?? input.sublimiteAnual),
  );
  const receitaAnterior = toScaledInteger(input.receitaAnoAnterior);
  const receitaAntesPa = toScaledInteger(input.receitaAnoCorrenteAntesPa);
  const receitaAtePa = toScaledInteger(input.receitaAnoCorrenteAtePa);
  const limiteComTolerancia = (valor: bigint) => (valor * 120n) / 100n;
  const excessoAnterior = receitaAnterior > limiteAnterior;
  const excessoMaisVinteAntesPa = receitaAntesPa > limiteComTolerancia(limite);
  const excessoMaisVinteAtePa = receitaAtePa > limiteComTolerancia(limite);
  const anoInicio = anoAbertura === ano;
  const impedido = anoInicio
    ? excessoMaisVinteAtePa
    : excessoAnterior || excessoMaisVinteAntesPa;

  return {
    sublimiteAplicavel: fromScaledInteger(limite),
    sublimiteAnual: input.sublimiteAnual,
    receitaAnoAnterior: input.receitaAnoAnterior,
    receitaAnoCorrente: input.receitaAnoCorrenteAtePa,
    impedido,
    motivo: impedido
      ? anoInicio
        ? 'EXCESSO_MAIS_20_INICIO_ATIVIDADE_RETROATIVO'
        : excessoAnterior
          ? 'EXCESSO_ANO_ANTERIOR'
          : 'EXCESSO_MAIS_20_MES_ANTERIOR'
      : excessoMaisVinteAtePa
        ? 'EXCESSO_MAIS_20_EFEITO_MES_SEGUINTE'
        : receitaAtePa > limite
          ? 'EXCESSO_ATE_20_EFEITO_ANO_SEGUINTE'
          : 'DENTRO_DO_SUBLIMITE',
    dataAberturaInformada: input.dataAberturaCnpj !== null,
  };
}
