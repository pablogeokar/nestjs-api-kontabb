import {
  buildAccessKey,
  buildDanfeXml,
  NFCE_QR_CODE,
} from './__fixtures__/danfe-xml';
import { parseDanfeXml } from './danfe-nfe.parser';

describe('parseDanfeXml', () => {
  it('extrai DANFE autorizado modelo 55, itens e dados fiscais', () => {
    const data = parseDanfeXml(buildDanfeXml('55'));
    expect(data).toMatchObject({
      chaveAcesso: buildAccessKey('55'),
      modelo: '55',
      numero: '123',
      status: 'AUTORIZADA',
      protocolo: '129240000123456',
      inscricaoEstadualSt: '99887766',
      saida: '2024-08-15T11:00:00-03:00',
      emitente: { nome: 'Emitente Exemplo Ltda', documento: '12345678000195' },
      destinatario: { bairro: 'Comércio', municipio: 'Salvador', uf: 'BA' },
      transporte: { placa: 'ABC1D23', ufVeiculo: 'BA', rntrc: '12345678' },
      volumes: { marca: 'TESTE', numero: '123' },
      totais: { valorNota: '21.00', valorIcms: '3.60' },
    });
    expect(data.itens).toHaveLength(2);
    expect(data.itens[0]).toMatchObject({
      codigo: 'P-1',
      cst: '00',
      valorIpi: '0.50',
      aliqIpi: '5.00',
    });
    expect(data.duplicatas[0]).toMatchObject({ numero: '001', valor: '21.00' });
  });

  it('preserva o QR Code original da NFC-e e aceita NFe isolada', () => {
    const data = parseDanfeXml(
      buildDanfeXml('65', {
        homologacao: true,
        standalone: true,
      }),
    );
    expect(data.modelo).toBe('65');
    expect(data.ambiente).toBe('HOMOLOGAÇÃO');
    expect(data.status).toBe('SEM PROTOCOLO');
    expect(data.qrCode).toBe(NFCE_QR_CODE);
    expect(data.pagamentos[0]).toEqual({
      tipo: '01',
      descricao: '',
      valor: '25.00',
    });
    expect(data.troco).toBe('4.00');
  });

  it('rejeita chave e protocolo divergentes', () => {
    const xml = buildDanfeXml('55').replace(
      `<chNFe>${buildAccessKey('55')}</chNFe>`,
      `<chNFe>${buildAccessKey('65')}</chNFe>`,
    );
    expect(() => parseDanfeXml(xml)).toThrow('Chave de acesso');
  });

  it('rejeita DTD e XML malformado', () => {
    expect(() => parseDanfeXml('<!DOCTYPE foo><NFe/>')).toThrow('DTD');
    expect(() => parseDanfeXml('<NFe>')).toThrow('malformado');
  });
});
