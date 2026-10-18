import { NfsePdfService } from './nfse-pdf.service';

const XML_NFSE = `<CompNfse><Nfse versao="2.02"><InfNfse Id="29108001203155128000112202600000019626090407576254">
  <Numero>2026000000196</Numero><CodigoVerificacao>2WRT-ZASA</CodigoVerificacao>
  <DataEmissao>2026-09-19T16:06:32</DataEmissao>
  <ValoresNfse><BaseCalculo>225.00</BaseCalculo><Aliquota>2.00</Aliquota><ValorIss>4.50</ValorIss><ValorLiquidoNfse>225.00</ValorLiquidoNfse></ValoresNfse>
  <PrestadorServico><IdentificacaoPrestador><CpfCnpj><Cnpj>03155128000112</Cnpj></CpfCnpj><InscricaoMunicipal>12345</InscricaoMunicipal></IdentificacaoPrestador><RazaoSocial>Prestador de exemplo</RazaoSocial></PrestadorServico>
  <DeclaracaoPrestacaoServico><InfDeclaracaoPrestacaoServico>
    <Competencia>2026-09-01</Competencia>
    <Tomador><IdentificacaoTomador><CpfCnpj><Cpf>88636933587</Cpf></CpfCnpj></IdentificacaoTomador><RazaoSocial>Tomador de exemplo</RazaoSocial></Tomador>
    <Servico><Valores><ValorServicos>225.00</ValorServicos></Valores><IssRetido>2</IssRetido><ItemListaServico>0416</ItemListaServico><CodigoCnae>8650003</CodigoCnae><ExigibilidadeISS>1</ExigibilidadeISS><MunicipioIncidencia>2910800</MunicipioIncidencia><Discriminacao>Serviço de exemplo para visualização.</Discriminacao></Servico>
  </InfDeclaracaoPrestacaoServico></DeclaracaoPrestacaoServico>
</InfNfse></Nfse></CompNfse>`;

describe('NfsePdfService', () => {
  const service = new NfsePdfService();

  it('gera um PDF completo para uma NFS-e WebISS importada', async () => {
    const pdf = await service.generatePdf(XML_NFSE);

    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(pdf.subarray(-1_024).includes('%%EOF')).toBe(true);
    expect(pdf.length).toBeGreaterThan(2_000);
  });

  it('recusa XML que não seja uma NFS-e suportada', async () => {
    await expect(service.generatePdf('<NFe/>')).rejects.toThrow(
      'XML de NFS-e WebISS inválido ou não suportado.',
    );
  });
});
