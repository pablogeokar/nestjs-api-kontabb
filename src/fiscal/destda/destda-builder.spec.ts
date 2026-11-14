import { buildDestdaFile, consolidarTotais } from './destda-builder';
import { validateDestdaFile } from './destda-validator';
import type { DestdaBuilderInput, DestdaTotais } from './destda.types';

const perfil = {
  indEd: '3',
  indArq: '7',
  prfIss: '9',
  prfIcms: '0',
  prfRidf: '1',
  prfRudf: '1',
  prfLmc: '1',
  prfRv: '1',
  prfRi: '1',
  indEc: '9',
  indIss: '1',
  indRt: '1',
  indIcms: '0',
  indSt: '0',
  indAt: '1',
  indIpi: '1',
  indRiAvulso: '1',
};

function entrada(totais: DestdaTotais): DestdaBuilderInput {
  return {
    competencia: '2026-02',
    finalidade: '0',
    empresa: {
      nome: 'Comércio Ação & Filhos | ME',
      cnpj: '00123456000190',
      uf: 'BA',
      ie: '012345678',
      codMun: '2927408',
      im: null,
      suframa: null,
      fantasia: 'Loja Ação',
      nire: null,
    },
    inscricoesSubstituto: [{ uf: 'SP', ie: '111222333444' }],
    responsavel: {
      nome: 'Maria Souza',
      codAssin: '801',
      cpf: '12345678909',
      cep: '40000000',
      endereco: 'Rua A',
      numero: '10',
      bairro: 'Centro',
      email: 'maria@empresa.com.br',
    },
    perfil,
    contabilista: {
      nome: 'Contador Exemplo',
      codAssin: '900',
      cnpj: null,
      cpf: '98765432100',
      crc: 'BA012345',
      uf: 'BA',
      codMun: '2927408',
    },
    totais,
  };
}

const vazio: DestdaTotais = { entradas: [], consumoFinal: [], st: [] };

