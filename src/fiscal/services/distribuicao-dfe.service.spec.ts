import {
  DistribuicaoDfeService,
  FISCAL_SYNC_LOCK_TTL_MS,
  isFiscalSyncLockActive,
} from './distribuicao-dfe.service';
import { PgDialect } from 'drizzle-orm/pg-core';
import { gzipSync } from 'node:zlib';
import type { SQL } from 'drizzle-orm';
import {
  documentosFiscais,
  documentosFiscaisItens,
} from '../../database/schema';
import {
  parseManualFiscalXml,
  type ParsedDocumentoFiscal,
  type ParsedResumoNfe,
} from './dfe-document.parser';

describe('DistribuicaoDfeService', () => {
  it('considera ativo um lock fiscal recente', () => {
    const now = Date.now();

    expect(
      isFiscalSyncLockActive(
        {
          sincronizacaoId: 'sync-id',
          iniciadaEm: new Date(now - 1_000),
        },
        now,
      ),
    ).toBe(true);
  });

  it('libera logicamente um lock fiscal abandonado', () => {
    const now = Date.now();

    expect(
      isFiscalSyncLockActive(
        {
          sincronizacaoId: 'sync-id',
          iniciadaEm: new Date(now - FISCAL_SYNC_LOCK_TTL_MS - 1),
        },
        now,
      ),
    ).toBe(false);
  });

  it('converte datas agregadas do banco ao consultar o status fiscal', async () => {
    const orderBy = jest.fn().mockResolvedValue([
      {
        clienteId: 'cliente-1',
        razaoSocial: 'ALFA COMERCIO LTDA',
        tipoDocumento: 'NFE',
        ultimoNsu: 42,
        maxNsu: 42,
        statusSefaz: 138,
        motivoSefaz: 'Documento localizado',
        ultimaConsultaEm: new Date('2026-10-17T15:00:00.000Z'),
        proximaConsultaEm: null,
        sincronizacaoId: null,
        sincronizacaoIniciadaEm: null,
      },
    ]);
    const select = jest
      .fn()
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({ orderBy }),
          }),
        }),
      })
      .mockImplementationOnce(
        (fields: {
          proximaTentativa: SQL & {
            decoder: { mapFromDriverValue(value: string): Date };
          };
          proximaCiencia: SQL & {
            decoder: { mapFromDriverValue(value: string): Date };
          };
        }) => ({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              groupBy: jest.fn().mockResolvedValue([
                {
                  clienteId: 'cliente-1',
                  semManifestacao: '1',
                  aguardandoXml: '2',
                  proximaTentativa:
                    fields.proximaTentativa.decoder.mapFromDriverValue(
                      '2026-10-18T03:00:00.000Z',
                    ),
                  proximaCiencia:
                    fields.proximaCiencia.decoder.mapFromDriverValue(
                      '2026-10-19T03:00:00.000Z',
                    ),
                },
              ]),
            }),
          }),
        }),
      );
    const service = new DistribuicaoDfeService(
      { db: { select } } as never,
      {} as never,
      {} as never,
      createCfopServiceMock() as never,
      {} as never,
    );

    const result = await service.getStatusSincronizacao('cliente-1');

    expect(result).toEqual([
      expect.objectContaining({
        cliente_id: 'cliente-1',
        nfe_resumos_sem_manifestacao: 1,
        nfe_resumos_aguardando_xml: 2,
        proxima_tentativa_xml_em: '2026-10-18T03:00:00.000Z',
        proxima_tentativa_ciencia_em: '2026-10-19T03:00:00.000Z',
      }),
    ]);
  });

  it('não inicia uma consulta duplicada quando o controle já está bloqueado', async () => {
    const limit = jest
      .fn()
      .mockResolvedValueOnce([
        { id: 'client-1', cnpj: '12345678000195', uf: 'BA' },
      ])
      .mockResolvedValueOnce([
        {
          id: 'control-1',
          ultimoNsu: 42,
          maxNsu: 42,
          proximaConsultaEm: null,
        },
      ]);
    const select = jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({ limit }),
      }),
    });
    const returning = jest.fn().mockResolvedValue([]);
    const update = jest.fn().mockReturnValue({
      set: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({ returning }),
      }),
    });
    const nfeWizard = {
      consultarDistribuicaoDFe: jest.fn(),
      consultarDistribuicaoCTe: jest.fn(),
    };
    const service = new DistribuicaoDfeService(
      { db: { select, update } } as never,
      {} as never,
      nfeWizard as never,
      createCfopServiceMock() as never,
      {} as never,
    );

    const result = await service.sincronizarCliente('client-1', 'NFE');

    expect(result.status).toBe('EM_ANDAMENTO');
    expect(nfeWizard.consultarDistribuicaoDFe).not.toHaveBeenCalled();
  });

  it('varre lotes sucessivos e só avança o NSU após salvar cada resumo', async () => {
    const { service, nfeWizard, atualizacoes } = createSyncHarness([
      dfeResponse(1, 2, 'resNFe_v1.01.xsd'),
      dfeResponse(2, 2, 'resNFe_v1.01.xsd'),
    ]);
    const salvarResumo = jest
      .spyOn(service as never, 'salvarResumoNfe')
      .mockResolvedValue(true as never);
    jest
      .spyOn(service as never, 'manifestarResumosPendentes')
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(service as never, 'recuperarUmResumoManifestado')
      .mockResolvedValue(false as never);

    const resultado = await service.sincronizarCliente('client-1', 'NFE');

    expect(resultado).toMatchObject({
      status: 'OK',
      ultimoNsu: 2,
      maxNsu: 2,
      documentosRecebidos: 2,
      documentosProcessados: 2,
    });
    expect(salvarResumo).toHaveBeenCalledTimes(2);
    expect(
      (
        nfeWizard.consultarDistribuicaoDFe.mock.calls as Array<
          [{ ultimoNsu: number }]
        >
      ).map(([arg]) => arg.ultimoNsu),
    ).toEqual([0, 1]);
    expect(atualizacoes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ultimoNsu: 1 }),
        expect.objectContaining({ ultimoNsu: 2 }),
      ]),
    );
  });

  it('preserva o NSU diante de um docZip fiscal desconhecido', async () => {
    const { service, atualizacoes } = createSyncHarness([
      dfeResponse(1, 1, 'procNFe_v9.99.xsd', '<invalido/>'),
    ]);
    jest
      .spyOn(service as never, 'manifestarResumosPendentes')
      .mockResolvedValue(undefined as never);

    const resultado = await service.sincronizarCliente('client-1', 'NFE');

    expect(resultado).toMatchObject({
      status: 'ERRO',
      ultimoNsu: 0,
      documentosComFalha: 1,
    });
    expect(atualizacoes).toEqual(
      expect.arrayContaining([expect.objectContaining({ ultimoNsu: 0 })]),
    );
  });

  it('respeita uma hora após cStat 137 sem iniciar consulta por chave', async () => {
    const { service, nfeWizard, atualizacoes } = createSyncHarness([
      { data: {}, xMotivo: 'Nenhum documento localizado' },
    ]);
    jest
      .spyOn(service as never, 'manifestarResumosPendentes')
      .mockResolvedValue(undefined as never);
    const recuperar = jest
      .spyOn(service as never, 'recuperarUmResumoManifestado')
      .mockResolvedValue(false as never);

    const resultado = await service.sincronizarCliente('client-1', 'NFE');

    expect(resultado).toMatchObject({ status: 'OK', cStat: 137, ultimoNsu: 0 });
    expect(nfeWizard.consultarDistribuicaoDFe).toHaveBeenCalledTimes(1);
    expect(recuperar).not.toHaveBeenCalled();
    const proxima = atualizacoes.find(
      (value) => value.statusSefaz === 137,
    )?.proximaConsultaEm;
    expect(proxima).toBeInstanceOf(Date);
    expect((proxima as Date).getTime()).toBeGreaterThan(
      Date.now() + 59 * 60 * 1000,
    );
  });

  it('envia Ciência para resumo pendente e registra o evento sem escriturar', async () => {
    const limit = jest
      .fn()
      .mockResolvedValue([{ id: 'doc-1', chaveAcesso: buildAccessKey('55') }]);
    const select = jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          orderBy: jest.fn().mockReturnValue({ limit }),
        }),
      }),
    });
    const atualizacoes: Array<Record<string, unknown>> = [];
    const update = jest.fn().mockReturnValue({
      set: jest.fn((value: Record<string, unknown>) => {
        atualizacoes.push(value);
        return {
          where: jest.fn(() =>
            Object.assign(Promise.resolve(), {
              returning: jest.fn().mockResolvedValue([{ id: 'doc-1' }]),
            }),
          ),
        };
      }),
    });
    const nfeWizard = {
      enviarManifestacao: jest.fn().mockResolvedValue({
        status: 135,
        motivo: 'Evento registrado',
        protocolo: '123',
      }),
    };
    const service = new DistribuicaoDfeService(
      { db: { select, update } } as never,
      {} as never,
      nfeWizard as never,
      createCfopServiceMock() as never,
      {} as never,
    );
    const registrar = jest
      .spyOn(service, 'registrarManifestacao')
      .mockResolvedValue(undefined);

    await (
      service as unknown as {
        manifestarResumosPendentes(
          clienteId: string,
          cnpj: string,
          uf: string,
        ): Promise<void>;
      }
    ).manifestarResumosPendentes('client-1', '98765432000110', 'BA');

    expect(nfeWizard.enviarManifestacao).toHaveBeenCalledWith(
      expect.objectContaining({ tipoEvento: '210210' }),
    );
    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        documentoId: 'doc-1',
        codigoEvento: '210210',
        statusSefaz: 135,
      }),
    );
    expect(atualizacoes.some((value) => 'tentativasCiencia' in value)).toBe(
      true,
    );
    expect(
      atualizacoes.some((value) => value.proximaTentativaXmlEm instanceof Date),
    ).toBe(true);
  });

  it('retorna o resumo completo de documentos separado por cliente', async () => {
    const orderBy = jest.fn().mockResolvedValue([
      {
        id: 'cliente-1',
        razaoSocial: 'ALFA COMERCIO LTDA',
        cnpj: '12345678000195',
        inscricaoEstadual: '123456789',
        municipio: 'Salvador',
        uf: 'BA',
        regimeTributario: 'SIMPLES_NACIONAL',
        apuraIcms: false,
        optanteSimplesNacional: true,
        obrigadoEfdIcmsIpi: false,
        totalDocumentos: '105',
      },
      {
        id: 'cliente-2',
        razaoSocial: 'BETA INDUSTRIA LTDA',
        cnpj: '98765432000110',
        inscricaoEstadual: null,
        municipio: null,
        uf: null,
        regimeTributario: 'LUCRO_REAL',
        apuraIcms: true,
        optanteSimplesNacional: false,
        obrigadoEfdIcmsIpi: true,
        totalDocumentos: '8',
      },
    ]);
    const groupBy = jest.fn().mockReturnValue({ orderBy });
    const secondLeftJoin = jest.fn().mockReturnValue({ groupBy });
    const firstLeftJoin = jest
      .fn()
      .mockReturnValue({ leftJoin: secondLeftJoin });
    const from = jest.fn().mockReturnValue({ leftJoin: firstLeftJoin });
    const select = jest.fn().mockReturnValue({ from });
    const service = new DistribuicaoDfeService(
      { db: { select } } as never,
      {} as never,
      {} as never,
      createCfopServiceMock() as never,
      {} as never,
    );

    const result = await service.listClientesComDocumentosFiscais();

    expect(result).toEqual([
      {
        id: 'cliente-1',
        razao_social: 'ALFA COMERCIO LTDA',
        cnpj: '12345678000195',
        inscricao_estadual: '123456789',
        municipio: 'Salvador',
        uf: 'BA',
        regime_tributario: 'SIMPLES_NACIONAL',
        apura_icms: false,
        optante_simples_nacional: true,
        obrigado_efd_icms_ipi: false,
        total_documentos: 105,
      },
      {
        id: 'cliente-2',
        razao_social: 'BETA INDUSTRIA LTDA',
        cnpj: '98765432000110',
        inscricao_estadual: null,
        municipio: null,
        uf: null,
        regime_tributario: 'LUCRO_REAL',
        apura_icms: true,
        optante_simples_nacional: false,
        obrigado_efd_icms_ipi: true,
        total_documentos: 8,
      },
    ]);
    expect(select).toHaveBeenCalledTimes(1);
    expect(firstLeftJoin).toHaveBeenCalledTimes(1);
    expect(secondLeftJoin).toHaveBeenCalledTimes(1);
    expect(groupBy).toHaveBeenCalledTimes(1);
    expect(orderBy).toHaveBeenCalledTimes(1);
  });

  it('exclui NFS-e da consulta paginada de saídas quando solicitado', async () => {
    const countWhere = jest.fn().mockResolvedValue([
      {
        count: 3,
        valorTotal: '450.00',
        valorTotalAutorizado: '300.00',
      },
    ]);
    const offset = jest.fn().mockResolvedValue([]);
    const limit = jest.fn().mockReturnValue({ offset });
    const orderBy = jest.fn().mockReturnValue({ limit });
    const rowsWhere = jest.fn().mockReturnValue({ orderBy });
    let selectCall = 0;
    const select = jest.fn().mockImplementation(() => {
      selectCall += 1;
      return {
        from: jest.fn().mockReturnValue({
          where: selectCall === 1 ? countWhere : rowsWhere,
        }),
      };
    });
    const service = new DistribuicaoDfeService(
      { db: { select } } as never,
      {} as never,
      {} as never,
      createCfopServiceMock() as never,
      {} as never,
    );

    const result = await service.listDocumentosFiscais({
      tipoOperacao: 'SAIDA',
      excluirTipoDocumento: 'NFSE',
      pagination: { page: 1, pageSize: 15, limit: 15, offset: 0 },
    });

    expect(result.resumo).toEqual({
      quantidade_documentos: 3,
      valor_total: '450.00',
      valor_total_autorizado: '300.00',
    });

    const dialect = new PgDialect();
    for (const whereMock of [countWhere, rowsWhere]) {
      const calls = whereMock.mock.calls as Array<[SQL | undefined]>;
      const condition = calls[0]?.[0];
      expect(condition).toBeDefined();
      const query = dialect.sqlToQuery(condition!);
      expect(query.sql).toContain('"tipo_documento" <>');
      expect(query.sql).toContain('"tipo_operacao_escriturada" =');
      expect(query.params).toEqual(expect.arrayContaining(['NFSE', 'SAIDA']));
    }
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
    // Reconciliação (F01): a transação consulta os itens existentes antes de
    // inserir/atualizar. Documento novo → nenhum item existente.
    const txSelect = jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue([]),
      }),
    });
    const txExecute = jest.fn().mockResolvedValue(undefined);
    const tx = {
      execute: txExecute,
      select: txSelect,
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
      {} as never,
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
    // R1.6/R1.7: o caminho de substituição (`onConflictDoUpdate`) adquire o
    // advisory lock por cliente + chaveAcesso (NÃO por NSU), serializando
    // reimportações concorrentes manual × DF-e.
    expectAdvisoryLockAcquired(txExecute, 'cliente-1', documento.chaveAcesso);
    expect(tx.insert).toHaveBeenCalledWith(documentosFiscais);
    // F01: reconciliação consulta os itens existentes (nenhum, doc novo) e
    // nunca deleta em massa; apenas insere os itens novos.
    expect(txSelect).toHaveBeenCalled();
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

  it('persiste resumo de NF-e como não escriturável e sem apagar documento completo', async () => {
    const existingLimit = jest.fn().mockResolvedValue([]);
    const select = jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({ limit: existingLimit }),
      }),
    });
    const onConflictDoUpdate = jest.fn().mockResolvedValue(undefined);
    const values = jest.fn().mockReturnValue({ onConflictDoUpdate });
    const tx = {
      execute: jest.fn().mockResolvedValue(undefined),
      insert: jest.fn().mockReturnValue({ values }),
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
      {} as never,
    );
    const resumo: ParsedResumoNfe = {
      chaveAcesso: '29240812345678000195550010000001231123456780',
      nsu: 456,
      modelo: '55',
      serie: '1',
      numeroDocumento: '123',
      emitenteCnpjCpf: '12345678000195',
      emitenteRazaoSocial: 'Empresa Teste',
      dataEmissao: new Date('2024-08-15T13:45:00.000Z'),
      dataEmissaoFiscal: '2024-08-15',
      valorTotal: '150.75',
      tpNfXml: '1',
      xmlContent: '<resNFe />',
    };

    const result = await (
      service as unknown as {
        salvarResumoNfe(
          clienteId: string,
          cnpj: string,
          resumo: ParsedResumoNfe,
        ): Promise<boolean>;
      }
    ).salvarResumoNfe('cliente-1', '98765432000110', resumo);

    expect(result).toBe(true);
    expect(storage.upload).toHaveBeenCalledWith(
      expect.stringContaining('/resumos/nfe/'),
      expect.any(Buffer),
      'application/xml',
    );
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        situacao: 'RESUMIDA',
        escriturado: false,
        escrituracaoStatus: 'NAO_ESCRITURAVEL',
      }),
    );
    expect(onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ setWhere: expect.anything() as unknown }),
    );
  });

  it('cancelamento atualiza a situação para CANCELADA sem apagar o documento nem os itens (R1.5)', async () => {
    const documento = parseDocumentWithItem();
    // O evento de cancelamento reprocessa o mesmo documento já persistido
    // (mesmo NSU) trazendo a situação CANCELADA.
    const canceladoParsed: ParsedDocumentoFiscal = {
      ...documento,
      situacao: 'CANCELADA',
    };

    // Documento já existe com o mesmo NSU e não é RESUMIDA → ramo isDuplicate.
    const existingLimit = jest.fn().mockResolvedValue([
      {
        id: 'doc-existente-1',
        nsu: canceladoParsed.nsu,
        situacao: 'AUTORIZADA',
        xmlKey: 'clientes/xml-antigo.xml',
      },
    ]);
    const select = jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({ limit: existingLimit }),
      }),
    });

    // Itens já persistidos: a reconciliação deve preservá-los (UPDATE por id),
    // nunca deletar em massa.
    const itemExistente = {
      id: 'item-existente-1',
      numeroItem: 1,
      codigoProduto: 'PROD-1',
      cfopManual: false,
    };
    const txSelect = jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue([itemExistente]),
      }),
    });

    const docUpdateSet = jest.fn().mockReturnValue({
      where: jest.fn().mockResolvedValue(undefined),
    });
    const itemUpdateSet = jest.fn().mockReturnValue({
      where: jest.fn().mockResolvedValue(undefined),
    });
    const update = jest.fn((table) =>
      table === documentosFiscais
        ? { set: docUpdateSet }
        : { set: itemUpdateSet },
    );
    const deleteFn = jest.fn();
    const insertFn = jest.fn();
    const tx = {
      execute: jest.fn().mockResolvedValue(undefined),
      select: txSelect,
      update,
      delete: deleteFn,
      insert: insertFn,
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
      {} as never,
    );

    const result = await (
      service as unknown as {
        salvarDocumento(
          clienteId: string,
          cnpj: string,
          parsed: ParsedDocumentoFiscal,
        ): Promise<boolean>;
      }
    ).salvarDocumento('cliente-1', '98765432000110', canceladoParsed);

    // Documento já existia → salvarDocumento retorna false (não é novo).
    expect(result).toBe(false);
    // R1.6/R1.7: o ramo isDuplicate adquire o advisory lock por cliente +
    // chaveAcesso (NÃO por NSU), serializando reimportações concorrentes.
    expectAdvisoryLockAcquired(
      tx.execute,
      'cliente-1',
      canceladoParsed.chaveAcesso,
    );
    // Situação convergiu para CANCELADA via UPDATE do documento original.
    expect(update).toHaveBeenCalledWith(documentosFiscais);
    expect(docUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ situacao: 'CANCELADA' }),
    );
    // Reconciliação consultou os itens existentes (preservação por identidade).
    expect(txSelect).toHaveBeenCalled();
    // O item existente foi ATUALIZADO in-place (id preservado), não recriado.
    expect(update).toHaveBeenCalledWith(documentosFiscaisItens);
    // NUNCA deleta o documento nem os itens no cancelamento.
    expect(deleteFn).not.toHaveBeenCalled();
    // Não reinsere documento nem itens (sem delete+reinsert destrutivo).
    expect(insertFn).not.toHaveBeenCalled();
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
      {} as never,
    );

    await service.getDashboardStats();

    const dashboardQuery = new PgDialect().sqlToQuery(whereClauses[0]);
    expect(dashboardQuery.params).toHaveLength(1);
    expect(typeof dashboardQuery.params[0]).toBe('string');
    expect(dashboardQuery.params[0]).toMatch(/^\d{4}-\d{2}-01T/);
  });
});

