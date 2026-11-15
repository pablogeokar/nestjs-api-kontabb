import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { SalvarIcmsRegrasDto } from '../../fiscal/dto/icms-regras.dto';
import { validarEnquadramentosIcms } from '../../fiscal/services/icms-regras.service';
import { ENQUADRAMENTOS_ANTECIPACAO_BA_2026 } from './data/antecipacao-parcial-ba-2026.enquadramentos';

describe('seed ICMS BA 2026', () => {
  it('passa nas mesmas validações do cadastro de regras', () => {
    expect(() =>
      validarEnquadramentosIcms(ENQUADRAMENTOS_ANTECIPACAO_BA_2026 as never),
    ).not.toThrow();
    const dto = plainToInstance(SalvarIcmsRegrasDto, {
      uf: 'BA',
      competencia: '2026-01',
      fonte: 'RICMS-BA',
      expectedRevision: 1,
      enquadramentos: ENQUADRAMENTOS_ANTECIPACAO_BA_2026,
    });
    expect(
      validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }),
    ).toEqual([]);
  });

  it('nenhuma linha vem confirmada fiscalmente', () => {
    expect(
      ENQUADRAMENTOS_ANTECIPACAO_BA_2026.every(
        (e) => !e.confirmado_fiscalmente,
      ),
    ).toBe(true);
  });
});
