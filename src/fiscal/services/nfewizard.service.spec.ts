import {
  extractManifestacaoSefazResult,
  NfeWizardService,
} from './nfewizard.service';
import { ConfigService } from '@nestjs/config';
import { CertificadoService } from './certificado.service';
import { SefazConsultaControlService } from './sefaz-consulta-control.service';

describe('NfeWizardService controle de distribuição', () => {
  it.each([true, false])(
    'aplica o controle compartilhado (porChave=%s)',
    async (porChave) => {
      const control = {
        consultar: jest.fn(
          async (_input: unknown, action: () => Promise<unknown>) => action(),
        ),
      };
      const service = new NfeWizardService(
        {} as CertificadoService,
        new ConfigService({ SEFAZ_AMBIENTE: 'PRODUCAO' }),
        control as unknown as SefazConsultaControlService,
      );
      const wizard = {
        NFE_DistribuicaoDFePorChave: jest
          .fn()
          .mockResolvedValue({ cStat: 138 }),
        NFE_DistribuicaoDFePorUltNSU: jest
          .fn()
          .mockResolvedValue({ cStat: 137 }),
      };
      jest
        .spyOn(service, 'getClientWizardInstance')
        .mockResolvedValue(wizard as never);
      const input = {
        clienteId: 'cliente',
        cnpj: '12345678000195',
        uf: 'BA',
        chaveAcesso: 'chave',
        ultimoNsu: 0,
      };
      if (porChave) await service.consultarPorChave(input);
      else await service.consultarDistribuicaoDFe(input);
      expect(control.consultar).toHaveBeenCalledWith(
        { cnpj: input.cnpj, ambiente: 1, porChave },
        expect.any(Function),
      );
    },
  );
});

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
