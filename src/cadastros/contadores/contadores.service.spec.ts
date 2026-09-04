import { ConflictException } from '@nestjs/common';
import { ContadoresService } from './contadores.service';

describe('ContadoresService', () => {
  it('bloqueia a exclusão de contador vinculado a clientes', async () => {
    const countQuery = {
      from: jest.fn(),
      where: jest.fn().mockResolvedValue([{ count: 2 }]),
    };
    countQuery.from.mockReturnValue(countQuery);
    const database = {
      db: {
        execute: jest.fn().mockResolvedValue([]),
        select: jest.fn().mockReturnValue(countQuery),
      },
    };
    const service = new ContadoresService(database as never);

    await expect(
      service.excluir('e07dfbac-a2c9-4fb1-a6aa-f8105d87897f'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