// R1.6/R1.7: verifica que a transação adquiriu o advisory lock por
// cliente + chaveAcesso. A chave DEVE ser `fiscal-doc:${clienteId}:${chave}`
// (idêntica entre distribuição DF-e e importação manual) para que os dois
// canais serializem no mesmo par cliente+chave e nunca no NSU.
function expectAdvisoryLockAcquired(
  execute: jest.Mock,
  clienteId: string,
  chaveAcesso: string,
): void {
  const dialect = new PgDialect();
  const expectedKey = `fiscal-doc:${clienteId}:${chaveAcesso}`;
  const acquired = execute.mock.calls.some(([arg]) => {
    if (!arg || typeof arg !== 'object') {
      return false;
    }
    let rendered: { sql: string; params: unknown[] };
    try {
      rendered = dialect.sqlToQuery(arg as SQL);
    } catch {
      return false;
    }
    return (
      rendered.sql.includes('pg_advisory_xact_lock') &&
      rendered.params.includes(expectedKey)
    );
  });
  expect(acquired).toBe(true);
}

function createSyncHarness(responses: unknown[]) {
  const limit = jest
    .fn()
    .mockResolvedValueOnce([
      {
        id: 'client-1',
        cnpj: '98765432000110',
        uf: 'BA',
        regimeTributario: null,
        apuraIcms: false,
      },
    ])
    .mockResolvedValueOnce([
      {
        id: 'control-1',
        ultimoNsu: 0,
        maxNsu: 0,
        proximaConsultaEm: null,
      },
    ]);
  const select = jest.fn().mockReturnValue({
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({ limit }),
    }),
  });
  const atualizacoes: Array<Record<string, unknown>> = [];
  const update = jest.fn().mockReturnValue({
    set: jest.fn((value: Record<string, unknown>) => {
      atualizacoes.push(value);
      return {
        where: jest.fn(() =>
          Object.assign(Promise.resolve(), {
            returning: jest.fn().mockResolvedValue([{ id: 'control-1' }]),
          }),
        ),
      };
    }),
  });
  const nfeWizard = {
    consultarDistribuicaoDFe: jest
      .fn()
      .mockImplementation(() => Promise.resolve(responses.shift())),
  };
  const service = new DistribuicaoDfeService(
    { db: { select, update } } as never,
    {} as never,
    nfeWizard as never,
    createCfopServiceMock() as never,
    {} as never,
  );
  return { service, nfeWizard, atualizacoes };
}

function dfeResponse(
  nsu: number,
  maxNsu: number,
  schema: string,
  xml?: string,
) {
  const chave = buildAccessKey('55');
  const conteudo =
    xml ??
    `<resNFe><chNFe>${chave}</chNFe><CNPJ>12345678000195</CNPJ><dhEmi>2024-08-15T10:45:00-03:00</dhEmi><vNF>10.00</vNF></resNFe>`;
  const zipped = gzipSync(Buffer.from(conteudo)).toString('base64');
  return {
    data: {
      retDistDFeInt: {
        cStat: '138',
        ultNSU: String(nsu),
        maxNSU: String(maxNsu),
        xml: `<retDistDFeInt><loteDistDFeInt><docZip NSU="${String(nsu).padStart(15, '0')}" schema="${schema}">${zipped}</docZip></loteDistDFeInt></retDistDFeInt>`,
      },
    },
  };
}

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
