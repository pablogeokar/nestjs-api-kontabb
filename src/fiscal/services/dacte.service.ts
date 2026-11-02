import { Injectable } from '@nestjs/common';
import bwipjs from 'bwip-js';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import {
  formatAccessKey,
  parseDacteXml,
  type DacteData,
  type DacteParty,
  type DacteValueItem,
} from './dacte.parser';

type PdfDocument = InstanceType<typeof PDFDocument>;

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 18;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const BOTTOM_LIMIT = PAGE_HEIGHT - 28;

@Injectable()
export class DacteService {
  private readonly pageAssets = new WeakMap<
    PdfDocument,
    {
      barcode: Buffer;
      qrCode: Buffer | null;
    }
  >();

  async generatePdf(xml: string): Promise<Buffer> {
    const data = parseDacteXml(xml);
    const [barcode, qrCode] = await Promise.all([
      bwipjs.toBuffer({
        bcid: 'code128',
        text: data.chaveAcesso,
        scale: 2,
        height: 8,
        includetext: false,
      }),
      data.qrCode
        ? QRCode.toBuffer(data.qrCode, {
            type: 'png',
            width: 150,
            margin: 4,
            errorCorrectionLevel: 'M',
          })
        : Promise.resolve(null),
    ]);

    const document = new PDFDocument({
      size: 'A4',
      margin: MARGIN,
      bufferPages: true,
      info: {
        Title: `DACTE ${data.numero}`,
        Subject: 'Documento Auxiliar do Conhecimento de Transporte Eletrônico',
        Author: data.emitente.nome,
        Creator: 'Kontabb',
      },
    });
    const chunks: Buffer[] = [];
    this.pageAssets.set(document, { barcode, qrCode });
    document.on('data', (chunk: Buffer) => chunks.push(chunk));
    const completed = new Promise<Buffer>((resolve, reject) => {
      document.once('end', () => resolve(Buffer.concat(chunks)));
      document.once('error', reject);
    });

    try {
      this.render(document, data, barcode, qrCode);
      this.addPageNumbers(document);
      document.end();
      return await completed;
    } catch (error: unknown) {
      document.end();
      throw error;
    }
  }

  private render(
    document: PdfDocument,
    data: DacteData,
    barcode: Buffer,
    qrCode: Buffer | null,
  ) {
    this.drawWatermark(document, data);
    let y = this.drawReceipt(document, data, MARGIN);
    y = this.drawHeader(document, data, barcode, qrCode, y + 4);
    y = this.drawProtocol(document, data, y + 3);
    y = this.drawGeneralData(document, data, y + 3);
    y = this.drawParties(document, data, y + 3);
    y = this.drawCargo(document, data, y + 3);
    y = this.drawFinancialData(document, data, y + 3);
    y = this.drawValueItems(
      document,
      data,
      'INFORMAÇÕES DO MODAL',
      data.modalInfo,
      y + 3,
    );
    y = this.drawDocuments(document, data, y + 3);
    y = this.drawObservations(document, data, y + 3);
    this.drawReservedAreas(document, data, y + 3);
  }

