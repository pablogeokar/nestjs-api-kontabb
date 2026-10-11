import {
  ORDEM_ETAPAS,
  montarPonteConciliacao,
  type EtapaPonte,
  type TotaisEtapa,
} from './conciliacao-ponte';
import type { FechamentoRegistro } from './fiscal-closing.service';
import {
  projetarResultadoApuracao,
  type FechamentoSnapshots,
} from './resultado-apuracao.projector';

function registro(
  overrides: Partial<FechamentoRegistro> = {},
): FechamentoRegistro {
  return {
    id: 'f1',
    clienteId: 'c1',
    obrigacao: 'EFD_ICMS_IPI',
    competencia: '2026-09-01',
    versao: 2,
    estado: 'FECHADO',
    corrente: true,
    motorVersao: 'fase3-fechamento@1',
    hashEntradas: 'a'.repeat(64),
    aprovadoPor: 'u1',
    fechadoEm: new Date('2026-10-01T00:00:00Z'),
    ...overrides,
  };
}

/**
 * Snapshots de exemplo. Dois documentos de entrada (crédito) e um de saída
 * (débito); os saldos congelados representam a apuração já composta. Valores
 * monetários SEMPRE como strings decimais.
 */
function snapshots(
  overrides: Partial<FechamentoSnapshots> = {},
): FechamentoSnapshots {
  return {
    documentos: [
      {
        chave: 'A',
        tipoOperacaoEscriturada: 'ENTRADA',
        cfop: '1102',
        cstIcms: '00', // tributada: CST autoriza o crédito do destaque
        valorIcms: '18.00',
      },
      {
        chave: 'B',
        tipoOperacaoEscriturada: 'ENTRADA',
        cfop: '1556', // uso/consumo: CFOP veda o crédito do destaque
        cstIcms: '00',
        valorIcms: '5.00',
      },
      {
        chave: 'C',
        tipoOperacaoEscriturada: 'SAIDA',
        cfop: '5102',
        valorIcms: '45.09',
      },
    ],
    saldos: {
      // Saldos congelados: crédito admitido 18.00 (o uso/consumo 1556 é vedado,
      // 5.00 destacados mas NÃO admitidos — ver reconciliação C190×admitido).
      creditos: '18.00',
      debitos: '45.09',
      saldoApurado: '27.09',
      icmsRecolher: '27.09',
    },
    parametros: {},
    ...overrides,
  };
}

/**
 * Snapshot em que TODO o destaque documental é admitido (sem vedações): dois
 * documentos de entrada tributados (CST 00, CFOP creditável) e uma saída. Serve
 * aos casos em que C190 e crédito admitido coincidem — não há diferença a
 * explicar.
 */
function snapshotsTotalmenteAdmitido(
  overrides: Partial<FechamentoSnapshots> = {},
): FechamentoSnapshots {
  return {
    documentos: [
      {
        chave: 'A',
        tipoOperacaoEscriturada: 'ENTRADA',
        cfop: '1102',
        cstIcms: '00',
        valorIcms: '18.00',
      },
      {
        chave: 'B',
        tipoOperacaoEscriturada: 'ENTRADA',
        cfop: '1102',
        cstIcms: '00',
        valorIcms: '5.00',
      },
      {
        chave: 'C',
        tipoOperacaoEscriturada: 'SAIDA',
        cfop: '5102',
        valorIcms: '45.09',
      },
    ],
    saldos: {
      creditos: '23.00',
      debitos: '45.09',
      saldoApurado: '22.09',
      icmsRecolher: '22.09',
    },
    parametros: {},
    ...overrides,
  };
}

