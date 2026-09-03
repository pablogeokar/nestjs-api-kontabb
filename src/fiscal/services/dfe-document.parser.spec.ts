import { gzipSync } from 'node:zlib';
import {
  extractDfeDocZips,
  extractDfeResponseMetadata,
  parseDfeDocZip,
  parseManualFiscalXml,
  type DfeDocZip,
} from './dfe-document.parser';
import { conferirIntegridadeDocumentoFiscal } from './dfe-document.integrity';

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
    expect(parsed?.dataEmissaoFiscal).toBe('2024-08-15');
    expect(parsed?.participantesCnpjCpf).toEqual([
      '12345678000195',
      '98765432000110',
    ]);
  });

  it('extrai participantes do 0150, totais, datas e informações complementares', () => {
    const parsed = parseManualFiscalXml(buildDetailedNfeProc());

    expect(parsed.status).toBe('DOCUMENTO');
    if (parsed.status !== 'DOCUMENTO') return;

    expect(parsed.documento.emitente).toEqual({
      cnpjCpf: '12345678000195',
      cnpj: '12345678000195',
      cpf: '',
      nome: 'Empresa & Filhos',
      ie: '123456789',
      uf: 'BA',
      codMun: '2927408',
      endereco: 'Rua Fiscal',
      numero: '100',
      complemento: 'Sala 2',
      bairro: 'Centro',
      cep: '40000000',
      suframa: '',
      codPais: '1058',
      pais: 'Brasil',
    });
    expect(parsed.documento.destinatario).toMatchObject({
      cnpjCpf: '98765432000110',
      ie: '99887766',
      uf: 'AM',
      codMun: '1302603',
      suframa: '123456789',
      cep: '69000000',
    });
    expect(parsed.documento.dataEntradaSaida?.toISOString()).toBe(
      '2024-08-16T12:00:00.000Z',
    );
    expect(parsed.documento.dataEntradaSaidaFiscal).toBe('2024-08-16');
    expect(parsed.documento.quantidadeItensDeclarada).toBe(1);
    expect(parsed.documento.icmsTot).toMatchObject({
      vProd: '100.00',
      vFrete: '10.00',
      vDesc: '5.00',
      vST: '1.80',
      vIPI: '5.00',
      vIPIDevol: '0.50',
      vPIS: '1.65',
      vCOFINS: '7.60',
      vNF: '117.50',
      camposAdicionais: {},
    });
    expect(parsed.documento.pisCofinsTotais).toEqual({
      vPIS: '1.65',
      vCOFINS: '7.60',
      vPISST: '0.10',
      vCOFINSST: '0.20',
    });
    expect(parsed.documento.informacoesComplementares).toEqual({
      contribuinte: 'Pedido 42 & entrega agendada',
      fisco: 'Benefício sujeito a conferência',
    });
  });

  it('confere frete, seguro, desconto, IPI, ST e tributos sem somar vProd em vNF', () => {
    const parsed = parseManualFiscalXml(buildDetailedNfeProc());
    if (parsed.status !== 'DOCUMENTO') throw new Error('Fixture inválida');

    expect(parsed.documento.integridade.status).toBe('CONFORME');
    expect(
      parsed.documento.integridade.valorDocumentoComparadoComSomaProdutos,
    ).toBe(false);
    expect(
      parsed.documento.integridade.verificacoes.find(
        (verification) => verification.codigo === 'FRETE',
      ),
    ).toMatchObject({
      declarado: '10.00',
      calculado: '10.00',
      status: 'CONFORME',
    });
    expect(
      parsed.documento.integridade.verificacoes.some(
        (verification) => verification.campoTotal === 'vNF',
      ),
    ).toBe(false);
  });

  it('detecta item estruturalmente descartado pela contagem de det', () => {
    const parsed = parseManualFiscalXml(
      buildDetailedNfeProc({ includeInvalidItem: true }),
    );
    if (parsed.status !== 'DOCUMENTO') throw new Error('Fixture inválida');

    expect(parsed.documento.quantidadeItensDeclarada).toBe(2);
    expect(parsed.documento.itens).toHaveLength(1);
    expect(parsed.documento.integridade).toMatchObject({
      status: 'DIVERGENTE',
      quantidadeItensDeclarada: 2,
      quantidadeItensProcessada: 1,
    });
    expect(parsed.documento.integridade.divergencias).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ codigo: 'QUANTIDADE_ITENS' }),
      ]),
    );
  });

  it('aplica tolerância decimal parametrizável e relata divergência estruturada', () => {
    const parsed = parseManualFiscalXml(
      buildDetailedNfeProc({ totalIcms: '18.03' }),
    );
    if (parsed.status !== 'DOCUMENTO') throw new Error('Fixture inválida');

    expect(parsed.documento.integridade.status).toBe('DIVERGENTE');
    expect(parsed.documento.integridade.divergencias).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          codigo: 'VALOR_ICMS',
          declarado: '18.03',
          calculado: '18.00',
          diferenca: '0.03',
        }),
      ]),
    );
    expect(
      conferirIntegridadeDocumentoFiscal(parsed.documento, '0.03').status,
    ).toBe('CONFORME');
  });

  it('preserva CNPJ e chave de acesso alfanuméricos como strings', () => {
    const cnpj = '12ABC34501DE95';
    const parsed = parseManualFiscalXml(buildNfeProc('55', true, cnpj));

    expect(parsed.status).toBe('DOCUMENTO');
    if (parsed.status === 'DOCUMENTO') {
      expect(parsed.documento.chaveAcesso).toContain(cnpj);
      expect(parsed.documento.emitenteCnpjCpf).toBe(cnpj);
      expect(parsed.documento.emitente.cnpj).toBe(cnpj);
    }
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

  it('captura o refNFe do grupo NFref para o registro C113', () => {
    const refChave = buildAccessKey('55', '98765432000110');
    const xml = buildNfeProc('55').replace(
      '<mod>55</mod>',
      `<NFref><refNFe>${refChave}</refNFe></NFref><mod>55</mod>`,
    );
    const result = parseManualFiscalXml(xml);

    expect(result.status).toBe('DOCUMENTO');
    if (result.status === 'DOCUMENTO') {
      expect(result.documento.documentosReferenciados).toEqual([
        { tipo: 'NFE', chaveAcesso: refChave },
      ]);
    }
  });

  it('não gera referências para NF-e sem NFref', () => {
    const result = parseManualFiscalXml(buildNfeProc('55'));
    expect(result.status).toBe('DOCUMENTO');
    if (result.status === 'DOCUMENTO') {
      expect(result.documento.documentosReferenciados).toEqual([]);
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
      cteEscrituracao: {
        tomadorCnpjCpf: '98765432000110',
        tomadorPapel: 'REMETENTE',
        cfop: '5353',
        valorTotalServico: '999.90',
      },
      tomador: {
        cnpjCpf: '98765432000110',
        nome: 'Remetente Teste',
        ie: '11223344',
        uf: 'BA',
        codMun: '2927408',
        endereco: 'Rua do Tomador',
        numero: '10',
        cep: '40000000',
      },
      integridade: { status: 'NAO_APLICAVEL' },
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

function buildNfeProc(
  modelo: '55' | '65',
  withDest = true,
  emitenteCnpj = '12345678000195',
): string {
  const chave = buildAccessKey(modelo, emitenteCnpj);
  return `<?xml version="1.0" encoding="UTF-8"?>
    <nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
      <NFe>
        <infNFe Id="NFe${chave}" versao="4.00">
          <ide>
            <mod>${modelo}</mod><serie>1</serie><nNF>123</nNF><tpNF>1</tpNF>
            <dhEmi>2024-08-15T10:45:00-03:00</dhEmi>
          </ide>
          <emit><CNPJ>${emitenteCnpj}</CNPJ><xNome>Empresa &amp; Filhos</xNome></emit>
          ${withDest ? '<dest><CNPJ>98765432000110</CNPJ><xNome>Cliente Teste</xNome></dest>' : ''}
          <total><ICMSTot><vNF>150.75</vNF></ICMSTot></total>
        </infNFe>
      </NFe>
      <protNFe><infProt><chNFe>${chave}</chNFe><cStat>100</cStat></infProt></protNFe>
    </nfeProc>`;
}

function buildDetailedNfeProc(
  options: { includeInvalidItem?: boolean; totalIcms?: string } = {},
): string {
  const chave = buildAccessKey('55');
  const invalidItem = options.includeInvalidItem
    ? `<det nItem="2"><prod>
        <cProd>INVALIDO</cProd><xProd>Item sem CFOP</xProd><uCom>UN</uCom>
        <qCom>1.0000</qCom><vUnCom>1.0000000000</vUnCom><vProd>1.00</vProd><indTot>1</indTot>
      </prod><imposto /></det>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
    <nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
      <NFe><infNFe Id="NFe${chave}" versao="4.00">
        <ide><mod>55</mod><serie>1</serie><nNF>123</nNF><tpNF>1</tpNF>
          <dhEmi>2024-08-15T10:45:00-03:00</dhEmi>
          <dhSaiEnt>2024-08-16T09:00:00-03:00</dhSaiEnt>
        </ide>
        <emit><CNPJ>12345678000195</CNPJ><xNome>Empresa &amp; Filhos</xNome><IE>123456789</IE>
          <enderEmit><xLgr>Rua Fiscal</xLgr><nro>100</nro><xCpl>Sala 2</xCpl><xBairro>Centro</xBairro>
            <cMun>2927408</cMun><xMun>Salvador</xMun><UF>BA</UF><CEP>40000000</CEP><cPais>1058</cPais><xPais>Brasil</xPais></enderEmit>
        </emit>
        <dest><CNPJ>98765432000110</CNPJ><xNome>Cliente Teste</xNome><IE>99887766</IE><ISUF>123456789</ISUF>
          <enderDest><xLgr>Avenida Norte</xLgr><nro>20</nro><xBairro>Centro</xBairro>
            <cMun>1302603</cMun><xMun>Manaus</xMun><UF>AM</UF><CEP>69000000</CEP><cPais>1058</cPais><xPais>Brasil</xPais></enderDest>
        </dest>
        <det nItem="1"><prod>
          <cProd>PROD-1</cProd><cEAN>SEM GTIN</cEAN><xProd>Produto fiscal</xProd><NCM>84713012</NCM>
          <CFOP>5102</CFOP><uCom>UN</uCom><qCom>1.0000</qCom><vUnCom>100.0000000000</vUnCom>
          <vProd>100.00</vProd><cEANTrib>SEM GTIN</cEANTrib><uTrib>UN</uTrib>
          <qTrib>1.0000</qTrib><vUnTrib>100.0000000000</vUnTrib>
          <vFrete>10.00</vFrete><vSeg>2.00</vSeg><vDesc>5.00</vDesc><vOutro>3.00</vOutro><indTot>1</indTot>
        </prod><imposto>
          <ICMS><ICMS10><orig>0</orig><CST>10</CST><modBC>3</modBC><vBC>100.00</vBC><pICMS>18.0000</pICMS><vICMS>18.00</vICMS>
            <modBCST>4</modBCST><vBCST>10.00</vBCST><pICMSST>18.0000</pICMSST><vICMSST>1.80</vICMSST>
            <vBCFCPST>10.00</vBCFCPST><pFCPST>2.0000</pFCPST><vFCPST>0.20</vFCPST></ICMS10></ICMS>
          <IPI><cEnq>999</cEnq><IPITrib><CST>50</CST><vBC>100.00</vBC><pIPI>5.0000</pIPI><vIPI>5.00</vIPI></IPITrib></IPI>
          <PIS><PISAliq><CST>01</CST><vBC>100.00</vBC><pPIS>1.6500</pPIS><vPIS>1.65</vPIS></PISAliq></PIS>
          <PISST><vBC>100.00</vBC><pPIS>0.1000</pPIS><vPIS>0.10</vPIS></PISST>
          <COFINS><COFINSAliq><CST>01</CST><vBC>100.00</vBC><pCOFINS>7.6000</pCOFINS><vCOFINS>7.60</vCOFINS></COFINSAliq></COFINS>
          <COFINSST><vBC>100.00</vBC><pCOFINS>0.2000</pCOFINS><vCOFINS>0.20</vCOFINS></COFINSST>
          <II><vBC>100.00</vBC><vDespAdu>0.00</vDespAdu><vII>1.00</vII><vIOF>0.00</vIOF></II>
          <vTotTrib>35.45</vTotTrib>
        </imposto><impostoDevol><pDevol>10.00</pDevol><IPI><vIPIDevol>0.50</vIPIDevol></IPI></impostoDevol></det>
        ${invalidItem}
        <total><ICMSTot>
          <vBC>100.00</vBC><vICMS>${options.totalIcms ?? '18.00'}</vICMS><vICMSDeson>0.00</vICMSDeson>
          <vFCP>0.00</vFCP><vBCST>10.00</vBCST><vST>1.80</vST><vFCPST>0.20</vFCPST><vFCPSTRet>0.00</vFCPSTRet>
          <vProd>100.00</vProd><vFrete>10.00</vFrete><vSeg>2.00</vSeg><vDesc>5.00</vDesc><vII>1.00</vII>
          <vIPI>5.00</vIPI><vIPIDevol>0.50</vIPIDevol><vPIS>1.65</vPIS><vCOFINS>7.60</vCOFINS>
          <vOutro>3.00</vOutro><vNF>117.50</vNF><vTotTrib>35.45</vTotTrib>
        </ICMSTot></total>
        <infAdic><infAdFisco>Benefício sujeito a conferência</infAdFisco><infCpl>Pedido 42 &amp; entrega agendada</infCpl></infAdic>
      </infNFe></NFe>
      <protNFe><infProt><chNFe>${chave}</chNFe><cStat>100</cStat></infProt></protNFe>
    </nfeProc>`;
}

function buildCteProc(modelo: '57' | '67'): string {
  const chave = buildAccessKey(modelo);
  return `<?xml version="1.0" encoding="UTF-8"?>
    <cteProc xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00">
      <CTe>
        <infCte Id="CTe${chave}" versao="4.00">
          <ide><CFOP>5353</CFOP><mod>${modelo}</mod><serie>2</serie><nCT>456</nCT><dhEmi>2024-08-16T08:00:00-03:00</dhEmi><tpCTe>0</tpCTe><tpServ>0</tpServ><modal>01</modal><cMunIni>2927408</cMunIni><cMunFim>2910800</cMunFim><toma3><toma>0</toma></toma3></ide>
          <emit><CNPJ>12345678000195</CNPJ><xNome>Transportadora Teste</xNome></emit>
          <rem><CNPJ>98765432000110</CNPJ><xNome>Remetente Teste</xNome><IE>11223344</IE><enderReme><xLgr>Rua do Tomador</xLgr><nro>10</nro><xBairro>Centro</xBairro><cMun>2927408</cMun><xMun>Salvador</xMun><UF>BA</UF><CEP>40000000</CEP><cPais>1058</cPais><xPais>Brasil</xPais></enderReme></rem>
          <dest><CNPJ>98765432000110</CNPJ><xNome>Destino Teste</xNome></dest>
          <vPrest><vTPrest>999.90</vTPrest><vRec>999.90</vRec></vPrest>
          <imp><ICMS><ICMS00><CST>00</CST><vBC>999.90</vBC><pICMS>12.0000</pICMS><vICMS>119.99</vICMS></ICMS00></ICMS><vTotTrib>119.99</vTotTrib></imp>
        </infCte>
      </CTe>
      <protCTe><infProt><chCTe>${chave}</chCTe><cStat>100</cStat></infProt></protCTe>
    </cteProc>`;
}

function buildAccessKey(modelo: string, cnpj = '12345678000195'): string {
  const base = `292408${cnpj}${modelo}001000000123112345678`;
  if (base.length !== 43) throw new Error('Base da chave de teste invalida');

  let weight = 2;
  let sum = 0;
  for (let index = 42; index >= 0; index--) {
    const character = base[index];
    const value = /\d/.test(character)
      ? Number(character)
      : character.charCodeAt(0) - 48;
    sum += value * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const remainder = sum % 11;
  const digit = remainder === 0 || remainder === 1 ? 0 : 11 - remainder;
  return `${base}${digit}`;
}
