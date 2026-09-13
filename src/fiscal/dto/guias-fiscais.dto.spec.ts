import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CriarGuiaDto, MarcarPagamentoGuiaDto } from './guias-fiscais.dto';

const VALID_UUID = '22222222-2222-4222-8222-222222222222';

async function propriedadesInvalidas<T extends object>(dto: T) {
  const errors = await validate(dto);
  return errors.map((error) => error.property);
}

describe('CriarGuiaDto', () => {
  const base = {
    clienteId: VALID_UUID,
    competencia: '2026-08',
    tributo: 'ICMS_PROPRIO',
    ufFavorecida: 'SP',
    tipoGuia: 'DAE',
    codigoReceita: '046',
    dataVencimento: '2026-09-10',
    valorPrincipal: '100.00',
    valorMulta: '0',
    valorJuros: '0',
  };

  it('aceita uma guia válida', async () => {
    const dto = plainToInstance(CriarGuiaDto, base);
    expect(await validate(dto)).toEqual([]);
  });

  it('normaliza a UF para maiúsculas', async () => {
    const dto = plainToInstance(CriarGuiaDto, { ...base, ufFavorecida: 'sp' });
    expect(await validate(dto)).toEqual([]);
    expect(dto.ufFavorecida).toBe('SP');
  });

  it('rejeita clienteId que não é UUID', async () => {
    const dto = plainToInstance(CriarGuiaDto, { ...base, clienteId: 'x' });
    expect(await propriedadesInvalidas(dto)).toContain('clienteId');
  });

  it('rejeita competência inválida', async () => {
    const dto = plainToInstance(CriarGuiaDto, {
      ...base,
      competencia: '2026-00',
    });
    expect(await propriedadesInvalidas(dto)).toContain('competencia');
  });

  it('rejeita tributo fora do domínio', async () => {
    const dto = plainToInstance(CriarGuiaDto, { ...base, tributo: 'INVENTADO' });
    expect(await propriedadesInvalidas(dto)).toContain('tributo');
  });

  it('rejeita tipoGuia fora do domínio', async () => {
    const dto = plainToInstance(CriarGuiaDto, { ...base, tipoGuia: 'XPTO' });
    expect(await propriedadesInvalidas(dto)).toContain('tipoGuia');
  });

  it.each(['SPP', 'S1', '12'])(
    'rejeita UF fora do formato de 2 letras %p',
    async (ufFavorecida) => {
      const dto = plainToInstance(CriarGuiaDto, { ...base, ufFavorecida });
      expect(await propriedadesInvalidas(dto)).toContain('ufFavorecida');
    },
  );

  it('rejeita dataVencimento inválida', async () => {
    const dto = plainToInstance(CriarGuiaDto, {
      ...base,
      dataVencimento: '10-09-2026',
    });
    expect(await propriedadesInvalidas(dto)).toContain('dataVencimento');
  });

  it('rejeita valorPrincipal negativo', async () => {
    const dto = plainToInstance(CriarGuiaDto, {
      ...base,
      valorPrincipal: '-100.00',
    });
    expect(await propriedadesInvalidas(dto)).toContain('valorPrincipal');
  });

  it('rejeita valorMulta negativo', async () => {
    const dto = plainToInstance(CriarGuiaDto, {
      ...base,
      valorMulta: '-1',
    });
    expect(await propriedadesInvalidas(dto)).toContain('valorMulta');
  });
});

describe('MarcarPagamentoGuiaDto', () => {
  it('aceita status de pagamento válido', async () => {
    const dto = plainToInstance(MarcarPagamentoGuiaDto, {
      clienteId: VALID_UUID,
      statusPagamento: 'PAGO',
    });
    expect(await validate(dto)).toEqual([]);
  });

  it('rejeita status fora do domínio', async () => {
    const dto = plainToInstance(MarcarPagamentoGuiaDto, {
      clienteId: VALID_UUID,
      statusPagamento: 'ATRASADO',
    });
    expect(await propriedadesInvalidas(dto)).toContain('statusPagamento');
  });

  it('rejeita clienteId inválido', async () => {
    const dto = plainToInstance(MarcarPagamentoGuiaDto, {
      clienteId: 'nope',
      statusPagamento: 'PAGO',
    });
    expect(await propriedadesInvalidas(dto)).toContain('clienteId');
  });
});
