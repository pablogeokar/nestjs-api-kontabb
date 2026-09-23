import {
  conciliarD190CteSaida,
  totalIcmsCtePrestacao,
  type SpedDocumentoCteBuilderData,
} from './efd-icms-ipi.builder';
import { fromScaledInteger } from './sped-decimal';

type DocumentoRow = SpedDocumentoCteBuilderData['row'];
type CteRow = SpedDocumentoCteBuilderData['cte'];

const EMPRESA_CNPJ = '09157533000156';

/**
 * Constrói um CT-e mínimo para exercitar `totalIcmsCtePrestacao`. Só os campos
 * consumidos pela função importam (tipoOperacaoEscriturada, tpCte, valorIcms e
 * codSituacaoSped no documento); o restante é preenchido de forma consistente
 * com o schema `documentosFiscaisCteEscrituracao`.
 */
function makeCte(
  documentoOverrides: Partial<DocumentoRow> = {},
  cteOverrides: Partial<CteRow> = {},
): SpedDocumentoCteBuilderData {
  return {
    row: {
      id: 'cte-documento-1',
      chaveAcesso: '2'.repeat(44),
      tipoDocumento: 'CTE',
      modelo: '57',
      numeroDocumento: '200',
      valorTotal: '150.00',
      valorTotalDeclaradoXml: '150.00',
      totaisDeclaradosXml: null,
      codSituacaoSped: '00',
      ...documentoOverrides,
    } as unknown as DocumentoRow,
    participanteCodigo: 'TRANSPORTADORA-1',
    participanteUf: 'BA',
    cte: {
      id: 'cte-1',
      documentoFiscalId: 'cte-documento-1',
      clienteId: 'cliente-1',
      escrituravel: true,
      motivoNaoEscrituravel: null,
      tomadorCnpjCpf: EMPRESA_CNPJ,
      tomadorPapel: 'REMETENTE',
      tipoOperacaoEscriturada: 'SAIDA',
      tpCte: '0',
      tpServ: '0',
      modal: '01',
      cfopXml: '5353',
      cfop: '5353',
      cfopRevisaoNecessaria: false,
      revisaoNecessaria: false,
      cstIcms: '00',
      csosnIcms: null,
      valorTotalServico: '150.00',
      valorReceber: '150.00',
      valorBcIcms: '100.00',
      aliquotaIcms: '12.00',
      valorIcms: '12.00',
      valorIcmsCreditavel: '0.00',
      valorTotalTributos: null,
      chaveCteReferenciado: null,
      codigoMunicipioOrigem: '2800308',
      codigoMunicipioDestino: '2927408',
      criadoEm: new Date('2026-08-05T12:00:00.000Z'),
      atualizadoEm: new Date('2026-08-05T12:00:00.000Z'),
      ...cteOverrides,
    } as unknown as CteRow,
  };
}

