import { RecuperacaoPortalService } from './recuperacao-portal.service';
import { parseManualFiscalXml } from './dfe-document.parser';
import { RecuperacaoPortalController } from '../controllers/recuperacao-portal.controller';
import { AuthGuard } from '../../auth/auth.guard';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../../auth/roles.decorator';
import { validate } from 'class-validator';
import { PrepararRecuperacaoPortalDto } from '../dto/recuperacao-portal.dto';

jest.mock('./dfe-document.parser', () => ({ parseManualFiscalXml: jest.fn() }));
const KEY = '29260112345678000195550010000001231123456780';
// Generate checksum from the synthetic 43-character prefix.
const base = '2926011234567800019555001000000123112345678';
let sum = 0;
for (let i = 42, w = 2; i >= 0; i--, w = w === 9 ? 2 : w + 1)
  sum += Number(base[i]) * w;
const chave = base + (sum % 11 < 2 ? 0 : 11 - (sum % 11));
const file = {
  buffer: Buffer.from('<nfeProc><Signature></Signature></nfeProc>'),
} as Express.Multer.File;

describe('Recuperação assistida', () => {
  const chaves = { analisar: jest.fn() };
  const xml = { importar: jest.fn() };
  const service = new RecuperacaoPortalService(chaves as never, xml as never);
  beforeEach(() => jest.resetAllMocks());
  it('prepara somente pendências sem fazer consulta externa', async () => {
    chaves.analisar.mockResolvedValue({
      itens: [
        {
          valida: true,
          modelo: '55',
          status_local: 'NOVA',
          chave_acesso: chave,
        },
        {
          valida: true,
          modelo: '55',
          status_local: 'JA_IMPORTADA',
          chave_acesso: KEY,
        },
      ],
      resumo: { ja_existentes: 1 },
    });
    expect(await service.preparar('cliente', [chave, KEY])).toEqual({
      clienteId: 'cliente',
      chaves: [chave],
      jaExistentes: 1,
    });
    expect(xml.importar).not.toHaveBeenCalled();
  });
  it('rejeita modelo fora da NF-e', async () => {
    chaves.analisar.mockResolvedValue({
      itens: [{ valida: true, modelo: '65' }],
    });
    await expect(service.preparar('cliente', [chave])).rejects.toThrow(
      'modelo 55',
    );
  });
  it('rejeita XML de outra chave antes de persistir', async () => {
    jest.mocked(parseManualFiscalXml).mockReturnValue({
      status: 'DOCUMENTO',
      documento: { tipoDocumento: 'NFE', chaveAcesso: 'outra' },
    } as never);
    await expect(
      service.importar({
        clienteId: 'cliente',
        chave,
        file,
        actorUserId: 'user',
        requestId: 'request',
      }),
    ).rejects.toThrow('chave solicitada');
    expect(xml.importar).not.toHaveBeenCalled();
  });
  it('preserva empresa, identidade e resultado de duplicidade/revisão da importação existente', async () => {
    jest.mocked(parseManualFiscalXml).mockReturnValue({
      status: 'DOCUMENTO',
      documento: { tipoDocumento: 'NFE', chaveAcesso: chave },
    } as never);
    xml.importar.mockResolvedValue({
      importados: 0,
      duplicados: 1,
      erros: 0,
      pendentes_revisao: 1,
    });
    const result = await service.importar({
      clienteId: 'cliente',
      chave,
      file,
      actorUserId: 'user',
      requestId: 'request',
    });
    expect(xml.importar).toHaveBeenCalledWith({
      clienteId: 'cliente',
      files: [file],
      actorUserId: 'user',
      requestId: 'request',
    });
    expect(result).toMatchObject({ duplicados: 1, pendentes_revisao: 1 });
  });
  it('rejeita arquivo ausente e entrada não limitada', async () => {
    await expect(
      service.importar({
        clienteId: 'cliente',
        chave,
        file: undefined as never,
        actorUserId: 'user',
        requestId: 'request',
      }),
    ).rejects.toThrow('10 MB');
    const dto = Object.assign(new PrepararRecuperacaoPortalDto(), {
      clienteId: 'invalid',
      chaves: Array(501).fill(chave),
    });
    expect((await validate(dto)).length).toBeGreaterThan(0);
  });
  it('exige sessão e papel da equipe nos dois endpoints', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, RecuperacaoPortalController),
    ).toContain(AuthGuard);
    expect(Reflect.getMetadata(ROLES_KEY, RecuperacaoPortalController)).toEqual(
      ['ADMIN', 'COLABORADOR'],
    );
  });
});
