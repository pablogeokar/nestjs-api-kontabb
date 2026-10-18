import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { DanfeService } from './danfe.service';

describe('DanfeService', () => {
  it('encaminha NFS-e ao gerador de espelho em PDF', async () => {
    const row = {
      id: 'doc-nfse',
      xmlKey: 'clientes/cliente/nfse.xml',
      chaveAcesso: 'nfse-key',
      tipoDocumento: 'NFSE',
      situacao: 'AUTORIZADA',
    };
    const limit = jest.fn().mockResolvedValue([row]);
    const database = {
      db: { select: () => ({ from: () => ({ where: () => ({ limit }) }) }) },
    };
    const storage = {
      download: jest.fn().mockResolvedValue(Buffer.from('<CompNfse/>')),
    };
    const nfsePdf = {
      generatePdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-nfse%%EOF')),
    };
    const dacte = { generatePdf: jest.fn() };
    const service = new DanfeService(
      database as never,
      storage as never,
      dacte as never,
      nfsePdf,
    );

    const result = await service.getDanfePdf(row.id);

    expect(nfsePdf.generatePdf).toHaveBeenCalledWith('<CompNfse/>');
    expect(dacte.generatePdf).not.toHaveBeenCalled();
    expect(result.contentType).toBe('application/pdf');
  });

  it('aguarda o stream terminar antes de ler o PDF', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kontabb-danfe-test-'));
    const filePath = join(directory, 'danfe.pdf');
    const service = Object.create(DanfeService.prototype) as DanfeService;
    const internals = service as unknown as {
      waitForCompletePdf(path: string): Promise<Buffer>;
    };

    try {
      const pendingPdf = internals.waitForCompletePdf(filePath);
      await writeFile(filePath, '%PDF-1.3\nconteudo parcial');
      await delay(40);
      await appendFile(filePath, '\n%%EOF\n');

      const pdf = await pendingPdf;

      expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
      expect(pdf.subarray(-7).toString('ascii')).toContain('%%EOF');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
