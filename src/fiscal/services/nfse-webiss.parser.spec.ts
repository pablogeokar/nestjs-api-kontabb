import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseManualFiscalXml } from './dfe-document.parser';
import { parseNfseWebissXml } from './nfse-webiss.parser';

function fixture(name: string) {
  return readFileSync(resolve(__dirname, '../../../../', name), 'utf8');
}

describe('parseNfseWebissXml', () => {
  it.each([
    {
      arquivo: 'NFSe_2026000000196_2WRT-ZASA.xml',
      numero: '2026000000196',
      verificacao: '2WRT-ZASA',
      chave: '29108001203155128000112202600000019626090407576254',
      tomador: '88636933587',
      valor: '225.00',
      iss: '4.50',
    },
    {
      arquivo: 'NFSe_2026000000197_LY43-SBWA.xml',
      numero: '2026000000197',
      verificacao: 'LY43-SBWA',
      chave: '29108001203155128000112202600000019726090407576290',
      tomador: '88636933587',
      valor: '225.00',
      iss: '4.50',
    },
    {
      arquivo: 'NFSe_2026000000198_QRJX-U4AQ.xml',
      numero: '2026000000198',
      verificacao: 'QRJX-U4AQ',
      chave: '29108001203155128000112202600000019826090408822140',
      tomador: '91159725500',
      valor: '560.00',
      iss: '11.20',
    },
  ])('extrai os campos fiscais de $arquivo', (expected) => {
    const parsed = parseNfseWebissXml(fixture(expected.arquivo));

    expect(parsed).not.toBeNull();
    expect(parsed).toMatchObject({
      tipoDocumento: 'NFSE',
      modelo: 'NFSE',
      numeroDocumento: expected.numero,
      chaveAcesso: expected.chave,
      emitenteCnpjCpf: '03155128000112',
      destinatarioCnpjCpf: expected.tomador,
      valorTotal: expected.valor,
      integridade: { status: 'CONFORME' },
    });
    expect(parsed?.dataEmissaoFiscal).toMatch(/^2026-09-/);
    expect(parsed?.nfseDados).toMatchObject({
      provedor: 'WEBISS',
      codigoVerificacao: expected.verificacao,
      competencia: '2026-09-01',
      valorServicos: expected.valor,
      aliquotaIss: '2.0000',
      valorIss: expected.iss,
      itemListaServico: '0416',
      cnae: '8650003',
      issRetido: false,
      optanteSimplesNacional: true,
    });
  });

  it('é detectado pelo despachante de upload manual', () => {
    const result = parseManualFiscalXml(
      fixture('NFSe_2026000000196_2WRT-ZASA.xml'),
    );

    expect(result.status).toBe('DOCUMENTO');
    if (result.status === 'DOCUMENTO') {
      expect(result.documento.tipoDocumento).toBe('NFSE');
    }
  });

  it('reconhece cancelamento por substituição e identifica a NFS-e substituidora', () => {
    const xml = fixture('NFSe_2026000000196_2WRT-ZASA.xml').replace(
      '</CompNfse>',
      `<NfseCancelamento versao="2.02">
        <Confirmacao>
          <Pedido><InfPedidoCancelamento>
            <IdentificacaoNfse><Numero>2026000000196</Numero></IdentificacaoNfse>
            <CodigoCancelamento>2</CodigoCancelamento>
            <MotivoCancelamento>Substituição da NFS-e</MotivoCancelamento>
          </InfPedidoCancelamento></Pedido>
          <DataHora>2026-09-20T10:30:00.000</DataHora>
        </Confirmacao>
      </NfseCancelamento>
      <NfseSubstituicao versao="2.02">
        <SubstituicaoNfse>
          <NfseSubstituidora>2026000000199</NfseSubstituidora>
        </SubstituicaoNfse>
      </NfseSubstituicao>
      </CompNfse>`,
    );

    const parsed = parseNfseWebissXml(xml);

    expect(parsed).toMatchObject({
      numeroDocumento: '2026000000196',
      situacao: 'CANCELADA',
      nfseDados: {
        cancelada: true,
        substituida: true,
        dataHoraCancelamento: '2026-09-20T10:30:00.000',
        codigoCancelamento: '2',
        motivoCancelamento: 'Substituição da NFS-e',
        nfseSubstituidora: '2026000000199',
      },
    });
  });

  it('rejeita DTD antes de tentar interpretar o documento', () => {
    const result = parseManualFiscalXml(
      '<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><CompNfse/>',
    );
    expect(result).toMatchObject({ status: 'INVALIDO' });
  });
});
