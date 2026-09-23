import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  BaixarBemCiapDto,
  CiapCompetenciaDto,
  RegistrarBemCiapDto,
} from './ciap.dto';

const VALID_UUID = '11111111-1111-4111-8111-111111111111';

async function propriedadesInvalidas<T extends object>(dto: T) {
  const errors = await validate(dto);
  return errors.map((error) => error.property);
}

describe('CiapCompetenciaDto', () => {
  const base = { clienteId: VALID_UUID, competencia: '2026-08' };

  it('aceita cliente UUID e competência AAAA-MM', async () => {
    const dto = plainToInstance(CiapCompetenciaDto, base);
    expect(await validate(dto)).toEqual([]);
  });

  it('rejeita clienteId que não é UUID', async () => {
    const dto = plainToInstance(CiapCompetenciaDto, {
      ...base,
      clienteId: 'nao-e-uuid',
    });
    expect(await propriedadesInvalidas(dto)).toContain('clienteId');
  });

  it.each(['2026-13', '202608', '2026/08', ''])(
    'rejeita competência inválida %p',
    async (competencia) => {
      const dto = plainToInstance(CiapCompetenciaDto, { ...base, competencia });
      expect(await propriedadesInvalidas(dto)).toContain('competencia');
    },
  );
});

describe('RegistrarBemCiapDto', () => {
  const base = {
    clienteId: VALID_UUID,
    codigoBem: 'BEM-001',
    identificacaoBem: 'Torno CNC',
    dataEntrada: '2026-08-15',
    valorIcmsTotal: '1200.00',
    valorIcmsFrete: '10.00',
    valorIcmsDifal: '0',
    quantidadeParcelas: 48,
  };

  it('aceita um bem válido', async () => {
    const dto = plainToInstance(RegistrarBemCiapDto, base);
    expect(await validate(dto)).toEqual([]);
  });

  it('aceita campos opcionais ausentes', async () => {
    const dto = plainToInstance(RegistrarBemCiapDto, {
      clienteId: VALID_UUID,
      codigoBem: 'BEM-002',
      identificacaoBem: 'Prensa',
      dataEntrada: '2026-08-15',
      valorIcmsTotal: '500',
    });
    expect(await validate(dto)).toEqual([]);
  });

  it('rejeita clienteId inválido', async () => {
    const dto = plainToInstance(RegistrarBemCiapDto, {
      ...base,
      clienteId: '123',
    });
    expect(await propriedadesInvalidas(dto)).toContain('clienteId');
  });

  it('rejeita dataEntrada fora do formato AAAA-MM-DD', async () => {
    const dto = plainToInstance(RegistrarBemCiapDto, {
      ...base,
      dataEntrada: '15/08/2026',
    });
    expect(await propriedadesInvalidas(dto)).toContain('dataEntrada');
  });

  it.each(['-1', '-10.00', 'abc', '', '10,00'])(
    'rejeita valorIcmsTotal não numérico ou negativo %p',
    async (valorIcmsTotal) => {
      const dto = plainToInstance(RegistrarBemCiapDto, {
        ...base,
        valorIcmsTotal,
      });
      expect(await propriedadesInvalidas(dto)).toContain('valorIcmsTotal');
    },
  );

  it('rejeita valorIcmsFrete negativo', async () => {
    const dto = plainToInstance(RegistrarBemCiapDto, {
      ...base,
      valorIcmsFrete: '-5.00',
    });
    expect(await propriedadesInvalidas(dto)).toContain('valorIcmsFrete');
  });

  it.each([0, -1, 49, 100])(
    'rejeita quantidadeParcelas fora do limite 1..48 (%p)',
    async (quantidadeParcelas) => {
      const dto = plainToInstance(RegistrarBemCiapDto, {
        ...base,
        quantidadeParcelas,
      });
      expect(await propriedadesInvalidas(dto)).toContain('quantidadeParcelas');
    },
  );

  it.each([1, 24, 48])(
    'aceita quantidadeParcelas dentro do limite (%p)',
    async (quantidadeParcelas) => {
      const dto = plainToInstance(RegistrarBemCiapDto, {
        ...base,
        quantidadeParcelas,
      });
      expect(await validate(dto)).toEqual([]);
    },
  );
});

describe('BaixarBemCiapDto', () => {
  const base = {
    clienteId: VALID_UUID,
    dataBaixa: '2026-08-31',
    motivoBaixa: '01',
  };

  it('aceita uma baixa válida', async () => {
    const dto = plainToInstance(BaixarBemCiapDto, base);
    expect(await validate(dto)).toEqual([]);
  });

  it('rejeita motivoBaixa fora do domínio', async () => {
    const dto = plainToInstance(BaixarBemCiapDto, {
      ...base,
      motivoBaixa: '04',
    });
    expect(await propriedadesInvalidas(dto)).toContain('motivoBaixa');
  });

  it('rejeita dataBaixa inválida', async () => {
    const dto = plainToInstance(BaixarBemCiapDto, {
      ...base,
      dataBaixa: '2026-08',
    });
    expect(await propriedadesInvalidas(dto)).toContain('dataBaixa');
  });
});
