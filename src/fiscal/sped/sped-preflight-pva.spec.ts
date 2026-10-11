import { createSpedRecord } from './core';
import { naturezaCfop, runPreflightPva } from './sped-preflight-pva';

describe('naturezaCfop (R5.3)', () => {
  it('classifica CFOPs de devolução como DEVOLUCAO', () => {
    for (const cfop of ['1201', '1202', '2208', '5411', '1553', '6413']) {
      expect(naturezaCfop(cfop)).toBe('DEVOLUCAO');
    }
  });

  it('classifica material de uso/consumo (556/557) como USO_CONSUMO, não devolução', () => {
    expect(naturezaCfop('1556')).toBe('USO_CONSUMO');
    expect(naturezaCfop('2556')).toBe('USO_CONSUMO');
    expect(naturezaCfop('1557')).toBe('USO_CONSUMO');
  });

  it('classifica demais CFOPs como OUTRA', () => {
    expect(naturezaCfop('1102')).toBe('OUTRA');
    expect(naturezaCfop('5101')).toBe('OUTRA');
  });
});

describe('runPreflightPva', () => {
  it('acusa item que referencia unidade ausente no 0190', () => {
    const records = [
      createSpedRecord('0190', 'UN', 'UNIDADE'),
      createSpedRecord(
        '0200',
        'ITEM-1',
        'Produto',
        null,
        null,
        'CX', // unidade CX não existe no 0190
        '00',
        '12345678',
        null,
        '12',
        null,
        null,
        null,
      ),
    ];
    const issues = runPreflightPva(records);
    expect(issues).toContainEqual(
      expect.objectContaining({ codigo: 'PVA_0200_UNIDADE_INEXISTENTE' }),
    );
  });

  it('acusa 0150 sem nome ou município', () => {
    const records = [
      createSpedRecord(
        '0150',
        'PART-1',
        '', // sem nome
        '01058',
        '12345678000199',
        null,
        null,
        '', // sem município
        null,
        null,
        null,
        null,
      ),
    ];
    const issues = runPreflightPva(records);
    expect(issues).toContainEqual(
      expect.objectContaining({ codigo: 'PVA_0150_INCOMPLETO' }),
    );
  });

  it('avisa devolução sem C113 e não avisa quando há C113', () => {
    const semRef = [
      createSpedRecord('C100', '0', '1', 'PART-1', '55', '00'),
      createSpedRecord(
        'C170',
        '1',
        'ITEM-1',
        null,
        '1,00',
        'UN',
        '100,00',
        null,
        '0',
        '000',
        '1202',
      ),
    ];
    expect(runPreflightPva(semRef)).toContainEqual(
      expect.objectContaining({ codigo: 'PVA_DEVOLUCAO_SEM_C113' }),
    );

    const comRef = [
      createSpedRecord('C100', '0', '1', 'PART-1', '55', '00'),
      createSpedRecord(
        'C113',
        '0',
        '1',
        'PART-1',
        '55',
        null,
        null,
        null,
        '9'.repeat(44),
      ),
      createSpedRecord(
        'C170',
        '1',
        'ITEM-1',
        null,
        '1,00',
        'UN',
        '100,00',
        null,
        '0',
        '000',
        '1202',
      ),
    ];
    // Com C113 o participante precisa existir no 0150 senão gera outro erro;
    // adicionamos o 0150 para isolar a regra de devolução.
    const comRefCompleto = [
      createSpedRecord(
        '0150',
        'PART-1',
        'FORN',
        '01058',
        '12345678000199',
        null,
        null,
        '1234567',
        null,
        null,
        null,
        null,
      ),
      ...comRef,
    ];
    expect(runPreflightPva(comRefCompleto)).not.toContainEqual(
      expect.objectContaining({ codigo: 'PVA_DEVOLUCAO_SEM_C113' }),
    );
  });

  it('R5.3: documento com CFOP de devolução (fim 202) sem C113 → PVA_DEVOLUCAO_SEM_C113', () => {
    const semRef = [
      createSpedRecord('C100', '0', '1', 'PART-1', '55', '00'),
      createSpedRecord(
        'C170',
        '1',
        'ITEM-1',
        null,
        '1,00',
        'UN',
        '100,00',
        null,
        '0',
        '000',
        '1202', // devolução de compra p/ comercialização
      ),
    ];
    expect(runPreflightPva(semRef)).toContainEqual(
      expect.objectContaining({ codigo: 'PVA_DEVOLUCAO_SEM_C113' }),
    );
  });

  it('R5.3: documento com CFOP de devolução (fim 202) COM C113 → sem inconsistência', () => {
    const comRef = [
      createSpedRecord(
        '0150',
        'PART-1',
        'FORN',
        '01058',
        '12345678000199',
        null,
        null,
        '1234567',
        null,
        null,
        null,
        null,
      ),
      createSpedRecord('C100', '0', '1', 'PART-1', '55', '00'),
      createSpedRecord(
        'C113',
        '0',
        '1',
        'PART-1',
        '55',
        null,
        null,
        null,
        '9'.repeat(44),
      ),
      createSpedRecord(
        'C170',
        '1',
        'ITEM-1',
        null,
        '1,00',
        'UN',
        '100,00',
        null,
        '0',
        '000',
        '1202',
      ),
    ];
    expect(runPreflightPva(comRef)).not.toContainEqual(
      expect.objectContaining({ codigo: 'PVA_DEVOLUCAO_SEM_C113' }),
    );
  });

  it('F22: CFOP 1556 (uso/consumo) não dispara falso positivo de devolução', () => {
    const usoConsumo = [
      createSpedRecord('C100', '0', '1', 'PART-1', '55', '00'),
      createSpedRecord(
        'C170',
        '1',
        'ITEM-1',
        null,
        '1,00',
        'UN',
        '100,00',
        null,
        '0',
        '000',
        '1556', // material de uso/consumo — NÃO é devolução
      ),
    ];
    expect(runPreflightPva(usoConsumo)).not.toContainEqual(
      expect.objectContaining({ codigo: 'PVA_DEVOLUCAO_SEM_C113' }),
    );
  });

  // Monta um par 0300 + G125 coerente com o leiaute oficial (bloco-g-leiaute.ts).
  // 0300: COD_IND_BEM, IDENT_MERC, DESCR_ITEM, COD_PRNC, COD_CTA, NR_PARC.
  // G125: COD_IND_BEM, DT_MOV, TIPO_MOV, VL_IMOB_ICMS_OP, VL_IMOB_ICMS_ST,
  //       VL_IMOB_ICMS_FRT, VL_IMOB_ICMS_DIF, NUM_PARC, VL_PARC_PASS.
  const cadastro0300 = (cod: string, nrParc: string) =>
    createSpedRecord('0300', cod, '1', 'Maquina', null, '1.2.3', nrParc);
  const movimentoG125 = (cod: string, numParc: string, vlParcPass = '10,00') =>
    createSpedRecord(
      'G125',
      cod,
      '01012026',
      'SI',
      '100,00',
      '0,00',
      '0,00',
      '0,00',
      numParc,
      vlParcPass,
    );

  it('R3.6: lê NUM_PARC na posição correta — parcela acima do limite é acusada', () => {
    const records = [cadastro0300('BEM-1', '48'), movimentoG125('BEM-1', '49')];
    expect(runPreflightPva(records)).toContainEqual(
      expect.objectContaining({ codigo: 'PVA_G125_PARCELA_INVALIDA' }),
    );
  });

  it('R3.6: VL_IMOB_ICMS_DIF (antiga posição de NUM_PARC) não é confundido com a parcela', () => {
    // VL_IMOB_ICMS_DIF = 999,99 na posição [6]; NUM_PARC válido = 5 na posição [7].
    // A leitura antiga (g125[6]) interpretaria 999 como parcela e falharia.
    const records = [
      cadastro0300('BEM-1', '48'),
      createSpedRecord(
        'G125',
        'BEM-1',
        '01012026',
        'SI',
        '100,00',
        '0,00',
        '0,00',
        '999,99', // VL_IMOB_ICMS_DIF
        '5', // NUM_PARC
        '10,00', // VL_PARC_PASS
      ),
    ];
    expect(runPreflightPva(records)).not.toContainEqual(
      expect.objectContaining({ codigo: 'PVA_G125_PARCELA_INVALIDA' }),
    );
  });

  it('R3.6: NUM_PARC acima de NR_PARC do 0300 (abaixo de 48) é acusado', () => {
    const records = [cadastro0300('BEM-1', '36'), movimentoG125('BEM-1', '40')];
    const issues = runPreflightPva(records);
    expect(issues).toContainEqual(
      expect.objectContaining({
        codigo: 'PVA_G125_PARCELA_INVALIDA',
        mensagem: expect.stringContaining('1..36'),
      }),
    );
  });

  it('R3.6: parcela válida dentro de 1..NR_PARC não gera inconsistência', () => {
    const records = [cadastro0300('BEM-1', '48'), movimentoG125('BEM-1', '12')];
    expect(runPreflightPva(records)).toEqual([]);
  });

  it('R3.6: parcela zero/negativa é acusada', () => {
    const records = [cadastro0300('BEM-1', '48'), movimentoG125('BEM-1', '0')];
    expect(runPreflightPva(records)).toContainEqual(
      expect.objectContaining({ codigo: 'PVA_G125_PARCELA_INVALIDA' }),
    );
  });

  it('R3.3: G125 que referencia bem sem 0300 correspondente é acusado', () => {
    const records = [
      cadastro0300('BEM-1', '48'),
      movimentoG125('BEM-OUTRO', '1'),
    ];
    expect(runPreflightPva(records)).toContainEqual(
      expect.objectContaining({ codigo: 'PVA_G125_0300_INEXISTENTE' }),
    );
  });

  it('R3.2: VL_PARC_PASS > 0 sem NUM_PARC é acusado', () => {
    const records = [
      cadastro0300('BEM-1', '48'),
      movimentoG125('BEM-1', '', '10,00'),
    ];
    expect(runPreflightPva(records)).toContainEqual(
      expect.objectContaining({ codigo: 'PVA_G125_PARCELA_AUSENTE' }),
    );
  });

  it('não gera inconsistências para catálogo íntegro', () => {
    const records = [
      createSpedRecord(
        '0150',
        'PART-1',
        'FORN',
        '01058',
        '12345678000199',
        null,
        null,
        '1234567',
        null,
        null,
        null,
        null,
      ),
      createSpedRecord('0190', 'UN', 'UNIDADE'),
      createSpedRecord(
        '0200',
        'ITEM-1',
        'Produto',
        null,
        null,
        'UN',
        '00',
        '12345678',
        null,
        '12',
        null,
        null,
        null,
      ),
      createSpedRecord('C100', '0', '1', 'PART-1', '55', '00'),
      createSpedRecord(
        'C170',
        '1',
        'ITEM-1',
        null,
        '1,00',
        'UN',
        '100,00',
        null,
        '0',
        '000',
        '1102',
      ),
    ];
    expect(runPreflightPva(records)).toEqual([]);
  });
});
