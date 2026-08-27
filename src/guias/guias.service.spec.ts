import { GuiasService } from './guias.service';

describe('GuiasService - regime tributário', () => {
  it('bloqueia guia de ICMS para Simples Nacional sem apuração separada', async () => {
    const storage = { upload: jest.fn() };
    const service = new GuiasService(
      {} as never,
      storage as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await service.uploadGuia({
      actorUserId: 'user-1',
      client: {
        id: 'client-1',
        cnpj: '12345678000190',
        razaoSocial: 'Empresa Simples',
        emails: [],
        regimeTributario: 'SIMPLES_NACIONAL',
        apuraIcms: false,
      },
      bytes: Buffer.from('%PDF-1.4'),
      fileName: 'icms.pdf',
      tipo: 'ICMS',
      periodo: '08/2026',
      vencimento: null,
      valorNumerico: null,
      valorLabel: null,
      parcelaLabel: null,
      numeroParcelamento: null,
    });

    expect(result).toEqual({ ok: false, code: 'ICMS_NOT_APPLICABLE' });
    expect(storage.upload).not.toHaveBeenCalled();
  });
});
