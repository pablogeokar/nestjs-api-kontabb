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

  const pjSemRegime = {
    tipoPessoa: 'PJ',
    regimeTributario: null,
    tipoContribuinteIcms: null,
  };

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
});
