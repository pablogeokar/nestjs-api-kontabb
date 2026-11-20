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

  it('resolve município e UF pelo código IBGE e reaproveita o cache', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          'municipio-id': 2927408,
          'municipio-nome': 'Salvador',
          'UF-sigla': 'BA',
        }),
    } as Response);
    const service = new IbgeMunicipiosService();
    expect(await service.resolverLocalidade('2927408')).toEqual({
      municipio: 'Salvador',
      uf: 'BA',
    });
    expect(await service.resolverLocalidade('2927408')).toEqual({
      municipio: 'Salvador',
      uf: 'BA',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://servicodados.ibge.gov.br/api/v1/localidades/municipios/2927408?view=nivelado',
      expect.any(Object),
    );
  });

  it.each([
    null,
    {},
    {
      'municipio-id': 2910800,
      'municipio-nome': 'Feira de Santana',
      'UF-sigla': 'BA',
    },
    { 'municipio-id': 2927408, 'municipio-nome': 'Salvador' },
    { 'municipio-id': 2927408, 'municipio-nome': '', 'UF-sigla': 'BA' },
  ])(
    'rejeita resposta de localidade incompleta ou divergente (%p)',
    async (data) => {
      const response = {
        ok: true,
        json: () => Promise.resolve(data),
      } as Response;
      jest.spyOn(global, 'fetch').mockResolvedValue(response);
      expect(
        await new IbgeMunicipiosService().resolverLocalidade('2927408'),
      ).toBeNull();
    },
  );

  it('não consulta código inválido e permite nova tentativa após indisponibilidade', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ ok: false } as Response);
    const service = new IbgeMunicipiosService();
    expect(await service.resolverLocalidade('invalido')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await service.resolverLocalidade('2927408')).toBeNull();
    expect(await service.resolverLocalidade('2927408')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
