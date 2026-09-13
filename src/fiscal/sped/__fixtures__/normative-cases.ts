/**
 * Fixtures normativas de regressão da Fase 0 — cenários P0.
 *
 * Cada fixture é AUTOCONTIDA e INDEPENDENTE do algoritmo do builder (R5.1):
 * declara o input em linhas cruas de banco e a EXPECTATIVA NORMATIVA campo a
 * campo (código de inconsistência exigido e/ou linha SPED esperada com o valor
 * literal de cada campo). O oráculo é escrito à mão a partir das normas, não
 * derivado da saída do builder.
 *
 * Cenários P0 cobertos (R5.6):
 *  1. CST PIS/COFINS `88` (F10)            → inconsistência impeditiva.
 *  2. IPI `88` com valor zero (F10)        → inconsistência impeditiva.
 *  3. CT-e sem CST (F10)                    → inconsistência; nunca fallback 000.
 *  4. CT-e de saída com débito ausente (F04)→ débito no E110.
 *  5. IPI `01` creditado (F09)              → crédito NÃO automático + revisão.
 *  6. Fallback agregado PIS/COFINS (F12)    → débito por item, sem perder base.
 */
import type { SpedEfdBuilderInput } from '../efd-icms-ipi.builder';
import { cteFixture, empresaFixture, inputFixture, itemRow, nfeFixture } from './normative-rows';

/**
 * Expectativa de uma linha SPED específica: registro, índice de ocorrência e
 * os campos (após o REG) que devem casar EXATAMENTE. Índices que não constam
 * em `campos` não são verificados por esta expectativa.
 */
export interface LinhaEsperada {
  reg: string;
  ocorrencia: number;
  /** Mapa índiceDoCampoAposReg → valor serializado esperado. */
  campos: Record<number, string>;
}

export interface FixtureNormativa {
  id: string;
  descricao: string;
  achado: string;
  input: () => SpedEfdBuilderInput;
  /** Padrões de código de inconsistência que DEVEM aparecer (regex). */
  inconsistenciasExigidas?: RegExp[];
  /**
   * Padrões de código de inconsistência que NÃO podem aparecer (regex).
   * Usado para provar que o campo dispensado não vira erro (R4.5), etc.
   */
  inconsistenciasProibidas?: RegExp[];
  /** Linhas serializadas esperadas campo a campo. */
  linhasEsperadas?: LinhaEsperada[];
  /**
   * Padrão que NÃO pode aparecer em NENHUMA linha serializada (ex.: o D190 não
   * pode conter o fallback inventado `000`).
   */
  linhasProibidas?: Array<{ reg: string; contem: RegExp }>;
}

export const FIXTURES_NORMATIVAS: FixtureNormativa[] = [
  {
    id: 'F10-cst-pis-cofins-88',
    descricao: 'CST PIS/COFINS 88 (fora do catálogo) impede a geração',
    achado: 'F10',
    input: () =>
      inputFixture({
        nfe: [nfeFixture({}, [itemRow({ cstPis: '88', cstCofins: '88' })])],
      }),
    inconsistenciasExigidas: [/^CST_PIS_(INVALIDO|AUSENTE)$/, /^CST_COFINS_(INVALIDO|AUSENTE)$/],
  },
  {
    id: 'F10-cst-ipi-88-valor-zero',
    descricao: 'CST IPI 88 com valor zero impede a geração (industrial)',
    achado: 'F10',
    input: () =>
      inputFixture({
        empresa: empresaFixture({
          indAtiv: '0',
          classificacaoEstabelecimentoIndustrial: '01',
        }),
        nfe: [
          nfeFixture({}, [
            itemRow({ cstIpi: '88', valorIpi: '0.00', valorBcIpi: '0.00' }),
          ]),
        ],
      }),
    inconsistenciasExigidas: [/^CST_IPI_(INVALIDO|AUSENTE)$/],
  },
  {
    id: 'F10-cte-sem-cst',
    descricao: 'CT-e sem CST/CSOSN gera erro impeditivo; nunca fallback 000',
    achado: 'F10',
    input: () =>
      inputFixture({
        cte: [cteFixture({}, { cstIcms: null, csosnIcms: null })],
      }),
    inconsistenciasExigidas: [/^CST_CTE_AUSENTE$/],
    // O D190 do CT-e não pode ser emitido com o código inventado `000`.
    linhasProibidas: [{ reg: 'D190', contem: /\|000\|/ }],
  },
  {
    id: 'F04-cte-saida-debito',
    descricao: 'CT-e de saída tributado compõe o débito do E110',
    achado: 'F04',
    input: () =>
      inputFixture({
        cte: [
          cteFixture(
            { tipoOperacaoEscriturada: 'SAIDA' },
            {
              tipoOperacaoEscriturada: 'SAIDA',
              cfop: '5353',
              cfopXml: '5353',
              // CT-e de saída não gera crédito próprio para o prestador.
              valorIcmsCreditavel: '0.00',
              // ICMS destacado da prestação = débito 12,00.
              valorBcIcms: '100.00',
              valorIcms: '12.00',
              aliquotaIcms: '12.00',
            },
          ),
        ],
      }),
    // E110 (após REG): campo 0 = VL_TOT_DEBITOS. Débito da prestação = 12,00.
    linhasEsperadas: [{ reg: 'E110', ocorrencia: 0, campos: { 0: '12,00' } }],
  },
  {
    id: 'F09-ipi-cst01-creditado',
    descricao: 'IPI CST 01 com valor positivo não vira crédito automático',
    achado: 'F09',
    input: () =>
      inputFixture({
        empresa: empresaFixture({
          indAtiv: '0',
          classificacaoEstabelecimentoIndustrial: '01',
        }),
        nfe: [
          nfeFixture({}, [
            itemRow({
              cstIpi: '01',
              valorBcIpi: '100.00',
              aliquotaIpi: '50.00',
              valorIpi: '50.00',
            }),
          ]),
        ],
      }),
    // E520 (após REG): campo 2 = VL_TOT_CRED. CST 01 não credita ⇒ 0,00.
    linhasEsperadas: [{ reg: 'E520', ocorrencia: 0, campos: { 2: '0,00' } }],
    inconsistenciasExigidas: [/^IPI_CST01_VALOR_POSITIVO$/],
  },
];
