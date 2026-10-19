import type { DatabaseService } from '../../database/database.service';
import type { AppLogger } from '../../common/logger.service';
import type { DistribuicaoDfeService } from './distribuicao-dfe.service';
import type { NfeWizardService } from './nfewizard.service';
import {
  foraDaJanelaSefaz,
  ImportacaoChavesFiscalService,
} from './importacao-chaves-fiscal.service';
import { SefazConsultaAdiadaError } from './sefaz-consulta-control.service';
import { CertificateAccessError } from './certificado.service';
import { gzipSync } from 'node:zlib';

describe('ImportacaoChavesFiscalService', () => {
  beforeEach(() => {
    jest.useFakeTimers({
      now: new Date('2024-09-01T12:00:00Z'),
      doNotFake: ['setTimeout', 'clearTimeout'],
    });
  });
  afterEach(() => jest.useRealTimers());
  const cliente = {
    id: 'bff6b350-3794-4d22-a3a2-18b0a6f72672',
    cnpj: '98765432000110',
    uf: 'BA',
    regimeTributario: 'LUCRO_PRESUMIDO',
    apuraIcms: true,
  };
  const actorUserId = 'user-1';

  it.each([false, true])(
    'importa XML completo e promove resumo existente (resumo=%s)',
    async (hasSummary) => {
      const chave = buildAccessKey('55');
      const xml = `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe${chave}" versao="4.00"><ide><mod>55</mod><serie>1</serie><nNF>123</nNF><tpNF>1</tpNF><dhEmi>2024-08-15T10:45:00-03:00</dhEmi></ide><emit><CNPJ>12345678000195</CNPJ><xNome>Fornecedor Teste</xNome></emit><dest><CNPJ>98765432000110</CNPJ><xNome>Cliente</xNome></dest><total><ICMSTot><vNF>150.75</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><chNFe>${chave}</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>`;
      const response = {
        cStat: 138,
        data: {
          retDistDFeInt: {
            loteDistDFeInt: {
              docZip: [
                {
                  $: { NSU: '000000000000123', schema: 'procNFe_v4.00.xsd' },
                  _: gzipSync(Buffer.from(xml)).toString('base64'),
                },
              ],
            },
          },
        },
      };
      const service = makeService(
        databaseWithResponses([
          [cliente],
          [{ id: 'cert-1', validadeFim: futureDate() }],
          hasSummary ? [existingDocument(chave, 'RESUMIDA')] : [],
          [existingDocument(chave, 'AUTORIZADA')],
        ]),
        nfeWizardMock(response),
      );
      const result = await service.executar({
        clienteId: cliente.id,
        chaves: [chave],
        actorUserId,
        requestId: 'req-xml',
      });
      expect(result.itens[0]).toMatchObject({
        status: 'IMPORTADO',
        documento_id: '7bc10448-3bcf-4d1f-aace-78411d72c635',
        valor_total: '150.75',
      });
      expect(result.resumo.importados).toBe(1);
      expect(result.resumo.ja_existentes).toBe(0);
    },
  );

  it('não consulta notas antigas, mesmo com reimportação forçada', async () => {
    jest.setSystemTime(new Date('2026-10-19T12:00:00Z'));
    const nfeWizard = nfeWizardMock();
    const service = makeService(
      databaseWithResponses([
        [cliente],
        [{ id: 'cert-1', validadeFim: futureDate() }],
        [],
      ]),
      nfeWizard,
    );
    const result = await service.executar({
      clienteId: cliente.id,
      chaves: [buildAccessKey('55')],
      forcarReimportacao: true,
      actorUserId,
      requestId: 'req-old',
    });
    expect(result.itens[0].status).toBe('RECUPERACAO_PORTAL_NECESSARIA');
    expect(result.resumo.recuperacao_portal).toBe(1);
    expect(result.resumo.nao_localizados).toBe(0);
    expect(result.itens[0].mensagem).toContain('ainda não foi verificada');
    expect(nfeWizard.consultarPorChave).not.toHaveBeenCalled();
  });

  it('não exclui o mês que contém a borda dos 90 dias', () => {
    expect(
      foraDaJanelaSefaz(buildAccessKey('55'), new Date('2024-11-15T12:00:00Z')),
    ).toBe(false);
    expect(
      foraDaJanelaSefaz(buildAccessKey('55'), new Date('2024-12-01T12:00:00Z')),
    ).toBe(true);
  });

  it.each([
    [
      new Error('NFE_DistribuicaoDFePorChave: Rejeição: CNPJ não autorizado'),
      'FALHA',
      'CNPJ não autorizado',
    ],
    [new Error('connect ETIMEDOUT'), 'FALHA', 'comunicação segura'],
    [
      new SefazConsultaAdiadaError(
        'LIMITE_LOCAL',
        new Date('2024-09-01T13:00:00Z'),
      ),
      'ADIADO_LIMITE_CONSULTAS',
      '20 consultas',
    ],
  ])(
    'interrompe o lote e diferencia o motivo da falha: %s',
    async (error, status, message) => {
      const nfeWizard = nfeWizardMock();
      nfeWizard.consultarPorChave.mockRejectedValue(error);
      const service = makeService(
        databaseWithResponses([
          [cliente],
          [{ id: 'cert-1', validadeFim: futureDate() }],
          [],
        ]),
        nfeWizard,
      );
      const result = await service.executar({
        clienteId: cliente.id,
        chaves: [
          buildAccessKey('55', '000000001'),
          buildAccessKey('55', '000000002'),
        ],
        actorUserId,
        requestId: 'req-error',
      });
      expect(result.itens.map((item) => item.status)).toEqual([status, status]);
      expect(result.itens[0].mensagem).toContain(message);
      expect(nfeWizard.consultarPorChave).toHaveBeenCalledTimes(1);
      expect(result.resumo.certificado_indisponivel).toBe(false);
    },
  );

  it('não classifica rejeição como documento não localizado', async () => {
    const nfeWizard = nfeWizardMock({
      cStat: 593,
      xMotivo: 'CNPJ não autorizado',
    });
    const service = makeService(
      databaseWithResponses([
        [cliente],
        [{ id: 'cert-1', validadeFim: futureDate() }],
        [],
      ]),
      nfeWizard,
    );
    const result = await service.executar({
      clienteId: cliente.id,
      chaves: [buildAccessKey('55')],
      actorUserId,
      requestId: 'req-rejection',
    });
    expect(result.itens[0].status).toBe('FALHA');
    expect(result.itens[0].mensagem).toContain('593');
    expect(result.resumo.nao_localizados).toBe(0);
  });

  it('classifica documento já importado sem consultar a SEFAZ', async () => {
    const chave = buildAccessKey('55');
    const database = databaseWithResponses([
      [cliente],
      [{ id: 'cert-1', validadeFim: futureDate() }],
      [existingDocument(chave, 'AUTORIZADA')],
    ]);
    const nfeWizard = nfeWizardMock();
    const service = makeService(database, nfeWizard);

    const result = await service.executar({
      clienteId: cliente.id,
      chaves: [chave],
      actorUserId,
      requestId: 'req-1',
    });

    expect(result.resumo).toMatchObject({
      total: 1,
      ja_existentes: 1,
      falhas: 0,
    });
    expect(result.itens[0].status).toBe('JA_EXISTENTE');
    expect(nfeWizard.consultarPorChave).not.toHaveBeenCalled();
  });

  it('trata cStat 137 como documento não localizado', async () => {
    const chave = buildAccessKey('55');
    const database = databaseWithResponses([
      [cliente],
      [{ id: 'cert-1', validadeFim: futureDate() }],
      [],
    ]);
    const nfeWizard = nfeWizardMock({
      cStat: 137,
      xMotivo: 'Nenhum documento localizado',
    });
    const service = makeService(database, nfeWizard);

    const result = await service.executar({
      clienteId: cliente.id,
      chaves: [chave],
      actorUserId,
      requestId: 'req-2',
    });

    expect(result.resumo.nao_localizados).toBe(1);
    expect(result.resumo.falhas).toBe(0);
    expect(result.itens[0].status).toBe('NAO_LOCALIZADO');
  });

  it('interrompe as chaves restantes ao receber consumo indevido', async () => {
    const first = buildAccessKey('55', '000000001');
    const second = buildAccessKey('55', '000000002');
    const database = databaseWithResponses([
      [cliente],
      [{ id: 'cert-1', validadeFim: futureDate() }],
      [],
    ]);
    const nfeWizard = nfeWizardMock({
      cStat: 656,
      xMotivo: 'Rejeição: Consumo Indevido',
    });
    const service = makeService(database, nfeWizard);

    const result = await service.executar({
      clienteId: cliente.id,
      chaves: [first, second],
      actorUserId,
      requestId: 'req-3',
    });

    expect(result.resumo.consumo_indevido).toBe(true);
    expect(result.resumo.falhas).toBe(2);
    expect(result.itens.map((item) => item.status)).toEqual([
      'ABORTADO_CONSUMO_INDEVIDO',
      'ABORTADO_CONSUMO_INDEVIDO',
    ]);
    expect(nfeWizard.consultarPorChave).toHaveBeenCalledTimes(1);
  });

  it('interrompe o lote quando o certificado não pode ser lido do armazenamento', async () => {
    const first = buildAccessKey('55', '000000001');
    const second = buildAccessKey('55', '000000002');
    const database = databaseWithResponses([
      [cliente],
      [{ id: 'cert-1', validadeFim: futureDate() }],
      [],
    ]);
    const nfeWizard = nfeWizardMock();
    nfeWizard.consultarPorChave.mockRejectedValue(
      new CertificateAccessError(
        'CERTIFICATE_OBJECT_NOT_FOUND',
        'arquivo não encontrado',
      ),
    );
    const service = makeService(database, nfeWizard);

    const result = await service.executar({
      clienteId: cliente.id,
      chaves: [first, second],
      actorUserId,
      requestId: 'req-cert',
    });

    expect(result.resumo.certificado_indisponivel).toBe(true);
    expect(result.itens.map((item) => item.status)).toEqual([
      'ABORTADO_CERTIFICADO_INDISPONIVEL',
      'ABORTADO_CERTIFICADO_INDISPONIVEL',
    ]);
    expect(nfeWizard.consultarPorChave).toHaveBeenCalledTimes(1);
  });

  it('salva o resumo sem enviar Ciência quando a opção não foi autorizada', async () => {
    const chave = buildAccessKey('55');
    const database = databaseWithResponses([
      [cliente],
      [{ id: 'cert-1', validadeFim: futureDate() }],
      [],
      [existingDocument(chave, 'RESUMIDA')],
    ]);
    const nfeWizard = nfeWizardMock(summaryResponse(chave));
    const service = makeService(database, nfeWizard);

    const result = await service.executar({
      clienteId: cliente.id,
      chaves: [chave],
      manifestarAutomaticamente: false,
      actorUserId,
      requestId: 'req-resumo',
    });

    expect(result.resumo.resumos).toBe(1);
    expect(result.itens[0].status).toBe('RESUMO_PENDENTE');
    expect(nfeWizard.enviarManifestacao).not.toHaveBeenCalled();
  });

  it('marca na prévia chaves novas, resumidas e não suportadas', async () => {
    const nfe = buildAccessKey('55');
    const cte = buildAccessKey('57');
    const database = databaseWithResponses([
      [cliente],
      [existingDocument(nfe, 'RESUMIDA')],
    ]);
    const service = makeService(database, nfeWizardMock());

    const result = await service.analisar({
      clienteId: cliente.id,
      chavesTexto: `${nfe}\n${cte}`,
    });

    expect(result.resumo).toMatchObject({
      validas: 2,
      aptas_para_busca: 1,
      resumos_pendentes: 1,
    });
    expect(result.itens.map((item) => item.status_local)).toEqual([
      'RESUMIDA',
      'NAO_SUPORTADA',
    ]);
  });
});

