import { Injectable } from '@nestjs/common';
import bwipjs from 'bwip-js';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import {
  parseDanfeXml,
  type DanfeData,
  type DanfeParty,
} from './danfe-nfe.parser';
import { formatAccessKey } from './dacte.parser';

type Pdf = PDFKit.PDFDocument;

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN = 18;
const CONTENT = A4_WIDTH - MARGIN * 2;
const BOTTOM = A4_HEIGHT - MARGIN - 20;
const RECEIPT_WIDTH = 226.77; // 80 mm
const RECEIPT_MARGIN = 10;
const ITEM_COLUMNS: Array<[string, number]> = [
  ['codigo', 36],
  ['descricao', 120],
  ['ncm', 34],
  ['cst', 24],
  ['cfop', 27],
  ['unidade', 20],
  ['quantidade', 32],
  ['valorUnitario', 44],
  ['valorTotal', 42],
  ['baseIcms', 41],
  ['valorIcms', 41],
  ['valorIpi', 35],
  ['aliqIcms', 35],
  ['aliqIpi', 28],
];

function money(value: string): string {
  const amount = Number(value || 0);
  return Number.isFinite(amount)
    ? amount.toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : '0,00';
}

function qty(value: string): string {
  const amount = Number(value || 0);
  return Number.isFinite(amount)
    ? amount.toLocaleString('pt-BR', { maximumFractionDigits: 4 })
    : value;
}

function taxId(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 14) {
    return digits.replace(
      /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
      '$1.$2.$3/$4-$5',
    );
  }
  if (digits.length === 11) {
    return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  }
  return value;
}

function paymentName(code: string, description: string): string {
  if (description) return description;
  const names: Record<string, string> = {
    '01': 'Dinheiro',
    '02': 'Cheque',
    '03': 'Cartão de crédito',
    '04': 'Cartão de débito',
    '05': 'Crédito loja',
    '10': 'Vale alimentação',
    '11': 'Vale refeição',
    '15': 'Boleto bancário',
    '17': 'PIX',
    '18': 'Transferência',
    '90': 'Sem pagamento',
    '99': 'Outros',
  };
  return names[code] || code || 'Pagamento';
}

