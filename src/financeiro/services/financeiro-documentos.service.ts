import { Injectable, NotFoundException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import PDFDocument from 'pdfkit';
import { DatabaseService } from '../../database/database.service';
import { clientes } from '../../database/schema';
import { FinanceiroFaturasService } from './financeiro-faturas.service';

const BRAND = '#1456A3';
const DEEP = '#0C2D56';
const PALE = '#E6F0FA';
const INK = '#172B4D';
const MUTED = '#60728B';
const LINE = '#DCE5EF';
const PAGE_RIGHT = 555;
const LOGO = readFileSync(
  resolve(__dirname, '../../assets/financeiro/kontabb-logo.png'),
);

const money = (value: string | number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    Number(value),
  );
const date = (value: string) => {
  const [year, month, day] = value.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
};
const documentId = (value: string) =>
  /^[0-9A-Z]{12}[0-9]{2}$/.test(value)
    ? value.replace(
        /^([0-9A-Z]{2})([0-9A-Z]{3})([0-9A-Z]{3})([0-9A-Z]{4})([0-9]{2})$/,
        '$1.$2.$3/$4-$5',
      )
    : /^\d{11}$/.test(value)
      ? value.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
      : value;

function line(pdf: PDFKit.PDFDocument, y: number) {
  pdf
    .strokeColor(LINE)
    .lineWidth(0.7)
    .moveTo(40, y)
    .lineTo(PAGE_RIGHT, y)
    .stroke();
}

function header(
  pdf: PDFKit.PDFDocument,
  title: string,
  number: string,
  continuation = false,
) {
  pdf.rect(0, 0, 595.28, 10).fill(BRAND);
  pdf.image(LOGO, 40, 18, { fit: [168, 70] });
  pdf
    .font('Helvetica-Bold')
    .fontSize(16)
    .fillColor(DEEP)
    .text(title + (continuation ? '  ·  continuação' : ''), 250, 41, {
      width: 305,
      align: 'right',
    });
  pdf
    .font('Helvetica')
    .fontSize(9)
    .fillColor(MUTED)
    .text(`Fatura ${number}`, 250, 65, { width: 305, align: 'right' });
  line(pdf, 94);
}

function footer(pdf: PDFKit.PDFDocument) {
  line(pdf, 779);
  pdf
    .font('Helvetica')
    .fontSize(8)
    .fillColor(MUTED)
    .text(
      'Kontabb · Contabilidade Borges  |  Documento emitido eletronicamente',
      40,
      789,
      { width: 515, align: 'center' },
    );
}

function section(pdf: PDFKit.PDFDocument, label: string, y: number) {
  pdf
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor(BRAND)
    .text(label.toUpperCase(), 40, y);
  return y + 22;
}

function field(
  pdf: PDFKit.PDFDocument,
  label: string,
  value: string,
  x: number,
  y: number,
  width: number,
) {
  pdf
    .font('Helvetica')
    .fontSize(8)
    .fillColor(MUTED)
    .text(label.toUpperCase(), x, y, { width });
  pdf
    .font('Helvetica-Bold')
    .fontSize(10)
    .fillColor(INK)
    .text(value, x, y + 13, { width });
}

function newPage(pdf: PDFKit.PDFDocument, title: string, number: string) {
  pdf.addPage();
  header(pdf, title, number, true);
  footer(pdf);
  return 115;
}

function buildPdf(draw: (pdf: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({
      size: 'A4',
      margin: 0,
      autoFirstPage: true,
      info: {
        Author: 'Kontabb',
        Creator: 'Kontabb',
        Title: 'Documento financeiro',
      },
    });
    const chunks: Buffer[] = [];
    pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
    try {
      draw(pdf);
      pdf.end();
    } catch (error) {
      reject(error instanceof Error ? error : new Error('Falha ao gerar PDF.'));
      pdf.destroy();
    }
  });
}

@Injectable()
export class FinanceiroDocumentosService {
  constructor(
    private readonly database: DatabaseService,
    private readonly faturas: FinanceiroFaturasService,
  ) {}

