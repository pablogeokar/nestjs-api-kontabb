import {
  apurarEntradasInterestaduais,
  apurarSaidasInterestaduais,
  isCfopCombustivel,
  isDevolucaoComSt,
  type DestdaItemSaida,
} from './destda-apuracao';
import { montarPerfil, validarPerfil } from './destda-perfil';

function saida(parcial: Partial<DestdaItemSaida>): DestdaItemSaida {
  return {
    documentoFiscalId: 'doc-1',
    numeroDocumento: '100',
    ufDestino: 'SP',
    cfop: '6102',
    csosnIcms: '102',
    cstIcms: null,
    valorIcmsSt: null,
    valorFcpSt: null,
    valorIcmsUfDest: null,
    valorFcpUfDest: null,
    ...parcial,
  };
}

describe('apurarSaidasInterestaduais', () => {
  it('soma o DIFAL de venda a consumidor final por UF, com FCP', () => {
    const { totais, inconsistencias } = apurarSaidasInterestaduais(
      [
        saida({ valorIcmsUfDest: '10.50', valorFcpUfDest: '1.00' }),
        saida({ valorIcmsUfDest: '4.50' }),
        saida({ ufDestino: 'MG', valorIcmsUfDest: '2.00' }),
      ],
      'BA',
    );
    expect(inconsistencias).toEqual([]);
    expect(totais.consumoFinal).toEqual([
      { uf: 'SP', totalNf: 1600n, ajustes: 0n },
      { uf: 'MG', totalNf: 200n, ajustes: 0n },
    ]);
    expect(totais.st).toEqual([]);
  });

  it('separa ST comum de ST de combustível e ignora devolução de compra', () => {
    const { totais } = apurarSaidasInterestaduais(
      [
        saida({ cfop: '6403', csosnIcms: '201', valorIcmsSt: '30.00' }),
        saida({ cfop: '6655', csosnIcms: '201', valorIcmsSt: '70.00' }),
        saida({ cfop: '6411', csosnIcms: '201', valorIcmsSt: '999.00' }),
        saida({ cfop: '6202', csosnIcms: '201', valorIcmsSt: '888.00' }),
      ],
      'BA',
    );
    expect(totais.st).toEqual([
      {
        indOper: '1',
        indEmit: '0',
        uf: 'SP',
        indTpSt: '0',
        totalNf: 3000n,
        ajustes: 0n,
      },
      {
        indOper: '1',
        indEmit: '0',
        uf: 'SP',
        indTpSt: '3',
        totalNf: 7000n,
        ajustes: 0n,
      },
    ]);
  });

  it('ignora operações internas e para o exterior', () => {
    const { totais } = apurarSaidasInterestaduais(
      [
        saida({ ufDestino: 'BA', valorIcmsUfDest: '5.00' }),
        saida({ ufDestino: 'EX', valorIcmsSt: '5.00' }),
      ],
      'BA',
    );
    expect(totais.consumoFinal).toEqual([]);
    expect(totais.st).toEqual([]);
  });

  it('acusa saída com valor mas sem UF de destino válida', () => {
    const { totais, inconsistencias } = apurarSaidasInterestaduais(
      [saida({ ufDestino: null, valorIcmsSt: '5.00', numeroDocumento: '77' })],
      'BA',
    );
    expect(totais.st).toEqual([]);
    expect(inconsistencias).toHaveLength(1);
    expect(inconsistencias[0]).toMatchObject({
      codigo: 'UF_DESTINO_AUSENTE',
      severidade: 'ERRO',
    });
    expect(inconsistencias[0].mensagem).toContain('77');
  });

  it('reconhece CFOPs de combustível e devolução', () => {
    expect(isCfopCombustivel('6651')).toBe(true);
    expect(isCfopCombustivel('6667')).toBe(true);
    expect(isCfopCombustivel('5655')).toBe(false);
    expect(isCfopCombustivel('6403')).toBe(false);
    expect(isDevolucaoComSt('6201')).toBe(true);
    expect(isDevolucaoComSt('6250')).toBe(false);
  });
});

describe('apurarEntradasInterestaduais', () => {
  const difal = (parcial: Record<string, string | null>) => ({
    cfop: '2556',
    hipotese: 'DIFAL_ENTRADA_CONTRIBUINTE',
    statusCalculo: 'CALCULADO',
    recolhimentoProprio: 'SIM',
    valorDifal: '100.00',
    valorFcp: '2.00',
    ...parcial,
  });

  it('separa ativo (0) de uso e consumo (1) e soma antecipação como 3', () => {
    const { entradas, inconsistencias } = apurarEntradasInterestaduais({
      difal: [
        difal({}),
        difal({ cfop: '2551', valorDifal: '50.00', valorFcp: '0.00' }),
        difal({ valorDifal: '10.00', valorFcp: '0.00' }),
      ],
      antecipacao: [
        { situacao: 'CALCULADO', valorAntecipacao: '30.25' },
        { situacao: 'ICMS_ST', valorAntecipacao: null },
        { situacao: 'DISPENSADO', valorAntecipacao: null },
      ],
    });
    expect(inconsistencias).toEqual([]);
    expect(entradas).toEqual(
      expect.arrayContaining([
        { indSit: '1', totalNf: 11200n, ajustes: 0n },
        { indSit: '0', totalNf: 5000n, ajustes: 0n },
        { indSit: '3', totalNf: 3025n, ajustes: 0n },
      ]),
    );
  });

  it('bloqueia quando há item sem regra aprovada', () => {
    const { inconsistencias } = apurarEntradasInterestaduais({
      difal: [
        difal({ statusCalculo: 'SIMULACAO' }),
        difal({ statusCalculo: 'PENDENTE' }),
      ],
      antecipacao: [{ situacao: 'PENDENTE', valorAntecipacao: null }],
    });
    expect(inconsistencias.map((item) => item.codigo)).toEqual([
      'DIFAL_ENTRADA_PENDENTE',
      'ANTECIPACAO_PENDENTE',
    ]);
    expect(inconsistencias.every((item) => item.severidade === 'ERRO')).toBe(
      true,
    );
  });

  it('não declara itens sob ST nem sem recolhimento próprio', () => {
    const { entradas } = apurarEntradasInterestaduais({
      difal: [
        difal({ hipotese: 'ST', statusCalculo: null }),
        difal({ recolhimentoProprio: 'NAO' }),
      ],
      antecipacao: [],
    });
    expect(entradas).toEqual([]);
  });
});

describe('perfil do contribuinte', () => {
  it('aplica derivados e deixa as sobrescritas da empresa prevalecerem', () => {
    const perfil = montarPerfil({ prfIcms: '2', indSt: '1' }, { indSt: '0' });
    expect(perfil.prfIcms).toBe('2');
    expect(perfil.indSt).toBe('1');
    expect(perfil.indArq).toBe('7');
  });

  it('valida domínios e chaves desconhecidas', () => {
    expect(validarPerfil({ prfIcms: '1' })).toEqual([]);
    expect(validarPerfil({ prfIcms: '5' })).toHaveLength(1);
    expect(validarPerfil({ xpto: '1' })).toHaveLength(1);
  });
});
