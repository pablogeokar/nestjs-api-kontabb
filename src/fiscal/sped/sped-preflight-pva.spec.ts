import { createSpedRecord } from './core';
import { runPreflightPva } from './sped-preflight-pva';

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
