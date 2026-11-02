import { DacteService } from './dacte.service';
import { parseDacteXml } from './dacte.parser';

const ACCESS_KEY = '2'.repeat(44);

describe('DACTE', () => {
  it('extrai os dados relevantes do CT-e processado', () => {
    const data = parseDacteXml(buildCteXml());

    expect(data).toMatchObject({
      chaveAcesso: ACCESS_KEY,
      modelo: '57',
      serie: '1',
      numero: '123',
      modal: 'RODOVIÁRIO',
      protocolo: '129260000000001',
      status: 'AUTORIZADO',
      valorTotalServico: 'R$ 150,75',
      valorReceber: 'R$ 145,00',
    });
    expect(data.emitente.documento).toBe('12.345.678/0001-95');
    expect(data.expedidor.nome).toBe('EXPEDIDOR TESTE LTDA');
    expect(data.recebedor.nome).toBe('RECEBEDOR TESTE LTDA');
    expect(data.documentosOriginarios).toHaveLength(1);
    expect(data.modalInfo).toContainEqual({
      label: 'RNTRC',
      value: '12345678',
    });
  });

  it('gera um PDF completo em memória', async () => {
    const pdf = await new DacteService().generatePdf(buildCteXml());
    const pageObjects =
      pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? [];

    expect(pdf.length).toBeGreaterThan(5_000);
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(pdf.subarray(-1_024).includes('%%EOF')).toBe(true);
    expect(pageObjects).toHaveLength(1);
  });

  it('repete a identificação do CT-e nas folhas adicionais', async () => {
    const original = `<infNFe><chave>${'3'.repeat(44)}</chave></infNFe>`;
    const xml = buildCteXml().replace(original, original.repeat(80));
    const pdf = await new DacteService().generatePdf(xml);
    expect(
      (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length,
    ).toBeGreaterThan(1);
  });

  it('não inventa QR Code quando o CT-e não o fornece', async () => {
    const xml = buildCteXml().replace(/<infCTeSupl>[\s\S]*?<\/infCTeSupl>/, '');
    expect(parseDacteXml(xml).qrCode).toBe('');
    const pdf = await new DacteService().generatePdf(xml);
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('inclui campos do modal aéreo no quadro específico', async () => {
    const xml = buildCteXml()
      .replace('<modal>01</modal>', '<modal>02</modal>')
      .replace(
        '<rodo><RNTRC>12345678</RNTRC></rodo>',
        '<aereo><nOCA>ABC123</nOCA><cTar>TAR1</cTar><vTar>1.23</vTar></aereo>',
      );
    const data = parseDacteXml(xml);
    expect(data.modal).toBe('AÉREO');
    expect(data.modalInfo).toContainEqual({ label: 'Nº OCA', value: 'ABC123' });
    const pdf = await new DacteService().generatePdf(xml);
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('rejeita XML que não seja CT-e modelo 57', () => {
    expect(() =>
      parseDacteXml(buildCteXml().replace('<mod>57</mod>', '<mod>67</mod>')),
    ).toThrow('modelo 57');
  });
});

function buildCteXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
  <cteProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/cte">
    <CTe>
      <infCte Id="CTe${ACCESS_KEY}" versao="4.00">
        <ide>
          <CFOP>5353</CFOP><natOp>PRESTACAO DE SERVICO DE TRANSPORTE</natOp>
          <mod>57</mod><serie>1</serie><nCT>123</nCT>
          <dhEmi>2026-08-16T10:00:00-03:00</dhEmi><tpAmb>1</tpAmb>
          <tpCTe>0</tpCTe><modal>01</modal><tpServ>0</tpServ>
          <xMunIni>Salvador</xMunIni><UFIni>BA</UFIni>
          <xMunFim>Feira de Santana</xMunFim><UFFim>BA</UFFim>
          <toma3><toma>0</toma></toma3>
        </ide>
        <compl><xObs>Entrega em horário comercial.</xObs></compl>
        <emit>
          <CNPJ>12345678000195</CNPJ><IE>123456789</IE><xNome>TRANSPORTADORA TESTE LTDA</xNome>
          <enderEmit><xLgr>Rua Principal</xLgr><nro>100</nro><xBairro>Centro</xBairro><xMun>Salvador</xMun><UF>BA</UF><CEP>40000000</CEP><fone>7133334444</fone></enderEmit>
        </emit>
        <rem>
          <CNPJ>98765432000110</CNPJ><IE>987654321</IE><xNome>REMETENTE TESTE LTDA</xNome>
          <enderReme><xLgr>Av. Origem</xLgr><nro>10</nro><xBairro>Comércio</xBairro><xMun>Salvador</xMun><UF>BA</UF><CEP>40010000</CEP></enderReme>
        </rem>
        <exped>
          <CNPJ>22222222000191</CNPJ><xNome>EXPEDIDOR TESTE LTDA</xNome>
          <enderExped><xLgr>Rua do Expedidor</xLgr><nro>5</nro><xMun>Salvador</xMun><UF>BA</UF></enderExped>
        </exped>
        <receb>
          <CNPJ>33333333000191</CNPJ><xNome>RECEBEDOR TESTE LTDA</xNome>
          <enderReceb><xLgr>Rua do Recebedor</xLgr><nro>8</nro><xMun>Feira de Santana</xMun><UF>BA</UF></enderReceb>
        </receb>
        <dest>
          <CNPJ>11222333000181</CNPJ><IE>112223330</IE><xNome>DESTINATARIO TESTE LTDA</xNome>
          <enderDest><xLgr>Av. Destino</xLgr><nro>20</nro><xBairro>Centro</xBairro><xMun>Feira de Santana</xMun><UF>BA</UF><CEP>44000000</CEP></enderDest>
        </dest>
        <vPrest>
          <vTPrest>150.75</vTPrest><vRec>145.00</vRec>
          <Comp><xNome>FRETE VALOR</xNome><vComp>140.00</vComp></Comp>
          <Comp><xNome>PEDAGIO</xNome><vComp>10.75</vComp></Comp>
        </vPrest>
        <imp><ICMS><ICMS00><CST>00</CST><vBC>150.75</vBC><pICMS>12.00</pICMS><vICMS>18.09</vICMS></ICMS00></ICMS><vTotTrib>18.09</vTotTrib></imp>
        <infCTeNorm>
          <infCarga><vCarga>2500.00</vCarga><proPred>ALIMENTOS</proPred><xOutCat>CAIXAS</xOutCat><infQ><cUnid>01</cUnid><tpMed>PESO BRUTO</tpMed><qCarga>125.5000</qCarga></infQ></infCarga>
          <infDoc><infNFe><chave>${'3'.repeat(44)}</chave></infNFe></infDoc>
          <infModal versaoModal="4.00"><rodo><RNTRC>12345678</RNTRC></rodo></infModal>
        </infCTeNorm>
      </infCte>
      <infCTeSupl><qrCodCTe>https://www.cte.fazenda.gov.br/portal/consulta.aspx?chave=${ACCESS_KEY}</qrCodCTe></infCTeSupl>
    </CTe>
    <protCTe><infProt><chCTe>${ACCESS_KEY}</chCTe><dhRecbto>2026-08-16T10:01:00-03:00</dhRecbto><nProt>129260000000001</nProt><cStat>100</cStat><xMotivo>Autorizado o uso do CT-e</xMotivo></infProt></protCTe>
  </cteProc>`;
}
