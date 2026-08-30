import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  AtualizarContextoApuracaoSpedDto,
  SpedAjusteApuracaoDto,
} from './dto/sped-apuracao.dto';
import { assertSpedApuracaoContextPayload } from './sped-apuracao-contexto.service';

function makeAdjustment(
  overrides: Partial<SpedAjusteApuracaoDto> = {},
): SpedAjusteApuracaoDto {
  return {
    registro: 'E111',
    codigoAjuste: 'BA000001',
    valor: '10.00',
    indicador: 'DEBITO',
    ...overrides,
  };
}

function makeContext(
  ajustes: SpedAjusteApuracaoDto[],
): AtualizarContextoApuracaoSpedDto {
  return {
    competencia: '2026-08',
    saldos: [],
    ajustes,
    obrigacoes: [],
    responsabilidades: [],
  };
}

describe('SpedApuracaoContextoService invariants', () => {
  it('aceita códigos coerentes para E111, E220, E311 DIFAL/FCP e E530', () => {
    const context = makeContext([
      makeAdjustment(),
      makeAdjustment({
        registro: 'E220',
        codigoAjuste: 'SE120001',
        indicador: 'CREDITO',
        uf: 'SE',
      }),
      makeAdjustment({
        registro: 'E311',
        codigoAjuste: 'MG230001',
        indicador: 'ESTORNO_DEBITO',
        uf: 'MG',
      }),
      makeAdjustment({
        registro: 'E311',
        codigoAjuste: 'MG340001',
        indicador: 'DEDUCAO',
        uf: 'MG',
      }),
      makeAdjustment({
        registro: 'E220',
        codigoAjuste: 'SE150001',
        indicador: 'DEBITO_ESPECIAL',
        uf: 'SE',
      }),
      makeAdjustment({
        registro: 'E530',
        codigoAjuste: 'A1',
        indicador: 'CREDITO',
      }),
    ]);

    expect(() => assertSpedApuracaoContextPayload(context, 'BA')).not.toThrow();
  });

  it('normaliza registro, código, indicador, UF e valor no DTO', async () => {
    const dto = plainToInstance(AtualizarContextoApuracaoSpedDto, {
      competencia: '2026-08',
      saldos: [],
      ajustes: [
        {
          registro: 'e220',
          codigoAjuste: ' se120001 ',
          valor: '10,25',
          indicador: 'credito',
          uf: 'se',
        },
      ],
      obrigacoes: [],
    });

    expect(await validate(dto)).toEqual([]);
    expect(dto.ajustes[0]).toMatchObject({
      registro: 'E220',
      codigoAjuste: 'SE120001',
      valor: '10.25',
      indicador: 'CREDITO',
      uf: 'SE',
    });
  });

  it('exige que E111 use a UF do estabelecimento e o dígito 0', () => {
    expect(() =>
      assertSpedApuracaoContextPayload(
        makeContext([makeAdjustment({ codigoAjuste: 'SE000001' })]),
        'BA',
      ),
    ).toThrow('deve iniciar com a UF BA');

    expect(() =>
      assertSpedApuracaoContextPayload(
        makeContext([makeAdjustment({ codigoAjuste: 'BA100001' })]),
        'BA',
      ),
    ).toThrow('ICMS próprio (0)');

    expect(() =>
      assertSpedApuracaoContextPayload(makeContext([makeAdjustment()]), null),
    ).toThrow('Cadastre a UF do estabelecimento');
  });

  it('exige UF e o dígito 1 do ICMS-ST no E220', () => {
    expect(() =>
      assertSpedApuracaoContextPayload(
        makeContext([
          makeAdjustment({
            registro: 'E220',
            codigoAjuste: 'SE120001',
            indicador: 'CREDITO',
          }),
        ]),
        'BA',
      ),
    ).toThrow('E220 exige UF');

    expect(() =>
      assertSpedApuracaoContextPayload(
        makeContext([
          makeAdjustment({
            registro: 'E220',
            codigoAjuste: 'BA020001',
            indicador: 'CREDITO',
            uf: 'BA',
          }),
        ]),
        'BA',
      ),
    ).toThrow('ICMS-ST (1)');
  });

  it('limita E311 a códigos DIFAL (2) ou FCP (3) da UF informada', () => {
    expect(() =>
      assertSpedApuracaoContextPayload(
        makeContext([
          makeAdjustment({
            registro: 'E311',
            codigoAjuste: 'SP140001',
            indicador: 'DEDUCAO',
            uf: 'SP',
          }),
        ]),
        'BA',
      ),
    ).toThrow('DIFAL (2) ou FCP (3)');

    expect(() =>
      assertSpedApuracaoContextPayload(
        makeContext([
          makeAdjustment({
            registro: 'E311',
            codigoAjuste: 'RJ240001',
            indicador: 'DEDUCAO',
            uf: 'SP',
          }),
        ]),
        'BA',
      ),
    ).toThrow('deve iniciar com a UF SP');
  });

  it('confronta o quarto caractere do código com o indicador informado', () => {
    expect(() =>
      assertSpedApuracaoContextPayload(
        makeContext([
          makeAdjustment({
            registro: 'E220',
            codigoAjuste: 'SE120001',
            indicador: 'DEBITO',
            uf: 'SE',
          }),
        ]),
        'BA',
      ),
    ).toThrow('use CREDITO');
  });

  it('restringe E530 a código de até 3 caracteres e débito/crédito, sem UF', () => {
    expect(() =>
      assertSpedApuracaoContextPayload(
        makeContext([
          makeAdjustment({
            registro: 'E530',
            codigoAjuste: 'ABCD',
            indicador: 'CREDITO',
          }),
        ]),
        'BA',
      ),
    ).toThrow('1 a 3 caracteres');

    expect(() =>
      assertSpedApuracaoContextPayload(
        makeContext([
          makeAdjustment({
            registro: 'E530',
            codigoAjuste: '001',
            indicador: 'DEDUCAO',
          }),
        ]),
        'BA',
      ),
    ).toThrow('somente débito ou crédito');

    expect(() =>
      assertSpedApuracaoContextPayload(
        makeContext([
          makeAdjustment({
            registro: 'E530',
            codigoAjuste: '001',
            indicador: 'DEBITO',
            uf: 'BA',
          }),
        ]),
        'BA',
      ),
    ).toThrow('E530 não aceita UF');
  });

  it('mantém o DTO fechado para registros e indicadores não suportados', async () => {
    const dto = plainToInstance(AtualizarContextoApuracaoSpedDto, {
      competencia: '2026-08',
      saldos: [],
      ajustes: [
        {
          registro: 'E312',
          codigoAjuste: 'BA200001',
          valor: '10.00',
          indicador: 'OUTRO',
          uf: 'BA',
        },
      ],
      obrigacoes: [],
    });

    const errors = await validate(dto);
    expect(errors).not.toEqual([]);
    expect(errors[0].children?.[0].children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'registro' }),
        expect.objectContaining({ property: 'indicador' }),
      ]),
    );
  });

  it('continua rejeitando datas civis impossíveis', () => {
    const context = makeContext([]);
    context.obrigacoes = [
      {
        tipo: 'ICMS_PROPRIO',
        codigoObrigacao: '000',
        valor: '10.00',
        dataVencimento: '2026-02-30',
        codigoReceita: '1001',
        mesReferencia: '022026',
      },
    ];

    expect(() => assertSpedApuracaoContextPayload(context, 'BA')).toThrow(
      BadRequestException,
    );
  });
});
