import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { proximoReajuste, reajustarValor } from '../contrato-historico';
import { ReajusteContratoDto } from '../dto/contrato.dto';

describe('cálculo de reajustes contratuais', () => {
  it('respeita 12 meses completos e a competência mensal, inclusive na virada do ano', () => {
    expect(proximoReajuste('2024-01-01')).toBe('2025-01-01');
    expect(proximoReajuste('2024-11-12')).toBe('2025-12-01');
    expect(proximoReajuste('2024-12-31')).toBe('2026-01-01');
    expect(proximoReajuste('2024-02-29')).toBe('2025-03-01');
    expect(proximoReajuste(null)).toBeNull();
  });
  it('calcula em centavos com percentual de quatro casas e arredondamento por serviço', () => {
    expect(reajustarValor('100.00', 4.1234)).toBe('104.12');
    expect(reajustarValor('0.10', 5)).toBe('0.11');
    expect(reajustarValor('900.00', 10)).toBe('990.00');
    expect(() => reajustarValor('9999999999.99', 1000)).toThrow('limite');
  });
  it.each([-1, 0, NaN, 1001, 1.12345])(
    'rejeita percentual inválido (%s) na entrada da API',
    async (percentual) => {
      const dto = plainToInstance(ReajusteContratoDto, {
        percentual,
        competenciaInicio: '11/2026',
        motivo: 'Reajuste anual',
        versaoEsperada: 1,
      });
      const erros = await validate(dto);
      expect(erros.some((erro) => erro.property === 'percentual')).toBe(true);
    },
  );
});