function makeService(
  database: ReturnType<typeof databaseWithResponses>,
  nfeWizard: ReturnType<typeof nfeWizardMock>,
) {
  const distribuicao = {
    salvarDocumentoConsultado: jest.fn(),
    salvarResumoConsultado: jest.fn(),
    registrarManifestacao: jest.fn(),
    buscarXmlCompletoAposManifestacao: jest.fn(),
  };
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  return new ImportacaoChavesFiscalService(
    database as unknown as DatabaseService,
    nfeWizard as unknown as NfeWizardService,
    distribuicao as unknown as DistribuicaoDfeService,
    logger as unknown as AppLogger,
  );
}

function databaseWithResponses(responses: unknown[][]) {
  const queue = [...responses];
  const select = jest.fn(() => {
    const value = queue.shift() ?? [];
    const promise = Promise.resolve(value);
    const chain: Record<string, unknown> = {};
    chain.from = jest.fn(() => chain);
    chain.where = jest.fn(() => chain);
    chain.limit = jest.fn(() => promise);
    chain.then = promise.then.bind(promise);
    chain.catch = promise.catch.bind(promise);
    return chain;
  });
  const values = jest.fn().mockResolvedValue(undefined);
  return { db: { select, insert: jest.fn(() => ({ values })) } };
}

