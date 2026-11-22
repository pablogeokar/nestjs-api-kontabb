import { Injectable } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { pdfkitAddPlaceholder } from '@signpdf/placeholder-pdfkit';
import { SUBFILTER_ETSI_CADES_DETACHED } from '@signpdf/utils';
import type { FaturamentoMesSnapshot } from '../../database/schema';
import {
  ROTULO_TIPO,
  centavos,
  colunasAtivas,
  formatarCentavos,
  formatarData,
  formatarDataHora,
  formatarDocumentoFiscal,
  mesDetalhado,
  rotuloCompetencia,
  rotuloPeriodo,
  totaisPeriodo,
  valorDoTipo,
  type TipoReceita,
} from './faturamento-relatorio';

const LOGO = readFileSync(
  resolve(__dirname, '../../assets/financeiro/kontabb-logo.png'),
);

export const URL_VERIFICACAO = 'https://kontabb.com.br/verificar-faturamento';
export const TITULO_DOCUMENTO = 'Relação de faturamento';

// Paleta e medidas. A4 em pontos; margem lateral de 44 pt.
const NAVY = '#0F2F57';
const AZUL = '#123F70';
const INK = '#1B2B3F';
const MUTED = '#5C6E83';
const FAINT = '#8A99AB';
const LINE = '#C9D5E3';
const LINE_SOFT = '#E3EAF3';
const ZEBRA = '#F6F9FC';
const TINT = '#E8F0F9';
const PAGE_W = 595.28;
const LEFT = 44;
const RIGHT = 551;
const WIDTH = RIGHT - LEFT;
const BODY_BOTTOM = 746;
const FOOTER_Y = 758;
const CONTINUATION_TOP = 84;

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

const CRITERIOS: Record<TipoReceita, string> = {
  MERCADORIAS:
    'Mercadorias: NF-e (modelo 55) e NFC-e (modelo 65) com CFOP de venda.',
  SERVICOS: 'Serviços: NFS-e emitidas pela empresa.',
  TRANSPORTES:
    'Transportes: CT-e de prestação de serviço de transporte (CFOP 5.351 a 5.357, 5.360, 6.351 a 6.357 e 6.360).',
};

