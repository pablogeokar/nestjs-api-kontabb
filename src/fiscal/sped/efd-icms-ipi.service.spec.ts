import { UnprocessableEntityException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { spedAjustesApuracao } from '../../database/schema';
import type { SpedDocumentoNfeBuilderData } from './efd-icms-ipi.builder';
import {
  EfdIcmsIpiService,
  inputTaxSignals,
  isInventoryDueForPeriod,
  pendingDocumentReviewMessage,
  validateFcpAdjustments,
  buildApuracaoAuditTrail,
  validateAdjustmentAuditTrail,
  type SpedFcpTaxSignals,
} from './efd-icms-ipi.service';
import type { DatabaseService } from '../../database/database.service';
import type { StorageService } from '../../storage/storage.service';
import type { AppLogger } from '../../common/logger.service';
import type { SpedInconsistencia } from './sped-efd.types';

type Adjustment = typeof spedAjustesApuracao.$inferSelect;

function adjustment(overrides: Partial<Adjustment>): Adjustment {
  return {
    registro: 'E111',
    codigoAjuste: 'BA000001',
    indicador: 'DEBITO',
    valor: '2.00',
    uf: null,
    ...overrides,
  } as Adjustment;
}

function nfe(
  operation: 'ENTRADA' | 'SAIDA',
  uf: string | null,
  fcp: string,
  fcpSt: string,
): SpedDocumentoNfeBuilderData {
  return {
    row: { tipoOperacaoEscriturada: operation },
    participanteUf: uf,
    itens: [{ row: { valorFcp: fcp, valorFcpSt: fcpSt } }],
  } as SpedDocumentoNfeBuilderData;
}

describe('conciliação de FCP da EFD ICMS/IPI', () => {
  it('considera somente saídas e agrupa o FCP-ST pela UF do participante', () => {
    const signals = inputTaxSignals([
      nfe('ENTRADA', 'SE', '99.00', '99.00'),
      nfe('SAIDA', 'SE', '2.00', '3.00'),
      nfe('SAIDA', 'SE', '1.00', '4.00'),
      nfe('SAIDA', 'BA', '0.00', '5.00'),
    ]);

    expect(signals.fcpProprio).toBe(300n);
    expect([...signals.fcpStPorUf]).toEqual([
      ['SE', 700n],
      ['BA', 500n],
    ]);
  });

  it('aceita ajustes dedicados E111/E220 que conciliam os valores', () => {
    const signals: SpedFcpTaxSignals = {
      fcpProprio: 200n,
      fcpStPorUf: new Map([['SE', 300n]]),
    };

    expect(
      validateFcpAdjustments(signals, [
        adjustment({ valor: '2.00' }),
        adjustment({
          registro: 'E220',
          codigoAjuste: 'SE100001',
          valor: '3.00',
          uf: 'SE',
        }),
      ]),
    ).toEqual([]);
  });

  it('bloqueia valor/UF divergente e FCP-ST sem destino identificado', () => {
    const signals: SpedFcpTaxSignals = {
      fcpProprio: 200n,
      fcpStPorUf: new Map([
        ['SE', 300n],
        ['', 100n],
      ]),
    };
    const issues = validateFcpAdjustments(signals, [
      adjustment({ valor: '1.00' }),
      adjustment({
        registro: 'E220',
        codigoAjuste: 'BA100001',
        valor: '3.00',
        uf: 'BA',
      }),
    ]);

    expect(issues.map((issue) => issue.codigo)).toEqual([
      'FCP_PROPRIO_AJUSTE_NAO_CONCILIADO',
      'FCP_ST_AJUSTE_NAO_CONCILIADO',
      'FCP_ST_UF_DESTINO_AUSENTE',
    ]);
  });
});

describe('exigência do Bloco H por competência', () => {
  it('usa fevereiro como padrão e não exige inventário nos demais meses', () => {
    expect(
      isInventoryDueForPeriod(true, null, new Date('2026-02-01T00:00:00Z')),
    ).toBe(true);
    expect(
      isInventoryDueForPeriod(true, null, new Date('2026-01-01T00:00:00Z')),
    ).toBe(false);
    expect(
      isInventoryDueForPeriod(false, 2, new Date('2026-02-01T00:00:00Z')),
    ).toBe(false);
  });

  it('respeita o mês configurado pelo estabelecimento', () => {
    expect(
      isInventoryDueForPeriod(true, 3, new Date('2026-03-01T00:00:00Z')),
    ).toBe(true);
    expect(
      isInventoryDueForPeriod(true, 3, new Date('2026-02-01T00:00:00Z')),
    ).toBe(false);
  });
});

describe('diagnóstico de documento pendente na EFD', () => {
  it('identifica os CFOPs afetados e orienta o reprocessamento', () => {
    const message = pendingDocumentReviewMessage([
      {
        cfopXml: '5910',
        cfop: '1949',
        cfopRevisaoNecessaria: true,
      },
      {
        cfopXml: '5102',
        cfop: '1102',
        cfopRevisaoNecessaria: false,
      },
    ]);

    expect(message).toContain('5910 → 1949');
    expect(message).toContain('Regras CFOP');
    expect(message).toContain('reprocesse o período');
  });
});

describe('auditabilidade da apuração', () => {
  it('distingue valores automáticos, informados e o padrão seguro zero', () => {
    const trail = buildApuracaoAuditTrail([], [], []);

    expect(trail).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ origem: 'DOCUMENTOS_ESCRITURADOS' }),
        expect.objectContaining({
          codigo: 'SALDOS_ANTERIORES',
          origem: 'PADRAO_ZERO',
        }),
      ]),
    );
  });

  it('bloqueia ajuste sem descrição nem documento de suporte', () => {
    const issues = validateAdjustmentAuditTrail([
      adjustment({ id: '4bcb1fd7-8882-47a4-9bcd-e063b73a82f0' }),
    ]);

    expect(issues).toEqual([
      expect.objectContaining({
        codigo: 'AJUSTE_SEM_LASTRO_DOCUMENTAL',
        severidade: 'ERRO',
      }),
    ]);
  });
});