  private drawReceipt(document: PdfDocument, data: DacteData, y: number) {
    const height = 48;
    document.rect(MARGIN, y, CONTENT_WIDTH, height).stroke();
    document
      .font('Helvetica-Bold')
      .fontSize(5.5)
      .text(
        'DECLARO QUE RECEBI OS VOLUMES DESTE CONHECIMENTO EM PERFEITO ESTADO E DOU POR CUMPRIDO O PRESENTE CONTRATO DE TRANSPORTE',
        MARGIN + 4,
        y + 4,
        { width: CONTENT_WIDTH - 125, align: 'center' },
      );
    document
      .moveTo(MARGIN + CONTENT_WIDTH - 120, y)
      .lineTo(MARGIN + CONTENT_WIDTH - 120, y + height)
      .stroke();
    document
      .moveTo(MARGIN, y + 17)
      .lineTo(MARGIN + CONTENT_WIDTH - 120, y + 17)
      .moveTo(MARGIN + 145, y + 17)
      .lineTo(MARGIN + 145, y + height)
      .moveTo(MARGIN + 300, y + 17)
      .lineTo(MARGIN + 300, y + height)
      .stroke();
    document
      .font('Helvetica')
      .fontSize(5)
      .text('NOME / RG DO RECEBEDOR', MARGIN + 4, y + 21)
      .text('ASSINATURA DO RECEBEDOR', MARGIN + 149, y + 21)
      .text('DATA / HORA DO RECEBIMENTO', MARGIN + 304, y + 21);
    document
      .font('Helvetica-Bold')
      .fontSize(11)
      .text('CT-e', MARGIN + CONTENT_WIDTH - 116, y + 5, {
        width: 112,
        align: 'center',
      });
    document
      .fontSize(7)
      .text(
        `Nº ${data.numero || '-'}  ·  SÉRIE ${data.serie || '-'}`,
        MARGIN + CONTENT_WIDTH - 116,
        y + 23,
        {
          width: 112,
          align: 'center',
        },
      );
    return y + height;
  }

  private drawHeader(
    document: PdfDocument,
    data: DacteData,
    barcode: Buffer,
    qrCode: Buffer | null,
    y: number,
  ) {
    const height = 138;
    const emitenteWidth = 205;
    const qrWidth = 92;
    const centerWidth = CONTENT_WIDTH - emitenteWidth - qrWidth;
    document.rect(MARGIN, y, CONTENT_WIDTH, height).stroke();
    document
      .moveTo(MARGIN + emitenteWidth, y)
      .lineTo(MARGIN + emitenteWidth, y + height)
      .moveTo(MARGIN + emitenteWidth + centerWidth, y)
      .lineTo(MARGIN + emitenteWidth + centerWidth, y + height)
      .stroke();

    document
      .font('Helvetica-Bold')
      .fontSize(9)
      .text(data.emitente.nome || '-', MARGIN + 7, y + 10, {
        width: emitenteWidth - 14,
        align: 'center',
        height: 25,
        ellipsis: true,
      });
    document
      .font('Helvetica')
      .fontSize(6.2)
      .text(this.partyText(data.emitente), MARGIN + 8, y + 42, {
        width: emitenteWidth - 16,
        height: 88,
        lineGap: 2,
      });

    const centerX = MARGIN + emitenteWidth;
    document
      .font('Helvetica-Bold')
      .fontSize(18)
      .text('DACTE', centerX + 5, y + 7, {
        width: centerWidth - 10,
        align: 'center',
      });
    document
      .font('Helvetica')
      .fontSize(5.4)
      .text(
        'DOCUMENTO AUXILIAR DO CONHECIMENTO DE TRANSPORTE ELETRÔNICO',
        centerX + 8,
        y + 29,
        { width: centerWidth - 16, align: 'center' },
      );
    this.drawField(
      document,
      centerX + 3,
      y + 44,
      70,
      26,
      'MODELO',
      data.modelo,
    );
    this.drawField(document, centerX + 73, y + 44, 56, 26, 'SÉRIE', data.serie);
    this.drawField(
      document,
      centerX + 129,
      y + 44,
      82,
      26,
      'NÚMERO',
      data.numero,
    );
    this.drawField(
      document,
      centerX + 211,
      y + 44,
      centerWidth - 214,
      26,
      'MODAL',
      data.modal,
      6,
    );
    document.image(barcode, centerX + 12, y + 76, {
      width: centerWidth - 24,
      height: 28,
    });
    document
      .font('Helvetica')
      .fontSize(5)
      .text('CHAVE DE ACESSO', centerX + 5, y + 108, {
        width: centerWidth - 10,
        align: 'center',
      });
    document
      .font('Courier-Bold')
      .fontSize(6.3)
      .text(formatAccessKey(data.chaveAcesso), centerX + 4, y + 117, {
        width: centerWidth - 8,
        align: 'center',
      });
    document
      .font('Helvetica')
      .fontSize(4.8)
      .text('Consulta em www.cte.fazenda.gov.br', centerX + 5, y + 130, {
        width: centerWidth - 10,
        align: 'center',
      });

    const qrX = centerX + centerWidth;
    if (qrCode) {
      document.image(qrCode, qrX + 9, y + 12, { width: qrWidth - 18 });
    }
    document
      .font('Helvetica-Bold')
      .fontSize(5.5)
      .text(data.status, qrX + 4, y + 108, {
        width: qrWidth - 8,
        align: 'center',
      });
    document
      .font('Helvetica')
      .fontSize(5)
      .text(data.ambiente, qrX + 4, y + 120, {
        width: qrWidth - 8,
        align: 'center',
      });
    return y + height;
  }