@Injectable()
export class FaturamentoDocumentoService {
  async render(input: FaturamentoPdfInput): Promise<Buffer> {
    const urlConferencia = `${URL_VERIFICACAO}?codigo=${encodeURIComponent(input.codigo)}`;
    const qr = await QRCode.toBuffer(urlConferencia, {
      type: 'png',
      width: 240,
      margin: 1,
      errorCorrectionLevel: 'M',
    });
    const colunas = colunasAtivas(input.meses);
    const totais = totaisPeriodo(input.meses);
    const documento = formatarDocumentoFiscal(input.documento);
    const periodo = rotuloPeriodo(input.inicio, input.fim);

    const pdf = new PDFDocument({
      size: 'A4',
      margins: { top: 40, bottom: 20, left: LEFT, right: PAGE_W - RIGHT },
      bufferPages: true,
      info: {
        Title: `${TITULO_DOCUMENTO} ${input.numero}`,
        Author: 'KONTABB',
        Subject: `Receita bruta de ${input.nome}, ${periodo}`,
        Keywords: input.codigo,
      },
    });
    const chunks: Buffer[] = [];
    pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<Buffer>((resolveBuffer, reject) => {
      pdf.on('end', () => resolveBuffer(Buffer.concat(chunks)));
      pdf.on('error', reject);
    });

    let y = 0;

    const topBar = () => {
      pdf.rect(0, 0, PAGE_W, 7).fill(NAVY);
    };

    /** Cabeçalho completo da primeira página. */
    const headerCompleto = () => {
      topBar();
      pdf.image(LOGO, LEFT, 24, { fit: [126, 46] });
      pdf
        .fillColor(FAINT)
        .font('Helvetica-Bold')
        .fontSize(6.5)
        .text('DOCUMENTO Nº', 330, 28, {
          width: 221,
          align: 'right',
          characterSpacing: 0.8,
        });
      pdf
        .fillColor(NAVY)
        .font('Helvetica-Bold')
        .fontSize(12)
        .text(input.numero, 330, 39, { width: 221, align: 'right' });
      pdf
        .fillColor(MUTED)
        .font('Helvetica')
        .fontSize(7.5)
        .text(`Emitido em ${formatarDataHora(input.emitidoEm)}`, 330, 56, {
          width: 221,
          align: 'right',
        });
      pdf
        .moveTo(LEFT, 82)
        .lineTo(RIGHT, 82)
        .lineWidth(0.8)
        .strokeColor(LINE)
        .stroke();
      y = 98;
    };

    /** Cabeçalho resumido das páginas seguintes: cada página identifica o documento e a empresa. */
    const headerContinuacao = () => {
      topBar();
      pdf.image(LOGO, LEFT, 20, { fit: [88, 32] });
      pdf
        .fillColor(NAVY)
        .font('Helvetica-Bold')
        .fontSize(8.5)
        .text(`${TITULO_DOCUMENTO.toUpperCase()} · ${input.numero}`, 250, 24, {
          width: 301,
          align: 'right',
        });
      pdf
        .fillColor(MUTED)
        .font('Helvetica')
        .fontSize(7.5)
        .text(`${input.nome} · ${documento}`, 250, 38, {
          width: 301,
          align: 'right',
          height: 10,
          ellipsis: true,
        });
      pdf
        .moveTo(LEFT, 62)
        .lineTo(RIGHT, 62)
        .lineWidth(0.8)
        .strokeColor(LINE)
        .stroke();
      y = CONTINUATION_TOP;
    };

    const novaPagina = () => {
      pdf.addPage();
      headerContinuacao();
    };

    /** Garante `altura` livre no corpo da página; abre outra página quando não cabe. */
    const garantir = (altura: number) => {
      if (y + altura > BODY_BOTTOM) {
        novaPagina();
        return true;
      }
      return false;
    };

    const secao = (titulo: string, lateral?: string) => {
      pdf.rect(LEFT, y + 0.5, 3, 9.5).fill(NAVY);
      pdf
        .fillColor(NAVY)
        .font('Helvetica-Bold')
        .fontSize(8)
        .text(titulo, LEFT + 10, y + 1.5, { characterSpacing: 0.9 });
      if (lateral) {
        pdf
          .fillColor(MUTED)
          .font('Helvetica')
          .fontSize(7.5)
          .text(lateral, LEFT, y + 2, { width: WIDTH, align: 'right' });
      }
      y += 18;
    };

    // ── Página 1 ────────────────────────────────────────────────────────
    headerCompleto();

    pdf
      .fillColor(NAVY)
      .font('Helvetica-Bold')
      .fontSize(18)
      .text(TITULO_DOCUMENTO.toUpperCase(), LEFT, y, {
        width: WIDTH,
        align: 'center',
        characterSpacing: 1.6,
      });
    pdf
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(9)
      .text('Demonstrativo da receita bruta por competência', LEFT, y + 27, {
        width: WIDTH,
        align: 'center',
      });
    pdf.rect(PAGE_W / 2 - 24, y + 45, 48, 2).fill(NAVY);
    y += 54;

    // Identificação do contribuinte.
    const rotulo = (texto: string, x: number, yy: number) =>
      pdf
        .fillColor(FAINT)
        .font('Helvetica-Bold')
        .fontSize(6.5)
        .text(texto, x, yy, { characterSpacing: 0.7 });
    secao('IDENTIFICAÇÃO DO CONTRIBUINTE');
    const alturaIdentificacao = 80;
    pdf
      .rect(LEFT, y, WIDTH, alturaIdentificacao)
      .lineWidth(0.7)
      .strokeColor(LINE)
      .stroke();
    rotulo('NOME EMPRESARIAL', LEFT + 14, y + 11);
    pdf
      .fillColor(INK)
      .font('Helvetica-Bold')
      .fontSize(10.5)
      .text(input.nome, LEFT + 14, y + 22, {
        width: WIDTH - 28,
        height: 14,
        ellipsis: true,
      });
    pdf
      .moveTo(LEFT + 14, y + 44)
      .lineTo(RIGHT - 14, y + 44)
      .lineWidth(0.5)
      .strokeColor(LINE_SOFT)
      .stroke();
    const meio = LEFT + WIDTH / 2;
    rotulo('CNPJ / CPF', LEFT + 14, y + 53);
    pdf
      .fillColor(INK)
      .font('Helvetica')
      .fontSize(9.5)
      .text(documento, LEFT + 14, y + 63, { width: 220 });
    rotulo('PERÍODO DE APURAÇÃO', meio, y + 53);
    pdf
      .fillColor(INK)
      .font('Helvetica')
      .fontSize(9.5)
      .text(periodo, meio, y + 63, { width: 230 });
    y += alturaIdentificacao + 14;

    // Resumo do período.
    secao('RESUMO DO PERÍODO');
    const resumo = [
      {
        titulo: 'RECEITA BRUTA NO PERÍODO',
        valor: `R$ ${formatarCentavos(totais.total)}`,
        largura: 227,
        destaque: true,
      },
      {
        titulo: 'MÉDIA MENSAL',
        valor: `R$ ${formatarCentavos(totais.mediaMensal)}`,
        largura: 170,
        destaque: false,
      },
      {
        titulo: 'COMPETÊNCIAS',
        valor: String(totais.competencias),
        largura: 110,
        destaque: false,
      },
    ];
    let xCelula = LEFT;
    for (const celula of resumo) {
      pdf
        .rect(xCelula, y, celula.largura, 50)
        .fillAndStroke(celula.destaque ? TINT : '#FFFFFF', LINE);
      pdf
        .fillColor(celula.destaque ? AZUL : FAINT)
        .font('Helvetica-Bold')
        .fontSize(6.5)
        .text(celula.titulo, xCelula + 11, y + 11, {
          width: celula.largura - 16,
          characterSpacing: 0.7,
        });
      pdf
        .fillColor(celula.destaque ? NAVY : INK)
        .font('Helvetica-Bold')
        .fontSize(celula.destaque ? 14 : 11.5)
        .text(celula.valor, xCelula + 11, y + 26, {
          width: celula.largura - 16,
        });
      xCelula += celula.largura;
    }
    y += 50 + 16;

    // ── Tabela por competência ─────────────────────────────────────────
    // Composição por tipo só quando há mais de um tipo de receita e todos os
    // meses têm a composição; caso contrário, só a receita bruta do mês.
    // O relatório não indica a origem da base de cálculo de cada mês.
    const mostrarComposicao =
      colunas.length > 1 && input.meses.every(mesDetalhado);
    const colunasValor: TipoReceita[] = mostrarComposicao ? colunas : [];
    const larguraCompetencia = mostrarComposicao ? 96 : 200;
    const larguraTotal = mostrarComposicao ? 116 : WIDTH - 200;
    const larguraValor = mostrarComposicao
      ? (WIDTH - larguraCompetencia - larguraTotal) / colunasValor.length
      : 0;
    const xValor = (indice: number) =>
      LEFT + larguraCompetencia + indice * larguraValor;
    const xTotal = RIGHT - larguraTotal;
    const ALTURA_LINHA = 21;
    const cabecalhoTabela = () => {
      pdf.rect(LEFT, y, WIDTH, 24).fill(NAVY);
      pdf.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(7);
      const opcoes = { characterSpacing: 0.6 };
      pdf.text('COMPETÊNCIA', LEFT + 10, y + 9, { ...opcoes });
      colunasValor.forEach((coluna, indice) => {
        pdf.text(ROTULO_TIPO[coluna], xValor(indice), y + 9, {
          ...opcoes,
          width: larguraValor - 10,
          align: 'right',
        });
      });
      pdf.text('RECEITA BRUTA', xTotal, y + 9, {
        ...opcoes,
        width: larguraTotal - 10,
        align: 'right',
      });
      y += 24;
    };

    garantir(18 + 24 + ALTURA_LINHA * 2);
    secao(
      'RECEITA BRUTA POR COMPETÊNCIA',
      colunas.length === 1
        ? `Receita de ${ROTULO_TIPO[colunas[0]].toLowerCase()} · Valores em reais (R$)`
        : 'Valores em reais (R$)',
    );
    cabecalhoTabela();

    for (const [indice, mes] of input.meses.entries()) {
      if (y + ALTURA_LINHA > BODY_BOTTOM) {
        novaPagina();
        cabecalhoTabela();
      }
      if (indice % 2 === 0) pdf.rect(LEFT, y, WIDTH, ALTURA_LINHA).fill(ZEBRA);
      pdf
        .moveTo(LEFT, y + ALTURA_LINHA)
        .lineTo(RIGHT, y + ALTURA_LINHA)
        .lineWidth(0.4)
        .strokeColor(LINE_SOFT)
        .stroke();
      const yTexto = y + 6.5;
      const detalhado = mesDetalhado(mes);
      pdf
        .fillColor(INK)
        .font('Helvetica')
        .fontSize(8.5)
        .text(rotuloCompetencia(mes.competencia), LEFT + 10, yTexto);
      colunasValor.forEach((coluna, posicao) => {
        const valor = detalhado ? valorDoTipo(mes, coluna) : 0n;
        const texto =
          !detalhado || valor === 0n ? '—' : formatarCentavos(valor);
        pdf
          .fillColor(!detalhado || valor === 0n ? FAINT : INK)
          .text(texto, xValor(posicao), yTexto, {
            width: larguraValor - 10,
            align: 'right',
          });
      });
      pdf
        .fillColor(NAVY)
        .font('Helvetica-Bold')
        .text(formatarCentavos(centavos(mes.total)), xTotal, yTexto, {
          width: larguraTotal - 10,
          align: 'right',
        });
      y += ALTURA_LINHA;
    }

    // Linha de totais.
    if (y + 30 > BODY_BOTTOM) {
      novaPagina();
      cabecalhoTabela();
    }
    pdf.rect(LEFT, y, WIDTH, 28).fill(TINT);
    pdf
      .moveTo(LEFT, y)
      .lineTo(RIGHT, y)
      .lineWidth(1.2)
      .strokeColor(NAVY)
      .stroke();
    const yTotais = y + 9.5;
    pdf
      .fillColor(NAVY)
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .text('TOTAL DO PERÍODO', LEFT + 10, yTotais, { characterSpacing: 0.3 });
    colunasValor.forEach((coluna, posicao) => {
      const valor = totais.porTipo[coluna];
      pdf.text(formatarCentavos(valor), xValor(posicao), yTotais, {
        width: larguraValor - 10,
        align: 'right',
      });
    });
    pdf.fontSize(10).text(formatarCentavos(totais.total), xTotal, y + 8.5, {
      width: larguraTotal - 10,
      align: 'right',
    });
    y += 28;
    y += 14;

    // ── Critérios de apuração ──────────────────────────────────────────
    const criterios = [
      'Receita bruta por competência correspondente à base de cálculo utilizada na apuração dos tributos, conforme as informações registradas no sistema até a data de emissão deste documento.',
      ...colunas.map((tipo) => CRITERIOS[tipo]),
      'Documento de natureza informativa. Não substitui a escrituração fiscal e contábil nem os documentos fiscais originais.',
    ];
    pdf.font('Helvetica').fontSize(7.5);
    const alturasCriterios = criterios.map(
      (texto) =>
        pdf.heightOfString(texto, { width: WIDTH - 16, lineGap: 1.5 }) + 4,
    );
    garantir(18 + alturasCriterios.reduce((a, b) => a + b, 0));
    secao('CRITÉRIOS DE APURAÇÃO');
    criterios.forEach((texto, indice) => {
      pdf
        .fillColor(AZUL)
        .font('Helvetica-Bold')
        .fontSize(7.5)
        .text(`${indice + 1}.`, LEFT, y, { width: 14 });
      pdf
        .fillColor(MUTED)
        .font('Helvetica')
        .fontSize(7.5)
        .text(texto, LEFT + 16, y, { width: WIDTH - 16, lineGap: 1.5 });
      y += alturasCriterios[indice];
    });
    y += 6;

    // ── Responsável contábil e autenticidade ───────────────────────────
    const alturaBloco = 120;
    garantir(18 + alturaBloco);
    secao('RESPONSÁVEL CONTÁBIL E AUTENTICIDADE');
    const larguraEsquerda = 247;
    const xDireita = LEFT + larguraEsquerda + 8;
    const larguraDireita = RIGHT - xDireita;

    // Esquerda: responsável e situação da assinatura (afirma só o que foi aplicado).
    pdf
      .rect(LEFT, y, larguraEsquerda, alturaBloco)
      .lineWidth(0.7)
      .strokeColor(LINE)
      .stroke();
    rotulo('RESPONSÁVEL CONTÁBIL', LEFT + 14, y + 11);
    pdf
      .fillColor(INK)
      .font('Helvetica-Bold')
      .fontSize(10)
      .text(
        input.contadorNome ?? 'Não vinculado no cadastro',
        LEFT + 14,
        y + 23,
        { width: larguraEsquerda - 28, height: 13, ellipsis: true },
      );
    if (input.contadorNome) {
      pdf
        .fillColor(MUTED)
        .font('Helvetica')
        .fontSize(8.5)
        .text(
          input.contadorCrc
            ? `Contador(a) · CRC ${input.contadorCrc}`
            : 'Contador(a)',
          LEFT + 14,
          y + 38,
          { width: larguraEsquerda - 28 },
        );
    }
    pdf
      .moveTo(LEFT + 14, y + 58)
      .lineTo(LEFT + larguraEsquerda - 14, y + 58)
      .lineWidth(0.5)
      .strokeColor(LINE_SOFT)
      .stroke();
    pdf
      .fillColor(input.assinado ? AZUL : MUTED)
      .font('Helvetica-Bold')
      .fontSize(6.5)
      .text(
        input.assinado ? 'ASSINATURA DIGITAL' : 'SEM ASSINATURA DIGITAL',
        LEFT + 14,
        y + 66,
        { characterSpacing: 0.7 },
      );
    pdf
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(7.5)
      .text(
        input.assinado
          ? `Assinado digitalmente com o certificado A1 do contador responsável, em ${formatarDataHora(input.emitidoEm)}. A validade da assinatura é conferida no leitor de PDF.`
          : 'Emitido sem a assinatura digital do contador, que não possui certificado digital cadastrado.',
        LEFT + 14,
        y + 78,
        { width: larguraEsquerda - 28, lineGap: 1.5 },
      );

    // Direita: QR Code, endereço e código de controle.
    pdf
      .rect(xDireita, y, larguraDireita, alturaBloco)
      .fillAndStroke('#FBFCFE', LINE);
    rotulo('AUTENTICIDADE', xDireita + 14, y + 11);
    pdf.image(qr, xDireita + 12, y + 23, { width: 58, height: 58 });
    const xTextoQr = xDireita + 82;
    const larguraTextoQr = larguraDireita - 94;
    pdf
      .fillColor(INK)
      .font('Helvetica')
      .fontSize(7.5)
      .text(
        'Confira a autenticidade pela leitura do QR Code ou em',
        xTextoQr,
        y + 25,
        { width: larguraTextoQr, lineGap: 1.5 },
      );
    pdf
      .fillColor(AZUL)
      .font('Helvetica-Bold')
      .fontSize(7.5)
      .text('kontabb.com.br/verificar-faturamento', xTextoQr, y + 47, {
        width: larguraTextoQr,
        link: urlConferencia,
        underline: true,
      });
    pdf
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(7)
      .text(
        'A segunda via do documento original é obtida no mesmo endereço.',
        xTextoQr,
        y + 63,
        { width: larguraTextoQr, lineGap: 1.5 },
      );
    pdf
      .moveTo(xDireita + 14, y + 88)
      .lineTo(RIGHT - 14, y + 88)
      .lineWidth(0.5)
      .strokeColor(LINE_SOFT)
      .stroke();
    rotulo('CÓDIGO DE CONTROLE', xDireita + 14, y + 95);
    pdf
      .fillColor(NAVY)
      .font('Courier-Bold')
      .fontSize(8.5)
      .text(input.codigo, xDireita + 14, y + 106, {
        width: larguraDireita - 28,
      });
    y += alturaBloco;

    // ── Rodapé de todas as páginas ─────────────────────────────────────
    const paginas = pdf.bufferedPageRange();
    for (let pagina = 0; pagina < paginas.count; pagina++) {
      pdf.switchToPage(pagina);
      pdf
        .moveTo(LEFT, FOOTER_Y)
        .lineTo(RIGHT, FOOTER_Y)
        .lineWidth(0.6)
        .strokeColor(LINE)
        .stroke();
      pdf
        .fillColor(MUTED)
        .font('Helvetica-Bold')
        .fontSize(7)
        .text(`${TITULO_DOCUMENTO} · ${input.numero}`, LEFT, FOOTER_Y + 8, {
          width: 300,
        });
      pdf
        .font('Helvetica')
        .text(`Página ${pagina + 1} de ${paginas.count}`, 400, FOOTER_Y + 8, {
          width: RIGHT - 400,
          align: 'right',
        });
      pdf
        .fillColor(FAINT)
        .fontSize(6.5)
        .text(
          `Emitido em ${formatarData(input.emitidoEm)} · Código de controle ${input.codigo}`,
          LEFT,
          FOOTER_Y + 20,
          { width: 400 },
        );
      pdf.text('KONTABB', 400, FOOTER_Y + 20, {
        width: RIGHT - 400,
        align: 'right',
      });
    }

    if (input.assinado) {
      pdfkitAddPlaceholder({
        pdf,
        pdfBuffer: Buffer.alloc(0),
        reason: TITULO_DOCUMENTO,
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