describe('totalIcmsCtePrestacao', () => {
  // R2.1: CT-e de saída tributado com ICMS 12,00 → débito 12,00.
  it('soma o ICMS de prestação de um CT-e de saída tributado', () => {
    const total = totalIcmsCtePrestacao([makeCte()], 'SAIDA');

    expect(fromScaledInteger(total)).toBe('12.00');
  });

  it('soma o ICMS de múltiplos CT-e de saída', () => {
    const total = totalIcmsCtePrestacao(
      [
        makeCte({}, { valorIcms: '12.00' }),
        makeCte(
          { id: 'cte-documento-2', chaveAcesso: '3'.repeat(44) },
          { id: 'cte-2', valorIcms: '8.00' },
        ),
      ],
      'SAIDA',
    );

    expect(fromScaledInteger(total)).toBe('20.00');
  });

  // R2.2: CT-e de saída cancelado não gera débito. codSituacaoSped 02-05
  // (cancelado/denegado) não tem valores fiscais.
  it.each(['02', '03', '04', '05'])(
    'não soma CT-e de saída com situação %s (cancelado/denegado)',
    (codSituacaoSped) => {
      const total = totalIcmsCtePrestacao(
        [makeCte({ codSituacaoSped })],
        'SAIDA',
      );

      expect(fromScaledInteger(total)).toBe('0.00');
    },
  );

  it('ignora o CT-e cancelado mas mantém o débito dos demais', () => {
    const total = totalIcmsCtePrestacao(
      [
        makeCte({}, { valorIcms: '12.00' }),
        makeCte(
          { id: 'cte-documento-2', chaveAcesso: '3'.repeat(44), codSituacaoSped: '02' },
          { id: 'cte-2', valorIcms: '99.00' },
        ),
      ],
      'SAIDA',
    );

    expect(fromScaledInteger(total)).toBe('12.00');
  });

  // R2.3: complementar (tpCte '1') soma apenas o valor destacado no próprio
  // documento (o diferencial), sem reincluir a prestação original.
  it('soma o complementar apenas com o ICMS destacado no próprio documento (sem duplicar)', () => {
    const total = totalIcmsCtePrestacao(
      [
        makeCte({}, { valorIcms: '12.00' }),
        makeCte(
          { id: 'cte-documento-2', chaveAcesso: '3'.repeat(44), codSituacaoSped: '06' },
          {
            id: 'cte-2',
            tpCte: '1',
            valorIcms: '3.00',
            chaveCteReferenciado: '2'.repeat(44),
          },
        ),
      ],
      'SAIDA',
    );

    // 12,00 (original) + 3,00 (complemento) = 15,00; o imposto original não é
    // recontado dentro do complementar.
    expect(fromScaledInteger(total)).toBe('15.00');
  });

  // R2.3: substituto (tpCte '3') traz o imposto do documento substituto; o
  // original normalmente é cancelado/anulado, então não há duplicação.
  it('soma o substituto uma única vez pelo valor do próprio documento', () => {
    const total = totalIcmsCtePrestacao(
      [
        makeCte(
          {},
          {
            tpCte: '3',
            valorIcms: '15.00',
            chaveCteReferenciado: '9'.repeat(44),
          },
        ),
      ],
      'SAIDA',
    );

    expect(fromScaledInteger(total)).toBe('15.00');
  });

  // R2.3: par explícito original + substituto. O substituto (tpCte '3') refaz a
  // prestação; o original é cancelado (codSituacaoSped '02'), então só o
  // substituto compõe o débito — não há soma de 12,00 + 15,00.
  it('não duplica o imposto quando o original é cancelado e o substituto o refaz', () => {
    const total = totalIcmsCtePrestacao(
      [
        makeCte(
          { codSituacaoSped: '02' },
          { valorIcms: '12.00' },
        ),
        makeCte(
          { id: 'cte-documento-2', chaveAcesso: '3'.repeat(44), codSituacaoSped: '06' },
          {
            id: 'cte-2',
            tpCte: '3',
            valorIcms: '15.00',
            chaveCteReferenciado: '2'.repeat(44),
          },
        ),
      ],
      'SAIDA',
    );

    // Somente o substituto (15,00) entra: o original cancelado não soma.
    expect(fromScaledInteger(total)).toBe('15.00');
  });

  // R2.3: anulação de valores (tpCte '2') reverte a prestação original; não
  // pode adicionar débito positivo.
  it('não soma débito positivo de CT-e de anulação (tpCte 2)', () => {
    const total = totalIcmsCtePrestacao(
      [makeCte({}, { tpCte: '2', valorIcms: '12.00' })],
      'SAIDA',
    );

    expect(fromScaledInteger(total)).toBe('0.00');
  });

  it('respeita o sentido: CT-e de entrada não entra no total de SAIDA', () => {
    const total = totalIcmsCtePrestacao(
      [makeCte({}, { tipoOperacaoEscriturada: 'ENTRADA', valorIcms: '12.00' })],
      'SAIDA',
    );

    expect(fromScaledInteger(total)).toBe('0.00');
  });

  it('soma CT-e de entrada quando o sentido é ENTRADA', () => {
    const total = totalIcmsCtePrestacao(
      [makeCte({}, { tipoOperacaoEscriturada: 'ENTRADA', valorIcms: '12.00' })],
      'ENTRADA',
    );

    expect(fromScaledInteger(total)).toBe('12.00');
  });

  it('retorna zero para lista vazia', () => {
    expect(fromScaledInteger(totalIcmsCtePrestacao([], 'SAIDA'))).toBe('0.00');
  });
});