describe('F07 — bloqueio de geração por Bloco G pendente (R3.1/R3.3)', () => {
  function makeService(configValue: string | undefined) {
    const upload = jest.fn();
    const storage = { upload } as unknown as StorageService;
    // A transação apenas executa o callback recebido, como no runtime.
    const tx = {
      execute: jest.fn().mockResolvedValue(undefined),
      insert: jest.fn(),
    };
    const db = {
      transaction: jest.fn(
        async (cb: (executor: typeof tx) => Promise<unknown>) => cb(tx),
      ),
    };
    const database = { db } as unknown as DatabaseService;
    const logger = {
      error: jest.fn(),
      warn: jest.fn(),
      log: jest.fn(),
    } as unknown as AppLogger;
    const configService = {
      get: jest.fn((key: string) =>
        key === 'SPED_BLOCO_G_LEIAUTE_HOMOLOGADO' ? configValue : undefined,
      ),
    } as unknown as ConfigService;

    const service = new EfdIcmsIpiService(
      database,
      storage,
      logger,
      configService,
    );
    return { service, upload };
  }

  it('resolve a flag `sped.blocoG.leiauteHomologado` a partir da configuração', () => {
    // Fase 0: default (ausente) e qualquer valor != "true" mantêm bloqueado.
    expect(makeService(undefined).service.blocoGLeiauteHomologado).toBe(false);
    expect(makeService('false').service.blocoGLeiauteHomologado).toBe(false);
    // Só a homologação explícita (Fase 2) libera a serialização do Bloco G.
    expect(makeService('true').service.blocoGLeiauteHomologado).toBe(true);
  });

  it('gerar() recusa o arquivo quando a prévia tem BLOCO_G_LEIAUTE_PENDENTE (ERRO)', async () => {
    const { service, upload } = makeService('false');
    const inconsistencia: SpedInconsistencia = {
      codigo: 'BLOCO_G_LEIAUTE_PENDENTE',
      severidade: 'ERRO',
      mensagem:
        'Geração bloqueada: o CIAP exige o Bloco G, cujo leiaute está em correção.',
    };
    // A preparação end-to-end exige banco; aqui isolamos o contrato de saída:
    // com inconsistência ERRO o `podeGerar` é falso e a geração é abortada.
    const prepararSpy = jest
      .spyOn(
        service as unknown as {
          preparar: EfdIcmsIpiService['preview'];
        },
        'preparar' as never,
      )
      .mockResolvedValue({
        preview: {
          podeGerar: false,
          inconsistencias: [inconsistencia],
          perfil: 'A',
        },
        records: [],
        clientDocument: '09157533000156',
        participantes: [],
        unidades: [],
        itensCatalogo: [],
      } as never);

    await expect(
      service.gerar({
        clienteId: 'cliente-1',
        competencia: '2026-08',
        finalidade: '0',
        actorUserId: 'user-1',
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'SPED_INCONSISTENTE',
        inconsistencias: expect.arrayContaining([
          expect.objectContaining({ codigo: 'BLOCO_G_LEIAUTE_PENDENTE' }),
        ]),
      },
    });
    // Contrato central: nenhum arquivo é escrito no storage.
    expect(upload).not.toHaveBeenCalled();
    prepararSpy.mockRestore();
  });

  it('gerar() propaga UnprocessableEntityException do tipo SPED_INCONSISTENTE', async () => {
    const { service } = makeService('false');
    jest
      .spyOn(
        service as unknown as { preparar: EfdIcmsIpiService['preview'] },
        'preparar' as never,
      )
      .mockResolvedValue({
        preview: {
          podeGerar: false,
          inconsistencias: [
            {
              codigo: 'BLOCO_G_LEIAUTE_PENDENTE',
              severidade: 'ERRO',
              mensagem: 'bloqueado',
            },
          ],
          perfil: 'A',
        },
        records: [],
        clientDocument: '09157533000156',
        participantes: [],
        unidades: [],
        itensCatalogo: [],
      } as never);

    await expect(
      service.gerar({
        clienteId: 'cliente-1',
        competencia: '2026-08',
        finalidade: '0',
        actorUserId: 'user-1',
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});
