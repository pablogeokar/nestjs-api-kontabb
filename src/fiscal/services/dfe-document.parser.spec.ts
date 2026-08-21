import { gzipSync } from 'node:zlib';
import {
  extractDfeDocZips,
  extractDfeResponseMetadata,
  parseDfeDocZip,
  parseManualFiscalXml,
  type DfeDocZip,
} from './dfe-document.parser';

describe('DF-e document parser', () => {
  it('recupera NSU, schema e conteudo do XML bruto retornado pelo NFeWizard', () => {
    const xml = buildNfeProc('55');
    const zipped = zip(xml);
    const resposta = {
      data: {
        retDistDFeInt: {
          // O JSON da biblioteca perde os atributos e deve ser ignorado.
          loteDistDFeInt: { docZip: [zipped] },
          xml: `<retDistDFeInt><loteDistDFeInt><docZip NSU="000000000000321" schema="procNFe_v4.00.xsd">${zipped}</docZip></loteDistDFeInt></retDistDFeInt>`,
        },
      },
    };

    expect(extractDfeDocZips(resposta)).toEqual([
      {
        nsu: 321,
        schema: 'procNFe_v4.00.xsd',
        content: zipped,
      },
    ]);
  });

  it('recupera status e controle de NSU, inclusive do XML bruto', () => {
    const resposta = {
      data: {
        retDistDFeInt: {
          xml: '<retDistDFeInt><cStat>138</cStat><xMotivo>Documento localizado</xMotivo><ultNSU>42</ultNSU><maxNSU>50</maxNSU></retDistDFeInt>',
        },
      },
    };

    expect(extractDfeResponseMetadata(resposta)).toEqual({
      cStat: 138,
      ultimoNsu: 42,
      maxNsu: 50,
      motivo: 'Documento localizado',
    });
  });

  it('reconhece cStat 137 omitido pelo NFeWizard', () => {
    expect(
      extractDfeResponseMetadata({
        data: {},
        xMotivo: 'Nenhum documento localizado',
      }),
    ).toEqual({
      cStat: 137,
      ultimoNsu: 0,
      maxNsu: 0,
      motivo: 'Nenhum documento localizado',
    });
  });

  it('aceita somente o XML processado completo de NF-e modelo 55', () => {
    const parsed = parseDfeDocZip(docZip(buildNfeProc('55'), 'procNFe'), 'NFE');

    expect(parsed).toMatchObject({
      tipoDocumento: 'NFE',
      modelo: '55',
      nsu: 123,
      serie: '1',
      numeroDocumento: '123',
      emitenteCnpjCpf: '12345678000195',
      emitenteRazaoSocial: 'Empresa & Filhos',
      destinatarioCnpjCpf: '98765432000110',
      valorTotal: '150.75',
      tpNfXml: '1',
      situacao: 'AUTORIZADA',
    });
    expect(parsed?.dataEmissao.toISOString()).toBe('2024-08-15T13:45:00.000Z');
    expect(parsed?.participantesCnpjCpf).toEqual([
      '12345678000195',
      '98765432000110',
    ]);
  });

  it('classifica nfeProc modelo 65 como NFC-e e permite consumidor anonimo', () => {
    const parsed = parseDfeDocZip(
      docZip(buildNfeProc('65', false), 'procNFe'),
      'NFE',
    );

    expect(parsed).toMatchObject({
      tipoDocumento: 'NFCE',
      modelo: '65',
      destinatarioCnpjCpf: '',
      destinatarioRazaoSocial: '',
    });
  });

  it('preserva tpNF de entrada própria informado no XML', () => {
    const result = parseManualFiscalXml(
      buildNfeProc('55').replace('<tpNF>1</tpNF>', '<tpNF>0</tpNF>'),
    );

    expect(result.status).toBe('DOCUMENTO');
    if (result.status === 'DOCUMENTO') {
      expect(result.documento.tpNfXml).toBe('0');
    }
  });

  it('aceita somente cteProc modelo 57 na distribuicao de CT-e', () => {
    const parsed = parseDfeDocZip(docZip(buildCteProc('57'), 'procCTe'), 'CTE');

    expect(parsed).toMatchObject({
      tipoDocumento: 'CTE',
      modelo: '57',
      serie: '2',
      numeroDocumento: '456',
      valorTotal: '999.90',
    });
  });

  it.each([
    [
      'resumo de NF-e',
      '<resNFe><chNFe>1</chNFe></resNFe>',
      'resNFe_v1.01.xsd',
      'NFE',
    ],
    [
      'evento de NF-e',
      '<procEventoNFe><chNFe>1</chNFe></procEventoNFe>',
      'procEventoNFe_v1.00.xsd',
      'NFE',
    ],
    [
      'resumo de CT-e',
      '<resCTe><chCTe>1</chCTe></resCTe>',
      'resCTe_v1.00.xsd',
      'CTE',
    ],
    [
      'evento de CT-e',
      '<procEventoCTe><chCTe>1</chCTe></procEventoCTe>',
      'procEventoCTe_v4.00.xsd',
      'CTE',
    ],
    ['schema desconhecido', buildNfeProc('55'), 'procBPe_v1.00.xsd', 'NFE'],
  ])('descarta %s', (_name, xml, schema, tipoConsulta) => {
    expect(
      parseDfeDocZip(
        { nsu: 1, schema, content: zip(xml) },
        tipoConsulta as 'NFE' | 'CTE',
      ),
    ).toBeNull();
  });

  it('descarta CT-e OS modelo 67 mesmo quando vem no lote de CT-e', () => {
    expect(
      parseDfeDocZip(docZip(buildCteProc('67'), 'procCTe'), 'CTE'),
    ).toBeNull();
  });

  it('descarta documento cujo modelo diverge da chave de acesso', () => {
    const xml = buildNfeProc('55').replace('<mod>55</mod>', '<mod>65</mod>');

    expect(parseDfeDocZip(docZip(xml, 'procNFe'), 'NFE')).toBeNull();
  });

  it.each([
    ['NF-e', buildNfeProc('55'), 'NFE'],
    ['NFC-e', buildNfeProc('65', false), 'NFCE'],
    ['CT-e', buildCteProc('57'), 'CTE'],
  ])('identifica %s em upload manual', (_label, xml, tipoDocumento) => {
    const result = parseManualFiscalXml(xml);

    expect(result.status).toBe('DOCUMENTO');
    if (result.status === 'DOCUMENTO') {
      expect(result.documento.tipoDocumento).toBe(tipoDocumento);
      expect(result.documento.nsu).toBe(0);
    }
  });

  it.each([
    '<procEventoNFe><evento><infEvento><chNFe>1</chNFe></infEvento></evento></procEventoNFe>',
    '<resCTe><chCTe>1</chCTe></resCTe>',
    buildCteProc('67'),
  ])('ignora XML sem documento fiscal aproveitavel', (xml) => {
    expect(parseManualFiscalXml(xml).status).toBe('IGNORADO');
  });

  it('rejeita XML malformado, DTD e documento sem protocolo autorizado', () => {
    expect(parseManualFiscalXml('<nfeProc><NFe></nfeProc>').status).toBe(
      'INVALIDO',
    );
    expect(
      parseManualFiscalXml(
        '<!DOCTYPE nfeProc [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><nfeProc />',
      ).status,
    ).toBe('INVALIDO');
    expect(
      parseManualFiscalXml(
        buildNfeProc('55').replace('<cStat>100</cStat>', '<cStat>999</cStat>'),
      ).status,
    ).toBe('INVALIDO');
  });
});

