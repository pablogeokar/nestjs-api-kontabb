import { resolverSublimite } from './simples-sublimite';

const base = {
  competencia: '2026-10',
  dataAberturaCnpj: '2026-10-08',
  sublimiteAnual: '3600000.00',
  receitaAnoAnterior: '0.00',
  receitaAnoCorrenteAntesPa: '0.00',
  receitaAnoCorrenteAtePa: '47827.27',
};

describe('sublimite estadual do Simples', () => {
  it('proporcionaliza outubro a dezembro para a empresa aberta em outubro', () => {
    expect(resolverSublimite(base)).toMatchObject({
      sublimiteAplicavel: '900000.00',
      impedido: false,
      motivo: 'DENTRO_DO_SUBLIMITE',
    });
  });

  it('diferencia excesso até 20% e acima de 20% no ano de abertura', () => {
    expect(
      resolverSublimite({ ...base, receitaAnoCorrenteAtePa: '1000000.00' }),
    ).toMatchObject({
      impedido: false,
      motivo: 'EXCESSO_ATE_20_EFEITO_ANO_SEGUINTE',
    });
    expect(
      resolverSublimite({ ...base, receitaAnoCorrenteAtePa: '1080000.01' }),
    ).toMatchObject({
      impedido: true,
      motivo: 'EXCESSO_MAIS_20_INICIO_ATIVIDADE_RETROATIVO',
    });
  });

  it('aplica o efeito no mês seguinte para empresa antiga', () => {
    const antiga = { ...base, dataAberturaCnpj: '2020-01-01' };
    expect(
      resolverSublimite({ ...antiga, receitaAnoCorrenteAtePa: '4320000.01' }),
    ).toMatchObject({
      impedido: false,
      motivo: 'EXCESSO_MAIS_20_EFEITO_MES_SEGUINTE',
    });
    expect(
      resolverSublimite({
        ...antiga,
        competencia: '2026-11',
        receitaAnoCorrenteAntesPa: '4320000.01',
        receitaAnoCorrenteAtePa: '4350000.00',
      }),
    ).toMatchObject({ impedido: true, motivo: 'EXCESSO_MAIS_20_MES_ANTERIOR' });
  });

  it('usa o excesso do ano anterior, inclusive com limite proporcional', () => {
    expect(
      resolverSublimite({
        ...base,
        competencia: '2027-01',
        receitaAnoAnterior: '950000.00',
        receitaAnoCorrenteAtePa: '10000.00',
      }),
    ).toMatchObject({ impedido: true, motivo: 'EXCESSO_ANO_ANTERIOR' });
  });

  it('aceita sublimite anual menor configurado para outra UF e ano', () => {
    expect(
      resolverSublimite({ ...base, sublimiteAnual: '1800000.00' }),
    ).toMatchObject({ sublimiteAplicavel: '450000.00', impedido: false });
  });

  it('usa o valor do ano anterior para o impedimento vigente em janeiro', () => {
    expect(
      resolverSublimite({
        ...base,
        competencia: '2027-01',
        sublimiteAnual: '3600000.00',
        sublimiteAnoAnterior: '1800000.00',
        receitaAnoAnterior: '500000.00',
        receitaAnoCorrenteAtePa: '0.00',
      }),
    ).toMatchObject({ impedido: true, motivo: 'EXCESSO_ANO_ANTERIOR' });
  });
});
