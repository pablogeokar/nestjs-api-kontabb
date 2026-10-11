import {
  decidirC191,
  decidirC195C197,
  decidirE112E113,
  type C191Entrada,
  type C195C197Entrada,
  type E112E113Entrada,
} from './st-registros-filhos';
import { serializeSpedRecord } from './core';
import type { StCalculoStatus } from '../services/st-calculador';

// Status que NÃO geram guia definitiva (R3.6): nenhum registro filho definitivo
// deve ser emitido para eles, mesmo quando o cenário "teria" valores.
const STATUS_SEM_GUIA: StCalculoStatus[] = [
  'SIMULACAO',
  'PENDENTE',
  'BLOQUEADO',
];

describe('decidirC191 (Fase 4 / tarefa 4.4 — R3.3): só com ST/FCP efetivo', () => {
  function entrada(overrides: Partial<C191Entrada> = {}): C191Entrada {
    return {
      icmsStRetido: '150.00',
      fcpSt: '20.00',
      status: 'CALCULADO',
      ...overrides,
    };
  }

  it('emite C191 quando o grupo tem ICMS-ST e FCP-ST efetivos', () => {
    const d = decidirC191(entrada());
    expect(d.exigido).toBe(true);
    expect(d.motivo).toBeNull();
    expect(d.registros).toHaveLength(1);
    // Layout: REG | VL_FCPUFDEST | VL_ICMSUFDEST | VL_ICMSUFREMET.
    expect(serializeSpedRecord(d.registros[0])).toBe(
      '|C191|20,00|150,00|0,00|',
    );
  });

  it('emite C191 quando há apenas FCP-ST (sem ICMS-ST)', () => {
    const d = decidirC191(entrada({ icmsStRetido: '0.00', fcpSt: '20.00' }));
    expect(d.exigido).toBe(true);
    expect(d.registros).toHaveLength(1);
  });

  it('emite C191 quando há apenas ICMS-ST (sem FCP-ST)', () => {
    const d = decidirC191(entrada({ icmsStRetido: '150.00', fcpSt: '0.00' }));
    expect(d.exigido).toBe(true);
  });

  it('NÃO emite C191 quando o grupo não tem ST nem FCP (não exigido)', () => {
    const d = decidirC191(entrada({ icmsStRetido: '0.00', fcpSt: '0.00' }));
    expect(d.exigido).toBe(false);
    expect(d.registros).toHaveLength(0);
    expect(d.motivo).toMatch(/sem ICMS-ST nem FCP-ST/);
  });

  it.each(STATUS_SEM_GUIA)(
    'NÃO emite C191 definitivo quando o status é %s (R3.6)',
    (status) => {
      const d = decidirC191(entrada({ status }));
      expect(d.exigido).toBe(false);
      expect(d.registros).toHaveLength(0);
      expect(d.motivo).toContain(status);
    },
  );
});

describe('decidirC195C197 (R3.3): só com ajuste tipado do documento', () => {
  function entrada(overrides: Partial<C195C197Entrada> = {}): C195C197Entrada {
    return {
      codigoObservacao: 'OBS001',
      textoObservacao: 'Ressarcimento de ST',
      ajustes: [
        {
          tipo: 'RESSARCIMENTO',
          codigoAjuste: 'SP10000000',
          descricao: 'Ressarcimento saída interestadual',
          valor: '75.00',
        },
      ],
      status: 'CALCULADO',
      ...overrides,
    };
  }

  it('emite C195 + um C197 por ajuste', () => {
    const d = decidirC195C197(entrada());
    expect(d.exigido).toBe(true);
    expect(d.registros.map((r) => r.reg)).toEqual(['C195', 'C197']);
    expect(serializeSpedRecord(d.registros[0])).toBe(
      '|C195|OBS001|Ressarcimento de ST|',
    );
    // C197: COD_AJ | DESCR | COD_ITEM | VL_BC | ALIQ | VL_ICMS | VL_OUTROS.
    expect(serializeSpedRecord(d.registros[1])).toBe(
      '|C197|SP10000000|Ressarcimento saída interestadual|||||75,00|',
    );
  });

  it('emite um C197 para cada ajuste tipado, preservando a separação', () => {
    const d = decidirC195C197(
      entrada({
        ajustes: [
          { tipo: 'RESTITUICAO', codigoAjuste: 'SP1', valor: '10.00' },
          { tipo: 'COMPLEMENTO', codigoAjuste: 'SP2', valor: '5.00' },
        ],
      }),
    );
    expect(d.registros.map((r) => r.reg)).toEqual(['C195', 'C197', 'C197']);
  });

  it('NÃO emite nada quando não há ajuste (não exigido)', () => {
    const d = decidirC195C197(entrada({ ajustes: [] }));
    expect(d.exigido).toBe(false);
    expect(d.registros).toHaveLength(0);
    expect(d.motivo).toMatch(/sem ajuste de ST/);
  });

  it('NÃO emite ajuste sem código apurado (não inventa código)', () => {
    const d = decidirC195C197(
      entrada({
        ajustes: [{ tipo: 'RESTITUICAO', codigoAjuste: '  ', valor: '10.00' }],
      }),
    );
    expect(d.exigido).toBe(false);
  });

  it('NÃO emite quando há ajuste mas falta código de observação', () => {
    const d = decidirC195C197(entrada({ codigoObservacao: '' }));
    expect(d.exigido).toBe(false);
    expect(d.motivo).toMatch(/sem código de observação/);
  });

  it.each(STATUS_SEM_GUIA)(
    'NÃO emite definitivo quando o status é %s (R3.6)',
    (status) => {
      const d = decidirC195C197(entrada({ status }));
      expect(d.exigido).toBe(false);
      expect(d.registros).toHaveLength(0);
    },
  );
});

