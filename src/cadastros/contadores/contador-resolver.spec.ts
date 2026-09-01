import { resolverContadorDoCliente } from './contador-resolver';

function databaseReturning(rows: unknown[]) {
  const chain = {
    select: jest.fn(),
    from: jest.fn(),
    where: jest.fn(),
    orderBy: jest.fn(),
    limit: jest.fn().mockResolvedValue(rows),
  };
  chain.select.mockReturnValue(chain);
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  return chain;
}

const CONTADOR = {
  id: 'e07dfbac-a2c9-4fb1-a6aa-f8105d87897f',
  nome: 'Maria Contadora',
  cpf: '12345678901',
  crc: 'BA-12345',
  cnpj: null,
  cep: null,
  logradouro: null,
  numero: null,
  complemento: null,
  bairro: null,
  telefone: null,
  fax: null,
  email: null,
  codigoMunicipioIbge: '2927408',
};

describe('resolverContadorDoCliente', () => {
  it('prioriza o vínculo explícito do cliente', async () => {
    const db = databaseReturning([CONTADOR]);
    const result = await resolverContadorDoCliente(db as never, CONTADOR.id);

    expect(result).toEqual({
      contador: CONTADOR,
      origem: 'VINCULO_EXPLICITO',
    });
    expect(db.where).toHaveBeenCalled();
  });

  it('assume automaticamente o único contador global', async () => {
    const db = databaseReturning([CONTADOR]);
    const result = await resolverContadorDoCliente(db as never, null);

    expect(result).toEqual({ contador: CONTADOR, origem: 'CONTADOR_UNICO' });
  });

  it('não escolhe arbitrariamente quando há mais de um contador', async () => {
    const db = databaseReturning([
      CONTADOR,
      { ...CONTADOR, id: '1ba18c2d-a551-4ccb-9776-9ccf9702bc63' },
    ]);

    await expect(
      resolverContadorDoCliente(db as never, null),
    ).resolves.toBeNull();
  });
});
