import { Injectable } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import PDFDocument from 'pdfkit';
import { pdfkitAddPlaceholder } from '@signpdf/placeholder-pdfkit';
import { SUBFILTER_ETSI_CADES_DETACHED } from '@signpdf/utils';
import type { FaturamentoMesSnapshot } from '../../database/schema';

const LOGO = readFileSync(
  resolve(__dirname, '../../assets/financeiro/kontabb-logo.png'),
);
const brl = (value: string) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    Number(value),
  );

export interface FaturamentoPdfInput {
  numero: string;
  codigo: string;
  nome: string;
  documento: string;
  contadorNome: string | null;
  contadorCrc: string | null;
  inicio: string;
  fim: string;
  meses: FaturamentoMesSnapshot[];
  total: string;
  emitidoEm: Date;
  assinado: boolean;
}

@Injectable()
export class FaturamentoDocumentoService {
  async render(input: FaturamentoPdfInput): Promise<Buffer> {
    const pdf = new PDFDocument({
      size: 'A4',
      margin: 44,
      bufferPages: true,
      info: { Title: 'Demonstrativo de faturamento', Author: 'KONTABB' },
    });
    const chunks: Buffer[] = [];
    pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<Buffer>((resolveBuffer, reject) => {
      pdf.on('end', () => resolveBuffer(Buffer.concat(chunks)));
      pdf.on('error', reject);
    });

    const header = () => {
      pdf.image(LOGO, 44, 29, { fit: [135, 50] });
      pdf
        .fillColor('#16365B')
        .font('Helvetica-Bold')
        .fontSize(9)
        .text('DOCUMENTO DE CONTROLE', 344, 34, { width: 207, align: 'right' });
      pdf
        .fillColor('#66788D')
        .font('Helvetica')
        .fontSize(8)
        .text(input.numero, 344, 49, { width: 207, align: 'right' });
      pdf.moveTo(44, 89).lineTo(551, 89).strokeColor('#DCE5EF').stroke();
      pdf
        .fillColor('#102B4D')
        .font('Helvetica-Bold')
        .fontSize(17)
        .text('Demonstrativo de faturamento', 44, 108);
      pdf
        .fillColor('#63758A')
        .font('Helvetica')
        .fontSize(9)
        .text('Receita bruta documental por competência', 44, 133);
    };
    header();
    pdf.roundedRect(44, 160, 507, 84, 8).fill('#F3F7FC');
    pdf
      .fillColor('#1E3A5F')
      .font('Helvetica-Bold')
      .fontSize(11)
      .text(input.nome, 57, 173, { width: 478 });
    pdf
      .fillColor('#586B81')
      .font('Helvetica')
      .fontSize(9)
      .text(`CNPJ/CPF: ${input.documento}`, 57, 195);
    pdf.text(
      `Período: ${input.inicio.slice(5)}/${input.inicio.slice(0, 4)} a ${input.fim.slice(5)}/${input.fim.slice(0, 4)}`,
      57,
      212,
    );

    let y = 271;
    const tableHeader = () => {
      pdf.rect(44, y, 507, 28).fill('#123F70');
      pdf.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8);
      pdf.text('COMPETÊNCIA', 54, y + 10, { width: 85 });
      pdf.text('PRODUTOS', 145, y + 10, { width: 100, align: 'right' });
      pdf.text('SERVIÇOS', 260, y + 10, { width: 100, align: 'right' });
      pdf.text('TOTAL', 390, y + 10, { width: 147, align: 'right' });
      y += 28;
    };
    tableHeader();
    for (const [index, mes] of input.meses.entries()) {
      if (y > 707) {
        pdf.addPage();
        header();
        y = 175;
        tableHeader();
      }
      if (index % 2 === 0) pdf.rect(44, y, 507, 27).fill('#F7FAFD');
      pdf.fillColor('#223954').font('Helvetica').fontSize(8.5);
      pdf.text(
        `${mes.competencia.slice(5)}/${mes.competencia.slice(0, 4)}`,
        54,
        y + 9,
        { width: 85 },
      );
      pdf.text(brl(mes.valorProdutos), 145, y + 9, {
        width: 100,
        align: 'right',
      });
      pdf.text(brl(mes.valorServicos), 260, y + 9, {
        width: 100,
        align: 'right',
      });
      pdf
        .font('Helvetica-Bold')
        .text(brl(mes.total), 390, y + 9, { width: 147, align: 'right' });
      y += 27;
    }
    if (y > 678) {
      pdf.addPage();
      header();
      y = 175;
    }
    pdf.roundedRect(44, y + 15, 507, 47, 7).fill('#E8F1FA');
    pdf
      .fillColor('#123F70')
      .font('Helvetica-Bold')
      .fontSize(10)
      .text('TOTAL DO PERÍODO', 57, y + 32);
    pdf
      .fontSize(14)
      .text(brl(input.total), 310, y + 29, { width: 225, align: 'right' });
    y += 84;
    if (y > 650) {
      pdf.addPage();
      header();
      y = 175;
    }
    pdf
      .fillColor('#223954')
      .font('Helvetica-Bold')
      .fontSize(9)
      .text('Responsável contábil', 44, y);
    pdf
      .font('Helvetica')
      .fontSize(9)
      .text(
        input.contadorNome
          ? `${input.contadorNome}${input.contadorCrc ? ` · CRC ${input.contadorCrc}` : ''}`
          : 'Não vinculado no cadastro',
        44,
        y + 16,
      );
    pdf
      .fillColor('#66788D')
      .fontSize(8)
      .text(
        input.assinado
          ? 'Documento assinado digitalmente com certificado A1 do contador. Confira a assinatura no PDF.'
          : 'Documento emitido sem assinatura digital do contador.',
        44,
        y + 36,
        { width: 507 },
      );
    pdf.text(
      'Fonte: NF-e/NFC-e de venda (itens com CFOP de receita) e NFS-e autorizadas, emitidas pela empresa e disponíveis no sistema até a emissão. Valores brutos, sem dedução de devoluções; não substitui escrituração, conferência contábil ou documentos fiscais originais.',
      44,
      y + 57,
      { width: 507, lineGap: 2 },
    );
    const footerY = 760;
    const pages = pdf.bufferedPageRange();
    for (let page = 0; page < pages.count; page++) {
      pdf.switchToPage(page);
      pdf
        .moveTo(44, footerY - 16)
        .lineTo(551, footerY - 16)
        .strokeColor('#DCE5EF')
        .stroke();
      pdf
        .fillColor('#66788D')
        .font('Helvetica')
        .fontSize(7)
        .text(`Código de verificação: ${input.codigo}`, 44, footerY - 8, {
          width: 380,
        });
      pdf.text(`${page + 1}/${pages.count}`, 510, footerY - 8, {
        width: 41,
        align: 'right',
      });
      pdf.text(
        `Emissão: ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Bahia' }).format(input.emitidoEm)}`,
        44,
        footerY + 4,
      );
      pdf.text(
        'Confira a autenticidade em kontabb.com.br/verificar-faturamento',
        44,
        footerY + 15,
        { link: 'https://kontabb.com.br/verificar-faturamento' },
      );
    }
    if (input.assinado) {
      pdfkitAddPlaceholder({
        pdf,
        pdfBuffer: Buffer.alloc(0),
        reason: 'Demonstrativo de faturamento',
        contactInfo: '',
        name: input.contadorNome ?? '',
        location: 'Brasil',
        signingTime: input.emitidoEm,
        signatureLength: 32768,
        subFilter: SUBFILTER_ETSI_CADES_DETACHED,
      });
    }
    pdf.end();
    return done;
  }
}