  private async obter(id: string, escopoClienteId?: string) {
    const fatura = await this.faturas.getById(id, escopoClienteId);
    const [cliente] = await this.database.db
      .select({ cnpj: clientes.cnpj })
      .from(clientes)
      .where(eq(clientes.id, fatura.clienteId))
      .limit(1);
    if (!cliente) throw new NotFoundException('Fatura não encontrada.');
    return { fatura, cliente };
  }

  async faturaPdf(id: string, escopoClienteId?: string) {
    const { fatura, cliente } = await this.obter(id, escopoClienteId);
    return buildPdf((pdf) => {
      header(pdf, 'FATURA DE COBRANÇA', fatura.numero);
      footer(pdf);
      let y = section(pdf, 'Dados da cobrança', 114);
      field(pdf, 'Número', fatura.numero, 40, y, 165);
      field(pdf, 'Competência', fatura.competencia, 225, y, 140);
      field(pdf, 'Emissão', date(fatura.dataEmissao), 400, y, 155);
      y += 49;
      field(pdf, 'Cliente', fatura.clienteRazaoSocial, 40, y, 340);
      field(pdf, 'CNPJ / CPF', documentId(cliente.cnpj), 400, y, 155);
      y += 56;
      pdf.roundedRect(40, y, 515, 66, 8).fill(PALE);
      field(pdf, 'Vencimento', date(fatura.dataVencimento), 55, y + 12, 150);
      field(
        pdf,
        'Valor da fatura',
        money(fatura.valorLiquido),
        230,
        y + 12,
        160,
      );
      field(
        pdf,
        'Saldo em aberto',
        money(fatura.saldoAberto),
        410,
        y + 12,
        130,
      );
      y += 89;
      y = section(pdf, 'Serviços e ajustes', y);
      pdf.rect(40, y, 515, 25).fill(DEEP);
      pdf
        .font('Helvetica-Bold')
        .fontSize(8)
        .fillColor('#FFFFFF')
        .text('DESCRIÇÃO', 51, y + 8, { width: 375 })
        .text('VALOR', 440, y + 8, { width: 103, align: 'right' });
      y += 25;
      for (const item of fatura.lancamentos) {
        const detail = item.tipoNome
          ? `${item.tipoNome}  ·  ${item.descricao}`
          : item.descricao;
        const h = Math.max(
          32,
          pdf
            .font('Helvetica')
            .fontSize(9)
            .heightOfString(detail, { width: 365 }) + 17,
        );
        if (y + h > 688) {
          y = newPage(pdf, 'FATURA DE COBRANÇA', fatura.numero);
        }
        pdf
          .font('Helvetica')
          .fontSize(9)
          .fillColor(INK)
          .text(detail, 51, y + 8, { width: 365 });
        pdf
          .font('Helvetica-Bold')
          .fillColor(item.natureza === 'CREDITO' ? BRAND : INK)
          .text(
            `${item.natureza === 'CREDITO' ? '- ' : ''}${money(item.valor)}`,
            430,
            y + 8,
            { width: 113, align: 'right' },
          );
        line(pdf, y + h);
        y += h;
      }
      if (y + 117 > 690) y = newPage(pdf, 'FATURA DE COBRANÇA', fatura.numero);
      y += 16;
      field(pdf, 'Valor bruto', money(fatura.valorBruto), 40, y, 150);
      field(pdf, 'Descontos', money(fatura.valorDescontos), 215, y, 150);
      field(pdf, 'Total', money(fatura.valorLiquido), 395, y, 160);
      y += 49;
      if (fatura.status === 'CANCELADA') {
        pdf
          .font('Helvetica-Bold')
          .fontSize(11)
          .fillColor('#9F1239')
          .text('FATURA CANCELADA', 40, y);
        y += 24;
      } else if (Number(fatura.saldoAberto) === 0) {
        pdf
          .font('Helvetica-Bold')
          .fontSize(11)
          .fillColor(BRAND)
          .text('FATURA QUITADA', 40, y);
        y += 24;
      }
      if (fatura.observacoes) {
        if (y + 65 > 735) y = newPage(pdf, 'FATURA DE COBRANÇA', fatura.numero);
        y = section(pdf, 'Observações', y);
        pdf
          .font('Helvetica')
          .fontSize(9)
          .fillColor(INK)
          .text(fatura.observacoes, 40, y, { width: 515 });
        y = pdf.y + 15;
      }
      if (fatura.status !== 'CANCELADA' && Number(fatura.saldoAberto) > 0) {
        const methods = [
          fatura.pixCopiaECola && ['PIX copia e cola', fatura.pixCopiaECola],
          fatura.linhaDigitavel && ['Linha digitável', fatura.linhaDigitavel],
        ].filter(Boolean) as string[][];
        for (const [label, value] of methods) {
          const h =
            pdf
              .font('Helvetica')
              .fontSize(8)
              .heightOfString(value, { width: 515 }) + 39;
          if (y + h > 735)
            y = newPage(pdf, 'FATURA DE COBRANÇA', fatura.numero);
          y = section(pdf, label, y);
          pdf
            .font('Helvetica')
            .fontSize(8)
            .fillColor(INK)
            .text(value, 40, y, { width: 515 });
          y = pdf.y + 15;
        }
      }
    });
  }

