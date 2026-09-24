import {
  CertificadoMetadata,
  CertificadoService,
  extractCertificateCnpj,
  normalizeCertificateCnpj,
} from './certificado.service';

describe('identificação do certificado A1', () => {
  it('normaliza CNPJ numérico legado e CNPJ alfanumérico', () => {
    expect(normalizeCertificateCnpj('09.157.533/0001-56')).toBe(
      '09157533000156',
    );
    expect(normalizeCertificateCnpj('12.abc.345/01de-95')).toBe(
      '12ABC34501DE95',
    );
  });

  it('mantém os dois dígitos verificadores estritamente numéricos', () => {
    expect(normalizeCertificateCnpj('12ABC34501DE9X')).toBeNull();
    expect(normalizeCertificateCnpj('12ABC34501DE9')).toBeNull();
  });

  it('extrai o CNPJ do CN do certificado sem incorporar o nome empresarial', () => {
    expect(extractCertificateCnpj('EMPRESA EXEMPLO:12ABC34501DE95')).toBe(
      '12ABC34501DE95',
    );
    expect(extractCertificateCnpj('EMPRESA EXEMPLO: 09.157.533/0001-56')).toBe(
      '09157533000156',
    );
  });
});

describe('substituição de certificado A1', () => {
  const clienteId = '11111111-1111-4111-8111-111111111111';

  beforeEach(() => {
    process.env.CERTIFICATE_ENCRYPTION_KEY =
      'test-certificate-key-32-characters-long';
  });

  it('remove todos os registros anteriores e agenda a exclusão dos respectivos arquivos', async () => {
    const certificadosAnteriores = [
      { id: 'certificado-anterior-1', arquivoKey: 'certificados/anterior-1' },
      { id: 'certificado-anterior-2', arquivoKey: 'certificados/anterior-2' },
    ];
    const initialQuery = {
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest
            .fn()
            .mockResolvedValue([{ id: clienteId, cnpj: '09.157.533/0001-56' }]),
        }),
      }),
    };
    const lockClientQuery = {
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          for: jest.fn().mockResolvedValue([{ id: clienteId }]),
        }),
      }),
    };
    const previousCertificatesQuery = {
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue(certificadosAnteriores),
      }),
    };
    const deleteWhere = jest.fn().mockResolvedValue(undefined);
    const insertCertificateValues = jest.fn().mockResolvedValue(undefined);
    const cleanupReturning = jest
      .fn()
      .mockResolvedValue([{ id: 'cleanup-1' }, { id: 'cleanup-2' }]);
    const cleanupOnConflictDoNothing = jest.fn().mockReturnValue({
      returning: cleanupReturning,
    });
    const insertCleanupValues = jest.fn().mockReturnValue({
      onConflictDoNothing: cleanupOnConflictDoNothing,
    });
    const tx = {
      select: jest
        .fn()
        .mockReturnValueOnce(lockClientQuery)
        .mockReturnValueOnce(previousCertificatesQuery),
      delete: jest.fn().mockReturnValue({ where: deleteWhere }),
      insert: jest
        .fn()
        .mockReturnValueOnce({ values: insertCertificateValues })
        .mockReturnValueOnce({ values: insertCleanupValues }),
    };
    const database = {
      db: {
        select: jest.fn().mockReturnValue(initialQuery),
        transaction: jest.fn(async (callback) => callback(tx)),
      },
    };
    const storage = {
      upload: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    const storageCleanup = {
      processJobs: jest.fn().mockResolvedValue({
        processed: 2,
        completed: 2,
        failed: 0,
      }),
    };
    const logger = {
      error: jest.fn(),
      warn: jest.fn(),
    };
    const service = new CertificadoService(
      database as never,
      storage as never,
      storageCleanup as never,
      logger as never,
    );
    const metadata: CertificadoMetadata = {
      cnpj: '09157533000156',
      razaoSocial: 'Empresa Exemplo',
      emissor: 'Autoridade Certificadora',
      thumbprint: 'thumbprint',
      validadeInicio: new Date('2026-01-01T00:00:00.000Z'),
      validadeFim: new Date('2027-01-01T00:00:00.000Z'),
    };
    Object.defineProperty(service, 'extractPfxMetadata', {
      value: jest.fn().mockReturnValue(metadata),
    });

    await service.uploadCertificado({
      clienteId,
      pfxBuffer: Buffer.from('certificado'),
      senha: 'senha-segura',
      uploadadoPor: 'usuario-1',
    });

    expect(deleteWhere).toHaveBeenCalledTimes(1);
    expect(insertCertificateValues).toHaveBeenCalledWith(
      expect.objectContaining({ clienteId, cnpj: metadata.cnpj }),
    );
    expect(insertCleanupValues).toHaveBeenCalledWith([
      {
        objectKey: 'certificados/anterior-1',
        entidadeTipo: 'CERTIFICADO_DIGITAL',
        entidadeId: 'certificado-anterior-1',
      },
      {
        objectKey: 'certificados/anterior-2',
        entidadeTipo: 'CERTIFICADO_DIGITAL',
        entidadeId: 'certificado-anterior-2',
      },
    ]);
    expect(storageCleanup.processJobs).toHaveBeenCalledWith(
      ['cleanup-1', 'cleanup-2'],
      { userId: 'usuario-1', trigger: 'certificate_replacement' },
    );
  });
});
