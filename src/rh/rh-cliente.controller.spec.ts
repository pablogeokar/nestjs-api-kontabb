import { RhClienteController } from './rh-cliente.controller';
import type { CurrentUser } from '../common/types';

describe('RhClienteController', () => {
  const folhaId = '08383b59-970d-48a1-b3fc-8a2c1c640779';
  const itemFolhaId = '5de82d43-b392-4428-a8de-fbbf0b79e4f1';
  const client = { id: 'cliente-id' };
  const currentUser: CurrentUser = {
    id: 'cliente-user-id',
    name: 'Cliente de teste',
    email: 'cliente@example.com',
    role: 'CLIENTE',
  };

  function createController() {
    const rhService = {
      getFolhaClienteId: jest.fn().mockResolvedValue(client.id),
      getFolhaDetail: jest.fn().mockResolvedValue({ id: folhaId }),
      getFolhaDocumentoKey: jest.fn().mockResolvedValue('rh/folha.pdf'),
      getAllRecibosByFolha: jest.fn().mockResolvedValue([{ id: itemFolhaId }]),
      getItemFolhaContext: jest
        .fn()
        .mockResolvedValue({ clienteId: client.id, folhaId }),
      getRecibo: jest.fn().mockResolvedValue({ id: itemFolhaId }),
      recordFolhaView: jest.fn().mockResolvedValue(undefined),
    };
    const clientesService = {
      getClientForUser: jest.fn().mockResolvedValue(client),
    };
    const storage = {
      getSignedUrl: jest
        .fn()
        .mockResolvedValue('https://storage.example/folha'),
    };
    const controller = new RhClienteController(
      rhService as never,
      clientesService as never,
      storage as never,
    );
    return { controller, rhService, storage };
  }

  it('registra a abertura dos detalhes da folha', async () => {
    const { controller, rhService } = createController();

    await controller.getFolha(folhaId, currentUser);

    expect(rhService.recordFolhaView).toHaveBeenCalledWith(
      folhaId,
      currentUser.id,
    );
  });

  it('registra o download da folha ou recibo de férias', async () => {
    const { controller, rhService } = createController();

    await controller.downloadFolha(folhaId, currentUser);

    expect(rhService.recordFolhaView).toHaveBeenCalledWith(
      folhaId,
      currentUser.id,
    );
  });

  it('registra a geração dos recibos da folha', async () => {
    const { controller, rhService } = createController();

    await controller.getAllRecibos(folhaId, currentUser);

    expect(rhService.recordFolhaView).toHaveBeenCalledWith(
      folhaId,
      currentUser.id,
    );
  });

  it('registra a consulta de um recibo individual na folha correspondente', async () => {
    const { controller, rhService } = createController();

    await controller.getRecibo(itemFolhaId, currentUser);

    expect(rhService.recordFolhaView).toHaveBeenCalledWith(
      folhaId,
      currentUser.id,
    );
  });

  it('não devolve o conteúdo quando o registro de acesso falha', async () => {
    const { controller, rhService } = createController();
    rhService.recordFolhaView.mockRejectedValue(
      new Error('database unavailable'),
    );

    await expect(controller.getFolha(folhaId, currentUser)).rejects.toThrow(
      'database unavailable',
    );
  });
});
