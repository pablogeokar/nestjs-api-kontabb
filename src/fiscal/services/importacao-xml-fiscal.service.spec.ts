import { ImportacaoXmlFiscalService } from './importacao-xml-fiscal.service';
import { documentosFiscaisItens } from '../../database/schema';
import {
  parseManualFiscalXml,
  type ParsedDocumentoFiscal,
} from './dfe-document.parser';

describe('ImportacaoXmlFiscalService', () => {
  const storage = {
    upload: jest.fn(),
    delete: jest.fn(),
  };
  const logger = {
    info: jest.fn(),
    error: jest.fn(),
  };
  let service: ImportacaoXmlFiscalService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ImportacaoXmlFiscalService(
      {} as never,
      storage as never,
      logger as never,
      createCfopServiceMock() as never,
    );
  });

  it('associa automaticamente o XML aos clientes participantes cadastrados', async () => {
    jest.spyOn(service as any, 'findClientesForDocument').mockResolvedValue([
      { id: 'cliente-1', cnpj: '12345678000195', razaoSocial: 'Emitente' },
      { id: 'cliente-2', cnpj: '98765432000110', razaoSocial: 'Destinatário' },
    ]);
    jest
      .spyOn(service as any, 'persistirDocumento')
      .mockResolvedValueOnce('IMPORTADO')
      .mockResolvedValueOnce('DUPLICADO');

    const result = await service.importar({
      files: [xmlFile(buildNfeProc())],
      actorUserId: 'user-1',
      requestId: 'request-1',
    });

    expect(result).toMatchObject({
      total_arquivos: 1,
      importados: 1,
      duplicados: 1,
      ignorados: 0,
      erros: 0,
    });
    expect(result.resultados[0]).toMatchObject({
      status: 'IMPORTADO',
      tipo_documento: 'NFE',
      importados: 1,
      duplicados: 1,
    });
  });

  it('impede que o cliente importe XML do qual nao participa', async () => {
    jest.spyOn(service as any, 'findClienteById').mockResolvedValue({
      id: 'cliente-3',
      cnpj: '11111111000191',
      razaoSocial: 'Outra empresa',
    });
    const persist = jest.spyOn(service as any, 'persistirDocumento');

    const result = await service.importar({
      files: [xmlFile(buildNfeProc())],
      actorUserId: 'user-1',
      requestId: 'request-1',
      clienteId: 'cliente-3',
    });

    expect(result.erros).toBe(1);
    expect(result.resultados[0].mensagem).toContain('não consta');
    expect(persist).not.toHaveBeenCalled();
  });

  it('descarta evento fiscal sem tentar persistir', async () => {
    const persist = jest.spyOn(service as any, 'persistirDocumento');
    const result = await service.importar({
      files: [
        xmlFile(
          '<procEventoNFe><evento><infEvento><chNFe>1</chNFe></infEvento></evento></procEventoNFe>',
          'evento.xml',
        ),
      ],
      actorUserId: 'user-1',
      requestId: 'request-1',
    });

    expect(result.ignorados).toBe(1);
    expect(result.resultados[0].status).toBe('IGNORADO');
    expect(persist).not.toHaveBeenCalled();
  });

  it('reconcilia itens de documento duplicado em transação sem novo upload', async () => {
    const existingLimit = jest.fn().mockResolvedValue([
      {
        id: 'doc-1',
        situacao: 'AUTORIZADA',
        xmlKey: 'documento.xml',
        danfeKey: null,
      },
    ]);
    const select = jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({ limit: existingLimit }),
      }),
    });
    const itemValues = jest.fn().mockResolvedValue(undefined);
    const tx = {
      update: jest.fn().mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue(undefined),
        }),
      }),
      delete: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue(undefined),
      }),
      insert: jest.fn().mockReturnValue({ values: itemValues }),
    };
    const transaction = jest.fn(
      (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    );
    const duplicateService = new ImportacaoXmlFiscalService(
      { db: { select, transaction } } as never,
      storage as never,
      logger as never,
      createCfopServiceMock() as never,
    );
    const parsed = parseManualFiscalXml(buildNfeProc());
    if (parsed.status !== 'DOCUMENTO') throw new Error('Fixture inválida');

    const result = await (
      duplicateService as unknown as {
        persistirDocumento(input: {
          target: { id: string; cnpj: string; razaoSocial: string };
          documento: ParsedDocumentoFiscal;
          actorUserId: string;
          requestId: string;
        }): Promise<'IMPORTADO' | 'DUPLICADO'>;
      }
    ).persistirDocumento({
      target: {
        id: 'cliente-1',
        cnpj: '12345678000195',
        razaoSocial: 'Emitente',
      },
      documento: parsed.documento,
      actorUserId: 'user-1',
      requestId: 'request-1',
    });

    expect(result).toBe('DUPLICADO');
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(tx.delete).toHaveBeenCalledWith(documentosFiscaisItens);
    expect(itemValues).toHaveBeenCalledWith([
      expect.objectContaining({
        documentoFiscalId: 'doc-1',
        clienteId: 'cliente-1',
        numeroItem: 1,
        cfopXml: '5102',
        cfop: '5102',
        tipoOperacaoEscriturada: 'SAIDA',
      }),
    ]);
    expect(storage.upload).not.toHaveBeenCalled();
  });
});