  async reciboPdf(faturaId: string, baixaId: string, escopoClienteId?: string) {
    const { fatura, cliente } = await this.obter(faturaId, escopoClienteId);
    const baixa = fatura.baixas.find((item) => item.id === baixaId);
    if (!baixa || ('estornado' in baixa && baixa.estornado)) {
      throw new NotFoundException('Recibo não encontrado.');
    }
    return buildPdf((pdf) => {
      header(pdf, 'RECIBO DE PAGAMENTO', fatura.numero);
      footer(pdf);
      let y = section(pdf, 'Identificação', 117);
      field(pdf, 'Recibo', baixa.id.toUpperCase(), 40, y, 515);
      y += 48;
      field(pdf, 'Recebido de', fatura.clienteRazaoSocial, 40, y, 340);
      field(pdf, 'CNPJ / CPF', documentId(cliente.cnpj), 400, y, 155);
      y += 55;
      pdf.roundedRect(40, y, 515, 78, 8).fill(PALE);
      field(pdf, 'Valor recebido', money(baixa.valorRecebido), 55, y + 15, 200);
      field(
        pdf,
        'Data do pagamento',
        date(baixa.dataPagamento),
        280,
        y + 15,
        140,
      );
      field(
        pdf,
        'Forma',
        (
          {
            PIX: 'PIX',
            BOLETO: 'Boleto',
            TRANSFERENCIA: 'Transferência',
            DINHEIRO: 'Dinheiro',
            CARTAO: 'Cartão',
            OUTROS: 'Outros',
          } as Record<string, string>
        )[baixa.formaPagamento] ?? baixa.formaPagamento,
        440,
        y + 15,
        100,
      );
      y += 103;
      pdf
        .font('Helvetica')
        .fontSize(10)
        .fillColor(INK)
        .text(
          `Recebemos de ${fatura.clienteRazaoSocial} a importância de ${money(baixa.valorRecebido)}, referente à fatura ${fatura.numero}, competência ${fatura.competencia}.`,
          40,
          y,
          { width: 515, lineGap: 4 },
        );
      y = pdf.y + 31;
      y = section(pdf, 'Composição do pagamento', y);
      field(pdf, 'Multa', money(baixa.valorMulta), 40, y, 120);
      field(pdf, 'Juros', money(baixa.valorJuros), 175, y, 120);
      field(pdf, 'Desconto', money(baixa.valorDesconto), 310, y, 120);
      y += 54;
      line(pdf, y);
      y += 19;
      field(pdf, 'Fatura de referência', fatura.numero, 40, y, 230);
      field(pdf, 'Vencimento', date(fatura.dataVencimento), 310, y, 175);
      y += 64;
      pdf
        .font('Helvetica')
        .fontSize(9)
        .fillColor(MUTED)
        .text(
          'Este recibo comprova exclusivamente o pagamento identificado acima. Em caso de pagamento parcial, a fatura pode permanecer com saldo em aberto.',
          40,
          y,
          { width: 515, lineGap: 3 },
        );
    });
  }
}
