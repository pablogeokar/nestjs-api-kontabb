import {
  IbgeMunicipiosService,
  normalizarNomeMunicipio,
} from './ibge-municipios.service';

describe('IbgeMunicipiosService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('normaliza acentos e caixa', () => {
    expect(normalizarNomeMunicipio("São João d'Aliança")).toBe(
      'SAO JOAO D ALIANCA',
    );
  });

  it('resolve o código e reaproveita o cache da UF', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve([
          { id: 2910800, nome: 'Feira de Santana' },
          { id: 2927408, nome: 'Salvador' },
        ]),
    } as Response);
    const service = new IbgeMunicipiosService();
    expect(await service.resolverCodigo('FEIRA DE SANTANA', 'ba')).toBe(
      '2910800',
    );
    expect(await service.resolverCodigo('Salvador', 'BA')).toBe('2927408');
    expect(await service.resolverCodigo('Inexistente', 'BA')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('devolve null quando a API falha', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('timeout'));
    expect(
      await new IbgeMunicipiosService().resolverCodigo('X', 'SP'),
    ).toBeNull();
  });
});
