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

  it('linhas confirmadas têm tratamento definido, fundamento e parâmetros de cálculo', () => {
    const confirmadas = ENQUADRAMENTOS_ANTECIPACAO_BA_2026.filter(
      (e) => e.confirmado_fiscalmente,
    );
    expect(confirmadas.length).toBeGreaterThan(0);
    for (const e of confirmadas) {
      expect(e.tratamento).not.toBe('CONFERIR');
      expect(e.fundamento?.trim()).toBeTruthy();
      if (e.tratamento === 'APLICAVEL') {
        expect(e.aliquota_interna).toBeTruthy();
        expect(e.aliquota_interestadual).toBeTruthy();
      }
    }
  });
  it('toda decisão de IPI vem com fundamento, e o texto não afirma norma inexistente', () => {
    const comIpi = ENQUADRAMENTOS_ANTECIPACAO_BA_2026.filter(
      (e) => e.ipi_na_base,
    );
    expect(comIpi.length).toBeGreaterThan(0);
    for (const e of comIpi) {
      expect(e.fundamento_ipi?.trim()).toBeTruthy();
      expect(e.fundamento_ipi).not.toMatch(
        /^(O IPI na Bahia faz parte da Base|A Bahia considera o IPI na base de cálculo)$/i,
      );
    }
  });
  it('não repete a mesma combinação de NCM, CEST, regime, origem e mercadoria', () => {
    const chaves = ENQUADRAMENTOS_ANTECIPACAO_BA_2026.map((e) =>
      [e.ncm, e.cest ?? '', e.regime, e.uf_origem, e.origem_mercadoria].join(
        '|',
      ),
    );
    expect(new Set(chaves).size).toBe(chaves.length);
  });
  it('mantém em CONFERIR as linhas sem decisão e fora do cálculo definitivo', () => {
    for (const e of ENQUADRAMENTOS_ANTECIPACAO_BA_2026) {
      if (e.tratamento === 'CONFERIR')
        expect(e.confirmado_fiscalmente).toBe(false);
    }
  });
});