function nfeWizardMock(response: unknown = {}) {
  return {
    consultarPorChave: jest.fn().mockResolvedValue(response),
    enviarManifestacao: jest.fn(),
  };
}

function existingDocument(chaveAcesso: string, situacao: string) {
  return {
    id: '7bc10448-3bcf-4d1f-aace-78411d72c635',
    chaveAcesso,
    situacao,
    manifestacaoStatus: 'SEM_MANIFESTACAO',
  };
}

function futureDate() {
  return new Date(Date.now() + 24 * 60 * 60 * 1_000);
}

function summaryResponse(chave: string) {
  const xml = `<resNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">
    <chNFe>${chave}</chNFe><CNPJ>12345678000195</CNPJ><xNome>Fornecedor Teste</xNome>
    <dhEmi>2024-08-15T10:45:00-03:00</dhEmi><tpNF>1</tpNF><vNF>150.75</vNF>
  </resNFe>`;
  return {
    cStat: 138,
    xMotivo: 'Documento localizado',
    data: {
      retDistDFeInt: {
        loteDistDFeInt: {
          docZip: [
            {
              $: { NSU: '000000000000123', schema: 'resNFe_v1.01.xsd' },
              _: gzipSync(Buffer.from(xml)).toString('base64'),
            },
          ],
        },
      },
    },
  };
}

function buildAccessKey(modelo: string, numero = '000000123'): string {
  const base = `29240812345678000195${modelo}001${numero}112345678`;
  let weight = 2;
  let sum = 0;
  for (let index = 42; index >= 0; index -= 1) {
    sum += Number(base[index]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const remainder = sum % 11;
  return `${base}${remainder < 2 ? 0 : 11 - remainder}`;
}
