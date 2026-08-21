import { DistribuicaoDfeService } from './distribuicao-dfe.service';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import {
  documentosFiscais,
  documentosFiscaisItens,
} from '../../database/schema';
import {
  parseManualFiscalXml,
  type ParsedDocumentoFiscal,
} from './dfe-document.parser';

describe('DistribuicaoDfeService', () => {
  it('retorna o resumo completo de documentos separado por cliente', async () => {
    const orderBy = jest.fn().mockResolvedValue([
      {
        id: 'cliente-1',
        razaoSocial: 'ALFA COMERCIO LTDA',
        cnpj: '12345678000195',
        totalDocumentos: '105',
      },
      {
        id: 'cliente-2',
        razaoSocial: 'BETA INDUSTRIA LTDA',
        cnpj: '98765432000110',
        totalDocumentos: '8',
      },
    ]);
    const groupBy = jest.fn().mockReturnValue({ orderBy });
    const innerJoin = jest.fn().mockReturnValue({ groupBy });
    const from = jest.fn().mockReturnValue({ innerJoin });
    const select = jest.fn().mockReturnValue({ from });
    const service = new DistribuicaoDfeService(
      { db: { select } } as never,
      {} as never,
      {} as never,
      createCfopServiceMock() as never,
    );

    const result = await service.listClientesComDocumentosFiscais();

    expect(result).toEqual([
      {
        id: 'cliente-1',
        razao_social: 'ALFA COMERCIO LTDA',
        cnpj: '12345678000195',
        total_documentos: 105,
      },
      {
        id: 'cliente-2',
        razao_social: 'BETA INDUSTRIA LTDA',
        cnpj: '98765432000110',
        total_documentos: 8,
      },
    ]);
    expect(select).toHaveBeenCalledTimes(1);
    expect(innerJoin).toHaveBeenCalledTimes(1);
    expect(groupBy).toHaveBeenCalledTimes(1);
    expect(orderBy).toHaveBeenCalledTimes(1);
  });

  it('persiste cabeçalho e itens na mesma transação', async () => {
    const existingLimit = jest.fn().mockResolvedValue([]);
    const select = jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({ limit: existingLimit }),
      }),
    });
    const itemValues = jest.fn().mockResolvedValue(undefined);
    const returning = jest.fn().mockResolvedValue([{ id: 'doc-1' }]);
    const tx = {
      update: jest.fn().mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue(undefined),
        }),
      }),
      insert: jest.fn((table) =>
        table === documentosFiscais
          ? {
              values: jest.fn().mockReturnValue({
                onConflictDoUpdate: jest.fn().mockReturnValue({ returning }),
              }),
            }
          : { values: itemValues },
      ),
      delete: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue(undefined),
      }),
    };
    const transaction = jest.fn(
      (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    );
    const storage = {
      upload: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    const service = new DistribuicaoDfeService(
      { db: { select, transaction } } as never,
      storage as never,
      {} as never,
      createCfopServiceMock() as never,
    );
    const documento = parseDocumentWithItem();

    const result = await (
      service as unknown as {
        salvarDocumento(
          clienteId: string,
          cnpj: string,
          parsed: ParsedDocumentoFiscal,
        ): Promise<boolean>;
      }
    ).salvarDocumento('cliente-1', '98765432000110', documento);

    expect(result).toBe(true);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(tx.insert).toHaveBeenCalledWith(documentosFiscais);
    expect(tx.delete).toHaveBeenCalledWith(documentosFiscaisItens);
    expect(tx.insert).toHaveBeenCalledWith(documentosFiscaisItens);
    expect(itemValues).toHaveBeenCalledWith([
      expect.objectContaining({
        documentoFiscalId: 'doc-1',
        clienteId: 'cliente-1',
        numeroItem: 1,
        codigoProduto: 'PROD-1',
        cfopXml: '5102',
        cfop: '1102',
        tipoOperacaoEscriturada: 'ENTRADA',
      }),
    ]);
  });

  it('serializa o início do mês como timestamp no dashboard', async () => {
    const whereClauses: SQL[] = [];
    const select = jest.fn().mockImplementation(() => ({
      from: jest.fn().mockReturnValue({
        where: jest.fn((condition: SQL) => {
          whereClauses.push(condition);
          return Promise.resolve([{ count: '0', total: '0' }]);
        }),
      }),
    }));
    const service = new DistribuicaoDfeService(
      { db: { select } } as never,
      {} as never,
      {} as never,
      createCfopServiceMock() as never,
    );

    await service.getDashboardStats();

    const dashboardQuery = new PgDialect().sqlToQuery(whereClauses[0]);
    expect(dashboardQuery.params).toHaveLength(1);
    expect(typeof dashboardQuery.params[0]).toBe('string');
    expect(dashboardQuery.params[0]).toMatch(/^\d{4}-\d{2}-01T/);
  });
});

function parseDocumentWithItem(): ParsedDocumentoFiscal {
  const chave = buildAccessKey('55');
  const parsed = parseManualFiscalXml(`
    <nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">
      <NFe><infNFe Id="NFe${chave}">
        <ide><mod>55</mod><serie>1</serie><nNF>123</nNF><dhEmi>2024-08-15T10:45:00-03:00</dhEmi><tpNF>1</tpNF></ide>
        <emit><CNPJ>12345678000195</CNPJ><xNome>Emitente</xNome></emit>
        <dest><CNPJ>98765432000110</CNPJ><xNome>Destinatário</xNome></dest>
        <det nItem="1"><prod>
          <cProd>PROD-1</cProd><cEAN>SEM GTIN</cEAN><xProd>Produto</xProd><NCM>84713012</NCM>
          <CFOP>5102</CFOP><uCom>UN</uCom><qCom>1.0000</qCom><vUnCom>10.0000000000</vUnCom>
          <vProd>10.00</vProd><cEANTrib>SEM GTIN</cEANTrib><uTrib>UN</uTrib>
          <qTrib>1.0000</qTrib><vUnTrib>10.0000000000</vUnTrib><indTot>1</indTot>
        </prod><imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>10.00</vBC><pICMS>18.0000</pICMS><vICMS>1.80</vICMS></ICMS00></ICMS></imposto></det>
        <total><ICMSTot><vNF>10.00</vNF></ICMSTot></total>
      </infNFe></NFe>
      <protNFe><infProt><chNFe>${chave}</chNFe><cStat>100</cStat></infProt></protNFe>
    </nfeProc>
  `);
  if (parsed.status !== 'DOCUMENTO') {
    throw new Error('Fixture fiscal inválida');
  }
  return parsed.documento;
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
  return `${base}${remainder === 0 || remainder === 1 ? 0 : 11 - remainder}`;
}
