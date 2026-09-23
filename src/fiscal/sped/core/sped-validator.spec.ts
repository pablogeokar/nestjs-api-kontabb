import { buildSpedFile } from './sped-file';
import { createSpedRecord } from './sped-writer';
import { validateSpedFile } from './sped-validator';

describe('validador estrutural EFD ICMS/IPI', () => {
  // Conta os pipes da primeira linha de um registro, para comprovar que uma
  // mutacao de posicao nao alterou a estrutura de delimitadores.
  const countPipes = (source: string, reg: string): number => {
    const line = source
      .split(/\r\n/u)
      .find((candidate) => candidate.startsWith(`|${reg}|`));
    return (line?.match(/\|/gu) ?? []).length;
  };

  const validFile = () =>
    buildSpedFile({
      records: [
        createSpedRecord('0000', '020'),
        createSpedRecord('0005', 'EMPRESA'),
        createSpedRecord('C100', 'DOC'),
      ],
    }).text;

  it('aceita o arquivo construido pelo nucleo e devolve seus contadores', () => {
    const result = validateSpedFile(validFile());
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.recordCounts['0000']).toBe(1);
    expect(result.recordCounts['9900']).toBe(
      Object.keys(result.recordCounts).length,
    );
    expect(result.blockCounts.C).toBe(3);
  });

  it('valida a quantidade oficial de campos quando o modo estrito e ativado', () => {
    const result = validateSpedFile(validFile(), { strictFieldCounts: true });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'INVALID_FIELD_COUNT',
          reg: '0000',
        }),
        expect.objectContaining({
          code: 'INVALID_FIELD_COUNT',
          reg: 'C100',
        }),
      ]),
    );
  });

  it('detecta contagem incorreta de bloco e dos fechamentos gerais', () => {
    const source = validFile()
      .replace('|C990|3|', '|C990|99|')
      .replace(/\r\n\|9990\|(\d+)\|\r\n/u, '\r\n|9990|1|\r\n')
      .replace(/\r\n\|9999\|(\d+)\|\r\n/u, '\r\n|9999|1|\r\n');
    const codes = validateSpedFile(source).issues.map((issue) => issue.code);

    expect(codes).toContain('INVALID_BLOCK_LINE_COUNT');
    expect(codes).toContain('INVALID_9990_COUNT');
    expect(codes).toContain('INVALID_9999_COUNT');
  });

  it('detecta a autorreferencia incorreta do 9900', () => {
    const source = validFile().replace(
      /\|9900\|9900\|(\d+)\|/u,
      '|9900|9900|1|',
    );
    const result = validateSpedFile(source);

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'INVALID_9900_COUNT',
          reg: '9900',
        }),
      ]),
    );
  });

  it('detecta totalizador ausente, duplicado e fora de ordem', () => {
    const source = validFile().replace(
      '|9900|C001|1|\r\n|9900|C100|1|',
      '|9900|C001|1|\r\n|9900|C001|1|',
    );
    const codes = validateSpedFile(source).issues.map((issue) => issue.code);

    expect(codes).toContain('DUPLICATE_9900_ENTRY');
    expect(codes).toContain('INVALID_9900_ORDER');
    expect(codes).toContain('MISSING_9900_ENTRY');
  });

  it('detecta quebra LF, CRLF final ausente e bloco fora da ordem', () => {
    const reordered = validFile()
      .replace('|B001|1|\r\n|B990|2|\r\n', '')
      .replace('|D001|1|', '|D001|1|\r\n|B001|1|\r\n|B990|2|');
    const invalid = reordered.replace(/\r\n/gu, '\n').replace(/\n$/u, '');
    const codes = validateSpedFile(invalid).issues.map((issue) => issue.code);

    expect(codes).toContain('INVALID_LINE_BREAK');
    expect(codes).toContain('MISSING_FINAL_CRLF');
    expect(codes).toContain('INVALID_BLOCK_ORDER');
  });

  // R5.2: a corrupcao de POSICAO de campo (sem mexer em delimitadores nem na
  // contagem de pipes) deve ser detectada. Isso comprova que o validador
  // interpreta o conteudo posicional e nao apenas a estrutura de delimitadores.
  describe('mutacao de posicao de campo (R5.2)', () => {
    it('acusa quando REG_BLC e QTD_REG_BLC do 9900 sao trocados de posicao', () => {
      const original = validFile();
      // Delimitadores e contagem de campos identicos: apenas as duas posicoes
      // do 9900 do proprio 0000 (REG_BLC='0000', QTD_REG_BLC='1') sao trocadas.
      const mutated = original.replace('|9900|0000|1|', '|9900|1|0000|');

      expect(mutated).not.toBe(original);
      // Mesmo numero de pipes/campos na linha corrompida.
      expect(countPipes(mutated, '9900')).toEqual(countPipes(original, '9900'));

      const result = validateSpedFile(mutated);
      expect(result.valid).toBe(false);
      const codes = result.issues.map((issue) => issue.code);
      // O REG_BLC passa a ser '1' (codigo invalido) e a contagem some para 0000.
      expect(codes).toContain('INVALID_BLOCK_9_CONTENT');
    });

    it('acusa quando o COD_VER do 0000 e movido para fora da posicao 0', () => {
      const original = validFile();
      // Injeta um valor extra antes do COD_VER: o layout '020' deixa de ocupar
      // a primeira posicao do 0000, ainda que continue presente na linha.
      const mutated = original.replace('|0000|020|', '|0000|X|020|');

      expect(mutated).not.toBe(original);
      const codes = validateSpedFile(mutated).issues.map((issue) => issue.code);
      expect(codes).toContain('INVALID_LAYOUT');
    });

    it('nao depende de remover delimitadores para acusar posicao trocada', () => {
      const original = validFile();
      const mutated = original.replace('|9900|0000|1|', '|9900|1|0000|');
      const delimiterOnly = original.replace('|9900|0000|1|', '|9900|0000|');

      const swapResult = validateSpedFile(mutated);
      const delimiterResult = validateSpedFile(delimiterOnly);

      // Ambos falham, mas o caso de troca de posicao nao removeu delimitadores.
      expect(swapResult.valid).toBe(false);
      expect(delimiterResult.valid).toBe(false);
    });
  });

  it('detecta shells/indicador invalidos e caracteres fora de Latin-1', () => {
    const source = validFile()
      .replace('|G001|1|\r\n|G990|2|\r\n', '')
      .replace('|H001|1|', '|H001|0|')
      .replace('|0005|EMPRESA|', '|0005|EMPRESA😀|');
    const codes = validateSpedFile(source).issues.map((issue) => issue.code);

    expect(codes).toContain('MISSING_BLOCK_SHELL');
    expect(codes).toContain('INVALID_MOVEMENT_INDICATOR');
    expect(codes).toContain('INVALID_LATIN1_CHARACTER');
  });
});
