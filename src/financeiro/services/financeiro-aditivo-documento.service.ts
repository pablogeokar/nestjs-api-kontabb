import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import PDFDocument from 'pdfkit';
import { resolve } from 'node:path';
import { DatabaseService } from '../../database/database.service';
import {
  financeiroContratos,
  financeiroContratosAditivos,
} from '../../database/schema';
import { competenciaNaVigencia, fromCents, toCents } from '../financeiro.utils';

type Aditivo = typeof financeiroContratosAditivos.$inferSelect;
const moeda = (valor: string) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    Number(valor),
  );
const dataCivil = (valor: string) => valor.split('-').reverse().join('/');

export function renderAditivoPdf(aditivo: Aditivo): Promise<Buffer> {
  const { cliente, contador, contrato, itens } = aditivo.posterior;
  if (
    !contador ||
    !contador.nome ||
    !contador.documento ||
    !contador.crc ||
    !cliente.razaoSocial ||
    (cliente.tipoPessoa === 'PJ' && !cliente.representante) ||
    aditivo.localAssinatura === 'Não informado'
  )
    throw new BadRequestException(
      'Complete as partes e o local da assinatura antes de registrar a alteração para gerar o aditivo.',
    );
  return new Promise((resolvePdf, reject) => {
    const pdf = new PDFDocument({
      size: 'A4',
      margins: { top: 120, bottom: 70, left: 40, right: 40 },
      bufferPages: true,
      info: {
        Title: `Aditivo contratual nº ${aditivo.numero}`,
        Author: 'Kontabb',
      },
    });
    const chunks: Buffer[] = [];
    pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
    pdf.on('end', () => resolvePdf(Buffer.concat(chunks)));
    pdf.on('error', reject);
    let fonteAtual = 'Helvetica';
    const cabecalho = () => {
      pdf.rect(0, 0, 595.28, 9).fill('#1456A3');
      pdf.image(
        resolve(__dirname, '../../assets/financeiro/kontabb-logo.png'),
        40,
        20,
        { fit: [160, 65] },
      );
      pdf
        .font('Helvetica-Bold')
        .fontSize(14)
        .fillColor('#0C2D56')
        .text(`ADITIVO CONTRATUAL Nº ${aditivo.numero}`, 240, 46, {
          width: 315,
          align: 'right',
          lineBreak: false,
        });
      pdf.moveTo(40, 103).lineTo(555, 103).strokeColor('#DCE5EF').stroke();
      pdf.y = 120;
      pdf.x = 40;
      pdf.font(fonteAtual).fontSize(10).fillColor('#172B4D');
    };
    pdf.on('pageAdded', cabecalho);
    const texto = (valor: string, bold = false) => {
      fonteAtual = bold ? 'Helvetica-Bold' : 'Helvetica';
      pdf
        .font(bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(10)
        .fillColor('#172B4D')
        .text(valor, {
          width: 515,
          align: 'left',
          paragraphGap: 7,
          lineGap: 2,
        });
      pdf.moveDown(0.35);
    };
    try {
      cabecalho();
      texto('MINUTA PARA ASSINATURA DAS PARTES', true);
      texto(
        `CONTRATADO(A): ${contador.nome}, CPF/CNPJ ${contador.documento}, CRC ${contador.crc}, endereço: ${contador.endereco}.`,
      );
      texto(
        `CONTRATANTE: ${cliente.razaoSocial}, CPF/CNPJ ${cliente.cnpj}, endereço: ${cliente.endereco}${cliente.representante ? `, representada por ${cliente.representante}` : ''}.`,
      );
      texto(
        `As partes ajustam o presente aditivo ao contrato de prestação de serviços com início em ${contrato.dataInicio ? dataCivil(contrato.dataInicio) : 'data indicada no instrumento original'}, nos seguintes termos:`,
      );
      texto('1. OBJETO E VIGÊNCIA', true);
      texto(
        `${aditivo.tipo === 'REAJUSTE_ANUAL' ? `Reajuste anual de ${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 }).format(Number(aditivo.percentual))}% sobre os honorários dos serviços contratados` : 'Alteração dos parâmetros contratuais'}, com efeitos a partir da competência ${aditivo.competenciaInicio}. Motivo: ${aditivo.motivo}`,
      );
      texto('2. ALTERAÇÕES PACTUADAS', true);
      for (const linha of aditivo.alteracoes) texto(linha);
      texto(
        `Mensalidade base anterior: ${moeda(aditivo.anterior.contrato.valorMensalidade)}. Nova mensalidade base: ${moeda(contrato.valorMensalidade)}.`,
        true,
      );
      const total = itens.reduce(
        (valor, item) =>
          item.ativo &&
          competenciaNaVigencia(
            aditivo.competenciaInicio,
            item.competenciaInicio,
            item.competenciaFim,
          )
            ? valor +
              toCents(item.valor) * (item.natureza === 'CREDITO' ? -1 : 1)
            : valor,
        toCents(contrato.valorMensalidade),
      );
      texto(
        `Total a pagar no vencimento de cada ciclo ${moeda(fromCents(Math.max(0, total)))}`,
        true,
      );
      texto('3. RATIFICAÇÃO', true);
      texto(
        'Permanecem ratificadas as demais cláusulas e condições do contrato original que não foram expressamente modificadas por este aditivo. O registro no sistema não substitui a assinatura das partes.',
      );
      if (pdf.y > 620) pdf.addPage();
      texto(
        `${aditivo.localAssinatura}, ${dataCivil(aditivo.dataAssinatura)}.`,
        true,
      );
      pdf.moveDown(2);
      texto('________________________________________________________');
      texto(`${contador.nome} - CONTRATADO(A)`);
      pdf.moveDown(1.5);
      texto('________________________________________________________');
      texto(`${cliente.representante || cliente.razaoSocial} - CONTRATANTE`);
      const range = pdf.bufferedPageRange();
      for (let page = range.start; page < range.start + range.count; page++) {
        pdf.switchToPage(page);
        pdf.page.margins.bottom = 0;
        pdf
          .font('Helvetica')
          .fontSize(8)
          .fillColor('#60728B')
          .text(
            `Kontabb | Aditivo nº ${aditivo.numero} | Página ${page + 1} de ${range.count}`,
            40,
            790,
            { width: 515, align: 'center', lineBreak: false },
          );
      }
      pdf.end();
    } catch (error) {
      pdf.destroy();
      reject(
        error instanceof Error
          ? error
          : new Error('Não foi possível gerar o aditivo.'),
      );
    }
  });
}

@Injectable()
export class FinanceiroAditivoDocumentoService {
  constructor(private readonly database: DatabaseService) {}
  async gerarPdf(clienteId: string, aditivoId: string) {
    const [row] = await this.database.db
      .select({ aditivo: financeiroContratosAditivos })
      .from(financeiroContratosAditivos)
      .innerJoin(
        financeiroContratos,
        eq(financeiroContratos.id, financeiroContratosAditivos.contratoId),
      )
      .where(
        and(
          eq(financeiroContratos.clienteId, clienteId),
          eq(financeiroContratosAditivos.id, aditivoId),
        ),
      )
      .limit(1);
    if (!row)
      throw new NotFoundException('Aditivo não encontrado para este cliente.');
    return renderAditivoPdf(row.aditivo);
  }
}
