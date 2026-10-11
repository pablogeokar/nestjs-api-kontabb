import {
  BLOCO_G_EXPECTED_FIELD_COUNTS,
  blocoGFieldPosition,
} from './bloco-g-leiaute';

describe('blocoGFieldPosition', () => {
  it('resolve posições oficiais do G125 (0-based, após REG)', () => {
    expect(blocoGFieldPosition('G125', 'COD_IND_BEM')).toBe(0);
    expect(blocoGFieldPosition('G125', 'VL_IMOB_ICMS_ST')).toBe(4);
    expect(blocoGFieldPosition('G125', 'VL_IMOB_ICMS_DIF')).toBe(6);
    expect(blocoGFieldPosition('G125', 'NUM_PARC')).toBe(7);
    expect(blocoGFieldPosition('G125', 'VL_PARC_PASS')).toBe(8);
  });

  it('resolve posições do 0300 referenciado pelo G125', () => {
    expect(blocoGFieldPosition('0300', 'COD_IND_BEM')).toBe(0);
    expect(blocoGFieldPosition('0300', 'NR_PARC')).toBe(5);
  });

  it('lança para registro desconhecido', () => {
    expect(() => blocoGFieldPosition('X999', 'REG')).toThrow(/desconhecido/);
  });

  it('lança para campo inexistente no leiaute', () => {
    expect(() => blocoGFieldPosition('G125', 'NAO_EXISTE')).toThrow(
      /não existe/,
    );
  });

  it('lança ao pedir a posição do próprio REG (sem posição em fields)', () => {
    expect(() => blocoGFieldPosition('G125', 'REG')).toThrow(/próprio REG/);
  });

  it('expõe as contagens oficiais de campos após REG', () => {
    expect(BLOCO_G_EXPECTED_FIELD_COUNTS.G125).toBe(9);
    expect(BLOCO_G_EXPECTED_FIELD_COUNTS.G110).toBe(9);
    expect(BLOCO_G_EXPECTED_FIELD_COUNTS['0300']).toBe(6);
  });
});
