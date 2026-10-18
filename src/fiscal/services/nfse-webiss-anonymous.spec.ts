import { parseManualFiscalXml } from './dfe-document.parser';
import {
  ImportacaoXmlFiscalService,
  prepararNfseEscrituracao,
} from './importacao-xml-fiscal.service';
import { NfsePdfService } from './nfse-pdf.service';
import { parseNfseWebissXml } from './nfse-webiss.parser';

const XML_SEM_TOMADOR = `<CompNfse><Nfse versao="2.02"><InfNfse Id="29108001203155128000112202600000019626090407576254">
  <Numero>2026000000196</Numero><CodigoVerificacao>2WRT-ZASA</CodigoVerificacao>
  <DataEmissao>2026-09-19T16:06:32</DataEmissao>
  <ValoresNfse><BaseCalculo>225.00</BaseCalculo><Aliquota>2.00</Aliquota><ValorIss>4.50</ValorIss><ValorLiquidoNfse>225.00</ValorLiquidoNfse></ValoresNfse>
  <PrestadorServico><IdentificacaoPrestador><CpfCnpj><Cnpj>03155128000112</Cnpj></CpfCnpj></IdentificacaoPrestador><RazaoSocial>Prestador de exemplo</RazaoSocial></PrestadorServico>
  <DeclaracaoPrestacaoServico><InfDeclaracaoPrestacaoServico>
    <Competencia>2026-09-01</Competencia>
    <Servico><Valores><ValorServicos>225.00</ValorServicos></Valores><IssRetido>2</IssRetido><ItemListaServico>0416</ItemListaServico><CodigoCnae>8650003</CodigoCnae><ExigibilidadeISS>1</ExigibilidadeISS><MunicipioIncidencia>2910800</MunicipioIncidencia><Discriminacao>Serviço de exemplo.</Discriminacao></Servico>
  </InfDeclaracaoPrestacaoServico></DeclaracaoPrestacaoServico>
</InfNfse></Nfse></CompNfse>`;

describe('NFS-e WebISS sem identificação do tomador', () => {
  it('aceita o XML e associa somente o prestador identificado', () => {
    const parsed = parseNfseWebissXml(XML_SEM_TOMADOR);
    const manual = parseManualFiscalXml(XML_SEM_TOMADOR);

    expect(manual.status).toBe('DOCUMENTO');
    expect(parsed).toMatchObject({
      tipoDocumento: 'NFSE',
      destinatarioCnpjCpf: '',
      destinatarioRazaoSocial: '',
      destinatario: null,
      tomador: null,
      participantesCnpjCpf: ['03155128000112'],
      integridade: { status: 'CONFORME' },
    });
    expect(parsed?.nfseDados?.valorIss).toBe('4.50');
  });

  it('continua recusando identificador informado e inválido', () => {
    const xml = XML_SEM_TOMADOR.replace(
      '<Competencia>2026-09-01</Competencia>',
      '<Competencia>2026-09-01</Competencia><Tomador><IdentificacaoTomador><CpfCnpj><Cnpj>123</Cnpj></CpfCnpj></IdentificacaoTomador></Tomador>',
    );

    expect(parseNfseWebissXml(xml)).toBeNull();
  });

  it('escritura a saída do prestador e gera o espelho da nota', async () => {
    const parsed = parseNfseWebissXml(XML_SEM_TOMADOR);
    if (!parsed) throw new Error('Fixture inválida');

    expect(
      prepararNfseEscrituracao({ cnpj: parsed.emitenteCnpjCpf }, parsed),
    ).toMatchObject({
      tipoOperacaoEscriturada: 'SAIDA',
      itens: [{ cfop: '5933' }],
    });

    const pdf = await new NfsePdfService().generatePdf(XML_SEM_TOMADOR);
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(2_000);
  });

  it('encaminha a importação apenas à empresa prestadora cadastrada', async () => {
    const service = new ImportacaoXmlFiscalService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const findClientes = jest
      .spyOn(service as never, 'findClientesForDocument')
      .mockResolvedValue([
        { id: 'cliente-1', cnpj: '03155128000112', razaoSocial: 'Prestador' },
      ] as never);
    const persistir = jest
      .spyOn(service as never, 'persistirDocumento')
      .mockResolvedValue({ status: 'IMPORTADO', revisoes: [] } as never);
    const buffer = Buffer.from(XML_SEM_TOMADOR);

    const result = await service.importar({
      files: [
        {
          originalname: 'nota-sem-tomador.xml',
          mimetype: 'application/xml',
          buffer,
          size: buffer.length,
        } as Express.Multer.File,
      ],
      actorUserId: 'user-1',
      requestId: 'request-1',
    });

    expect(findClientes).toHaveBeenCalledWith(['03155128000112']);
    expect(persistir).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ importados: 1, erros: 0 });
  });
});