describe('buildDestdaFile', () => {
  it('gera arquivo válido e determinístico com movimento', () => {
    const built = buildDestdaFile(
      entrada({
        entradas: [
          { indSit: '1', totalNf: 12345n, ajustes: 0n },
          { indSit: '1', totalNf: 5n, ajustes: 0n },
          { indSit: '3', totalNf: 100000n, ajustes: 25000n },
        ],
        consumoFinal: [
          { uf: 'SP', totalNf: 2050n, ajustes: 0n },
          { uf: 'MG', totalNf: 999n, ajustes: 0n },
        ],
        st: [
          {
            indOper: '1',
            indEmit: '0',
            uf: 'SP',
            indTpSt: '0',
            totalNf: 500n,
            ajustes: 0n,
          },
          {
            indOper: '1',
            indEmit: '0',
            uf: 'SP',
            indTpSt: '3',
            totalNf: 700n,
            ajustes: 0n,
          },
          {
            indOper: '1',
            indEmit: '0',
            uf: 'RJ',
            indTpSt: '0',
            totalNf: 300n,
            ajustes: 100n,
          },
        ],
      }),
    );

    expect(validateDestdaFile(built.bytes)).toMatchObject({
      valid: true,
      issues: [],
    });
    expect(built.text.endsWith('\r\n')).toBe(true);
    const lines = built.lines;
    expect(lines[0]).toBe(
      '|0000|LFPD|01022026|28022026|Comércio Ação & Filhos ME|00123456000190|BA|012345678|2927408||||2000|0|30|Brasil|Loja Ação||||',
    );
    expect(lines).toContain('|0002|SP|111222333444|');
    expect(lines).toContain('|G020|2|01022026|28022026|');
    expect(lines).toContain('|G600|1123,50|250,00|873,50|');
    expect(lines).toContain('|G605|1|123,50||123,50|');
    expect(lines).toContain('|G605|3|1000,00|250,00|750,00|');
  });

  it('totaliza pai e filhos coerentemente e separa combustível no G620', () => {
    const built = buildDestdaFile(
      entrada({
        entradas: [{ indSit: '1', totalNf: 12350n, ajustes: 0n }],
        consumoFinal: [
          { uf: 'SP', totalNf: 2050n, ajustes: 0n },
          { uf: 'MG', totalNf: 999n, ajustes: 0n },
        ],
        st: [
          {
            indOper: '1',
            indEmit: '0',
            uf: 'SP',
            indTpSt: '0',
            totalNf: 500n,
            ajustes: 0n,
          },
          {
            indOper: '1',
            indEmit: '0',
            uf: 'SP',
            indTpSt: '3',
            totalNf: 700n,
            ajustes: 0n,
          },
          {
            indOper: '1',
            indEmit: '0',
            uf: 'RJ',
            indTpSt: '0',
            totalNf: 300n,
            ajustes: 100n,
          },
        ],
      }),
    );
    expect(built.lines).toEqual(
      expect.arrayContaining([
        '|G600|123,50||123,50|',
        '|G605|1|123,50||123,50|',
        '|G610|30,49||30,49|',
        '|G615|MG|9,99||9,99|',
        '|G615|SP|20,50||20,50|',
        '|G620|1|0|8,00|1,00|7,00|7,00|',
        '|G625|RJ|0|3,00|1,00|2,00|',
        '|G625|SP|0|5,00||5,00|',
        '|G625|SP|3|7,00||7,00|',
      ]),
    );
    expect(built.totais.totalADeclarar).toBe('167.99');
  });

  it('gera arquivo sem movimento com G020 indicando guia sem dados', () => {
    const built = buildDestdaFile(entrada(vazio));
    expect(built.semMovimento).toBe(true);
    expect(built.lines).toContain('|G020|9|01022026|28022026|');
    expect(built.lines).toContain('|G001|0|');
    expect(built.lines.some((line) => line.startsWith('|G6'))).toBe(false);
    expect(validateDestdaFile(built.bytes).valid).toBe(true);
  });

  it('fecha o bloco 9 com contadores corretos', () => {
    const built = buildDestdaFile(
      entrada({
        entradas: [{ indSit: '0', totalNf: 100n, ajustes: 0n }],
        consumoFinal: [],
        st: [],
      }),
    );
    const totalLines = built.lines.length;
    expect(built.lines.at(-1)).toBe(`|9999|${totalLines}|`);
    expect(built.lines).toContain('|9900|0000|1|');
    expect(built.lines).toContain('|9900|G605|1|');
    expect(built.lines).toContain(
      '|9900|9900|' + built.recordCounts['9900'] + '|',
    );
    expect(built.blockCounts['9']).toBe(built.recordCounts['9900'] + 3);
  });

  it('codifica em Latin-1 e remove pipes do conteúdo', () => {
    const built = buildDestdaFile(entrada(vazio));
    expect(built.bytes.includes(0xe7)).toBe(true); // ç em ISO-8859-1
    expect(built.text).not.toContain('Filhos | ME');
  });

  it('rejeita valores negativos', () => {
    expect(() =>
      consolidarTotais({
        entradas: [{ indSit: '1', totalNf: -1n, ajustes: 0n }],
        consumoFinal: [],
        st: [],
      }),
    ).toThrow(TypeError);
  });

  it('descarta linhas sem valor', () => {
    const consolidado = consolidarTotais({
      entradas: [{ indSit: '1', totalNf: 0n, ajustes: 0n }],
      consumoFinal: [{ uf: 'SP', totalNf: 0n, ajustes: 0n }],
      st: [],
    });
    expect(consolidado.entradas).toHaveLength(0);
    expect(consolidado.consumoFinal).toHaveLength(0);
  });
});

describe('validateDestdaFile', () => {
  const base = () =>
    buildDestdaFile(
      entrada({
        entradas: [{ indSit: '1', totalNf: 12350n, ajustes: 0n }],
        consumoFinal: [],
        st: [],
      }),
    ).text;

  it('detecta total do pai divergente dos filhos', () => {
    const adulterado = base().replace(
      '|G600|123,50||123,50|',
      '|G600|1,00||1,00|',
    );
    const result = validateDestdaFile(adulterado);
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('INVALID_TOTAL');
  });

  it('detecta contador 9999 incorreto', () => {
    const texto = base();
    const adulterado = texto.replace(/^\|9999\|\d+\|/mu, '|9999|1|');
    expect(
      validateDestdaFile(adulterado).issues.map((issue) => issue.code),
    ).toContain('INVALID_9999_COUNT');
  });

  it('detecta quebra de linha diferente de CRLF', () => {
    const adulterado = base().replace(/\r\n/gu, '\n');
    expect(
      validateDestdaFile(adulterado).issues.map((issue) => issue.code),
    ).toContain('MISSING_FINAL_CRLF');
  });

  it('detecta quantidade de campos incorreta', () => {
    const adulterado = base().replace(
      '|G605|1|123,50||123,50|',
      '|G605|1|123,50|123,50|',
    );
    expect(
      validateDestdaFile(adulterado).issues.map((issue) => issue.code),
    ).toContain('INVALID_FIELD_COUNT');
  });

  it('detecta UF fora da tabela', () => {
    const texto = buildDestdaFile(
      entrada({
        entradas: [],
        consumoFinal: [{ uf: 'ZZ', totalNf: 100n, ajustes: 0n }],
        st: [],
      }),
    ).text;
    expect(
      validateDestdaFile(texto).issues.map((issue) => issue.code),
    ).toContain('INVALID_DOMAIN');
  });
});
