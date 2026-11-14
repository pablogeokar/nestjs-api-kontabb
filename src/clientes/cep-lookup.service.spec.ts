import type { AppLogger } from '../common/logger.service';
import {
  CepLookupFailure,
  CepLookupService,
  coherentIbge,
  normalizeCepPayload,
} from './cep-lookup.service';

const viaCep = {
  cep: '44075-165',
  logradouro: 'Rua Doutor Simões Filho',
  complemento: '',
  bairro: 'Ponto Central',
  localidade: 'Feira de Santana',
  uf: 'BA',
  ibge: '2910800',
};
const brasilApi = {
  cep: '44075165',
  state: 'BA',
  city: 'Feira de Santana',
  neighborhood: 'Ponto Central',
  street: 'Rua Doutor Simões Filho',
  ibge: { city: '2910800', state: '29' },
};

function response(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

function service() {
  const logger = { info: jest.fn(), warn: jest.fn() } as unknown as AppLogger;
  return new CepLookupService(logger);
}

describe('normalizeCepPayload', () => {
  it('normaliza ViaCEP, OpenCEP e BrasilAPI para o mesmo contrato', () => {
    const esperado = {
      postal_code: '44075165',
      street: 'Rua Doutor Simões Filho',
      district: 'Ponto Central',
      city: 'Feira de Santana',
      state: 'BA',
      ibge_code: '2910800',
    };
    expect(normalizeCepPayload('VIA_CEP', viaCep, '44075165')).toEqual({
      ...esperado,
      source: 'VIA_CEP',
    });
    expect(normalizeCepPayload('OPEN_CEP', viaCep, '44075165')).toEqual({
      ...esperado,
      source: 'OPEN_CEP',
    });
    expect(normalizeCepPayload('BRASIL_API', brasilApi, '44075165')).toEqual({
      ...esperado,
      source: 'BRASIL_API',
    });
  });

  it('reconhece o "erro" do ViaCEP como CEP inexistente', () => {
    expect(
      normalizeCepPayload('VIA_CEP', { erro: 'true' }, '00000000'),
    ).toBeNull();
    expect(
      normalizeCepPayload('VIA_CEP', { erro: true }, '00000000'),
    ).toBeNull();
  });

  it('descarta IBGE incoerente com a UF ou malformado', () => {
    expect(coherentIbge('2910800', 'BA')).toBe('2910800');
    expect(coherentIbge('3550308', 'BA')).toBeNull();
    expect(coherentIbge('291080', 'BA')).toBeNull();
    expect(
      normalizeCepPayload('VIA_CEP', { ...viaCep, ibge: '' }, '44075165')
        ?.ibge_code,
    ).toBeNull();
  });

  it('rejeita resposta de outro CEP', () => {
    expect(() =>
      normalizeCepPayload(
        'VIA_CEP',
        { ...viaCep, cep: '01001-000' },
        '44075165',
      ),
    ).toThrow('CEP_MISMATCH');
  });
});

describe('CepLookupService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('usa o fallback quando o primeiro provedor falha', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(response(200, brasilApi));
    const result = await service().lookup('44075-165');
    expect(result.source).toBe('BRASIL_API');
    expect(result.ibge_code).toBe('2910800');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('completa o IBGE com o provedor seguinte quando o primeiro não o informa', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(response(200, { ...viaCep, ibge: '' }))
      .mockResolvedValueOnce(response(200, brasilApi));
    const result = await service().lookup('44075165');
    expect(result.source).toBe('VIA_CEP');
    expect(result.street).toBe('Rua Doutor Simões Filho');
    expect(result.ibge_code).toBe('2910800');
  });

  it('devolve NOT_FOUND quando todos respondem que o CEP não existe', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(response(200, { erro: 'true' }))
      .mockResolvedValueOnce(response(404, {}))
      .mockResolvedValueOnce(response(404, { error: true }));
    await expect(service().lookup('00000000')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('devolve UNAVAILABLE quando algum provedor falha e nenhum encontra', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(response(404, {}))
      .mockResolvedValueOnce(response(500, {}));
    await expect(service().lookup('00000000')).rejects.toBeInstanceOf(
      CepLookupFailure,
    );
  });

  it('reaproveita o resultado em cache', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(response(200, viaCep));
    const lookup = service();
    await lookup.lookup('44075165');
    await lookup.lookup('44075-165');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejeita CEP com formato inválido sem chamar a rede', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    await expect(service().lookup('123')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
