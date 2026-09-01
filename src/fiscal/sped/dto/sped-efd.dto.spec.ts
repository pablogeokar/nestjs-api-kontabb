import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AtualizarSpedConfiguracaoDto } from './sped-efd.dto';

function validConfiguration(overrides: Record<string, unknown> = {}) {
  return {
    obrigadoEfdIcmsIpi: true,
    perfilEfd: 'A',
    indAtiv: '1',
    codigoMunicipioIbge: '2927408',
    inventarioObrigatorio: true,
    blocoKComMovimento: false,
    tipoItemPadrao: '00',
    ...overrides,
  };
}

describe('AtualizarSpedConfiguracaoDto', () => {
  it('mantém fevereiro como mês padrão para clientes anteriores', async () => {
    const dto = plainToInstance(
      AtualizarSpedConfiguracaoDto,
      validConfiguration(),
    );

    expect(await validate(dto)).toEqual([]);
    expect(dto.mesEntregaInventario).toBe(2);
  });

  it('normaliza o mês recebido como string e restringe o intervalo', async () => {
    const valid = plainToInstance(
      AtualizarSpedConfiguracaoDto,
      validConfiguration({ mesEntregaInventario: '3' }),
    );
    const invalid = plainToInstance(
      AtualizarSpedConfiguracaoDto,
      validConfiguration({ mesEntregaInventario: '13' }),
    );

    expect(await validate(valid)).toEqual([]);
    expect(valid.mesEntregaInventario).toBe(3);
    expect(await validate(invalid)).toEqual([
      expect.objectContaining({ property: 'mesEntregaInventario' }),
    ]);
  });
});
