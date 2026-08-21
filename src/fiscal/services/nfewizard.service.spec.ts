import { extractManifestacaoSefazResult } from './nfewizard.service';

describe('extractManifestacaoSefazResult', () => {
  it('normaliza o retorno aninhado da recepção de evento', () => {
    const result = extractManifestacaoSefazResult([
      {
        retEnvEvento: {
          retEvento: {
            infEvento: {
              cStat: '135',
              xMotivo: 'Evento registrado e vinculado a NF-e',
              nProt: '123456789',
            },
          },
        },
      },
    ]);

    expect(result).toEqual({
      status: 135,
      motivo: 'Evento registrado e vinculado a NF-e',
      protocolo: '123456789',
    });
  });

  it('retorna null quando não há retorno de evento', () => {
    expect(extractManifestacaoSefazResult({ cStat: '128' })).toBeNull();
  });
});