  private drawProtocol(document: PdfDocument, data: DacteData, y: number) {
    this.drawField(
      document,
      MARGIN,
      y,
      CONTENT_WIDTH,
      28,
      'PROTOCOLO DE AUTORIZAÇÃO DE USO',
      `${data.protocolo || '-'}  ·  ${data.protocoloData || '-'}`,
      8,
    );
    return y + 28;
  }

  private drawGeneralData(document: PdfDocument, data: DacteData, y: number) {
    const rowHeight = 31;
    const widths = [105, 130, CONTENT_WIDTH - 355, 120];
    let x = MARGIN;
    const rowOne = [
      ['TIPO DO CT-e', data.tipoCte],
      ['TIPO DO SERVIÇO', data.tipoServico],
      [
        'CFOP / NATUREZA DA OPERAÇÃO',
        `${data.cfop} · ${data.naturezaOperacao}`,
      ],
      ['DATA E HORA DE EMISSÃO', data.emissao],
    ];
    rowOne.forEach(([label, value], index) => {
      this.drawField(
        document,
        x,
        y,
        widths[index],
        rowHeight,
        label,
        value,
        6.4,
      );
      x += widths[index];
    });
    this.drawField(
      document,
      MARGIN,
      y + rowHeight,
      CONTENT_WIDTH / 2,
      rowHeight,
      'INÍCIO DA PRESTAÇÃO',
      data.origem,
      7,
    );
    this.drawField(
      document,
      MARGIN + CONTENT_WIDTH / 2,
      y + rowHeight,
      CONTENT_WIDTH / 2,
      rowHeight,
      'TÉRMINO DA PRESTAÇÃO',
      data.destino,
      7,
    );
    return y + rowHeight * 2;
  }

  private drawParties(document: PdfDocument, data: DacteData, y: number) {
    const height = 56;
    const half = CONTENT_WIDTH / 2;
    this.drawParty(
      document,
      MARGIN,
      y,
      half,
      height,
      'REMETENTE',
      data.remetente,
    );
    this.drawParty(
      document,
      MARGIN + half,
      y,
      half,
      height,
      'DESTINATÁRIO',
      data.destinatario,
    );
    y += height;
    if (data.expedidor.nome || data.recebedor.nome) {
      this.drawParty(
        document,
        MARGIN,
        y,
        half,
        height,
        'EXPEDIDOR',
        data.expedidor,
      );
      this.drawParty(
        document,
        MARGIN + half,
        y,
        half,
        height,
        'RECEBEDOR',
        data.recebedor,
      );
      y += height;
    }
    this.drawParty(
      document,
      MARGIN,
      y,
      CONTENT_WIDTH,
      39,
      'TOMADOR DO SERVIÇO',
      data.tomador,
    );
    return y + 39;
  }

