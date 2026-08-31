import { parseCteEscrituracaoXml } from './dacte.parser';

describe('Parser fiscal de CT-e', () => {
  it.each([
    ['0', '11111111000191', 'REMETENTE'],
    ['1', '22222222000191', 'EXPEDIDOR'],
    ['2', '33333333000191', 'RECEBEDOR'],
    ['3', '44444444000191', 'DESTINATARIO'],
  ] as const)(
    'resolve toma3=%s pelo participante correspondente',
    (codigo, documento, papel) => {
      expect(
        parseCteEscrituracaoXml(buildCte({ toma3: codigo })),
      ).toMatchObject({
        tomadorCnpjCpf: documento,
        tomadorPapel: papel,
      });
    },
  );

  it('resolve toma4 como terceiro e extrai prestação, ICMS e municípios', () => {
    expect(parseCteEscrituracaoXml(buildCte({ toma4: true }))).toEqual({
      tomadorCnpjCpf: '55555555000191',
      tomadorPapel: 'TERCEIRO',
      tpCte: '0',
      tpServ: '0',
      modal: '01',
      cfop: '5352',
      valorTotalServico: '150.75',
      valorReceber: '145.00',
      cstIcms: '00',
      csosnIcms: null,
      valorBcIcms: '150.75',
      aliquotaIcms: '12.0000',
      valorIcms: '18.09',
      valorTotalTributos: '18.09',
      chaveCteReferenciado: null,
      codigoMunicipioOrigem: '2927408',
      codigoMunicipioDestino: '2910800',
    });
  });

  it('extrai CSOSN e a chave referenciada do CT-e complementar', () => {
    const referencia = buildAccessKey('57', '000000124');
    const parsed = parseCteEscrituracaoXml(
      buildCte({ toma3: '0', tpCte: '1', referencia, simples: true }),
    );

    expect(parsed).toMatchObject({
      tpCte: '1',
      cstIcms: null,
      csosnIcms: '101',
      chaveCteReferenciado: referencia,
    });
  });

  it('rejeita DTD e chave de acesso inválida', () => {
    expect(() =>
      parseCteEscrituracaoXml(`<!DOCTYPE foo>${buildCte({ toma3: '0' })}`),
    ).toThrow('DTD');
    expect(() =>
      parseCteEscrituracaoXml(
        buildCte({ toma3: '0' }).replace(/CTe\d{44}/, `CTe${'1'.repeat(44)}`),
      ),
    ).toThrow('Chave de acesso');
  });
});

function buildCte(input: {
  toma3?: string;
  toma4?: boolean;
  tpCte?: string;
  referencia?: string;
  simples?: boolean;
}) {
  const chave = buildAccessKey('57', '000000123');
  const tomador = input.toma4
    ? '<toma4><toma>4</toma><CNPJ>55555555000191</CNPJ><xNome>Terceiro</xNome><enderToma /></toma4>'
    : `<toma3><toma>${input.toma3 ?? '0'}</toma></toma3>`;
  const icms = input.simples
    ? '<ICMSSN><CSOSN>101</CSOSN><vBC>150.75</vBC><pICMS>12.0000</pICMS><vICMS>18.09</vICMS></ICMSSN>'
    : '<ICMS00><CST>00</CST><vBC>150.75</vBC><pICMS>12.0000</pICMS><vICMS>18.09</vICMS></ICMS00>';
  const complemento = input.referencia
    ? `<infCteComp><chCTe>${input.referencia}</chCTe></infCteComp>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
    <cteProc xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00">
      <CTe><infCte Id="CTe${chave}" versao="4.00">
        <ide><CFOP>5352</CFOP><mod>57</mod><serie>1</serie><nCT>123</nCT>
          <dhEmi>2026-08-16T10:00:00-03:00</dhEmi><tpCTe>${input.tpCte ?? '0'}</tpCTe>
          <tpServ>0</tpServ><modal>01</modal><cMunIni>2927408</cMunIni><cMunFim>2910800</cMunFim>${tomador}
        </ide>
        <emit><CNPJ>12345678000195</CNPJ><xNome>Transportadora</xNome></emit>
        <rem><CNPJ>11111111000191</CNPJ><xNome>Remetente</xNome></rem>
        <exped><CNPJ>22222222000191</CNPJ><xNome>Expedidor</xNome></exped>
        <receb><CNPJ>33333333000191</CNPJ><xNome>Recebedor</xNome></receb>
        <dest><CNPJ>44444444000191</CNPJ><xNome>Destinatário</xNome></dest>
        <vPrest><vTPrest>150.75</vTPrest><vRec>145.00</vRec></vPrest>
        <imp><ICMS>${icms}</ICMS><vTotTrib>18.09</vTotTrib></imp>
        ${complemento}
      </infCte></CTe>
      <protCTe><infProt><chCTe>${chave}</chCTe><cStat>100</cStat></infProt></protCTe>
    </cteProc>`;
}

function buildAccessKey(modelo: string, numero: string) {
  const base = `29260812345678000195${modelo}001${numero}112345678`;
  if (base.length !== 43) throw new Error('Base de chave inválida');
  let weight = 2;
  let sum = 0;
  for (let index = 42; index >= 0; index--) {
    sum += Number(base[index]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const remainder = sum % 11;
  return `${base}${remainder < 2 ? 0 : 11 - remainder}`;
}
