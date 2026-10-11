import {
  obrigacaoTransmitida,
  prepararDiferencaParaFiscal,
  type EntregaTransmissaoFato,
  type PreparacaoDiferencaFatos,
} from './retificacao-decisao-fiscal';

/**
 * Testes do NÚCLEO PURO da preparação de diferenças para decisão fiscal
 * (Fase 5, tarefa 5.3 — R5.3).
 *
 * O design (§Rollout §13 + Riscos) proíbe retificar automaticamente obrigação
 * já transmitida e exige preparar a diferença para o fiscal decidir. Os testes
 * cobrem as três posturas exigidas:
 *  1. obrigação TRANSMITIDA não é retificada automaticamente (status
 *     AGUARDANDO_DECISAO_FISCAL, `retificacaoAutomaticaAplicada` sempre false);
 *  2. a diferença é PREPARADA (delta assinado) e aguarda a decisão fiscal;
 *  3. o caminho NÃO transmitido não é afetado (LIVRE_PARA_CORRECAO).
 */

function fatos(
  overrides: Partial<PreparacaoDiferencaFatos> = {},
): PreparacaoDiferencaFatos {
  return {
    clienteId: 'c1',
    obrigacao: 'EFD_ICMS_IPI',
    competencia: '2026-07',
    entregas: [],
    valorTransmitido: '1000.00',
    valorNovoComputado: '1000.00',
    ...overrides,
  };
}

const entregaTransmitidaPorData: EntregaTransmissaoFato = {
  statusValidacao: 'VALIDADA',
  transmitidaEm: '2026-08-10T12:00:00.000Z',
};
const entregaTransmitidaPorStatus: EntregaTransmissaoFato = {
  statusValidacao: 'TRANSMITIDA',
  transmitidaEm: null,
};
const entregaNaoTransmitida: EntregaTransmissaoFato = {
  statusValidacao: 'PENDENTE',
  transmitidaEm: null,
};

describe('obrigacaoTransmitida — mesma aferição do inventário de rollout', () => {
  it('é transmitida quando há transmitidaEm ou status TRANSMITIDA', () => {
    expect(obrigacaoTransmitida([entregaTransmitidaPorData])).toBe(true);
    expect(obrigacaoTransmitida([entregaTransmitidaPorStatus])).toBe(true);
  });

  it('não é transmitida sem data e sem status TRANSMITIDA', () => {
    expect(obrigacaoTransmitida([])).toBe(false);
    expect(obrigacaoTransmitida([entregaNaoTransmitida])).toBe(false);
  });

  it('basta UMA entrega transmitida entre várias', () => {
    expect(
      obrigacaoTransmitida([entregaNaoTransmitida, entregaTransmitidaPorStatus]),
    ).toBe(true);
  });
});

describe('prepararDiferencaParaFiscal — obrigação TRANSMITIDA (R5.3)', () => {
  it('NÃO retifica automaticamente: aguarda decisão fiscal, com diferença preparada', () => {
    const prep = prepararDiferencaParaFiscal(
      fatos({
        entregas: [entregaTransmitidaPorStatus],
        valorTransmitido: '1000.00',
        valorNovoComputado: '1250.50',
      }),
    );

    expect(prep.transmitida).toBe(true);
    expect(prep.status).toBe('AGUARDANDO_DECISAO_FISCAL');
    // Garantia central: nunca aplica retificação automática.
    expect(prep.retificacaoAutomaticaAplicada).toBe(false);
    // Diferença preparada (delta assinado), sem aplicar nada.
    expect(prep.houveDiferenca).toBe(true);
    expect(prep.diferenca).toBe('250.50');
    expect(prep.valorTransmitido).toBe('1000.00');
    expect(prep.valorNovoComputado).toBe('1250.50');
    expect(prep.memoria).toContain('JÁ TRANSMITIDA');
    expect(prep.memoria).toContain('decisão do responsável fiscal');
  });

  it('delta negativo (novo menor que o transmitido) é preparado com sinal', () => {
    const prep = prepararDiferencaParaFiscal(
      fatos({
        entregas: [entregaTransmitidaPorData],
        valorTransmitido: '1000.00',
        valorNovoComputado: '950.00',
      }),
    );

    expect(prep.status).toBe('AGUARDANDO_DECISAO_FISCAL');
    expect(prep.retificacaoAutomaticaAplicada).toBe(false);
    expect(prep.diferenca).toBe('-50.00');
    expect(prep.houveDiferenca).toBe(true);
  });

  it('transmitida sem diferença de valor ainda aguarda decisão (não aplica nada)', () => {
    const prep = prepararDiferencaParaFiscal(
      fatos({
        entregas: [entregaTransmitidaPorStatus],
        valorTransmitido: '1000.00',
        valorNovoComputado: '1000.00',
      }),
    );

    expect(prep.status).toBe('AGUARDANDO_DECISAO_FISCAL');
    expect(prep.houveDiferenca).toBe(false);
    expect(prep.diferenca).toBe('0.00');
    expect(prep.retificacaoAutomaticaAplicada).toBe(false);
  });
});

describe('prepararDiferencaParaFiscal — obrigação NÃO transmitida (caminho não afetado)', () => {
  it('fica LIVRE_PARA_CORRECAO quando não há entrega transmitida', () => {
    const prep = prepararDiferencaParaFiscal(
      fatos({
        entregas: [entregaNaoTransmitida],
        valorTransmitido: '1000.00',
        valorNovoComputado: '1300.00',
      }),
    );

    expect(prep.transmitida).toBe(false);
    expect(prep.status).toBe('LIVRE_PARA_CORRECAO');
    expect(prep.retificacaoAutomaticaAplicada).toBe(false);
    expect(prep.diferenca).toBe('300.00');
    expect(prep.houveDiferenca).toBe(true);
    expect(prep.memoria).toContain('NÃO transmitida');
  });

  it('sem entregas também é LIVRE_PARA_CORRECAO', () => {
    const prep = prepararDiferencaParaFiscal(fatos({ entregas: [] }));
    expect(prep.transmitida).toBe(false);
    expect(prep.status).toBe('LIVRE_PARA_CORRECAO');
  });
});

describe('prepararDiferencaParaFiscal — determinismo e validação de entrada', () => {
  it('é determinístico: os mesmos fatos produzem a mesma preparação', () => {
    const base = fatos({
      entregas: [entregaTransmitidaPorStatus],
      valorTransmitido: '1000.00',
      valorNovoComputado: '1250.50',
    });
    expect(prepararDiferencaParaFiscal(base)).toEqual(
      prepararDiferencaParaFiscal(base),
    );
  });

  it('rejeita valores que não sejam strings decimais de duas casas', () => {
    expect(() =>
      prepararDiferencaParaFiscal(fatos({ valorNovoComputado: '1000' })),
    ).toThrow(/formato decimal inesperado/);
    expect(() =>
      prepararDiferencaParaFiscal(
        // Força Number para provar a restrição da fase (nunca Number).
        fatos({ valorTransmitido: 1000 as unknown as string }),
      ),
    ).toThrow(/nunca Number/);
  });
});