  private drawCargo(document: PdfDocument, data: DacteData, y: number) {
    const height = 32;
    const columns: Array<[string, string, number]> = [
      ['PRODUTO PREDOMINANTE', data.produtoPredominante, CONTENT_WIDTH * 0.42],
      [
        'OUTRAS CARACTERÍSTICAS',
        data.outrasCaracteristicas,
        CONTENT_WIDTH * 0.33,
      ],
      ['VALOR TOTAL DA CARGA', data.valorCarga, CONTENT_WIDTH * 0.25],
    ];
    let x = MARGIN;
    for (const [label, value, width] of columns) {
      this.drawField(document, x, y, width, height, label, value, 6.2);
      x += width;
    }
    const measures = data.quantidades.length
      ? data.quantidades
      : [{ label: 'QUANTIDADE / MEDIDA', value: '-' }];
    const measureWidth = CONTENT_WIDTH / Math.max(measures.length, 4);
    measures.forEach((item, index) =>
      this.drawField(
        document,
        MARGIN + index * measureWidth,
        y + height,
        measureWidth,
        25,
        item.label.toUpperCase(),
        item.value,
        7,
      ),
    );
    for (let index = measures.length; index < 4; index++) {
      document
        .rect(MARGIN + index * measureWidth, y + height, measureWidth, 25)
        .stroke();
    }
    return y + height + 25;
  }

  private drawFinancialData(document: PdfDocument, data: DacteData, y: number) {
    y = this.ensureSpace(document, data, y, 110);
    this.drawSectionTitle(
      document,
      MARGIN,
      y,
      CONTENT_WIDTH,
      'COMPONENTES DO VALOR DA PRESTAÇÃO DE SERVIÇO',
    );
    y += 16;
    const components = data.componentes.length
      ? data.componentes
      : [{ label: 'COMPONENTE', value: '-' }];
    for (let index = 0; index < components.length; index += 4) {
      y = this.ensureSpace(document, data, y, 28);
      const row = components.slice(index, index + 4);
      row.forEach((item, column) => {
        this.drawField(
          document,
          MARGIN + (column * CONTENT_WIDTH) / 4,
          y,
          CONTENT_WIDTH / 4,
          28,
          item.label.toUpperCase(),
          item.value,
          7,
        );
      });
      for (let column = row.length; column < 4; column++) {
        document
          .rect(MARGIN + (column * CONTENT_WIDTH) / 4, y, CONTENT_WIDTH / 4, 28)
          .stroke();
      }
      y += 28;
    }
    y = this.ensureSpace(document, data, y, 28);
    this.drawField(
      document,
      MARGIN,
      y,
      CONTENT_WIDTH / 2,
      28,
      'VALOR TOTAL DO SERVIÇO',
      data.valorTotalServico,
      8,
    );
    this.drawField(
      document,
      MARGIN + CONTENT_WIDTH / 2,
      y,
      CONTENT_WIDTH / 2,
      28,
      'VALOR A RECEBER',
      data.valorReceber,
      8,
    );
    y += 31;
    y = this.ensureSpace(document, data, y, 48);
    this.drawSectionTitle(
      document,
      MARGIN,
      y,
      CONTENT_WIDTH,
      'INFORMAÇÕES RELATIVAS AO IMPOSTO',
    );
    y += 16;
    const taxes = data.impostos.length
      ? data.impostos
      : [{ label: 'TRIBUTAÇÃO', value: '-' }];
    const width = CONTENT_WIDTH / Math.max(taxes.length, 5);
    taxes.forEach((item, index) =>
      this.drawField(
        document,
        MARGIN + index * width,
        y,
        width,
        29,
        item.label.toUpperCase(),
        item.value,
        7,
      ),
    );
    return y + 29;
  }

  private drawValueItems(
    document: PdfDocument,
    data: DacteData,
    title: string,
    items: DacteValueItem[],
    y: number,
  ) {
    if (items.length === 0) return y - 3;
    y = this.ensureSpace(document, data, y, 45);
    this.drawSectionTitle(
      document,
      MARGIN,
      y,
      CONTENT_WIDTH,
      `${title} - ${data.modal}`,
    );
    y += 16;
    for (let index = 0; index < items.length; index += 4) {
      y = this.ensureSpace(document, data, y, 29);
      const row = items.slice(index, index + 4);
      row.forEach((item, column) =>
        this.drawField(
          document,
          MARGIN + (column * CONTENT_WIDTH) / 4,
          y,
          CONTENT_WIDTH / 4,
          29,
          item.label.toUpperCase(),
          item.value,
          7,
        ),
      );
      for (let column = row.length; column < 4; column++) {
        document
          .rect(MARGIN + (column * CONTENT_WIDTH) / 4, y, CONTENT_WIDTH / 4, 29)
          .stroke();
      }
      y += 29;
    }
    return y;
  }

