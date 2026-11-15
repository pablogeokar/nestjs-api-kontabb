import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { SalvarIcmsRegrasDto } from '../dto/icms-regras.dto';
import { validarEnquadramentosIcms } from './icms-regras.service';

const row = {
  ncm: '19053100',
  cest: '1705302',
  regime: 'SIMPLES_NACIONAL',
  uf_origem: 'SE',
  origem_mercadoria: '0',
  tratamento: 'APLICAVEL',
  aliquota_interna: '20.5',
  aliquota_interestadual: '12',
  fundamento: 'RICMS-BA, art. 321, VII, b',
  confirmado_fiscalmente: true,
};

describe('cadastro de regras de ICMS', () => {
  it('exige identificação completa e decimal em texto', () => {
    const input = plainToInstance(SalvarIcmsRegrasDto, {
      uf: 'BA',
      competencia: '2026-10',
      fonte: 'RICMS-BA',
      expectedRevision: 1,
      enquadramentos: [row],
    });
    expect(validateSync(input)).toEqual([]);
    expect(
      validateSync(
        plainToInstance(SalvarIcmsRegrasDto, {
          ...input,
          enquadramentos: [{ ...row, ncm: '1905', aliquota_interna: 20.5 }],
        }),
      ),
    ).not.toEqual([]);
  });

  it('rejeita combinação duplicada e alíquotas inconsistentes', () => {
    expect(() => validarEnquadramentosIcms([row, row])).toThrow(
      BadRequestException,
    );
    expect(() =>
      validarEnquadramentosIcms([{ ...row, aliquota_interna: '7' }]),
    ).toThrow(BadRequestException);
    expect(() =>
      validarEnquadramentosIcms([{ ...row, uf_origem: 'ZZ' }]),
    ).toThrow(BadRequestException);
  });

  it('permite usar o ICMS destacado do XML no regime normal', () => {
    expect(() =>
      validarEnquadramentosIcms(
        [{ ...row, regime: 'LUCRO_REAL', aliquota_interestadual: undefined }],
        true,
      ),
    ).not.toThrow();
  });

  it('não permite classificar ST sem CEST identificado', () => {
    expect(() =>
      validarEnquadramentosIcms([
        { ...row, cest: null, tratamento: 'ICMS_ST' },
      ]),
    ).toThrow('informe o CEST');
  });

  it('não homologa pendência ou linha sem fundamento', () => {
    expect(() =>
      validarEnquadramentosIcms(
        [{ ...row, tratamento: 'CONFERIR', motivo: 'Revisar CEST' }],
        true,
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      validarEnquadramentosIcms([{ ...row, fundamento: '' }], true),
    ).toThrow(BadRequestException);
    expect(() =>
      validarEnquadramentosIcms(
        [{ ...row, confirmado_fiscalmente: false }],
        true,
      ),
    ).toThrow(BadRequestException);
    expect(() => validarEnquadramentosIcms([row], true)).not.toThrow();
  });
});
