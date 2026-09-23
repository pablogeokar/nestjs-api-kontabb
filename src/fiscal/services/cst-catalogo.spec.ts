import { descricaoCst } from './cst-catalogo';
describe('catálogo fiscal', () => {
  it('distingue tributos e CST com origem', () => {
    expect(descricaoCst('ICMS', '060')).toContain('substituição');
    expect(descricaoCst('IPI', '00')).toContain('Entrada');
    expect(descricaoCst('CSOSN', '500')).toContain('anteriormente');
  });
  it.each([
    '01',
    '02',
    '03',
    '04',
    '05',
    '06',
    '07',
    '08',
    '09',
    '49',
    '50',
    '51',
    '52',
    '53',
    '54',
    '55',
    '56',
    '60',
    '61',
    '62',
    '63',
    '64',
    '65',
    '66',
    '67',
    '70',
    '71',
    '72',
    '73',
    '74',
    '75',
    '98',
    '99',
  ])('cobre CST PIS/COFINS %s', (codigo) => {
    expect(descricaoCst('PIS', codigo)).toBeTruthy();
    expect(descricaoCst('COFINS', codigo)).toBe(descricaoCst('PIS', codigo));
  });
  it('não inventa descrições nem completa códigos inválidos', () => {
    expect(descricaoCst('ICMS', '01')).toBeNull();
    expect(descricaoCst('PIS', '1')).toBeNull();
    expect(descricaoCst('IPI', null)).toBeNull();
  });
});
