import type { ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service';

/**
 * Testes leves de defesa em profundidade para a composição de chaves R2
 * ([BAIXA] 11): segmentos derivados de dados devem ser rejeitados quando
 * contêm separadores de caminho ou sequências de traversal, e aceitos
 * (sem alterar o formato) para CNPJ/CPF válidos.
 */
describe('StorageService — sanitização de segmentos de chave', () => {
  function createService(): StorageService {
    const config = {
      getOrThrow: (key: string) => `test-${key}`,
    } as unknown as ConfigService;
    return new StorageService(config);
  }

  it('rejeita segmento contendo "/" (path traversal)', () => {
    const service = createService();
    expect(() =>
      service.receiptObjectKey({
        cnpjCpf: 'clientes/../outro',
        receiptId: 'abc',
        extension: 'pdf',
      }),
    ).toThrow(/Segmento de chave R2 inválido/);
  });

  it('rejeita segmento contendo ".."', () => {
    const service = createService();
    expect(() =>
      service.logoObjectKey({ cnpjCpf: '..', extension: 'png' }),
    ).toThrow(/Segmento de chave R2 inválido/);
  });

  it('aceita CNPJ válido sem alterar o formato da chave', () => {
    const service = createService();
    const key = service.logoObjectKey({
      cnpjCpf: '12345678000190',
      extension: 'png',
    });
    expect(key).toBe('clientes/12345678000190/logo.png');
  });

  it('aceita CPF numérico válido sem alterar o formato da chave', () => {
    const service = createService();
    const key = service.receiptObjectKey({
      cnpjCpf: '12345678901',
      receiptId: '00000000-0000-4000-8000-000000000000',
      extension: 'pdf',
    });
    expect(key).toBe(
      'clientes/12345678901/comprovantes/00000000-0000-4000-8000-000000000000.pdf',
    );
  });
});
