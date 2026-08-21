import { normalizeFiscalDecimal, parseNfeItems } from './nfe-item.parser';

describe('NF-e item parser', () => {
  it('extrai produto e todos os blocos tributários preservando decimais', () => {
    const [item] = parseNfeItems(
      wrapNfe(`
        <det nItem="1">
          ${productXml('PROD-1')}
          <imposto>
            <vTotTrib>42.31</vTotTrib>
            <ICMS><ICMS10>
              <orig>0</orig><CST>10</CST><modBC>3</modBC><pRedBC>1.2500</pRedBC>
              <vBC>100.00</vBC><pICMS>18.0000</pICMS><vICMS>18.00</vICMS>
              <modBCST>4</modBCST><pMVAST>35.0000</pMVAST><pRedBCST>2.0000</pRedBCST>
              <vBCST>135.00</vBCST><pICMSST>18.0000</pICMSST><vICMSST>6.30</vICMSST>
              <vBCFCP>100.00</vBCFCP><pFCP>2.0000</pFCP><vFCP>2.00</vFCP>
              <vBCFCPST>135.00</vBCFCPST><pFCPST>2.0000</pFCPST><vFCPST>2.70</vFCPST>
              <motDesICMS>9</motDesICMS><vICMSDeson>1.00</vICMSDeson>
              <pDif>33.3300</pDif><vICMSDif>6.00</vICMSDif><vICMSOp>18.00</vICMSOp>
              <pCredSN>3.2000</pCredSN><vCredICMSSN>3.20</vCredICMSSN>
              <vBCSTRet>90.00</vBCSTRet><pST>18.0000</pST><vICMSSTRet>16.20</vICMSSTRet>
            </ICMS10></ICMS>
            <ICMSUFDest>
              <vBCUFDest>100.00</vBCUFDest><vBCFCPUFDest>100.00</vBCFCPUFDest>
              <pFCPUFDest>2.0000</pFCPUFDest><pICMSUFDest>18.0000</pICMSUFDest>
              <pICMSInter>12.0000</pICMSInter><pICMSInterPart>100.0000</pICMSInterPart>
              <vFCPUFDest>2.00</vFCPUFDest><vICMSUFDest>6.00</vICMSUFDest>
              <vICMSUFRemet>0.00</vICMSUFRemet>
            </ICMSUFDest>
            <IPI><clEnq>99999</clEnq><CNPJProd>12345678000195</CNPJProd><cEnq>999</cEnq>
              <IPITrib><CST>50</CST><vBC>100.00</vBC><pIPI>5.0000</pIPI><qUnid>2.0000</qUnid><vUnid>2.5000</vUnid><vIPI>5.00</vIPI></IPITrib>
            </IPI>
            <PIS><PISAliq><CST>01</CST><vBC>100.00</vBC><pPIS>1.6500</pPIS><vPIS>1.65</vPIS></PISAliq></PIS>
            <PISST><vBC>100.00</vBC><pPIS>1.6500</pPIS><vPIS>1.65</vPIS></PISST>
            <COFINS><COFINSQtde><CST>03</CST><qBCProd>2.0000</qBCProd><vAliqProd>3.8000</vAliqProd><vCOFINS>7.60</vCOFINS></COFINSQtde></COFINS>
            <COFINSST><vBC>100.00</vBC><pCOFINS>7.6000</pCOFINS><vCOFINS>7.60</vCOFINS></COFINSST>
            <II><vBC>100.00</vBC><vDespAdu>2.00</vDespAdu><vII>10.00</vII><vIOF>1.00</vIOF></II>
          </imposto>
          <infAdProd>Lote &amp; validade</infAdProd>
        </det>
      `),
    );

    expect(item).toMatchObject({
      numeroItem: 1,
      codigoProduto: 'PROD-1',
      codigoEan: '7891234567890',
      descricao: 'Produto de teste',
      ncm: '84713012',
      nve: 'AA0001,BB0002',
      cest: '2106300',
      indEscala: 'S',
      cnpjFabricante: '12345678000195',
      codigoBeneficioFiscal: 'PR123456',
      cfop: '5102',
      quantidadeComercial: '2.0000',
      valorUnitarioComercial: '50.1234567890',
      valorBrutoProduto: '100.00',
      origemMercadoria: '0',
      cstIcms: '10',
      valorIcms: '18.00',
      valorIcmsSt: '6.30',
      valorIcmsUfDest: '6.00',
      cstIpi: '50',
      valorIpi: '5.00',
      cstPis: '01',
      valorPis: '1.65',
      valorPisSt: '1.65',
      cstCofins: '03',
      quantidadeBcCofins: '2.0000',
      valorCofinsSt: '7.60',
      valorImpostoImportacao: '10.00',
      valorTributosAproximados: '42.31',
      informacoesAdicionais: 'Lote & validade',
    });
  });

  it.each([
    'ICMS00',
    'ICMS10',
    'ICMS20',
    'ICMS30',
    'ICMS40',
    'ICMS51',
    'ICMS60',
    'ICMS70',
    'ICMS90',
    'ICMSPart',
    'ICMSST',
  ])('suporta o grupo %s do regime normal', (group) => {
    const [item] = parseNfeItems(
      wrapNfe(
        `<det nItem="1">${productXml(group)}<imposto><ICMS><${group}><orig>1</orig><CST>90</CST><vBC>10.00</vBC><pICMS>18.0000</pICMS><vICMS>1.80</vICMS></${group}></ICMS></imposto></det>`,
      ),
    );
    expect(item).toMatchObject({ origemMercadoria: '1', cstIcms: '90' });
  });

  it.each([
    'ICMSSN101',
    'ICMSSN102',
    'ICMSSN201',
    'ICMSSN202',
    'ICMSSN500',
    'ICMSSN900',
  ])('suporta o grupo %s do Simples Nacional', (group) => {
    const [item] = parseNfeItems(
      wrapNfe(
        `<det nItem="1">${productXml(group)}<imposto><ICMS><${group}><orig>0</orig><CSOSN>900</CSOSN><pCredSN>3.2000</pCredSN><vCredICMSSN>3.20</vCredICMSSN></${group}></ICMS></imposto></det>`,
      ),
    );
    expect(item).toMatchObject({
      csosnIcms: '900',
      aliquotaCreditoSn: '3.2000',
      valorCreditoIcmsSn: '3.20',
    });
  });

  it.each([
    ['PISAliq', '<vBC>10.00</vBC><pPIS>1.6500</pPIS>'],
    ['PISQtde', '<qBCProd>2.0000</qBCProd><vAliqProd>0.1000</vAliqProd>'],
    ['PISNT', ''],
    ['PISOutr', '<vBC>10.00</vBC><pPIS>1.6500</pPIS>'],
  ])('suporta o grupo %s de PIS', (group, values) => {
    const [item] = parseNfeItems(
      wrapNfe(
        `<det nItem="1">${productXml(group)}<imposto><PIS><${group}><CST>49</CST>${values}<vPIS>0.17</vPIS></${group}></PIS></imposto></det>`,
      ),
    );
    expect(item.cstPis).toBe('49');
  });

  it.each([
    ['COFINSAliq', '<vBC>10.00</vBC><pCOFINS>7.6000</pCOFINS>'],
    ['COFINSQtde', '<qBCProd>2.0000</qBCProd><vAliqProd>0.5000</vAliqProd>'],
    ['COFINSNT', ''],
    ['COFINSOutr', '<vBC>10.00</vBC><pCOFINS>7.6000</pCOFINS>'],
  ])('suporta o grupo %s de COFINS', (group, values) => {
    const [item] = parseNfeItems(
      wrapNfe(
        `<det nItem="1">${productXml(group)}<imposto><COFINS><${group}><CST>49</CST>${values}<vCOFINS>0.76</vCOFINS></${group}></COFINS></imposto></det>`,
      ),
    );
    expect(item.cstCofins).toBe('49');
  });

  it.each(['IPITrib', 'IPINT'])('suporta o grupo %s de IPI', (group) => {
    const [item] = parseNfeItems(
      wrapNfe(
        `<det nItem="1">${productXml(group)}<imposto><IPI><cEnq>999</cEnq><${group}><CST>49</CST></${group}></IPI></imposto></det>`,
      ),
    );
    expect(item).toMatchObject({ cstIpi: '49', codigoEnquadramentoIpi: '999' });
  });

  it('trata objeto único, mais de cinquenta itens e NFC-e modelo 65', () => {
    expect(parseNfeItems(wrapNfe(itemXml(1), '65'))).toHaveLength(1);
    const many = Array.from({ length: 75 }, (_, index) => itemXml(index + 1));
    const items = parseNfeItems(wrapNfe(many.join('')));
    expect(items).toHaveLength(75);
    expect(items[74].numeroItem).toBe(75);
  });

  it('descarta item estruturalmente inválido sem arredondar o valor', () => {
    const invalid = itemXml(1).replace(
      '<qCom>2.0000</qCom>',
      '<qCom>2.00001</qCom>',
    );
    expect(parseNfeItems(wrapNfe(invalid))).toEqual([]);
    expect(normalizeFiscalDecimal('99999999999.1234567890', 21, 10)).toBe(
      '99999999999.1234567890',
    );
    expect(normalizeFiscalDecimal('1.12345', 7, 4)).toBeNull();
  });
});

