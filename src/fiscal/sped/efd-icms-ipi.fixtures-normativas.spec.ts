/**
 * Baseline de regressão da Fase 0 (R5.1, R5.6).
 *
 * Este spec consome as fixtures normativas de `__fixtures__/` — que descrevem o
 * arquivo SPED esperado CAMPO A CAMPO e são independentes do algoritmo do
 * builder (`makeInput`/`makeNfe`). Assim, um erro do builder não é replicado no
 * oráculo que o valida: o oráculo é escrito à mão a partir das normas.
 *
 * Cobre os 6 cenários P0 (R5.6):
 *   CST PIS/COFINS 88, IPI 88 valor zero, CT-e sem CST, CT-e de saída débito,
 *   IPI 01 creditado (via builder) e fallback agregado PIS/COFINS (via serviço).
 */
import { buildEfdIcmsIpiRecords } from './efd-icms-ipi.builder';
import { serializeSpedRecord, type SpedRecord } from './core';
import {
  FIXTURES_NORMATIVAS,
  type FixtureNormativa,
  type LinhaEsperada,
} from './__fixtures__/normative-cases';
import {
  PIS_COFINS_FIXTURE_F12,
  derivarLinhaSegmentoF12,
} from './__fixtures__/pis-cofins-normative-cases';
import { PisCofinsService } from '../services/pis-cofins.service';

/** Extrai os campos (após o REG) da n-ésima ocorrência de um registro. */
function camposDaLinha(
  records: readonly SpedRecord[],
  reg: string,
  ocorrencia: number,
): string[] {
  const matches = records.filter((record) => record.reg === reg);
  const alvo = matches[ocorrencia];
  if (!alvo) {
    throw new Error(
      `Registro ${reg}[${ocorrencia}] ausente no arquivo gerado.`,
    );
  }
  const serial = serializeSpedRecord(alvo);
  // Formato: |REG|c0|c1|...|  ⇒ remove vazios de borda e o próprio REG.
  return serial.split('|').slice(2, -1);
}

function verificarLinha(
  records: readonly SpedRecord[],
  esperada: LinhaEsperada,
): void {
  const campos = camposDaLinha(records, esperada.reg, esperada.ocorrencia);
  for (const [indice, valor] of Object.entries(esperada.campos)) {
    expect({
      reg: esperada.reg,
      campo: Number(indice),
      valor: campos[Number(indice)],
    }).toEqual({ reg: esperada.reg, campo: Number(indice), valor });
  }
}

describe('Fixtures normativas de regressão — SPED (Fase 0, cenários P0)', () => {
  const executar = (fixture: FixtureNormativa) => {
    const input = fixture.input();
    const result = buildEfdIcmsIpiRecords(input);
    return { input, records: result.records };
  };

  it.each(FIXTURES_NORMATIVAS)('[$achado] $descricao', (fixture) => {
    const { input, records } = executar(fixture);
    const codigos = input.inconsistencias.map((i) => i.codigo);

    for (const exigida of fixture.inconsistenciasExigidas ?? []) {
      expect(codigos.some((c) => exigida.test(c))).toBe(true);
    }
    for (const proibida of fixture.inconsistenciasProibidas ?? []) {
      expect(codigos.some((c) => proibida.test(c))).toBe(false);
    }
    for (const linha of fixture.linhasEsperadas ?? []) {
      verificarLinha(records, linha);
    }
    for (const proibida of fixture.linhasProibidas ?? []) {
      const linhas = records
        .filter((r) => r.reg === proibida.reg)
        .map(serializeSpedRecord);
      for (const serial of linhas) {
        expect(proibida.contem.test(serial)).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 6º cenário P0 (F12): fallback agregado de PIS/COFINS. Vive no cálculo de
// PIS/COFINS, não no builder do SPED. A fixture deriva o débito POR ITEM de
// forma independente; o serviço apenas soma crédito e apura o saldo.
// ---------------------------------------------------------------------------
function createDb(
  cliente: { regimeTributario: string | null },
  segmentos: unknown[][],
) {
  const queue = [...segmentos];
  return {
    db: {
      select: jest
        .fn()
        .mockImplementation((selection: Record<string, unknown>) => {
          if ('regimeTributario' in selection) {
            return {
              from: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  limit: jest
                    .fn()
                    .mockResolvedValue([{ id: 'c1', ...cliente }]),
                }),
              }),
            };
          }
          return {
            from: jest.fn().mockReturnValue({
              innerJoin: jest.fn().mockReturnValue({
                where: jest.fn().mockResolvedValue(queue.shift() ?? [{}]),
              }),
            }),
          };
        }),
    },
  };
}

describe('Fixture normativa de regressão — PIS/COFINS (F12)', () => {
  it('[F12] mix com/sem destaque soma o débito por item (nunca o agregado)', async () => {
    const fixture = PIS_COFINS_FIXTURE_F12;
    // Oráculo independente: soma POR ITEM (destaque OU base×alíquota).
    const linha = derivarLinhaSegmentoF12(fixture);
    // A soma por item deve casar com o esperado escrito à mão na fixture.
    expect(linha.pis_debito).toBe(fixture.debitoPisEsperado);
    expect(linha.cofins_debito).toBe(fixture.debitoCofinsEsperado);
    expect(linha.pis_base_tributada).toBe(fixture.baseTributadaEsperada);

    const service = new PisCofinsService(
      createDb({ regimeTributario: fixture.regime }, [[linha]]) as never,
    );
    const result = await service.apurarCompetencia({
      clienteId: 'c1',
      competencia: '2026-08',
    });

    // Não pode ficar só com o destaque de uma das bases: é a soma dos itens.
    expect(result.pis.debito).toBe(fixture.debitoPisEsperado);
    expect(result.pis.saldo_a_recolher).toBe(fixture.debitoPisEsperado);
    expect(result.cofins.debito).toBe(fixture.debitoCofinsEsperado);
  });
});