  private drawDocuments(document: PdfDocument, data: DacteData, y: number) {
    if (data.documentosOriginarios.length === 0) return y - 3;
    const titleHeight = 16;
    const rowHeight = 12;
    let index = 0;

    while (index < data.documentosOriginarios.length) {
      y = this.ensureSpace(document, data, y, titleHeight + rowHeight);
      const availableRows = Math.max(
        1,
        Math.floor((BOTTOM_LIMIT - y - titleHeight) / rowHeight),
      );
      const rows = data.documentosOriginarios.slice(
        index,
        index + availableRows,
      );
      const height = titleHeight + rows.length * rowHeight;
      document.rect(MARGIN, y, CONTENT_WIDTH, height).stroke();
      this.drawSectionTitle(
        document,
        MARGIN,
        y,
        CONTENT_WIDTH,
        'DOCUMENTOS ORIGINÁRIOS',
      );
      rows.forEach((row, rowIndex) => {
        const rowY = y + titleHeight + rowIndex * rowHeight;
        if (rowIndex > 0) {
          document
            .moveTo(MARGIN, rowY)
            .lineTo(MARGIN + CONTENT_WIDTH, rowY)
            .stroke();
        }
        document
          .font('Courier')
          .fontSize(6)
          .text(row, MARGIN + 4, rowY + 3, {
            width: CONTENT_WIDTH - 8,
            height: rowHeight - 4,
            ellipsis: true,
          });
      });
      index += rows.length;
      y += height + 3;
    }
    return y - 3;
  }

  private drawObservations(document: PdfDocument, data: DacteData, y: number) {
    const words = data.observacoes.join(' ').split(/\s+/).filter(Boolean);
    let cursor = 0;
    do {
      y = this.ensureSpace(document, data, y, 54);
      const available = BOTTOM_LIMIT - y - 17;
      document.font('Helvetica').fontSize(6.2);
      let part = '';
      while (cursor < words.length) {
        const candidate = part ? `${part} ${words[cursor]}` : words[cursor];
        if (
          part &&
          document.heightOfString(candidate, { width: CONTENT_WIDTH - 8 }) >
            available - 8
        )
          break;
        part = candidate;
        cursor++;
      }
      const height = Math.max(
        38,
        Math.min(
          available + 16,
          document.heightOfString(part, { width: CONTENT_WIDTH - 8 }) + 24,
        ),
      );
      document.rect(MARGIN, y, CONTENT_WIDTH, height).stroke();
      this.drawSectionTitle(
        document,
        MARGIN,
        y,
        CONTENT_WIDTH,
        'OBSERVAÇÕES / INFORMAÇÕES COMPLEMENTARES',
      );
      document
        .font('Helvetica')
        .fontSize(6.2)
        .text(part, MARGIN + 4, y + 19, {
          width: CONTENT_WIDTH - 8,
          height: height - 22,
        });
      y += height + 3;
    } while (cursor < words.length);
    return y;
  }

  private drawReservedAreas(document: PdfDocument, data: DacteData, y: number) {
    y = this.ensureSpace(document, data, y, 43);
    const left = CONTENT_WIDTH * 0.65;
    const right = CONTENT_WIDTH - left;
    document.rect(MARGIN, y, left, 43).stroke();
    document.rect(MARGIN + left, y, right, 43).stroke();
    this.drawSectionTitle(
      document,
      MARGIN,
      y,
      left,
      'USO EXCLUSIVO DO EMISSOR DO CT-e',
    );
    this.drawSectionTitle(
      document,
      MARGIN + left,
      y,
      right,
      'RESERVADO AO FISCO',
    );
  }

