import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { parseNfseWebissXml } from './nfse-webiss.parser';

/** Espelho legível da NFS-e importada; a fonte fiscal continua sendo o XML. */
@Injectable()
export class NfsePdfService {
  async generatePdf(xml: string): Promise<Buffer> {
    const nota = parseNfseWebissXml(xml);
    if (!nota?.nfseDados) {
      throw new Error('XML de NFS-e WebISS inválido ou não suportado.');
    }

    const nfse = nota.nfseDados;
    const document = new PDFDocument({
      size: 'A4',
      margin: 42,
      info: {
        Title: `Espelho da NFS-e ${nota.numeroDocumento}`,
        Subject: 'Visualização dos dados da NFS-e importada',
        Creator: 'Kontabb',
      },
    });
    const chunks: Buffer[] = [];
    document.on('data', (chunk: Buffer) => chunks.push(chunk));
    const completed = new Promise<Buffer>((resolve, reject) => {
      document.once('end', () => resolve(Buffer.concat(chunks)));
      document.once('error', reject);
    });

    document
      .fillColor('#0f172a')
      .font('Helvetica-Bold')
      .fontSize(17)
      .text('Espelho da NFS-e');
    document
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#475569')
      .text(
        'Visualização gerada a partir do XML importado. Consulte o município para o documento oficial.',
      );
    document.moveDown(0.7);
    document
      .fillColor(nota.situacao === 'CANCELADA' ? '#991b1b' : '#166534')
      .font('Helvetica-Bold')
      .fontSize(10)
      .text(
        nota.situacao === 'CANCELADA' ? 'NFS-e CANCELADA' : 'NFS-e AUTORIZADA',
      );
    document.fillColor('#0f172a').moveDown(0.5);

    section(document, 'Identificação');
    field(document, 'Número', nota.numeroDocumento);
    field(document, 'Código de verificação', nfse.codigoVerificacao);
    field(document, 'Chave de acesso', nota.chaveAcesso);
    field(document, 'Emissão', nota.dataEmissaoFiscal);
    field(document, 'Competência', nfse.competencia);

    section(document, 'Prestador do serviço');
    party(
      document,
      nota.emitente.nome,
      nota.emitente.cnpjCpf,
      [
        nota.emitente.endereco,
        nota.emitente.numero,
        nota.emitente.bairro,
        nota.emitente.uf,
      ]
        .filter(Boolean)
        .join(', '),
    );
    field(document, 'Inscrição municipal', nfse.inscricaoMunicipalPrestador);

    section(document, 'Tomador do serviço');
    if (nota.tomador) {
      party(
        document,
        nota.tomador.nome,
        nota.tomador.cnpjCpf,
        [
          nota.tomador.endereco,
          nota.tomador.numero,
          nota.tomador.bairro,
          nota.tomador.uf,
        ]
          .filter(Boolean)
          .join(', '),
      );
    } else {
      document
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#475569')
        .text('Tomador não identificado no XML.');
    }

    section(document, 'Serviço');
    field(document, 'Item da lista de serviços', nfse.itemListaServico);
    field(document, 'CNAE', nfse.cnae);
    field(document, 'Município de incidência', nfse.municipioIncidencia);
    document
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#0f172a')
      .text(nfse.discriminacao || 'Discriminação não informada.');
    document.moveDown(0.7);

    section(document, 'Valores e ISS');
    field(document, 'Valor dos serviços', currency(nfse.valorServicos));
    field(document, 'Deduções', currency(nfse.valorDeducoes));
    field(
      document,
      'Desconto incondicionado',
      currency(nfse.descontoIncondicionado),
    );
    field(document, 'Base de cálculo', currency(nfse.baseCalculoIss));
    field(document, 'Alíquota do ISS', `${nfse.aliquotaIss}%`);
    field(document, 'ISS', currency(nfse.valorIss));
    field(document, 'ISS retido', nfse.issRetido ? 'Sim' : 'Não');
    field(document, 'Valor líquido da NFS-e', currency(nfse.valorLiquidoNfse));
    if (nfse.outrasInformacoes) {
      section(document, 'Outras informações');
      document.font('Helvetica').fontSize(9).text(nfse.outrasInformacoes);
    }
    document.end();
    return completed;
  }
}

function section(document: PDFKit.PDFDocument, title: string) {
  document.moveDown(0.8);
  document.font('Helvetica-Bold').fontSize(10).fillColor('#0369a1').text(title);
  document.moveDown(0.3);
}

function field(document: PDFKit.PDFDocument, label: string, value: string) {
  document
    .font('Helvetica-Bold')
    .fontSize(8)
    .fillColor('#334155')
    .text(`${label}: `, { continued: true })
    .font('Helvetica')
    .fillColor('#0f172a')
    .text(value || 'Não informado');
  document.moveDown(0.2);
}

function party(
  document: PDFKit.PDFDocument,
  name: string,
  id: string,
  address: string,
) {
  document
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor('#0f172a')
    .text(name || 'Nome não informado');
  field(document, 'CNPJ/CPF', id);
  if (address) field(document, 'Endereço', address);
}

function currency(value: string) {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    : value;
}