function xmlFile(xml: string, originalname = 'documento.xml') {
  const buffer = Buffer.from(xml, 'utf8');
  return {
    fieldname: 'files',
    originalname,
    encoding: '7bit',
    mimetype: 'application/xml',
    size: buffer.length,
    buffer,
  } as Express.Multer.File;
}

function buildNfeProc() {
  const chave = buildAccessKey('55');
  return `<?xml version="1.0" encoding="UTF-8"?>
    <nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
      <NFe>
        <infNFe Id="NFe${chave}" versao="4.00">
          <ide><mod>55</mod><serie>1</serie><nNF>123</nNF><dhEmi>2024-08-15T10:45:00-03:00</dhEmi><tpNF>1</tpNF></ide>
          <emit><CNPJ>12345678000195</CNPJ><xNome>Empresa Emitente</xNome></emit>
          <dest><CNPJ>98765432000110</CNPJ><xNome>Empresa Destinatária</xNome></dest>
          <det nItem="1"><prod>
            <cProd>PROD-1</cProd><cEAN>SEM GTIN</cEAN><xProd>Produto</xProd><NCM>84713012</NCM>
            <CFOP>5102</CFOP><uCom>UN</uCom><qCom>1.0000</qCom><vUnCom>150.7500000000</vUnCom>
            <vProd>150.75</vProd><cEANTrib>SEM GTIN</cEANTrib><uTrib>UN</uTrib>
            <qTrib>1.0000</qTrib><vUnTrib>150.7500000000</vUnTrib><indTot>1</indTot>
          </prod><imposto /></det>
          <total><ICMSTot><vNF>150.75</vNF></ICMSTot></total>
        </infNFe>
      </NFe>
      <protNFe><infProt><chNFe>${chave}</chNFe><cStat>100</cStat></infProt></protNFe>
    </nfeProc>`;
}

function createCfopServiceMock() {
  return {
    prepararItensEscrituracao: jest.fn(
      (params: {
        itens: Array<{ cfop: string }>;
        emitenteCnpjCpf: string;
        clienteCnpjCpf: string;
      }) => {
        const tipoOperacaoEscriturada =
          params.emitenteCnpjCpf === params.clienteCnpjCpf
            ? 'SAIDA'
            : 'ENTRADA';
        return Promise.resolve({
          tipoOperacaoEscriturada,
          itens: params.itens.map((item) => ({
            ...item,
            cfopXml: item.cfop,
            cfop:
              tipoOperacaoEscriturada === 'ENTRADA' && item.cfop[0] === '5'
                ? `1${item.cfop.slice(1)}`
                : item.cfop,
            tipoOperacaoEscriturada,
            cfopRevisaoNecessaria: false,
          })),
        });
      },
    ),
  };
}

function buildAccessKey(modelo: string): string {
  const base = `29240812345678000195${modelo}001000000123112345678`;
  let weight = 2;
  let sum = 0;
  for (let index = 42; index >= 0; index--) {
    sum += Number(base[index]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const remainder = sum % 11;
  const digit = remainder === 0 || remainder === 1 ? 0 : 11 - remainder;
  return `${base}${digit}`;
}
