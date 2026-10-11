import ExcelJS from 'exceljs';
import {
  decodeFiscalAccessKey,
  parseChavesFromBuffer,
  parseChavesFromText,
} from './listagem-chaves.parser';

describe('listagem de chaves fiscais', () => {
  it('extrai, normaliza, deduplica e decodifica chaves em texto livre', () => {
    const chave = buildAccessKey('55');
    const result = parseChavesFromText(
      `# comentário\nChave: ${formatKey(chave)}\nNFe${chave}\n`,
    );

    expect(result).toMatchObject({
      totalRegistros: 2,
      validas: 1,
      aptasParaBusca: 1,
      invalidas: 0,
      duplicadas: 1,
    });
    expect(result.itens[0]).toMatchObject({
      chaveAcesso: chave,
      valida: true,
      aptaParaBusca: true,
      ocorrencias: 2,
      metadata: {
        uf: 'BA',
        competencia: '08/2024',
        cnpjEmitente: '12345678000195',
        modelo: '55',
        serie: '1',
        numeroDocumento: '123',
      },
    });
  });

  it('separa dígito inválido de modelo não consultável', () => {
    const cte = buildAccessKey('57');
    const validNfe = buildAccessKey('55');
    const invalid = `${validNfe.slice(0, 43)}${(Number(validNfe[43]) + 1) % 10}`;
    const result = parseChavesFromText(`${cte}\n${invalid}`);

    expect(result.validas).toBe(1);
    expect(result.aptasParaBusca).toBe(0);
    expect(result.invalidas).toBe(1);
    expect(
      result.itens.find((item) => item.chaveAcesso === cte)?.motivo,
    ).toContain('CT-e modelo 57');
  });

  it('lê CSV com campo entre aspas', async () => {
    const chave = buildAccessKey('55');
    const result = await parseChavesFromBuffer(
      Buffer.from(`descrição;chave\n"Compra; filial";"${chave}"`),
      'chaves.csv',
      'text/csv',
    );

    expect(result.aptasParaBusca).toBe(1);
    expect(result.itens[0].chaveAcesso).toBe(chave);
  });

  it('interpreta o relatório CSV da SEFAZ/BA sem transformar outras colunas em chaves', async () => {
    const first = buildAccessKey('55');
    const second = buildAccessKey('55', '12345678000195', '000000124');
    const csv = [
      'Numero NF-e;CNPJ/CPF Destinatario;Razao Social Destinatario;Data de Emissao;Data de Autorizacao;Valor (R$);Chave de Acesso;UF Dest.;Situacao;Tipo Operacao;',
      ` 000.000.123; 123.456.789-01; DESTINATARIO COM NOME MUITO EXTENSO; 01/09/2026 16:14:12 ; 01/09/2026 16:14:13 ;2.042,00;'${first}; BA; Autorizada; Entrada;`,
      ` 000.000.124; 12.345.678/0001-95; OUTRO DESTINATARIO COM NOME EXTENSO; 01/09/2026 16:39:03 ; 01/09/2026 16:39:05 ;1.317,57;'${second}; BA; Autorizada; Saida;`,
    ].join('\r\n');

    const result = await parseChavesFromBuffer(
      Buffer.from(csv, 'ascii'),
      'rpt_cons_emit.csv',
      'text/plain',
    );

    expect(result).toMatchObject({
      totalRegistros: 2,
      validas: 2,
      aptasParaBusca: 2,
      invalidas: 0,
      duplicadas: 0,
    });
    expect(result.itens.map((item) => item.chaveAcesso)).toEqual([
      first,
      second,
    ]);
  });

  it('lê a primeira aba XLSX e alerta sobre células numéricas sem precisão', async () => {
    const chave = buildAccessKey('55');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Chaves');
    sheet.addRow(['Chave']);
    sheet.addRow([chave]);
    sheet.addRow([1.2345678901234568e43]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const result = await parseChavesFromBuffer(
      buffer,
      'chaves.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );

    expect(result.aptasParaBusca).toBe(1);
    expect(result.avisos.join(' ')).toContain('15 dígitos');
  });

  it('rejeita extensão e conteúdo XLSX incompatíveis', async () => {
    await expect(
      parseChavesFromBuffer(Buffer.from('conteúdo'), 'chaves.xls'),
    ).rejects.toThrow('.txt, .csv ou .xlsx');
    await expect(
      parseChavesFromBuffer(Buffer.from('não é zip'), 'chaves.xlsx'),
    ).rejects.toThrow('não corresponde a uma planilha XLSX');
  });

  it('usa corretamente as posições AAMM da chave', () => {
    expect(decodeFiscalAccessKey(buildAccessKey('55'))?.competencia).toBe(
      '08/2024',
    );
  });
});

function buildAccessKey(
  modelo: string,
  cnpj = '12345678000195',
  numero = '000000123',
): string {
  const base = `292408${cnpj}${modelo}001${numero}112345678`;
  let weight = 2;
  let sum = 0;
  for (let index = 42; index >= 0; index -= 1) {
    sum += Number(base[index]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const remainder = sum % 11;
  return `${base}${remainder < 2 ? 0 : 11 - remainder}`;
}

function formatKey(value: string) {
  return value.match(/.{1,4}/g)?.join(' ') ?? value;
}