  private drawParty(
    document: PdfDocument,
    x: number,
    y: number,
    width: number,
    height: number,
    title: string,
    party: DacteParty,
  ) {
    document.rect(x, y, width, height).stroke();
    this.drawSectionTitle(document, x, y, width, title);
    document
      .font('Helvetica-Bold')
      .fontSize(7.2)
      .text(party.nome || '-', x + 4, y + 18, {
        width: width - 8,
        height: 10,
        ellipsis: true,
      });
    document
      .font('Helvetica')
      .fontSize(6)
      .text(this.partyText(party), x + 4, y + 29, {
        width: width - 8,
        height: height - 31,
        ellipsis: true,
      });
  }

  private drawField(
    document: PdfDocument,
    x: number,
    y: number,
    width: number,
    height: number,
    label: string,
    value: string,
    valueSize = 7,
  ) {
    document.rect(x, y, width, height).stroke();
    document
      .font('Helvetica')
      .fontSize(4.7)
      .text(label, x + 3, y + 3, { width: width - 6, height: 7 });
    document
      .font('Helvetica-Bold')
      .fontSize(valueSize)
      .text(value || '-', x + 3, y + 12, {
        width: width - 6,
        height: height - 14,
        ellipsis: true,
      });
  }

  private drawSectionTitle(
    document: PdfDocument,
    x: number,
    y: number,
    width: number,
    title: string,
  ) {
    document.save().fillColor('#eeeeee').rect(x, y, width, 16).fill().restore();
    document
      .font('Helvetica-Bold')
      .fillColor('#000000')
      .fontSize(5.4)
      .text(title, x + 4, y + 5, { width: width - 8 });
    document
      .moveTo(x, y + 16)
      .lineTo(x + width, y + 16)
      .stroke();
  }

  private ensureSpace(
    document: PdfDocument,
    data: DacteData,
    y: number,
    requiredHeight: number,
  ) {
    if (y + requiredHeight <= BOTTOM_LIMIT) return y;
    document.addPage({ size: 'A4', margin: MARGIN });
    this.drawWatermark(document, data);
    const assets = this.pageAssets.get(document);
    if (!assets) throw new Error('Recursos do DACTE indisponíveis.');
    let nextY = this.drawHeader(
      document,
      data,
      assets.barcode,
      assets.qrCode,
      MARGIN + 13,
    );
    nextY = this.drawProtocol(document, data, nextY + 3);
    return this.drawGeneralData(document, data, nextY + 3) + 4;
  }

  private drawWatermark(document: PdfDocument, data: DacteData) {
    if (data.ambiente !== 'HOMOLOGAÇÃO') return;
    document.save();
    document
      .fillColor('#bbbbbb')
      .opacity(0.18)
      .font('Helvetica-Bold')
      .fontSize(31)
      .rotate(-35, { origin: [PAGE_WIDTH / 2, PAGE_HEIGHT / 2] })
      .text('SEM VALOR FISCAL · HOMOLOGAÇÃO', 55, PAGE_HEIGHT / 2 - 20, {
        width: PAGE_WIDTH - 110,
        align: 'center',
      });
    document.restore();
  }

  private addPageNumbers(document: PdfDocument) {
    const range = document.bufferedPageRange();
    for (let index = 0; index < range.count; index += 1) {
      document.switchToPage(range.start + index);
      document
        .font('Helvetica-Bold')
        .fontSize(6)
        .text(
          `FOLHA ${index + 1}/${range.count}`,
          MARGIN + CONTENT_WIDTH - 116,
          index === 0 ? MARGIN + 38 : MARGIN,
          { width: 112, align: 'center' },
        );
      document
        .font('Helvetica')
        .fontSize(5)
        .text(
          `Página ${index + 1} de ${range.count}`,
          MARGIN,
          PAGE_HEIGHT - MARGIN - 8,
          {
            width: CONTENT_WIDTH,
            height: 6,
            align: 'center',
            lineBreak: false,
          },
        );
    }
  }

  private partyText(party: DacteParty) {
    return [
      party.documento ? `CNPJ/CPF: ${party.documento}` : '',
      party.inscricaoEstadual ? `IE: ${party.inscricaoEstadual}` : '',
      party.endereco,
      party.municipioUf,
      party.cep ? `CEP: ${party.cep}` : '',
      party.telefone ? `FONE: ${party.telefone}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
  }
}
