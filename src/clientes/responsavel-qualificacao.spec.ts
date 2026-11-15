import {
  escolherResponsavel,
  mapQualificacaoParaCodAssinante,
} from './responsavel-qualificacao';

describe('responsável pela empresa', () => {
  it.each([
    ['49-Sócio-Administrador', '205'],
    ['Administrador', '205'],
    ['Diretor', '203'],
    ['Presidente', '203'],
    ['Empresário', '801'],
    ['Titular Pessoa Física Residente no Brasil', '801'],
    ['Procurador', '309'],
    ['Sócio', '999'],
    ['', '999'],
  ])('mapeia %s para %s', (qualificacao, codigo) => {
    expect(mapQualificacaoParaCodAssinante(qualificacao)).toBe(codigo);
  });

  it('prioriza o administrador e ignora sócio pessoa jurídica', () => {
    expect(
      escolherResponsavel([
        {
          name: 'HOLDING LTDA',
          qualification: 'Administrador',
          isPerson: false,
        },
        { name: 'ANA SOCIA', qualification: 'Sócio', isPerson: true },
        {
          name: 'JOAO ADM',
          qualification: 'Sócio-Administrador',
          isPerson: true,
        },
      ]),
    ).toEqual({
      name: 'JOAO ADM',
      qualification_code: '205',
      qualification_label: 'Sócio-Administrador',
    });
  });

  it('devolve null sem sócio pessoa física', () => {
    expect(escolherResponsavel([])).toBeNull();
    expect(
      escolherResponsavel([
        { name: 'X SA', qualification: 'Sócio', isPerson: false },
      ]),
    ).toBeNull();
  });
});