describe('decidirE112E113 (R3.3): só quando o E111 referencia doc/processo', () => {
  function entrada(overrides: Partial<E112E113Entrada> = {}): E112E113Entrada {
    return {
      informacoesAdicionais: {
        numeroProcesso: '12345/2026',
        indicadorOrigemProcesso: '0',
        descricaoProcesso: 'Processo administrativo de ressarcimento',
      },
      documentos: [
        {
          participanteCodigo: 'PART1',
          codigoModelo: '55',
          serie: '1',
          numeroDocumento: '999',
          dataDocumento: new Date(Date.UTC(2026, 8, 15)),
          valorAjusteItem: '75.00',
          chaveEletronica: '3'.repeat(44),
        },
      ],
      status: 'CALCULADO',
      ...overrides,
    };
  }

  it('emite E112 e um E113 por documento', () => {
    const d = decidirE112E113(entrada());
    expect(d.exigido).toBe(true);
    expect(d.registros.map((r) => r.reg)).toEqual(['E112', 'E113']);
    expect(serializeSpedRecord(d.registros[0])).toBe(
      '|E112||12345/2026|0|Processo administrativo de ressarcimento||',
    );
    // E113: COD_PART|COD_MOD|SER|SUB|NUM_DOC|DT_DOC|COD_ITEM|VL_AJ_ITEM|CHV.
    expect(serializeSpedRecord(d.registros[1])).toBe(
      `|E113|PART1|55|1||999|15092026||75,00|${'3'.repeat(44)}|`,
    );
  });

  it('emite só E112 quando há informação adicional e nenhum documento', () => {
    const d = decidirE112E113(entrada({ documentos: [] }));
    expect(d.exigido).toBe(true);
    expect(d.registros.map((r) => r.reg)).toEqual(['E112']);
  });

  it('emite só E113 quando há documentos e nenhuma informação adicional', () => {
    const d = decidirE112E113(entrada({ informacoesAdicionais: null }));
    expect(d.exigido).toBe(true);
    expect(d.registros.map((r) => r.reg)).toEqual(['E113']);
  });

  it('NÃO emite nada quando o E111 não referencia doc/processo (não exigido)', () => {
    const d = decidirE112E113(
      entrada({ informacoesAdicionais: null, documentos: [] }),
    );
    expect(d.exigido).toBe(false);
    expect(d.registros).toHaveLength(0);
    expect(d.motivo).toMatch(/não referencia/);
  });

  it('trata E112 com todos os campos vazios como ausência de conteúdo', () => {
    const d = decidirE112E113(
      entrada({
        informacoesAdicionais: {
          numeroProcesso: '   ',
          descricaoProcesso: '',
        },
        documentos: [],
      }),
    );
    expect(d.exigido).toBe(false);
  });

  it.each(STATUS_SEM_GUIA)(
    'NÃO emite definitivo quando o status é %s (R3.6)',
    (status) => {
      const d = decidirE112E113(entrada({ status }));
      expect(d.exigido).toBe(false);
      expect(d.registros).toHaveLength(0);
    },
  );
});
