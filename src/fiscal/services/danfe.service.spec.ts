import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { DanfeService } from './danfe.service';

function harness(
  tipoDocumento: string,
  modelo: string,
  situacao = 'AUTORIZADA',
) {
  const row = {
    id: 'documento',
    xmlKey: 'clientes/cliente/documento.xml',
    chaveAcesso: 'chave',
    tipoDocumento,
    modelo,
    situacao,
  };
  const limit = jest.fn().mockResolvedValue([row]);
  const database = {
    db: { select: () => ({ from: () => ({ where: () => ({ limit }) }) }) },
  };
  const storage = {
    download: jest.fn().mockResolvedValue(Buffer.from('<documento/>')),
  };
  const pdf = Buffer.from('%PDF-1.7\n%%EOF');
  const dacte = { generatePdf: jest.fn().mockResolvedValue(pdf) };
  const nfse = { generatePdf: jest.fn().mockResolvedValue(pdf) };
  const nfe = { generatePdf: jest.fn().mockResolvedValue(pdf) };
  const service = new DanfeService(
    database as never,
    storage as never,
    dacte as never,
    nfse,
    nfe as never,
  );
  return { service, storage, dacte, nfse, nfe, pdf };
}

describe('DanfeService', () => {
  it.each([
    ['NFE', '55', 'nfe'],
    ['NFCE', '65', 'nfe'],
    ['NFE', '65', 'nfe'],
    ['CTE', '57', 'dacte'],
    ['NFSE', 'NFSE', 'nfse'],
  ])('roteia %s modelo %s para %s em memória', async (type, model, target) => {
    const context = harness(type, model);
    const result = await context.service.getDanfePdf('documento');
    expect(result).toEqual({
      buffer: context.pdf,
      contentType: 'application/pdf',
    });
    expect(context.storage.download).toHaveBeenCalledWith(
      'clientes/cliente/documento.xml',
    );
    for (const name of ['nfe', 'dacte', 'nfse'] as const) {
      expect(context[name].generatePdf).toHaveBeenCalledTimes(
        name === target ? 1 : 0,
      );
    }
  });

  it('não gera PDF para documento resumido', async () => {
    const context = harness('NFE', '55', 'RESUMIDA');
    await expect(
      context.service.getDanfePdf('documento'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(context.storage.download).not.toHaveBeenCalled();
  });

  it('converte falha do gerador em indisponibilidade', async () => {
    const context = harness('NFE', '55');
    context.nfe.generatePdf.mockRejectedValue(new Error('XML inválido'));
    await expect(
      context.service.getDanfePdf('documento'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
