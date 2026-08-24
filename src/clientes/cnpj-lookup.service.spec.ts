import {
  CnpjLookupService,
  isValidCnpj,
  normalizeCnpjPayload,
} from './cnpj-lookup.service';
import type { AppLogger } from '../common/logger.service';

describe('CNPJ lookup', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('normalizes the OpenCNPJ contract', () => {
    const result = normalizeCnpjPayload(
      'OPEN_CNPJ',
      {
        cnpj: '03198283000116',
        razao_social: 'Empresa Exemplo Ltda',
        tipo_logradouro: 'RUA',
        logradouro: 'DAS FLORES',
        numero: '10',
        complemento: 'SALA 2',
        bairro: 'CENTRO',
        cep: '44075165',
        municipio: 'FEIRA DE SANTANA',
        uf: 'BA',
        cnae_principal: '1749400',
        cnaes_secundarios: ['1742799'],
        cnaes: [
          {
            codigo: '1749400',
            descricao: 'Atividade principal',
            is_principal: true,
          },
          {
            codigo: '1742799',
            descricao: 'Atividade secundária',
            is_principal: false,
          },
        ],
      },
      '03198283000116',
    );

    expect(result.company_name).toBe('Empresa Exemplo Ltda');
    expect(result.address.street).toBe('RUA DAS FLORES');
    expect(result.address.formatted).toContain(
      '44075165 - FEIRA DE SANTANA - BA',
    );
    expect(result.primary_activity).toEqual({
      code: '1749400',
      description: 'Atividade principal',
    });
    expect(result.secondary_activities).toEqual([
      { code: '1742799', description: 'Atividade secundária' },
    ]);
  });

  it('normalizes the ReceitaWS contract', () => {
    const result = normalizeCnpjPayload(
      'RECEITA_WS',
      {
        status: 'OK',
        cnpj: '03.198.283/0001-16',
        nome: 'Empresa Exemplo Ltda',
        logradouro: 'RUA DAS FLORES',
        numero: '10',
        complemento: '',
        bairro: 'CENTRO',
        cep: '44.075-165',
        municipio: 'FEIRA DE SANTANA',
        uf: 'BA',
        atividade_principal: [
          { code: '17.49-4-00', text: 'Atividade principal' },
        ],
        atividades_secundarias: [
          { code: '17.42-7-99', text: 'Atividade secundária' },
        ],
      },
      '03198283000116',
    );

    expect(result.source).toBe('RECEITA_WS');
    expect(result.address.postal_code).toBe('44075165');
    expect(result.primary_activity?.code).toBe('1749400');
    expect(result.secondary_activities[0]?.code).toBe('1742799');
  });

  it('uses ReceitaWS when OpenCNPJ fails', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(
        Response.json({
          status: 'OK',
          cnpj: '03.198.283/0001-16',
          nome: 'Empresa via fallback',
          atividade_principal: [],
          atividades_secundarias: [],
        }),
      );
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
    } as unknown as AppLogger;
    const service = new CnpjLookupService(logger);

    const result = await service.lookup('03198283000116', { userId: 'user-1' });

    expect(result.source).toBe('RECEITA_WS');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('validates CNPJ check digits', () => {
    expect(isValidCnpj('03.198.283/0001-16')).toBe(true);
    expect(isValidCnpj('03.198.283/0001-00')).toBe(false);
    expect(isValidCnpj('11.111.111/1111-11')).toBe(false);
  });

  describe('simples_nacional extraction', () => {
    it('returns true when OpenCNPJ has opcao_simples = "S"', () => {
      const result = normalizeCnpjPayload(
        'OPEN_CNPJ',
        {
          cnpj: '03198283000116',
          razao_social: 'Empresa SN',
          opcao_simples: 'S',
          cnaes: [],
        },
        '03198283000116',
      );
      expect(result.simples_nacional).toBe(true);
    });

    it('returns false when OpenCNPJ has opcao_simples = "N"', () => {
      const result = normalizeCnpjPayload(
        'OPEN_CNPJ',
        {
          cnpj: '03198283000116',
          razao_social: 'Empresa LP',
          opcao_simples: 'N',
          cnaes: [],
        },
        '03198283000116',
      );
      expect(result.simples_nacional).toBe(false);
    });

    it('returns null when OpenCNPJ does not include opcao_simples', () => {
      const result = normalizeCnpjPayload(
        'OPEN_CNPJ',
        {
          cnpj: '03198283000116',
          razao_social: 'Empresa Sem Info',
          cnaes: [],
        },
        '03198283000116',
      );
      expect(result.simples_nacional).toBeNull();
    });

    it('returns true when ReceitaWS has simples.optante = true', () => {
      const result = normalizeCnpjPayload(
        'RECEITA_WS',
        {
          status: 'OK',
          cnpj: '03.198.283/0001-16',
          nome: 'Empresa SN',
          atividade_principal: [],
          atividades_secundarias: [],
          simples: { optante: true },
        },
        '03198283000116',
      );
      expect(result.simples_nacional).toBe(true);
    });

    it('returns false when ReceitaWS has simples.optante = false', () => {
      const result = normalizeCnpjPayload(
        'RECEITA_WS',
        {
          status: 'OK',
          cnpj: '03.198.283/0001-16',
          nome: 'Empresa LR',
          atividade_principal: [],
          atividades_secundarias: [],
          simples: { optante: false },
        },
        '03198283000116',
      );
      expect(result.simples_nacional).toBe(false);
    });

    it('returns null when ReceitaWS does not include simples field', () => {
      const result = normalizeCnpjPayload(
        'RECEITA_WS',
        {
          status: 'OK',
          cnpj: '03.198.283/0001-16',
          nome: 'Empresa Sem Info',
          atividade_principal: [],
          atividades_secundarias: [],
        },
        '03198283000116',
      );
      expect(result.simples_nacional).toBeNull();
    });
  });
});