function wrapNfe(det: string, modelo: '55' | '65' = '55') {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">
      <NFe><infNFe><ide><mod>${modelo}</mod></ide>${det}</infNFe></NFe>
    </nfeProc>`;
}

function itemXml(numero: number) {
  return `<det nItem="${numero}">${productXml(`P-${numero}`)}<imposto /></det>`;
}

function productXml(code: string) {
  return `<prod>
    <cProd>${code}</cProd><cEAN>7891234567890</cEAN><xProd>Produto de teste</xProd>
    <NCM>84713012</NCM><NVE>AA0001</NVE><NVE>BB0002</NVE><CEST>2106300</CEST>
    <indEscala>S</indEscala><CNPJFab>12345678000195</CNPJFab><cBenef>PR123456</cBenef>
    <CFOP>5102</CFOP><uCom>UN</uCom><qCom>2.0000</qCom>
    <vUnCom>50.1234567890</vUnCom><vProd>100.00</vProd>
    <cEANTrib>7891234567890</cEANTrib><uTrib>UN</uTrib><qTrib>2.0000</qTrib>
    <vUnTrib>50.1234567890</vUnTrib><vFrete>1.00</vFrete><vSeg>2.00</vSeg>
    <vDesc>3.00</vDesc><vOutro>4.00</vOutro><indTot>1</indTot>
    <xPed>PED-1</xPed><nItemPed>1</nItemPed>
  </prod>`;
}
