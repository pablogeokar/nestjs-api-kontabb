import type { spedAjustesApuracao } from '../../database/schema';
import type { SpedDocumentoNfeBuilderData } from './efd-icms-ipi.builder';
import {
  inputTaxSignals,
  isInventoryDueForPeriod,
  pendingDocumentReviewMessage,
  validateFcpAdjustments,
  type SpedFcpTaxSignals,
} from './efd-icms-ipi.service';

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