describe('conciliacao-ponte (F03 / R2.2, R2.4)', () => {
  describe('trilha de etapas (R2.2 — documentos→lançamentos→apuração→livro→E110)', () => {
    it('monta as cinco etapas na ordem canônica do fluxo', () => {
      const ponte = montarPonteConciliacao(registro(), snapshots());
      expect(ponte.etapas.map((e) => e.etapa)).toEqual(ORDEM_ETAPAS);
    });

    it('identifica a versão de fechamento conciliada', () => {
      const ponte = montarPonteConciliacao(registro(), snapshots());
      expect(ponte).toMatchObject({
        clienteId: 'c1',
        obrigacao: 'EFD_ICMS_IPI',
        competencia: '2026-09-01',
        versao: 2,
        estado: 'FECHADO',
        motorVersao: 'fase3-fechamento@1',
        hashEntradas: 'a'.repeat(64),
      });
    });

    it('a etapa DOCUMENTOS soma crédito por entradas e débito por saídas', () => {
      const ponte = montarPonteConciliacao(registro(), snapshots());
      const docs = ponte.etapas.find((e) => e.etapa === 'DOCUMENTOS');
      // Créditos documentais: 18.00 + 5.00 = 23.00; Débitos: 45.09.
      expect(docs?.totais).toEqual({ creditos: '23.00', debitos: '45.09' });
    });

    it('a etapa APURACAO/LIVRO/E110 reflete os saldos congelados do fechamento', () => {
      const ponte = montarPonteConciliacao(registro(), snapshots());
      for (const nome of ['APURACAO', 'LIVRO', 'E110'] as EtapaPonte[]) {
        const et = ponte.etapas.find((e) => e.etapa === nome);
        // Crédito admitido congelado: 18.00 (uso/consumo 1556 vedado).
        expect(et?.totais).toEqual({ creditos: '18.00', debitos: '45.09' });
      }
    });

    it('documento sem sentido explícito não contribui (zero ≠ não informado)', () => {
      const ponte = montarPonteConciliacao(
        registro(),
        snapshots({
          documentos: [
            { chave: 'X', valorIcms: '10.00' }, // sem tipoOperacao
          ],
          saldos: {},
        }),
      );
      const docs = ponte.etapas.find((e) => e.etapa === 'DOCUMENTOS');
      expect(docs?.totais).toEqual({ creditos: '0.00', debitos: '0.00' });
    });
  });

  describe('ajustes explicados entre etapas (R2.2 — cada ajuste rastreável)', () => {
    it('quando todo o destaque é admitido, não há ajuste DOCUMENTOS→LANCAMENTOS nem diferença', () => {
      const ponte = montarPonteConciliacao(
        registro(),
        snapshotsTotalmenteAdmitido(),
      );
      const ajuste = ponte.ajustes.find(
        (a) => a.de === 'DOCUMENTOS' && a.para === 'LANCAMENTOS',
      );
      expect(ajuste).toBeUndefined();
      // Reconciliação C190 × admitido: destaque = admitido, sem parcelas (R2.3).
      expect(ponte.diferencaCreditoAdmitido).toEqual({
        destacado: '23.00',
        admitido: '23.00',
        diferenca: '0.00',
        parcelas: [],
      });
    });

    it('explica a diferença C190×crédito admitido como ajuste, sem apagar o destaque (R2.3)', () => {
      // Documentos destacam 23.00 de crédito, mas o uso/consumo (CFOP 1556, 5.00)
      // é VEDADO pela decisão de crédito ÚNICA: só 18.00 são admitidos. A
      // diferença é derivada dos próprios documentos, não de um parâmetro.
      const ponte = montarPonteConciliacao(registro(), snapshots());
      const ajuste = ponte.ajustes.find(
        (a) =>
          a.de === 'DOCUMENTOS' &&
          a.para === 'LANCAMENTOS' &&
          a.campo === 'creditos',
      );
      expect(ajuste).toBeDefined();
      // Destaque documental 23.00 → crédito admitido 18.00 ⇒ delta -5.00.
      expect(ajuste?.delta).toBe('-5.00');
      expect(ajuste?.codigo).toBe('DOCUMENTOS_LANCAMENTOS_CREDITOS');
      expect(ajuste?.fundamento).toMatch(/admitido/i);
      // O fundamento carrega o MOTIVO REAL (vedação por CFOP), não texto genérico.
      expect(ajuste?.fundamento).toMatch(/CFOP_VEDA_CREDITO/);
      // O destaque documental NÃO foi zerado: a etapa DOCUMENTOS preserva 23.00.
      const docs = ponte.etapas.find((e) => e.etapa === 'DOCUMENTOS');
      expect(docs?.totais.creditos).toBe('23.00');
    });

    it('reconciliação C190×admitido é de primeira classe e decomposta por motivo (R2.3)', () => {
      const ponte = montarPonteConciliacao(registro(), snapshots());
      const dca = ponte.diferencaCreditoAdmitido;
      // Destaque preservado (23.00); admitido separado (18.00); diferença 5.00.
      expect(dca.destacado).toBe('23.00');
      expect(dca.admitido).toBe('18.00');
      expect(dca.diferenca).toBe('5.00');
      // Uma parcela: o uso/consumo 1556 vedado por CFOP.
      expect(dca.parcelas).toHaveLength(1);
      const parcela = dca.parcelas[0];
      expect(parcela.motivo).toBe('CFOP_VEDA_CREDITO');
      expect(parcela.decisao).toBe('VEDADO');
      expect(parcela.destacado).toBe('5.00');
      expect(parcela.admitido).toBe('0.00');
      expect(parcela.diferenca).toBe('5.00');
      expect(parcela.quantidade).toBe(1);
      expect(parcela.fundamento).toMatch(/uso\/consumo|LC 87\/96/);
    });

    it('o override explícito de lançamentos congelados PREVALECE sobre a decisão derivada', () => {
      // Quando o fechamento já congelou os totais de lançamento, eles vencem —
      // a decomposição por motivo continua sendo projetada a partir dos documentos.
      const ponte = montarPonteConciliacao(
        registro(),
        snapshots({
          parametros: { lancamentos: { creditos: '18.00', debitos: '45.09' } },
          saldos: { creditos: '18.00', debitos: '45.09' },
        }),
      );
      const lanc = ponte.etapas.find((e) => e.etapa === 'LANCAMENTOS');
      expect(lanc?.totais).toEqual({ creditos: '18.00', debitos: '45.09' });
      // A reconciliação C190×admitido é independente do override (vem dos docs).
      expect(ponte.diferencaCreditoAdmitido.admitido).toBe('18.00');
      expect(ponte.diferencaCreditoAdmitido.parcelas).toHaveLength(1);
    });

    it('explica ajustes/estornos de apuração como ajuste LANCAMENTOS→APURACAO', () => {
      // Lançamentos somam 23.00 de crédito; a apuração aplica um estorno,
      // deixando 20.00. A diferença aparece explicada entre as duas etapas.
      const ponte = montarPonteConciliacao(
        registro(),
        snapshots({
          parametros: { lancamentos: { creditos: '23.00', debitos: '45.09' } },
          saldos: { creditos: '20.00', debitos: '45.09' },
        }),
      );
      const ajuste = ponte.ajustes.find(
        (a) =>
          a.de === 'LANCAMENTOS' &&
          a.para === 'APURACAO' &&
          a.campo === 'creditos',
      );
      expect(ajuste?.delta).toBe('-3.00');
      expect(ajuste?.fundamento).toMatch(/estorno|ajuste/i);
    });

    it('cada ajuste carrega de/para/campo/código/delta/fundamento', () => {
      const ponte = montarPonteConciliacao(
        registro(),
        snapshots({
          parametros: { lancamentos: { creditos: '18.00', debitos: '45.09' } },
          saldos: { creditos: '18.00', debitos: '45.09' },
        }),
      );
      for (const ajuste of ponte.ajustes) {
        expect(ajuste.de).toBeTruthy();
        expect(ajuste.para).toBeTruthy();
        expect(['creditos', 'debitos']).toContain(ajuste.campo);
        expect(ajuste.codigo).toMatch(/^[A-Z_]+$/);
        expect(ajuste.delta).toMatch(/^-?\d+\.\d{2}$/);
        expect(ajuste.fundamento.length).toBeGreaterThan(0);
      }
    });
  });

  describe('conciliação livro × E110 (R2.4 — mesma versão → mesmos créditos/débitos)', () => {
    it('reconcilia por construção: livro e E110 projetam a mesma versão', () => {
      const ponte = montarPonteConciliacao(registro(), snapshots());
      expect(ponte.conciliacaoLivroE110).toEqual({
        reconcilia: true,
        diferencaCreditos: '0.00',
        diferencaDebitos: '0.00',
      });
      // E não há ajuste entre LIVRO e E110 (seriam sinal de regressão).
      const ajusteLivroE110 = ponte.ajustes.filter(
        (a) => a.de === 'LIVRO' && a.para === 'E110',
      );
      expect(ajusteLivroE110).toEqual([]);
    });

    it('cobre CFOPs de consumo/ativo/ST/exceções sem quebrar a conciliação (R2.4)', () => {
      const ponte = montarPonteConciliacao(
        registro(),
        snapshots({
          documentos: [
            // Revenda tributada: crédito admitido integral (CST 00).
            {
              chave: 'REVENDA',
              tipoOperacaoEscriturada: 'ENTRADA',
              cfop: '1102',
              cstIcms: '00',
              valorIcms: '20.00',
            },
            // Uso/consumo: CFOP veda o crédito (556).
            {
              chave: 'CONS',
              tipoOperacaoEscriturada: 'ENTRADA',
              cfop: '1556',
              cstIcms: '00',
              valorIcms: '5.00',
            },
            // Ativo imobilizado: CFOP veda o crédito integral (551 — via CIAP).
            {
              chave: 'ATIVO',
              tipoOperacaoEscriturada: 'ENTRADA',
              cfop: '1551',
              cstIcms: '00',
              valorIcms: '7.00',
            },
            // Substituído tributário (ST): CFOP veda o crédito próprio (403).
            {
              chave: 'ST',
              tipoOperacaoEscriturada: 'ENTRADA',
              cfop: '1403',
              cstIcms: '60',
              valorIcms: '3.00',
            },
            {
              chave: 'SAIDA',
              tipoOperacaoEscriturada: 'SAIDA',
              cfop: '5405',
              valorIcms: '30.00',
            },
          ],
          // Crédito admitido congelado = só a revenda (20.00); consumo/ativo/ST
          // são destacados mas NÃO admitidos. A apuração/livro/E110 partem daí.
          saldos: { creditos: '20.00', debitos: '30.00' },
        }),
      );
      expect(ponte.conciliacaoLivroE110.reconcilia).toBe(true);
      const dca = ponte.diferencaCreditoAdmitido;
      // Destaque total 35.00; admitido 20.00; diferença 15.00 (5+7+3), explicada.
      expect(dca.destacado).toBe('35.00');
      expect(dca.admitido).toBe('20.00');
      expect(dca.diferenca).toBe('15.00');
      // Consumo/ativo/ST compartilham o motivo CFOP_VEDA_CREDITO: um grupo de 3.
      const vedadoCfop = dca.parcelas.find(
        (p) => p.motivo === 'CFOP_VEDA_CREDITO',
      );
      expect(vedadoCfop?.decisao).toBe('VEDADO');
      expect(vedadoCfop?.diferenca).toBe('15.00');
      expect(vedadoCfop?.quantidade).toBe(3);
      // A diferença documento×admitido também aparece como ajuste da ponte.
      const ajuste = ponte.ajustes.find(
        (a) =>
          a.de === 'DOCUMENTOS' &&
          a.para === 'LANCAMENTOS' &&
          a.campo === 'creditos',
      );
      expect(ajuste?.delta).toBe('-15.00');
    });

    it('decompõe a diferença por MOTIVO quando há vedação por regra e CST não autorizado (R2.3)', () => {
      const ponte = montarPonteConciliacao(
        registro(),
        snapshots({
          documentos: [
            // Admitido (CST 00): 10.00.
            {
              chave: 'OK',
              tipoOperacaoEscriturada: 'ENTRADA',
              cfop: '1102',
              cstIcms: '00',
              valorIcms: '10.00',
            },
            // CST 90 não autorizado → EXIGE_REVISAO (destaque não admitido).
            {
              chave: 'REV',
              tipoOperacaoEscriturada: 'ENTRADA',
              cfop: '1102',
              cstIcms: '90',
              valorIcms: '4.00',
            },
            // Regra fiscal veda o crédito explicitamente → VEDADO.
            {
              chave: 'REGRA',
              tipoOperacaoEscriturada: 'ENTRADA',
              cfop: '1102',
              cstIcms: '00',
              valorIcms: '6.00',
              regra: { apropriaCreditoIcms: false, regraVersaoId: 'r-veda-1' },
            },
            {
              chave: 'SAIDA',
              tipoOperacaoEscriturada: 'SAIDA',
              cfop: '5102',
              valorIcms: '30.00',
            },
          ],
          saldos: { creditos: '10.00', debitos: '30.00' },
        }),
      );
      const dca = ponte.diferencaCreditoAdmitido;
      expect(dca.destacado).toBe('20.00');
      expect(dca.admitido).toBe('10.00');
      expect(dca.diferenca).toBe('10.00');
      // Duas parcelas distintas por motivo, ordenadas de forma estável.
      const motivos = dca.parcelas.map((p) => p.motivo);
      expect(motivos).toEqual(['CST_NAO_AUTORIZADO', 'REGRA_VEDA_CREDITO']);
      const revisao = dca.parcelas.find(
        (p) => p.motivo === 'CST_NAO_AUTORIZADO',
      );
      expect(revisao?.decisao).toBe('EXIGE_REVISAO');
      expect(revisao?.diferenca).toBe('4.00');
      expect(revisao?.fundamento).toMatch(/revisão/i);
      const regra = dca.parcelas.find((p) => p.motivo === 'REGRA_VEDA_CREDITO');
      expect(regra?.decisao).toBe('VEDADO');
      expect(regra?.diferenca).toBe('6.00');
      expect(regra?.fundamento).toMatch(/regra fiscal/i);
    });

    it('admite crédito de ICMS do Simples (CSOSN 101) e explica o CSOSN não autorizado (R2.3)', () => {
      const ponte = montarPonteConciliacao(
        registro(),
        snapshots({
          documentos: [
            // CSOSN 101 permite crédito ao adquirente → admitido.
            {
              chave: 'SN_OK',
              tipoOperacaoEscriturada: 'ENTRADA',
              cfop: '1102',
              csosnIcms: '101',
              valorCreditoIcmsSn: '2.00',
            },
            // CSOSN 102 não transfere crédito → EXIGE_REVISAO.
            {
              chave: 'SN_REV',
              tipoOperacaoEscriturada: 'ENTRADA',
              cfop: '1102',
              csosnIcms: '102',
              valorCreditoIcmsSn: '1.50',
            },
            {
              chave: 'SAIDA',
              tipoOperacaoEscriturada: 'SAIDA',
              cfop: '5102',
              valorIcms: '10.00',
            },
          ],
          saldos: { creditos: '2.00', debitos: '10.00' },
        }),
      );
      const dca = ponte.diferencaCreditoAdmitido;
      expect(dca.destacado).toBe('3.50');
      expect(dca.admitido).toBe('2.00');
      expect(dca.diferenca).toBe('1.50');
      expect(dca.parcelas).toHaveLength(1);
      expect(dca.parcelas[0].motivo).toBe('CST_NAO_AUTORIZADO');
      expect(dca.parcelas[0].diferenca).toBe('1.50');
    });
  });

  describe('saldo devedor documental não apresentado como guia automática (R2.5)', () => {
    it('expõe o saldo devedor no fim da trilha como apuração, não como guia', () => {
      const ponte = montarPonteConciliacao(registro(), snapshots());
      // Saldo devedor documental = icmsRecolher congelado (27.09).
      expect(ponte.saldoDevedorApurado.valor).toBe('27.09');
      expect(ponte.saldoDevedorApurado.possuiSaldoDevedor).toBe(true);
      // Natureza de APURAÇÃO; nunca uma guia automática a recolher.
      expect(ponte.saldoDevedorApurado.natureza).toBe('APURACAO');
      expect(ponte.saldoDevedorApurado.guiaAutomatica).toBe(false);
      expect(ponte.saldoDevedorApurado.exigeEmissaoDeliberada).toBe(true);
    });

    it('não introduz nenhuma etapa/ajuste/campo que represente uma guia a recolher', () => {
      const ponte = montarPonteConciliacao(registro(), snapshots());
      // A trilha vai até E110 (apuração/SPED) e NÃO até uma "guia": nenhuma
      // etapa é uma guia de recolhimento (DAE/GNRE/DARF/DAS).
      const nomesEtapas = ponte.etapas.map((e) => e.etapa);
      for (const guia of ['GUIA', 'DAE', 'GNRE', 'DARF', 'DAS']) {
        expect(nomesEtapas).not.toContain(guia as never);
      }
      // Nenhum ajuste declara ter gerado/derivado uma guia automaticamente.
      for (const ajuste of ponte.ajustes) {
        expect(ajuste.fundamento).not.toMatch(
          /guia (a recolher|gerada|autom)/i,
        );
      }
      // O rótulo do saldo deixa claro que emitir a guia é um passo separado.
      expect(ponte.saldoDevedorApurado.rotulo).toMatch(/separad|deliberad/i);
    });

    it('saldo credor na ponte não vira saldo devedor nem guia', () => {
      const ponte = montarPonteConciliacao(
        registro(),
        snapshots({
          documentos: [
            {
              chave: 'A',
              tipoOperacaoEscriturada: 'ENTRADA',
              cfop: '1102',
              cstIcms: '00',
              valorIcms: '50.00',
            },
            {
              chave: 'C',
              tipoOperacaoEscriturada: 'SAIDA',
              cfop: '5102',
              valorIcms: '10.00',
            },
          ],
          saldos: {
            creditos: '50.00',
            debitos: '10.00',
            saldoApurado: '-40.00',
            icmsRecolher: '0.00',
            saldoCredorTransportar: '40.00',
          },
        }),
      );
      expect(ponte.saldoDevedorApurado.possuiSaldoDevedor).toBe(false);
      expect(ponte.saldoDevedorApurado.valor).toBe('0.00');
      expect(ponte.saldoDevedorApurado.guiaAutomatica).toBe(false);
    });
  });

  /**
   * Tarefa 4.4 — R2.1 e R2.4 de forma inequívoca e abrangente.
   *
   * R2.1: QUANDO uma competência é fechada, os créditos e débitos documentais
   * DEVEM ser IDÊNTICOS entre livros e SPED para a MESMA versão, e os totais
   * DEVEM ser reconciliáveis com a convenção do preview do SPED
   * (`SpedApuracaoPreview.icmsProprio` — mesmos nomes/semântica de campos,
   * strings decimais). Aqui provamos a identidade livro×SPED campo a campo e a
   * reconciliação com o preview reaproveitando o MESMO projetor do contrato
   * (`projetarResultadoApuracao`), sem um segundo motor.
   *
   * R2.4: a conciliação DEVE cobrir CFOPs de consumo, ativo (CIAP), ST e
   * exceções aprovadas — e a identidade livro×SPED DEVE valer ATRAVÉS de todas
   * elas, inclusive combinadas num mesmo fechamento.
   */
  describe('mesma versão → mesmos créditos/débitos livro×SPED (R2.1, R2.4)', () => {
    /**
     * As doze chaves da convenção `SpedApuracaoPreview.icmsProprio`
     * (= `ResultadoApuracaoTotais`). Travar a lista garante que a projeção que a
     * ponte consome segue a MESMA convenção do preview do SPED (R2.1): se o
     * contrato mudar de forma, este teste falha e nos obriga a revisitar a
     * reconciliação.
     */
    const CHAVES_PREVIEW_SPED = [
      'debitos',
      'creditos',
      'saldoCredorAnterior',
      'ajustesDebitos',
      'ajustesCreditos',
      'estornosCreditos',
      'estornosDebitos',
      'deducoes',
      'debitosEspeciais',
      'saldoApurado',
      'icmsRecolher',
      'saldoCredorTransportar',
    ] as const;

    function totaisEtapa(
      nome: EtapaPonte,
      snaps: FechamentoSnapshots,
    ): TotaisEtapa {
      const ponte = montarPonteConciliacao(registro(), snaps);
      const etapa = ponte.etapas.find((e) => e.etapa === nome);
      if (!etapa) throw new Error(`etapa ${nome} ausente`);
      return etapa.totais;
    }

    it('APURAÇÃO, LIVRO e E110 apresentam créditos/débitos IDÊNTICOS (R2.1)', () => {
      // A mesma versão de fechamento não pode divergir entre a apuração, o livro
      // (projeção) e o E110 (SPED): os três são a MESMA projeção.
      const snaps = snapshots();
      const apuracao = totaisEtapa('APURACAO', snaps);
      const livro = totaisEtapa('LIVRO', snaps);
      const e110 = totaisEtapa('E110', snaps);
      expect(livro).toEqual(apuracao);
      expect(e110).toEqual(livro);
      expect(e110).toEqual(apuracao);
    });

    it('os totais do livro×SPED batem com a convenção do preview do SPED (R2.1)', () => {
      // Reconciliação com o preview: os totais que a ponte apresenta no LIVRO/E110
      // vêm do MESMO projetor do contrato (`SpedApuracaoPreview.icmsProprio`),
      // sem segundo motor — crédito/débito batem campo a campo.
      const snaps = snapshots();
      const projecao = projetarResultadoApuracao(registro(), snaps);
      const livro = totaisEtapa('LIVRO', snaps);
      const e110 = totaisEtapa('E110', snaps);

      // A projeção do contrato segue a convenção do preview do SPED: as doze
      // chaves de `icmsProprio` existem como strings decimais.
      for (const chave of CHAVES_PREVIEW_SPED) {
        expect(typeof projecao.totais[chave]).toBe('string');
        expect(projecao.totais[chave]).toMatch(/^-?\d+\.\d{2}$/);
      }
      // Crédito/débito do livro e do E110 são EXATAMENTE os do preview (R2.1).
      expect(livro.creditos).toBe(projecao.totais.creditos);
      expect(livro.debitos).toBe(projecao.totais.debitos);
      expect(e110.creditos).toBe(projecao.totais.creditos);
      expect(e110.debitos).toBe(projecao.totais.debitos);
    });

    it('a conciliação livro×E110 reconcilia (zero de diferença) na versão fechada (R2.4)', () => {
      const ponte = montarPonteConciliacao(registro(), snapshots());
      expect(ponte.conciliacaoLivroE110).toEqual({
        reconcilia: true,
        diferencaCreditos: '0.00',
        diferencaDebitos: '0.00',
      });
    });

    it('a mesma versão projeta sempre os mesmos créditos/débitos (reprodutível, R2.1)', () => {
      // Reproduzir a projeção duas vezes com os mesmos snapshots → mesmo resultado.
      const snaps = snapshots();
      const a = montarPonteConciliacao(registro(), snaps);
      const b = montarPonteConciliacao(registro(), snaps);
      expect(b.etapas).toEqual(a.etapas);
      expect(b.conciliacaoLivroE110).toEqual(a.conciliacaoLivroE110);
      expect(b.diferencaCreditoAdmitido).toEqual(a.diferencaCreditoAdmitido);
    });

    /**
     * Snapshot que combina TODAS as exceções exigidas por R2.4 num mesmo
     * fechamento, cada uma distinta e individualmente verificável:
     *  - REVENDA   (CFOP 1102, CST 00): crédito ADMITIDO integral.
     *  - CONSUMO   (CFOP 1556): uso/consumo — CFOP veda o crédito (LC 87/96).
     *  - ATIVO     (CFOP 1551): ativo imobilizado — crédito via CIAP, vedado aqui.
     *  - ST        (CFOP 1403, CST 60): substituído tributário — sem crédito próprio.
     *  - REGRA     (regra `apropriaCreditoIcms=false`): vedação por regra fiscal.
     *  - CST_REV   (CST 90): CST não autorizado → EXIGE_REVISAO.
     *  - CSOSN_REV (CSOSN 102): CSOSN não transfere crédito → EXIGE_REVISAO.
     * Destaque total de entrada = 20+5+7+3+6+4+1.50 = 46.50; admitido = só a
     * revenda (20.00). Débito por saída = 30.00. Crédito admitido congelado 20.00.
     */
    function snapshotsExcecoesCombinadas(): FechamentoSnapshots {
      return snapshots({
        documentos: [
          {
            chave: 'REVENDA',
            tipoOperacaoEscriturada: 'ENTRADA',
            cfop: '1102',
            cstIcms: '00',
            valorIcms: '20.00',
          },
          {
            chave: 'CONSUMO',
            tipoOperacaoEscriturada: 'ENTRADA',
            cfop: '1556',
            cstIcms: '00',
            valorIcms: '5.00',
          },
          {
            chave: 'ATIVO',
            tipoOperacaoEscriturada: 'ENTRADA',
            cfop: '1551',
            cstIcms: '00',
            valorIcms: '7.00',
          },
          {
            chave: 'ST',
            tipoOperacaoEscriturada: 'ENTRADA',
            cfop: '1403',
            cstIcms: '60',
            valorIcms: '3.00',
          },
          {
            chave: 'REGRA',
            tipoOperacaoEscriturada: 'ENTRADA',
            cfop: '1102',
            cstIcms: '00',
            valorIcms: '6.00',
            regra: { apropriaCreditoIcms: false, regraVersaoId: 'r-veda-1' },
          },
          {
            chave: 'CST_REV',
            tipoOperacaoEscriturada: 'ENTRADA',
            cfop: '1102',
            cstIcms: '90',
            valorIcms: '4.00',
          },
          {
            chave: 'CSOSN_REV',
            tipoOperacaoEscriturada: 'ENTRADA',
            cfop: '1102',
            csosnIcms: '102',
            valorCreditoIcmsSn: '1.50',
          },
          {
            chave: 'SAIDA',
            tipoOperacaoEscriturada: 'SAIDA',
            cfop: '5405',
            valorIcms: '30.00',
          },
        ],
        // A versão fechada admite só a revenda (20.00); as demais são destacadas
        // mas NÃO admitidas. Apuração/livro/E110 partem desse crédito admitido.
        saldos: {
          creditos: '20.00',
          debitos: '30.00',
          saldoApurado: '10.00',
          icmsRecolher: '10.00',
        },
      });
    }

    it('livro×SPED idênticos mesmo combinando consumo+ativo+ST+regra+CST+CSOSN (R2.4)', () => {
      const snaps = snapshotsExcecoesCombinadas();
      const ponte = montarPonteConciliacao(registro(), snaps);

      // R2.4 núcleo: livro e E110 batem campo a campo apesar de todas as exceções.
      const livro = ponte.etapas.find((e) => e.etapa === 'LIVRO')?.totais;
      const e110 = ponte.etapas.find((e) => e.etapa === 'E110')?.totais;
      expect(livro).toEqual({ creditos: '20.00', debitos: '30.00' });
      expect(e110).toEqual(livro);
      expect(ponte.conciliacaoLivroE110).toEqual({
        reconcilia: true,
        diferencaCreditos: '0.00',
        diferencaDebitos: '0.00',
      });

      // E batem com o preview do SPED (mesma projeção do contrato — R2.1).
      const projecao = projetarResultadoApuracao(registro(), snaps);
      expect(livro?.creditos).toBe(projecao.totais.creditos);
      expect(livro?.debitos).toBe(projecao.totais.debitos);
    });

    it('cada tipo de exceção é EXPLICADO (não apagado) na reconciliação C190×admitido (R2.4, R2.3)', () => {
      const ponte = montarPonteConciliacao(
        registro(),
        snapshotsExcecoesCombinadas(),
      );
      const dca = ponte.diferencaCreditoAdmitido;

      // Destaque documental PRESERVADO (46.50), admitido separado (20.00),
      // diferença explicada (26.50) — nunca zerado.
      expect(dca.destacado).toBe('46.50');
      expect(dca.admitido).toBe('20.00');
      expect(dca.diferenca).toBe('26.50');

      // Consumo (5) + ativo/CIAP (7) + ST (3) compartilham a vedação por CFOP:
      // um grupo de 3 documentos somando 15.00.
      const vedadoCfop = dca.parcelas.find(
        (p) => p.motivo === 'CFOP_VEDA_CREDITO',
      );
      expect(vedadoCfop?.decisao).toBe('VEDADO');
      expect(vedadoCfop?.quantidade).toBe(3);
      expect(vedadoCfop?.diferenca).toBe('15.00');
      expect(vedadoCfop?.fundamento).toMatch(/uso\/consumo|CIAP|substitu/i);

      // Regra fiscal vedando o crédito (6.00).
      const regra = dca.parcelas.find((p) => p.motivo === 'REGRA_VEDA_CREDITO');
      expect(regra?.decisao).toBe('VEDADO');
      expect(regra?.diferenca).toBe('6.00');

      // CST 90 + CSOSN 102 não autorizados → EXIGE_REVISAO (4.00 + 1.50 = 5.50).
      const revisao = dca.parcelas.find(
        (p) => p.motivo === 'CST_NAO_AUTORIZADO',
      );
      expect(revisao?.decisao).toBe('EXIGE_REVISAO');
      expect(revisao?.quantidade).toBe(2);
      expect(revisao?.diferenca).toBe('5.50');

      // As parcelas cobrem toda a diferença (15 + 6 + 5.50 = 26.50): nada some.
      const somaParcelas = dca.parcelas.reduce(
        (acc, p) => acc + Math.round(Number(p.diferenca) * 100),
        0,
      );
      expect(somaParcelas).toBe(2650);
    });

    it('o ajuste DOCUMENTOS→LANCAMENTOS carrega TODOS os motivos das exceções (R2.4)', () => {
      const ponte = montarPonteConciliacao(
        registro(),
        snapshotsExcecoesCombinadas(),
      );
      const ajuste = ponte.ajustes.find(
        (a) =>
          a.de === 'DOCUMENTOS' &&
          a.para === 'LANCAMENTOS' &&
          a.campo === 'creditos',
      );
      // O ajuste de etapa compara o destaque de ICMS (regime normal, `valorIcms`)
      // somado em DOCUMENTOS — 45.00 — com o crédito admitido do lançamento
      // (20.00): delta −25.00. O crédito SN (CSOSN 102, 1.50) não entra no
      // destaque de ICMS da etapa DOCUMENTOS, mas aparece na reconciliação
      // C190×admitido (diferença total 26.50) — por isso o delta do ajuste
      // (−25.00) e a diferença da reconciliação (26.50) são números distintos e
      // ambos corretos; nenhum é apagado.
      expect(ajuste?.delta).toBe('-25.00');
      expect(ajuste?.fundamento).toMatch(/CFOP_VEDA_CREDITO/);
      expect(ajuste?.fundamento).toMatch(/REGRA_VEDA_CREDITO/);
      expect(ajuste?.fundamento).toMatch(/CST_NAO_AUTORIZADO/);
    });

    it('exceção APROVADA (CFOP de ativo com crédito admitido por regra) mantém livro×SPED idênticos (R2.4)', () => {
      // Exceção aprovada: um ativo cujo crédito a regra fiscal AUTORIZA
      // (`apropriaCreditoIcms` não veda) — mas o CFOP de ativo ainda tem
      // precedência de vedação no destaque de regime normal. O que importa para
      // R2.4 é que, qualquer que seja o crédito admitido CONGELADO no fechamento,
      // livro e E110 projetam o MESMO valor. Aqui a saída tributada e o crédito
      // admitido vêm dos saldos congelados; a identidade livro×SPED se mantém.
      const snaps = snapshots({
        documentos: [
          // Entrada de ativo com destaque; o crédito efetivo é o que o fechamento
          // congelou (via CIAP/regra), não o destaque bruto.
          {
            chave: 'ATIVO_APROVADO',
            tipoOperacaoEscriturada: 'ENTRADA',
            cfop: '1551',
            cstIcms: '00',
            valorIcms: '12.00',
          },
          {
            chave: 'SAIDA',
            tipoOperacaoEscriturada: 'SAIDA',
            cfop: '5102',
            valorIcms: '40.00',
          },
        ],
        // Fechamento congela, p.ex., 1/48 do crédito do ativo como admitido (0.25).
        saldos: {
          creditos: '0.25',
          debitos: '40.00',
          saldoApurado: '39.75',
          icmsRecolher: '39.75',
        },
      });
      const ponte = montarPonteConciliacao(registro(), snaps);
      const livro = ponte.etapas.find((e) => e.etapa === 'LIVRO')?.totais;
      const e110 = ponte.etapas.find((e) => e.etapa === 'E110')?.totais;
      expect(livro).toEqual({ creditos: '0.25', debitos: '40.00' });
      expect(e110).toEqual(livro);
      expect(ponte.conciliacaoLivroE110.reconcilia).toBe(true);
    });
  });

  describe('restrição de decimais como strings (nunca Number)', () => {
    it('rejeita valorIcms Number no documento congelado', () => {
      expect(() =>
        montarPonteConciliacao(
          registro(),
          snapshots({
            documentos: [
              {
                chave: 'A',
                tipoOperacaoEscriturada: 'ENTRADA',
                valorIcms: 18.0,
              },
            ],
          }),
        ),
      ).toThrow(/string.*decimal/i);
    });

    it('rejeita total de lançamento Number', () => {
      expect(() =>
        montarPonteConciliacao(
          registro(),
          snapshots({
            parametros: { lancamentos: { creditos: 18 as unknown as string } },
          }),
        ),
      ).toThrow(/string decimal/i);
    });
  });
});
