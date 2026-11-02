export const NFCE_QR_CODE =
  'https://consulta.exemplo.gov.br/qrcode?p=29240812345678000195650010000001231123456780|2|2|1|ABCD';

export function buildAccessKey(modelo: '55' | '65'): string {
  const base = `29240812345678000195${modelo}001000000123112345678`;
  let weight = 2;
  let sum = 0;
  for (let index = 42; index >= 0; index--) {
    sum += Number(base[index]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const remainder = sum % 11;
  return `${base}${remainder < 2 ? 0 : 11 - remainder}`;
}

export function buildDanfeXml(
  modelo: '55' | '65',
  options: { items?: number; homologacao?: boolean; standalone?: boolean } = {},
): string {
  const key = buildAccessKey(modelo);
  const items = Array.from(
    { length: options.items ?? 2 },
    (_, index) => `
    <det nItem="${index + 1}">
      <prod>
        <cProd>P-${index + 1}</cProd>
        <xProd>Produto de teste ${index + 1} com descrição extensa para verificar a quebra de linha</xProd>
        <NCM>84713012</NCM><CFOP>5102</CFOP><uCom>UN</uCom>
        <qCom>1.0000</qCom><vUnCom>10.0000000000</vUnCom><vProd>10.00</vProd>
      </prod>
      <imposto><ICMS><ICMS00><CST>00</CST><vBC>10.00</vBC>
        <pICMS>18.0000</pICMS><vICMS>1.80</vICMS></ICMS00></ICMS>
        <IPI><IPITrib><pIPI>5.00</pIPI><vIPI>0.50</vIPI></IPITrib></IPI>
      </imposto>
    </det>`,
  ).join('');
  const nfe = `<NFe xmlns="http://www.portalfiscal.inf.br/nfe">
    <infNFe Id="NFe${key}" versao="4.00">
      <ide><mod>${modelo}</mod><serie>1</serie><nNF>123</nNF>
        <dhEmi>2024-08-15T10:45:00-03:00</dhEmi>
        <dhSaiEnt>2024-08-15T11:00:00-03:00</dhSaiEnt>
        <tpAmb>${options.homologacao ? '2' : '1'}</tpAmb>
        <tpNF>1</tpNF><natOp>Venda de mercadorias</natOp>
      </ide>
      <emit><CNPJ>12345678000195</CNPJ><xNome>Emitente Exemplo Ltda</xNome>
        <IE>123456789</IE><IEST>99887766</IEST><enderEmit><xLgr>Rua Central</xLgr><nro>100</nro>
        <xBairro>Centro</xBairro><xMun>Salvador</xMun><UF>BA</UF><CEP>40000000</CEP>
        </enderEmit></emit>
      <dest><CNPJ>98765432000110</CNPJ><xNome>Destinatário Exemplo</xNome>
        <enderDest><xLgr>Avenida Sul</xLgr><nro>500</nro>
        <xBairro>Comércio</xBairro><CEP>40010000</CEP><fone>7133334444</fone>
        <xMun>Salvador</xMun><UF>BA</UF></enderDest></dest>
      ${items}
      <total><ICMSTot><vBC>20.00</vBC><vICMS>3.60</vICMS><vBCST>0.00</vBCST>
        <vST>0.00</vST><vProd>20.00</vProd><vFrete>0.00</vFrete>
        <vSeg>0.00</vSeg><vDesc>0.00</vDesc><vOutro>0.00</vOutro>
        <vIPI>1.00</vIPI><vPIS>0.33</vPIS><vCOFINS>1.52</vCOFINS>
        <vNF>21.00</vNF></ICMSTot></total>
      <transp><modFrete>9</modFrete><veicTransp><placa>ABC1D23</placa><UF>BA</UF><RNTC>12345678</RNTC></veicTransp>
        <vol><qVol>1</qVol><esp>CAIXA</esp><marca>TESTE</marca><nVol>123</nVol>
        <pesoB>2.000</pesoB><pesoL>1.800</pesoL></vol></transp>
      <cobr><fat><nFat>123</nFat></fat><dup><nDup>001</nDup>
        <dVenc>2024-09-15</dVenc><vDup>21.00</vDup></dup></cobr>
      <pag><detPag><tPag>01</tPag><vPag>25.00</vPag></detPag>
        <vTroco>4.00</vTroco></pag>
      <infAdic><infCpl>Informação complementar de teste.</infCpl>
        <infAdFisco>Informação fiscal.</infAdFisco></infAdic>
    </infNFe>
    ${
      modelo === '65'
        ? `<infNFeSupl><qrCode><![CDATA[${NFCE_QR_CODE}]]></qrCode>
          <urlChave>https://consulta.exemplo.gov.br</urlChave></infNFeSupl>`
        : ''
    }
  </NFe>`;
  if (options.standalone) return nfe;
  return `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
    ${nfe}<protNFe><infProt><chNFe>${key}</chNFe><cStat>100</cStat>
      <nProt>129240000123456</nProt>
      <dhRecbto>2024-08-15T10:46:00-03:00</dhRecbto></infProt></protNFe>
    </nfeProc>`;
}
