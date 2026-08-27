import { BadRequestException } from '@nestjs/common';
import { ClientesService } from './clientes.service';

describe('ClientesService - configuração fiscal', () => {
  const service = new ClientesService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const normalize = (
    existing: {
      tipoPessoa: string;
      regimeTributario: string | null;
      tipoContribuinteIcms: string | null;
    },
    input: {
      regimeTributario?:
        'SIMPLES_NACIONAL' | 'LUCRO_PRESUMIDO' | 'LUCRO_REAL' | null;
      apuraIcms?: boolean;
      inscricaoEstadual?: string | null;
      tipoContribuinteIcms?:
        'CONTRIBUINTE' | 'ISENTO' | 'NAO_CONTRIBUINTE' | null;
    },
  ) =>
    (
      service as unknown as {
        normalizeFiscalUpdate: (
          current: typeof existing,
          update: typeof input,
        ) => {
          apuraIcms: boolean;
          inscricaoEstadual: string | null;
          writeInscricaoEstadual: boolean;
        };
      }
    ).normalizeFiscalUpdate(existing, input);

  const pjSemRegime: {
    tipoPessoa: string;
    regimeTributario: string | null;
    tipoContribuinteIcms: string | null;
    optanteSimplesNacional?: boolean | null;
  } = {
    tipoPessoa: 'PJ',
    regimeTributario: null,
    tipoContribuinteIcms: null,
  };

  const normalizeSimples = (
    existing: typeof pjSemRegime,
    input: {
      regimeTributario?:
        'SIMPLES_NACIONAL' | 'LUCRO_PRESUMIDO' | 'LUCRO_REAL' | null;
      apuraIcms?: boolean;
      optanteSimplesNacional?: boolean | null;
      simplesNacionalFonte?: 'OPEN_CNPJ' | 'RECEITA_WS' | null;
    },
  ) =>
    (
      service as unknown as {
        normalizeSimplesNacionalUpdate: (
          current: typeof existing,
          update: typeof input,
        ) => {
          writeConsultation: boolean;
          optanteSimplesNacional: boolean | null;
          fiscalInput: typeof input;
        };
      }
    ).normalizeSimplesNacionalUpdate(existing, input);

  const normalizeSimplesRegistration = (
    optanteSimplesNacional: boolean,
    simplesNacionalFonte: 'OPEN_CNPJ' | 'RECEITA_WS',
  ) =>
    (
      service as unknown as {
        normalizeSimplesNacionalRegistration: (
          tipoPessoa: 'PJ',
          input: {
            optanteSimplesNacional: boolean;
            simplesNacionalFonte: 'OPEN_CNPJ' | 'RECEITA_WS';
          },
        ) => {
          regimeTributario: string | null;
          optanteSimplesNacional: boolean | null;
        };
      }
    ).normalizeSimplesNacionalRegistration('PJ', {
      optanteSimplesNacional,
      simplesNacionalFonte,
    });

  it.each(['LUCRO_PRESUMIDO', 'LUCRO_REAL'] as const)(
    'força apuração de ICMS para %s',
    (regimeTributario) => {
      const result = normalize(pjSemRegime, {
        regimeTributario,
        apuraIcms: false,
      });

      expect(result.apuraIcms).toBe(true);
    },
  );

  it.each([false, true])(
    'preserva apuraIcms=%s no Simples Nacional',
    (apuraIcms) => {
      const result = normalize(pjSemRegime, {
        regimeTributario: 'SIMPLES_NACIONAL',
        apuraIcms,
      });

      expect(result.apuraIcms).toBe(apuraIcms);
    },
  );

  it('limpa a inscrição estadual ao selecionar não contribuinte', () => {
    const result = normalize(
      {
        ...pjSemRegime,
        tipoContribuinteIcms: 'CONTRIBUINTE',
      },
      {
        tipoContribuinteIcms: 'NAO_CONTRIBUINTE',
        inscricaoEstadual: '123.456.789',
      },
    );

    expect(result.writeInscricaoEstadual).toBe(true);
    expect(result.inscricaoEstadual).toBeNull();
  });

  it('rejeita regime tributário para pessoa física', () => {
    expect(() =>
      normalize(
        {
          tipoPessoa: 'PF',
          regimeTributario: null,
          tipoContribuinteIcms: null,
        },
        { regimeTributario: 'SIMPLES_NACIONAL' },
      ),
    ).toThrow(BadRequestException);
  });

  it('força Simples Nacional quando a consulta retorna optante', () => {
    const result = normalizeSimples(pjSemRegime, {
      regimeTributario: 'LUCRO_REAL',
      optanteSimplesNacional: true,
      simplesNacionalFonte: 'OPEN_CNPJ',
    });

    expect(result.writeConsultation).toBe(true);
    expect(result.fiscalInput.regimeTributario).toBe('SIMPLES_NACIONAL');
    expect(result.fiscalInput.apuraIcms).toBe(false);
  });

  it('prepara a persistência do resultado optante no cadastro inicial', () => {
    const result = normalizeSimplesRegistration(true, 'OPEN_CNPJ');

    expect(result.optanteSimplesNacional).toBe(true);
    expect(result.regimeTributario).toBe('SIMPLES_NACIONAL');
  });

  it('preserva explicitamente o resultado não optante no cadastro inicial', () => {
    const result = normalizeSimplesRegistration(false, 'RECEITA_WS');

    expect(result.optanteSimplesNacional).toBe(false);
    expect(result.regimeTributario).toBeNull();
  });

  it('remove Simples Nacional quando a consulta retorna não optante', () => {
    const result = normalizeSimples(
      { ...pjSemRegime, regimeTributario: 'SIMPLES_NACIONAL' },
      {
        optanteSimplesNacional: false,
        simplesNacionalFonte: 'RECEITA_WS',
      },
    );

    expect(result.optanteSimplesNacional).toBe(false);
    expect(result.fiscalInput.regimeTributario).toBeNull();
  });

  it('preserva Lucro Presumido quando a consulta retorna não optante', () => {
    const result = normalizeSimples(
      { ...pjSemRegime, regimeTributario: 'LUCRO_PRESUMIDO' },
      {
        optanteSimplesNacional: false,
        simplesNacionalFonte: 'OPEN_CNPJ',
      },
    );

    expect(result.fiscalInput.regimeTributario).toBeUndefined();
  });

  it('exige a fonte quando há resultado da consulta', () => {
    expect(() =>
      normalizeSimples(pjSemRegime, { optanteSimplesNacional: false }),
    ).toThrow(BadRequestException);
  });

  it('exige nova consulta antes de tirar uma empresa optante do Simples', () => {
    expect(() =>
      normalizeSimples(
        {
          ...pjSemRegime,
          regimeTributario: 'SIMPLES_NACIONAL',
          optanteSimplesNacional: true,
        },
        { regimeTributario: 'LUCRO_REAL' },
      ),
    ).toThrow(BadRequestException);
  });

  it('exige nova consulta antes de marcar uma empresa não optante como Simples', () => {
    expect(() =>
      normalizeSimples(
        { ...pjSemRegime, optanteSimplesNacional: false },
        { regimeTributario: 'SIMPLES_NACIONAL' },
      ),
    ).toThrow(BadRequestException);
  });
});
