import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ImportacaoXmlFiscalService } from './importacao-xml-fiscal.service';
import { FiscalClosingService } from './fiscal-closing.service';
import { FiscalPeriodSelectionService } from './fiscal-period-selection.service';

describe('ImportacaoXmlFiscalService.excluirMovimentacaoMes', () => {
  const storage = { deleteMany: jest.fn() };
  const logger = { info: jest.fn(), error: jest.fn() };

  function setup(options: {
    fechado?: boolean;
    preservadosSefaz?: number;
    removidos?: Array<{
      id: string;
      xmlKey: string;
      danfeKey: string | null;
      tipoDocumento: string;
    }>;
  }) {
    const deleteWhere = jest.fn().mockReturnValue({
      returning: jest.fn().mockResolvedValue(options.removidos ?? []),
    });
    // 1ª consulta: fechamento corrente (com limit); 2ª: contagem dos
    // documentos DF-e preservados (aguardada direto do where).
    const select = jest
      .fn()
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest
              .fn()
              .mockResolvedValue(
                options.fechado ? [{ obrigacao: 'EFD_ICMS_IPI' }] : [],
              ),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest
            .fn()
            .mockResolvedValue([{ total: options.preservadosSefaz ?? 0 }]),
        }),
      });
    const tx = {
      select,
      delete: jest.fn().mockReturnValue({ where: deleteWhere }),
      execute: jest.fn().mockResolvedValue(undefined),
    };
    const auditValues = jest.fn().mockResolvedValue(undefined);
    const db = {
      transaction: jest.fn(
        (callback: (t: typeof tx) => Promise<unknown>, _opts: unknown) =>
          callback(tx),
      ),
      insert: jest.fn().mockReturnValue({ values: auditValues }),
    };
    // Serviço de fechamento REAL: valida o formato da competência do escopo
    // (regressão: '2026-09-01' era rejeitado com 400).
    const closing = new FiscalClosingService(
      { db } as never,
      new FiscalPeriodSelectionService(),
    );
    jest.spyOn(closing, 'withEscopoLock');
    const service = new ImportacaoXmlFiscalService(
      { db } as never,
      storage as never,
      logger as never,
      {} as never,
      {} as never,
      closing as never,
    );
    jest.spyOn(service as any, 'findClienteById').mockResolvedValue({
      id: 'cliente-1',
      cnpj: '12345678000195',
      razaoSocial: 'Empresa',
    });
    return { service, tx, db, closing, auditValues };
  }

  const baseInput = {
    clienteId: 'cliente-1',
    competencia: '2026-09',
    actorUserId: 'user-1',
    requestId: 'req-1',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    storage.deleteMany.mockResolvedValue({ failedKeys: [] });
  });

  it('exclui os documentos manuais do mês, remove os arquivos em lote e audita', async () => {
    const { service, tx, closing, auditValues } = setup({
      preservadosSefaz: 4,
      removidos: [
        {
          id: 'd1',
          xmlKey: 'k1.xml',
          danfeKey: 'k1.pdf',
          tipoDocumento: 'NFE',
        },
        { id: 'd2', xmlKey: 'k2.xml', danfeKey: null, tipoDocumento: 'CTE' },
        { id: 'd3', xmlKey: 'k3.xml', danfeKey: null, tipoDocumento: 'NFE' },
      ],
    });

    const result = await service.excluirMovimentacaoMes(baseInput);

    expect(closing.withEscopoLock).toHaveBeenCalledWith(
      tx,
      {
        clienteId: 'cliente-1',
        obrigacao: 'EFD_ICMS_IPI',
        competencia: '2026-09',
      },
      expect.any(Function),
    );
    expect(tx.execute).toHaveBeenCalledTimes(1); // advisory lock do escopo
    expect(tx.delete).toHaveBeenCalledTimes(1);
    expect(storage.deleteMany).toHaveBeenCalledTimes(1);
    expect(storage.deleteMany).toHaveBeenCalledWith([
      'k1.xml',
      'k1.pdf',
      'k2.xml',
      'k3.xml',
    ]);
    expect(auditValues).toHaveBeenCalledWith(
      expect.objectContaining({
        acao: 'MOVIMENTACAO_FISCAL_MES_EXCLUIDA',
        entidadeId: 'cliente-1',
      }),
    );
    expect(result).toEqual({
      cliente_id: 'cliente-1',
      competencia: '2026-09',
      documentos_excluidos: 3,
      por_tipo: { NFE: 2, CTE: 1 },
      documentos_preservados_sefaz: 4,
      objetos_nao_removidos: 0,
    });
  });

  it('recusa a exclusão quando a competência está fechada', async () => {
    const { service, tx } = setup({ fechado: true });

    await expect(service.excluirMovimentacaoMes(baseInput)).rejects.toThrow(
      ConflictException,
    );
    expect(tx.delete).not.toHaveBeenCalled();
    expect(storage.deleteMany).not.toHaveBeenCalled();
  });

  it('não falha a operação quando a limpeza do storage falha', async () => {
    storage.deleteMany.mockResolvedValueOnce({ failedKeys: ['k1.xml'] });
    const { service } = setup({
      removidos: [
        { id: 'd1', xmlKey: 'k1.xml', danfeKey: null, tipoDocumento: 'NFE' },
      ],
    });

    const result = await service.excluirMovimentacaoMes(baseInput);

    expect(result.documentos_excluidos).toBe(1);
    expect(result.objetos_nao_removidos).toBe(1);
    expect(logger.error).toHaveBeenCalled();
  });

  it('não audita quando não há movimentação manual no mês', async () => {
    const { service, db } = setup({ removidos: [], preservadosSefaz: 2 });

    const result = await service.excluirMovimentacaoMes(baseInput);

    expect(result.documentos_excluidos).toBe(0);
    expect(result.documentos_preservados_sefaz).toBe(2);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('valida a competência', async () => {
    const { service } = setup({});
    await expect(
      service.excluirMovimentacaoMes({ ...baseInput, competencia: '2026-13' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('retorna 404 para empresa inexistente', async () => {
    const { service } = setup({});
    jest.spyOn(service as any, 'findClienteById').mockResolvedValue(null);
    await expect(service.excluirMovimentacaoMes(baseInput)).rejects.toThrow(
      NotFoundException,
    );
  });
});