function docZip(xml: string, schemaPrefix: 'procNFe' | 'procCTe'): DfeDocZip {
  return {
    nsu: 123,
    schema: `${schemaPrefix}_v4.00.xsd`,
    content: zip(xml),
  };
}

function zip(xml: string): string {
  return gzipSync(Buffer.from(xml, 'utf8')).toString('base64');
}

function buildNfeProc(modelo: '55' | '65', withDest = true): string {
  const chave = buildAccessKey(modelo);
  return `<?xml version="1.0" encoding="UTF-8"?>
    <nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
      <NFe>
        <infNFe Id="NFe${chave}" versao="4.00">
          <ide>
            <mod>${modelo}</mod><serie>1</serie><nNF>123</nNF><tpNF>1</tpNF>
            <dhEmi>2024-08-15T10:45:00-03:00</dhEmi>
          </ide>
          <emit><CNPJ>12345678000195</CNPJ><xNome>Empresa &amp; Filhos</xNome></emit>
          ${withDest ? '<dest><CNPJ>98765432000110</CNPJ><xNome>Cliente Teste</xNome></dest>' : ''}
          <total><ICMSTot><vNF>150.75</vNF></ICMSTot></total>
        </infNFe>
      </NFe>
      <protNFe><infProt><chNFe>${chave}</chNFe><cStat>100</cStat></infProt></protNFe>
    </nfeProc>`;
}

function buildCteProc(modelo: '57' | '67'): string {
  const chave = buildAccessKey(modelo);
  return `<?xml version="1.0" encoding="UTF-8"?>
    <cteProc xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00">
      <CTe>
        <infCte Id="CTe${chave}" versao="4.00">
          <ide><mod>${modelo}</mod><serie>2</serie><nCT>456</nCT><dhEmi>2024-08-16T08:00:00-03:00</dhEmi></ide>
          <emit><CNPJ>12345678000195</CNPJ><xNome>Transportadora Teste</xNome></emit>
          <dest><CNPJ>98765432000110</CNPJ><xNome>Destino Teste</xNome></dest>
          <vPrest><vTPrest>999.90</vTPrest></vPrest>
        </infCte>
      </CTe>
      <protCTe><infProt><chCTe>${chave}</chCTe><cStat>100</cStat></infProt></protCTe>
    </cteProc>`;
}

function buildAccessKey(modelo: string): string {
  const base = `29240812345678000195${modelo}001000000123112345678`;
  if (base.length !== 43) throw new Error('Base da chave de teste invalida');

  let weight = 2;
  let sum = 0;
  for (let index = 42; index >= 0; index--) {
    sum += Number(base[index]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const remainder = sum % 11;
  const digit = remainder === 0 || remainder === 1 ? 0 : 11 - remainder;
  return `${base}${digit}`;
}