function date(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

function partyLines(value: DanfeParty): string {
  return [
    value.documento ? `CNPJ/CPF: ${taxId(value.documento)}` : '',
    value.endereco,
    value.municipioUf,
    value.cep ? `CEP: ${value.cep}` : '',
    value.inscricaoEstadual ? `IE: ${value.inscricaoEstadual}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function field(
  pdf: Pdf,
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
  value: string,
) {
  pdf.lineWidth(0.5).rect(x, y, width, height).stroke('#111827');
  pdf
    .font('Times-Bold')
    .fontSize(5.8)
    .fillColor('#111827')
    .text(label, x + 3, y + 2, { width: width - 6, height: 8 });
  pdf
    .font('Times-Roman')
    .fontSize(9.5)
    .fillColor('#111827')
    .text(value || '-', x + 3, y + 11, {
      width: width - 6,
      height: height - 13,
      ellipsis: true,
    });
}

function title(pdf: Pdf, label: string, x: number, y: number, width: number) {
  pdf
    .font('Times-Bold')
    .fontSize(7.5)
    .fillColor('#111827')
    .text(label, x, y, { width });
  pdf
    .moveTo(x, y + 10)
    .lineTo(x + width, y + 10)
    .lineWidth(0.7)
    .stroke('#111827');
}

@Injectable()
export class DanfeNfeService {
  async generatePdf(xml: string): Promise<Buffer> {
    const data = parseDanfeXml(xml);
    const barcode = await bwipjs.toBuffer({
      bcid: 'code128',
      text: data.chaveAcesso,
      scale: 2,
      height: 8,
      includetext: false,
    });
    if (data.modelo === '65' && !data.qrCode) {
      throw new Error('QR Code ausente no XML da NFC-e.');
    }
    const qr =
      data.modelo === '65'
        ? await QRCode.toBuffer(data.qrCode, {
            type: 'png',
            width: 175,
            margin: 4,
            errorCorrectionLevel: 'M',
          })
        : null;
    const receiptHeight = data.modelo === '65' ? this.measureReceipt(data) : 0;
    const pdf = new PDFDocument({
      size:
        data.modelo === '55'
          ? 'A4'
          : [RECEIPT_WIDTH, Math.min(Math.max(receiptHeight, 300), 14_000)],
      margin: data.modelo === '55' ? MARGIN : RECEIPT_MARGIN,
      bufferPages: true,
      autoFirstPage: true,
      info: {
        Title: `${data.modelo === '55' ? 'DANFE' : 'DANFE NFC-e'} ${data.numero}`,
        Subject: 'Documento auxiliar da nota fiscal eletrônica',
        Author: data.emitente.nome,
        Creator: 'Kontabb',
      },
    });
    const chunks: Buffer[] = [];
    pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
    const completed = new Promise<Buffer>((resolve, reject) => {
      pdf.once('end', () => resolve(Buffer.concat(chunks)));
      pdf.once('error', reject);
    });
    try {
      if (data.modelo === '55') this.renderDanfe(pdf, data, barcode);
      else this.renderReceipt(pdf, data, barcode, qr as Buffer);
      this.addPageNumbers(pdf, data.modelo);
      pdf.end();
      return await completed;
    } catch (error) {
      pdf.end();
      void completed.catch(() => undefined);
      throw error;
    }
  }

  private renderDanfe(pdf: Pdf, data: DanfeData, barcode: Buffer) {
    let y = MARGIN;
    this.watermark(pdf, data, A4_WIDTH, A4_HEIGHT);
    pdf.rect(MARGIN, y, CONTENT - 120, 44).stroke('#111827');
    pdf
      .moveTo(MARGIN, y + 22)
      .lineTo(MARGIN + CONTENT - 120, y + 22)
      .moveTo(MARGIN + 130, y + 22)
      .lineTo(MARGIN + 130, y + 44)
      .stroke('#111827');
    pdf
      .font('Times-Bold')
      .fontSize(6.2)
      .text(
        `RECEBEMOS DE ${data.emitente.nome.toUpperCase()} OS PRODUTOS / SERVIÇOS CONSTANTES DA NOTA FISCAL INDICADA AO LADO`,
        MARGIN + 4,
        y + 4,
        { width: CONTENT - 128, height: 15, ellipsis: true },
      );
    pdf
      .font('Times-Roman')
      .fontSize(6)
      .text('DATA DE RECEBIMENTO', MARGIN + 4, y + 27);
    pdf.text('IDENTIFICAÇÃO E ASSINATURA DO RECEBEDOR', MARGIN + 134, y + 27);
    field(
      pdf,
      MARGIN + CONTENT - 120,
      y,
      120,
      44,
      'NF-e',
      `Nº ${data.numero}  SÉRIE ${data.serie}`,
    );
    y += 49;
    pdf
      .dash(3, { space: 3 })
      .moveTo(MARGIN, y + 2)
      .lineTo(MARGIN + CONTENT, y + 2)
      .stroke()
      .undash();
    y += 6;

    pdf.lineWidth(0.6).rect(MARGIN, y, CONTENT, 113).stroke('#111827');
    pdf
      .moveTo(MARGIN + 185, y)
      .lineTo(MARGIN + 185, y + 113)
      .stroke();
    pdf
      .moveTo(MARGIN + 300, y)
      .lineTo(MARGIN + 300, y + 113)
      .stroke();
    pdf
      .font('Times-Bold')
      .fontSize(12)
      .text(data.emitente.nome.toUpperCase(), MARGIN + 6, y + 7, {
        width: 173,
        height: 28,
        ellipsis: true,
        align: 'center',
      });
    pdf
      .font('Times-Roman')
      .fontSize(7.5)
      .text(partyLines(data.emitente), MARGIN + 6, y + 38, {
        width: 173,
        height: 67,
        ellipsis: true,
        align: 'center',
      });
    pdf
      .font('Times-Bold')
      .fontSize(16)
      .text('DANFE', MARGIN + 188, y + 8, { width: 109, align: 'center' });
    pdf
      .font('Times-Roman')
      .fontSize(6.5)
      .text(
        'DOCUMENTO AUXILIAR DA NOTA FISCAL ELETRÔNICA',
        MARGIN + 188,
        y + 30,
        { width: 109, align: 'center' },
      );
    pdf
      .font('Times-Bold')
      .fontSize(7.5)
      .text(`0 - ENTRADA / 1 - SAÍDA`, MARGIN + 188, y + 51, {
        width: 109,
        align: 'center',
      });
    pdf.rect(MARGIN + 231, y + 62, 22, 17).stroke('#111827');
    pdf
      .font('Times-Bold')
      .fontSize(11)
      .text(data.tipoOperacao, MARGIN + 231, y + 64, {
        width: 22,
        align: 'center',
      });
    pdf
      .fontSize(8.5)
      .text(`Nº ${data.numero}`, MARGIN + 188, y + 81, {
        width: 109,
        align: 'center',
      })
      .text(`SÉRIE ${data.serie}`, MARGIN + 188, y + 92, {
        width: 109,
        align: 'center',
      });
    pdf.image(barcode, MARGIN + 312, y + 6, { fit: [CONTENT - 324, 38] });
    pdf
      .moveTo(MARGIN + 300, y + 48)
      .lineTo(MARGIN + CONTENT, y + 48)
      .moveTo(MARGIN + 300, y + 74)
      .lineTo(MARGIN + CONTENT, y + 74)
      .stroke('#111827');
    pdf
      .font('Courier-Bold')
      .fontSize(7.2)
      .text(formatAccessKey(data.chaveAcesso), MARGIN + 304, y + 60, {
        width: CONTENT - 308,
        align: 'center',
      });
    pdf
      .font('Times-Bold')
      .fontSize(6)
      .text('CHAVE DE ACESSO', MARGIN + 304, y + 50);
    pdf
      .font('Times-Roman')
      .fontSize(6)
      .text(
        'Consulta de autenticidade: www.nfe.fazenda.gov.br/portal',
        MARGIN + 304,
        y + 77,
        { width: CONTENT - 308, align: 'center' },
      );
    pdf
      .font('Times-Bold')
      .fontSize(6.5)
      .text(
        `PROTOCOLO DE AUTORIZAÇÃO: ${data.protocolo || 'SEM PROTOCOLO'} ${date(data.protocoloData)}`,
        MARGIN + 304,
        y + 96,
        { width: CONTENT - 308, height: 15, ellipsis: true },
      );
    y += 117;

    field(
      pdf,
      MARGIN,
      y,
      CONTENT * 0.7,
      29,
      'NATUREZA DA OPERAÇÃO',
      data.naturezaOperacao,
    );
    field(
      pdf,
      MARGIN + CONTENT * 0.7,
      y,
      CONTENT * 0.3,
      29,
      'DATA DE EMISSÃO',
      date(data.emissao),
    );
    y += 33;
    this.fieldRow(pdf, y, 27, [
      ['INSCRIÇÃO ESTADUAL', data.emitente.inscricaoEstadual, 1],
      ['INSCRIÇÃO ESTADUAL DO SUBST. TRIBUT.', data.inscricaoEstadualSt, 1],
      ['CNPJ / CPF', taxId(data.emitente.documento), 1],
    ]);
    y += 31;
    title(pdf, 'DESTINATÁRIO / REMETENTE', MARGIN, y, CONTENT);
    y += 14;
    field(
      pdf,
      MARGIN,
      y,
      CONTENT * 0.66,
      32,
      'NOME / RAZÃO SOCIAL',
      data.destinatario.nome,
    );
    field(
      pdf,
      MARGIN + CONTENT * 0.66,
      y,
      CONTENT * 0.2,
      32,
      'CNPJ / CPF',
      taxId(data.destinatario.documento),
    );
    field(
      pdf,
      MARGIN + CONTENT * 0.86,
      y,
      CONTENT * 0.14,
      32,
      'DATA DE EMISSÃO',
      date(data.emissao),
    );
    y += 32;
    field(
      pdf,
      MARGIN,
      y,
      CONTENT * 0.54,
      32,
      'ENDEREÇO',
      data.destinatario.endereco,
    );
    field(
      pdf,
      MARGIN + CONTENT * 0.54,
      y,
      CONTENT * 0.19,
      32,
      'BAIRRO / DISTRITO',
      data.destinatario.bairro,
    );
    field(
      pdf,
      MARGIN + CONTENT * 0.73,
      y,
      CONTENT * 0.12,
      32,
      'CEP',
      data.destinatario.cep,
    );
    field(
      pdf,
      MARGIN + CONTENT * 0.85,
      y,
      CONTENT * 0.15,
      32,
      'DATA DE SAÍDA',
      date(data.saida),
    );
    y += 32;
    this.fieldRow(pdf, y, 28, [
      ['MUNICÍPIO', data.destinatario.municipio, 4],
      ['FONE / FAX', data.destinatario.telefone, 2],
      ['UF', data.destinatario.uf, 1],
      ['INSCRIÇÃO ESTADUAL', data.destinatario.inscricaoEstadual, 2],
      ['HORA DE SAÍDA', data.saida.match(/T(\d\d:\d\d)/)?.[1] ?? '', 1],
    ]);
    y += 32;

    if (data.duplicatas.length || data.fatura) {
      y = this.ensureSpace(pdf, data, barcode, y, 43);
      title(pdf, 'FATURA / DUPLICATAS', MARGIN, y, CONTENT);
      y += 14;
      const duplicates = data.duplicatas.length
        ? data.duplicatas.map(
            (dup) =>
              `${dup.numero || '-'}  ${date(dup.vencimento)}  R$ ${money(dup.valor)}`,
          )
        : [data.fatura];
      for (let index = 0; index < duplicates.length; index += 3) {
        if (y + 27 > BOTTOM) {
          y = this.ensureSpace(pdf, data, barcode, y, 27);
          title(pdf, 'FATURA / DUPLICATAS (CONTINUAÇÃO)', MARGIN, y, CONTENT);
          y += 14;
        }
        const row: Array<[string, string, number]> = duplicates
          .slice(index, index + 3)
          .map((value) => ['DUPLICATA / VENCIMENTO / VALOR', value, 1]);
        while (row.length < 3) row.push(['', '', 1]);
        this.fieldRow(pdf, y, 27, row);
        y += 27;
      }
      y += 4;
    }

    y = this.ensureSpace(pdf, data, barcode, y, 169);
    title(pdf, 'CÁLCULO DO IMPOSTO', MARGIN, y, CONTENT);
    y += 14;
    this.fieldRow(pdf, y, 27, [
      ['BASE DE CÁLCULO DO ICMS', money(data.totais.baseIcms), 1],
      ['VALOR DO ICMS', money(data.totais.valorIcms), 1],
      ['BASE DE CÁLCULO ICMS ST', money(data.totais.baseIcmsSt), 1],
      ['VALOR DO ICMS ST', money(data.totais.valorIcmsSt), 1],
      ['VALOR TOTAL DOS PRODUTOS', money(data.totais.totalProdutos), 1],
    ]);
    this.fieldRow(pdf, y + 27, 27, [
      ['VALOR DO FRETE', money(data.totais.frete), 1],
      ['VALOR DO SEGURO', money(data.totais.seguro), 1],
      ['DESCONTO', money(data.totais.desconto), 1],
      ['OUTRAS DESPESAS', money(data.totais.outrasDespesas), 1],
      ['VALOR DO IPI', money(data.totais.ipi), 1],
      ['VALOR TOTAL DA NOTA', money(data.totais.valorNota), 1],
    ]);
    y += 64;
    title(pdf, 'TRANSPORTADOR / VOLUMES TRANSPORTADOS', MARGIN, y, CONTENT);
    y += 14;
    this.fieldRow(pdf, y, 26, [
      ['NOME / RAZÃO SOCIAL', data.transportadora.nome, 5],
      ['FRETE POR CONTA', data.modalidadeFrete, 2],
      ['CÓDIGO ANTT', data.transporte.rntrc, 2],
      ['PLACA DO VEÍCULO', data.transporte.placa, 2],
      ['UF', data.transporte.ufVeiculo, 1],
      ['CNPJ / CPF', taxId(data.transportadora.documento), 3],
    ]);
    y += 26;
    this.fieldRow(pdf, y, 26, [
      ['ENDEREÇO', data.transportadora.endereco, 5],
      ['MUNICÍPIO', data.transportadora.municipio, 3],
      ['UF', data.transportadora.uf, 1],
      ['INSCRIÇÃO ESTADUAL', data.transportadora.inscricaoEstadual, 3],
    ]);
    y += 26;
    this.fieldRow(pdf, y, 26, [
      ['QUANTIDADE', data.volumes.quantidade, 1],
      ['ESPÉCIE', data.volumes.especie, 2],
      ['MARCA', data.volumes.marca, 2],
      ['NÚMERO', data.volumes.numero, 2],
      ['PESO BRUTO', data.volumes.pesoBruto, 2],
      ['PESO LÍQUIDO', data.volumes.pesoLiquido, 2],
    ]);
    y += 30;

    y = this.drawItems(pdf, data, barcode, y);
    if (data.issqn) {
      y = this.ensureSpace(pdf, data, barcode, y, 55);
      title(pdf, 'CÁLCULO DO ISSQN', MARGIN, y, CONTENT);
      y += 14;
      field(
        pdf,
        MARGIN,
        y,
        CONTENT / 3,
        30,
        'SERVIÇOS',
        money(data.issqn.servicos),
      );
      field(
        pdf,
        MARGIN + CONTENT / 3,
        y,
        CONTENT / 3,
        30,
        'BASE',
        money(data.issqn.base),
      );
      field(
        pdf,
        MARGIN + (2 * CONTENT) / 3,
        y,
        CONTENT / 3,
        30,
        'ISS',
        money(data.issqn.valor),
      );
      y += 34;
    }
    y = this.drawAdditional(pdf, data, barcode, y);
    if (data.ambiente === 'HOMOLOGAÇÃO') {
      pdf
        .font('Helvetica-Bold')
        .fontSize(8)
        .fillColor('#991b1b')
        .text(
          'DOCUMENTO EMITIDO EM AMBIENTE DE HOMOLOGAÇÃO',
          MARGIN,
          A4_HEIGHT - 50,
          { width: CONTENT, align: 'center' },
        );
    }
  }

  private fieldRow(
    pdf: Pdf,
    y: number,
    height: number,
    cells: Array<[string, string, number]>,
  ) {
    const units = cells.reduce((total, cell) => total + cell[2], 0);
    let x = MARGIN;
    cells.forEach(([label, value, size], index) => {
      const width =
        index === cells.length - 1
          ? MARGIN + CONTENT - x
          : (CONTENT * size) / units;
      field(pdf, x, y, width, height, label, value);
      x += width;
    });
  }

  private drawItems(
    pdf: Pdf,
    data: DanfeData,
    barcode: Buffer,
    initialY: number,
  ): number {
    let y = this.ensureSpace(pdf, data, barcode, initialY, 45);
    const header = () => {
      title(pdf, 'DADOS DOS PRODUTOS / SERVIÇOS', MARGIN, y, CONTENT);
      y += 14;
      pdf.rect(MARGIN, y, CONTENT, 22).stroke('#111827');
      pdf.fillColor('#111827').font('Times-Bold').fontSize(5.8);
      this.itemColumns(pdf, y + 5, {
        codigo: 'CÓD. PROD.',
        descricao: 'DESCRIÇÃO DOS PRODUTOS / SERVIÇOS',
        ncm: 'NCM/SH',
        cfop: 'CFOP',
        unidade: 'UN.',
        quantidade: 'QTD',
        valorUnitario: 'V. UNIT.',
        valorTotal: 'V. TOTAL',
        cst: 'CST',
        baseIcms: 'BC ICMS',
        valorIcms: 'ICMS',
        aliqIcms: 'ALIQ. ICMS',
        valorIpi: 'VALOR IPI',
        aliqIpi: 'ALIQ. IPI',
      });
      y += 22;
    };
    header();
    for (const item of data.itens) {
      const descriptionHeight = pdf
        .font('Times-Roman')
        .fontSize(6.5)
        .heightOfString(item.descricao || '-', { width: 116 });
      const rowHeight = Math.max(23, Math.min(descriptionHeight + 8, 80));
      if (y + rowHeight > BOTTOM) {
        pdf.addPage();
        this.watermark(pdf, data, A4_WIDTH, A4_HEIGHT);
        y = this.continuation(pdf, data, barcode);
        header();
      }
      pdf.rect(MARGIN, y, CONTENT, rowHeight).stroke('#111827');
      pdf.font('Times-Roman').fontSize(6.5).fillColor('#111827');
      this.itemColumns(
        pdf,
        y + 4,
        {
          codigo: item.codigo,
          descricao: item.descricao,
          ncm: item.ncm,
          cfop: item.cfop,
          unidade: item.unidade,
          quantidade: qty(item.quantidade),
          valorUnitario: money(item.valorUnitario),
          valorTotal: money(item.valorTotal),
          cst: item.cst || item.csosn,
          baseIcms: money(item.baseIcms),
          valorIcms: money(item.valorIcms),
          aliqIcms: item.aliqIcms ? `${qty(item.aliqIcms)}%` : '-',
          valorIpi: money(item.valorIpi),
          aliqIpi: item.aliqIpi ? `${qty(item.aliqIpi)}%` : '-',
        },
        rowHeight - 6,
      );
      y += rowHeight;
    }
    const target = BOTTOM - (data.issqn ? 150 : 90);
    if (y < target && pdf.bufferedPageRange().count === 1) {
      pdf.rect(MARGIN, y, CONTENT, target - y).stroke('#111827');
      let x = MARGIN;
      for (const [, width] of ITEM_COLUMNS.slice(0, -1)) {
        x += width;
        pdf.lineWidth(0.25).moveTo(x, y).lineTo(x, target).stroke('#111827');
      }
      y = target;
    }
    return y + 5;
  }

  private itemColumns(
    pdf: Pdf,
    y: number,
    values: Record<string, string>,
    height = 14,
  ) {
    let x = MARGIN + 2;
    for (const [key, width] of ITEM_COLUMNS) {
      pdf.text(values[key] || '-', x, y, {
        width: width - 3,
        height,
        ellipsis: true,
        align: key === 'descricao' ? 'left' : 'center',
      });
      if (key !== 'aliqIpi') {
        pdf
          .lineWidth(0.25)
          .moveTo(x + width - 2, y - 4)
          .lineTo(x + width - 2, y + height + 1)
          .stroke('#111827');
      }
      x += width;
    }
  }

  private drawAdditional(
    pdf: Pdf,
    data: DanfeData,
    barcode: Buffer,
    initialY: number,
  ): number {
    const info = [
      data.informacoesComplementares,
      data.informacoesFisco ? `FISCO: ${data.informacoesFisco}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    const leftWidth = CONTENT * 0.67;
    let y = this.ensureSpace(pdf, data, barcode, initialY, 85);
    const words = info.split(/\s+/).filter(Boolean);
    let cursor = 0;
    do {
      if (y + 85 > BOTTOM) y = this.ensureSpace(pdf, data, barcode, y, 85);
      title(pdf, 'DADOS ADICIONAIS', MARGIN, y, CONTENT);
      y += 14;
      const available = Math.max(65, BOTTOM - y);
      pdf.font('Times-Roman').fontSize(7);
      let part = '';
      while (cursor < words.length) {
        const candidate = part ? `${part} ${words[cursor]}` : words[cursor];
        if (
          part &&
          pdf.heightOfString(candidate, { width: leftWidth - 8 }) >
            available - 20
        )
          break;
        part = candidate;
        cursor++;
      }
      const height = Math.max(
        65,
        Math.min(
          available,
          pdf.heightOfString(part || ' ', { width: leftWidth - 8 }) + 22,
        ),
      );
      pdf.rect(MARGIN, y, leftWidth, height).stroke('#111827');
      pdf
        .rect(MARGIN + leftWidth, y, CONTENT - leftWidth, height)
        .stroke('#111827');
      pdf
        .font('Times-Bold')
        .fontSize(6)
        .text('INFORMAÇÕES COMPLEMENTARES', MARGIN + 4, y + 3)
        .text('RESERVADO AO FISCO', MARGIN + leftWidth + 4, y + 3);
      pdf
        .font('Times-Roman')
        .fontSize(7)
        .text(part, MARGIN + 4, y + 15, {
          width: leftWidth - 8,
          height: height - 18,
        });
      y += height + 3;
      if (cursor < words.length)
        y = this.ensureSpace(pdf, data, barcode, y, 85);
    } while (cursor < words.length);
    return y;
  }

  private ensureSpace(
    pdf: Pdf,
    data: DanfeData,
    barcode: Buffer,
    y: number,
    need: number,
  ): number {
    if (y + need <= BOTTOM) return y;
    pdf.addPage();
    this.watermark(pdf, data, A4_WIDTH, A4_HEIGHT);
    return this.continuation(pdf, data, barcode);
  }

  private continuation(pdf: Pdf, data: DanfeData, barcode: Buffer): number {
    const y = MARGIN;
    pdf.lineWidth(0.6).rect(MARGIN, y, CONTENT, 101).stroke('#111827');
    pdf
      .moveTo(MARGIN + 185, y)
      .lineTo(MARGIN + 185, y + 101)
      .moveTo(MARGIN + 300, y)
      .lineTo(MARGIN + 300, y + 101)
      .stroke();
    pdf
      .font('Times-Bold')
      .fontSize(10)
      .text(data.emitente.nome.toUpperCase(), MARGIN + 5, y + 7, {
        width: 175,
        height: 24,
        ellipsis: true,
        align: 'center',
      });
    pdf
      .font('Times-Roman')
      .fontSize(7)
      .text(partyLines(data.emitente), MARGIN + 5, y + 33, {
        width: 175,
        height: 62,
        ellipsis: true,
        align: 'center',
      });
    pdf
      .font('Times-Bold')
      .fontSize(15)
      .text('DANFE', MARGIN + 188, y + 6, { width: 109, align: 'center' });
    pdf
      .font('Times-Roman')
      .fontSize(6)
      .text(
        'DOCUMENTO AUXILIAR DA NOTA FISCAL ELETRÔNICA',
        MARGIN + 188,
        y + 28,
        { width: 109, align: 'center' },
      );
    pdf
      .font('Times-Bold')
      .fontSize(9)
      .text(`Nº ${data.numero}`, MARGIN + 188, y + 53, {
        width: 109,
        align: 'center',
      })
      .text(`SÉRIE ${data.serie}`, MARGIN + 188, y + 66, {
        width: 109,
        align: 'center',
      });
    pdf.image(barcode, MARGIN + 312, y + 7, { fit: [CONTENT - 324, 36] });
    pdf
      .moveTo(MARGIN + 300, y + 49)
      .lineTo(MARGIN + CONTENT, y + 49)
      .stroke();
    pdf
      .font('Times-Bold')
      .fontSize(6)
      .text('CHAVE DE ACESSO', MARGIN + 304, y + 52);
    pdf
      .font('Courier-Bold')
      .fontSize(7.2)
      .text(formatAccessKey(data.chaveAcesso), MARGIN + 304, y + 65, {
        width: CONTENT - 308,
        align: 'center',
      });
    pdf
      .font('Times-Roman')
      .fontSize(7)
      .text(`PROTOCOLO: ${data.protocolo || '-'}`, MARGIN + 304, y + 84, {
        width: CONTENT - 308,
      });
    this.fieldRow(pdf, y + 101, 27, [
      ['NATUREZA DA OPERAÇÃO', data.naturezaOperacao, 2],
      ['INSCRIÇÃO ESTADUAL', data.emitente.inscricaoEstadual, 1],
      ['CNPJ / CPF', taxId(data.emitente.documento), 1],
    ]);
    return y + 133;
  }

  private measureReceipt(data: DanfeData): number {
    // Espaços reservados por bloco; o PDF final mantém a altura do cupom.
    const itemLines = data.itens.reduce(
      (sum, item) => sum + Math.max(1, Math.ceil(item.descricao.length / 35)),
      0,
    );
    const extra = Math.ceil(
      (data.informacoesComplementares.length + data.informacoesFisco.length) /
        38,
    );
    return (
      525 +
      data.itens.length * 17 +
      itemLines * 10 +
      data.pagamentos.length * 14 +
      extra * 10
    );
  }

  private renderReceipt(
    pdf: Pdf,
    data: DanfeData,
    barcode: Buffer,
    qr: Buffer,
  ) {
    const width = RECEIPT_WIDTH - 2 * RECEIPT_MARGIN;
    let y = RECEIPT_MARGIN;
    const ensure = (need: number) => {
      if (y + need <= pdf.page.height - RECEIPT_MARGIN) return;
      pdf.addPage();
      y = RECEIPT_MARGIN;
      pdf
        .font('Helvetica-Bold')
        .fontSize(7)
        .fillColor('#111827')
        .text(`NFC-e Nº ${data.numero} - CONTINUAÇÃO`, RECEIPT_MARGIN, y, {
          width,
          align: 'center',
        });
      y += 18;
    };
    const centered = (value: string, size: number, bold = false) => {
      pdf
        .font(bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(size)
        .fillColor('#111827');
      const height = pdf.heightOfString(value, { width, align: 'center' });
      ensure(height + 3);
      pdf.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
      pdf.text(value, RECEIPT_MARGIN, y, { width, align: 'center' });
      y += height + 3;
    };
    const divider = () => {
      ensure(5);
      pdf
        .moveTo(RECEIPT_MARGIN, y)
        .lineTo(RECEIPT_MARGIN + width, y)
        .lineWidth(0.5)
        .stroke('#64748b');
      y += 5;
    };
    const pair = (label: string, value: string, size = 7, bold = false) => {
      ensure(size + 7);
      pdf
        .font(bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(size)
        .text(label, RECEIPT_MARGIN, y, { width: width - 70 });
      pdf.text(value, RECEIPT_MARGIN + width - 70, y, {
        width: 70,
        align: 'right',
      });
      y += size + 7;
    };
    centered(data.emitente.nome, 9, true);
    centered(`CNPJ/CPF: ${taxId(data.emitente.documento)}`, 7);
    centered(data.emitente.endereco, 7);
    centered(data.emitente.municipioUf, 7);
    divider();
    centered('DANFE NFC-e', 11, true);
    centered('Documento auxiliar da Nota Fiscal de Consumidor Eletrônica', 6);
    centered(
      `Nº ${data.numero}  Série ${data.serie}  ${date(data.emissao)}`,
      7,
    );
    divider();
    ensure(13);
    pdf
      .font('Helvetica-Bold')
      .fontSize(6.2)
      .text('CÓDIGO / DESCRIÇÃO', RECEIPT_MARGIN, y, { width: width - 65 })
      .text('VL. TOTAL', RECEIPT_MARGIN + width - 65, y, {
        width: 65,
        align: 'right',
      });
    y += 13;
    for (const [index, item] of data.itens.entries()) {
      pdf.font('Helvetica-Bold').fontSize(7);
      const description = `${index + 1}. ${item.codigo} ${item.descricao}`;
      const height = pdf.heightOfString(description, { width });
      ensure(height + 21);
      pdf.font('Helvetica-Bold').fontSize(7);
      pdf.text(description, RECEIPT_MARGIN, y, { width });
      y += height + 2;
      pdf
        .font('Helvetica')
        .fontSize(7)
        .text(
          `${qty(item.quantidade)} ${item.unidade} x ${money(item.valorUnitario)}`,
          RECEIPT_MARGIN + 4,
          y,
          { width: width - 65 },
        );
      pdf
        .font('Helvetica-Bold')
        .fontSize(7)
        .text(money(item.valorTotal), RECEIPT_MARGIN + width - 62, y, {
          width: 62,
          align: 'right',
        });
      y += 17;
    }
    divider();
    pair('Qtde. total de itens', String(data.itens.length));
    pair('Valor total R$', money(data.totais.totalProdutos));
    if (Number(data.totais.desconto) > 0) {
      pair('Desconto R$', money(data.totais.desconto));
    }
    pair('VALOR A PAGAR R$', money(data.totais.valorNota), 10, true);
    divider();
    ensure(13);
    pdf
      .font('Helvetica-Bold')
      .fontSize(6.5)
      .text('FORMA DE PAGAMENTO', RECEIPT_MARGIN, y, { width: width - 70 })
      .text('VALOR PAGO R$', RECEIPT_MARGIN + width - 70, y, {
        width: 70,
        align: 'right',
      });
    y += 13;
    for (const payment of data.pagamentos) {
      pair(paymentName(payment.tipo, payment.descricao), money(payment.valor));
    }
    if (data.troco) {
      pair('Troco R$', money(data.troco));
    }
    divider();
    if (data.destinatario.documento || data.destinatario.nome) {
      centered(
        `CONSUMIDOR: ${data.destinatario.nome || 'Não identificado'} ${taxId(data.destinatario.documento)}`,
        7,
      );
    }
    centered('Consulte pela chave de acesso em', 7);
    centered(data.urlChave || '-', 6);
    centered(formatAccessKey(data.chaveAcesso), 7, true);
    ensure(34);
    pdf.image(barcode, RECEIPT_MARGIN + 7, y, { fit: [width - 14, 30] });
    y += 34;
    centered(`Protocolo: ${data.protocolo || 'SEM PROTOCOLO'}`, 7);
    if (data.protocoloData) centered(date(data.protocoloData), 7);
    ensure(145);
    pdf.image(qr, RECEIPT_MARGIN + (width - 140) / 2, y, { width: 140 });
    y += 145;
    if (data.ambiente === 'HOMOLOGAÇÃO') {
      centered('EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO', 8, true);
      centered('SEM VALOR FISCAL', 8, true);
    }
    if (data.informacoesComplementares) {
      divider();
      centered(data.informacoesComplementares, 6);
    }
    if (data.informacoesFisco) centered(data.informacoesFisco, 6);
    if (y > pdf.page.height - RECEIPT_MARGIN) {
      throw new Error('Cupom excedeu a altura calculada.');
    }
  }

  private watermark(pdf: Pdf, data: DanfeData, width: number, height: number) {
    if (data.ambiente !== 'HOMOLOGAÇÃO') return;
    pdf
      .save()
      .fillColor('#cbd5e1')
      .opacity(0.35)
      .font('Helvetica-Bold')
      .fontSize(48)
      .rotate(-35, { origin: [width / 2, height / 2] })
      .text('HOMOLOGAÇÃO', 35, height / 2 - 40, {
        width: width - 70,
        align: 'center',
      })
      .restore();
  }

  private addPageNumbers(pdf: Pdf, modelo: '55' | '65') {
    if (modelo !== '55') return;
    const pages = pdf.bufferedPageRange();
    for (let index = pages.start; index < pages.start + pages.count; index++) {
      pdf.switchToPage(index);
      pdf
        .font('Times-Bold')
        .fontSize(6.5)
        .fillColor('#111827')
        .text(
          `FOLHA ${index + 1}/${pages.count}`,
          MARGIN + 185,
          index === pages.start ? MARGIN + 55 + 104 : MARGIN + 81,
          {
            width: 115,
            align: 'center',
          },
        );
    }
  }
}