// F04 (R2.4): a síntese D190 do CT-e de saída deve reconciliar com o débito do
// E110 e com o livro de saídas. Os três derivam das mesmas prestações.
describe('conciliarD190CteSaida', () => {
  it('reconcilia D190, E110 e livro de saídas para CT-e de saída tributado', () => {
    const conciliacao = conciliarD190CteSaida([makeCte()]);

    expect(fromScaledInteger(conciliacao.totalD190)).toBe('12.00');
    expect(fromScaledInteger(conciliacao.totalE110)).toBe('12.00');
    expect(fromScaledInteger(conciliacao.totalLivroSaidas)).toBe('12.00');
    expect(conciliacao.reconcilia).toBe(true);
  });

  it('reconcilia com múltiplos CT-e de saída', () => {
    const conciliacao = conciliarD190CteSaida([
      makeCte({}, { valorIcms: '12.00' }),
      makeCte(
        { id: 'cte-documento-2', chaveAcesso: '3'.repeat(44) },
        { id: 'cte-2', valorIcms: '8.50' },
      ),
    ]);

    expect(fromScaledInteger(conciliacao.totalD190)).toBe('20.50');
    expect(fromScaledInteger(conciliacao.totalE110)).toBe('20.50');
    expect(fromScaledInteger(conciliacao.totalLivroSaidas)).toBe('20.50');
    expect(conciliacao.reconcilia).toBe(true);
  });

  it('reconcilia excluindo CT-e cancelado dos três totais (sem D190, sem débito)', () => {
    const conciliacao = conciliarD190CteSaida([
      makeCte({}, { valorIcms: '12.00' }),
      makeCte(
        { id: 'cte-documento-2', chaveAcesso: '3'.repeat(44), codSituacaoSped: '02' },
        { id: 'cte-2', valorIcms: '99.00' },
      ),
    ]);

    // Cancelado (codSituacaoSped 02) não gera D190 nem débito: só o CT-e
    // tributado compõe os três totais, que reconciliam.
    expect(fromScaledInteger(conciliacao.totalD190)).toBe('12.00');
    expect(fromScaledInteger(conciliacao.totalE110)).toBe('12.00');
    expect(fromScaledInteger(conciliacao.totalLivroSaidas)).toBe('12.00');
    expect(conciliacao.reconcilia).toBe(true);
  });

  it('não conta CT-e de entrada na conciliação de saída', () => {
    const conciliacao = conciliarD190CteSaida([
      makeCte({}, { tipoOperacaoEscriturada: 'ENTRADA', valorIcms: '12.00' }),
    ]);

    expect(fromScaledInteger(conciliacao.totalD190)).toBe('0.00');
    expect(fromScaledInteger(conciliacao.totalE110)).toBe('0.00');
    expect(conciliacao.reconcilia).toBe(true);
  });

  // Divergência estrutural: um CT-e de anulação (tpCte '2') com ICMS destacado
  // positivo é escriturado no D190 (bloco D), mas não compõe débito positivo do
  // E110 nem do livro de saídas. A conciliação detecta a divergência.
  it('detecta divergência quando a anulação com ICMS positivo entra no D190 mas não no débito', () => {
    const conciliacao = conciliarD190CteSaida([
      makeCte({}, { tpCte: '2', valorIcms: '12.00' }),
    ]);

    expect(fromScaledInteger(conciliacao.totalD190)).toBe('12.00');
    expect(fromScaledInteger(conciliacao.totalE110)).toBe('0.00');
    expect(fromScaledInteger(conciliacao.totalLivroSaidas)).toBe('0.00');
    expect(conciliacao.reconcilia).toBe(false);
  });

  it('reconcilia complementar (tpCte 1) contando o ICMS do próprio documento uma única vez', () => {
    const conciliacao = conciliarD190CteSaida([
      makeCte({}, { valorIcms: '12.00' }),
      makeCte(
        { id: 'cte-documento-2', chaveAcesso: '3'.repeat(44) },
        { id: 'cte-2', tpCte: '1', valorIcms: '3.00' },
      ),
    ]);

    expect(fromScaledInteger(conciliacao.totalD190)).toBe('15.00');
    expect(fromScaledInteger(conciliacao.totalE110)).toBe('15.00');
    expect(conciliacao.reconcilia).toBe(true);
  });

  it('não conta na conciliação CT-e sem CST/CSOSN (não gera D190)', () => {
    const conciliacao = conciliarD190CteSaida([
      makeCte({}, { cstIcms: null, csosnIcms: null, valorIcms: '12.00' }),
    ]);

    // Sem CST/CSOSN o D190 não é emitido (buildBlocoD gera CST_CTE_AUSENTE),
    // então o D190 não soma. O débito também segue a mesma origem.
    expect(fromScaledInteger(conciliacao.totalD190)).toBe('0.00');
    expect(conciliacao.reconcilia).toBe(false);
  });

  it('retorna tudo zerado e reconciliado para lista vazia', () => {
    const conciliacao = conciliarD190CteSaida([]);

    expect(fromScaledInteger(conciliacao.totalD190)).toBe('0.00');
    expect(fromScaledInteger(conciliacao.totalE110)).toBe('0.00');
    expect(fromScaledInteger(conciliacao.totalLivroSaidas)).toBe('0.00');
    expect(conciliacao.reconcilia).toBe(true);
  });
});
