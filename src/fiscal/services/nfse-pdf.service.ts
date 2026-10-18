import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { parseNfseWebissXml, type ParsedNfseDados } from './nfse-webiss.parser';
import type { ParsedParticipanteFiscal } from './dfe-document.parser';

type Pdf = PDFKit.PDFDocument;
type Layout = { document: Pdf; y: number };

const PAGE_WIDTH = 595.28;
const LEFT = 36;
const RIGHT = PAGE_WIDTH - LEFT;
const WIDTH = RIGHT - LEFT;
const CONTENT_BOTTOM = 797;
const INK = '#172334';
const MUTED = '#536477';
const BORDER = '#cbd7e2';
const ACCENT = '#087b8c';
const PALE = '#eef6f7';

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
      margins: { top: LEFT, right: LEFT, bottom: 8, left: LEFT },
      bufferPages: true,
      autoFirstPage: true,
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
    const layout: Layout = { document, y: 190 };

    drawHeader(
      layout,
      nota.numeroDocumento,
      nota.chaveAcesso,
      nfse,
      nota.situacao,
    );
    drawParty(layout, 'PRESTADOR DE SERVIÇOS', nota.emitente, {
      municipalRegistration: nfse.inscricaoMunicipalPrestador,
      tradeName: nfse.nomeFantasiaPrestador,
      phone: nfse.telefonePrestador,
      email: nfse.emailPrestador,
    });
    if (nota.tomador) {
      drawParty(layout, 'TOMADOR DE SERVIÇOS', nota.tomador, {
        municipalRegistration: nfse.inscricaoMunicipalTomador,
        phone: nfse.telefoneTomador,
        email: nfse.emailTomador,
      });
    } else {
      section(layout, 'TOMADOR DE SERVIÇOS', 41);
      document
        .font('Helvetica')
        .fontSize(9)
        .fillColor(MUTED)
        .text('Tomador não informado no XML.', LEFT + 10, layout.y + 2);
      layout.y += 22;
    }

    section(layout, 'SERVIÇO PRESTADO', 51);
    const serviceFields: [string, string][] = [
      ['Item da lista', nfse.itemListaServico],
      ['CNAE', nfse.cnae],
      ['Tributação municipal', nfse.codigoTributacaoMunicipio],
      ['Município de incidência', nfse.municipioIncidencia],
    ];
    drawGrid(layout, serviceFields, 4, 32);

    drawTextSection(
      layout,
      'DESCRIÇÃO DOS SERVIÇOS',
      nfse.discriminacao || 'Não informada.',
    );

    section(layout, 'TRIBUTOS FEDERAIS E RETENÇÕES', 55);
    drawGrid(
      layout,
      [
        ['PIS', money(nfse.valorPis)],
        ['COFINS', money(nfse.valorCofins)],
        ['INSS', money(nfse.valorInss)],
        ['IR', money(nfse.valorIr)],
        ['CSLL', money(nfse.valorCsll)],
        ['Outras ret.', money(nfse.outrasRetencoes)],
      ],
      6,
      36,
    );

    section(layout, 'VALORES DA NOTA E ISS', 103);
    drawGrid(
      layout,
      [
        ['Serviços', money(nfse.valorServicos)],
        ['Deduções', money(nfse.valorDeducoes)],
        ['Desc. incond.', money(nfse.descontoIncondicionado)],
        ['Base de cálculo', money(nfse.baseCalculoIss)],
        ['Alíquota ISS', `${nfse.aliquotaIss.replace('.', ',')}%`],
      ],
      5,
      34,
    );
    document
      .moveTo(LEFT + 8, layout.y)
      .lineTo(RIGHT - 8, layout.y)
      .strokeColor(BORDER)
      .lineWidth(0.5)
      .stroke();
    layout.y += 5;
    drawGrid(
      layout,
      [
        ['ISS', money(nfse.valorIss)],
        ['ISS retido', nfse.issRetido ? money(nfse.valorIssRetido) : 'Não'],
        ['Retenções federais', money(nfse.retencoesFederais)],
        ['Valor líquido da NFS-e', money(nfse.valorLiquidoNfse)],
      ],
      4,
      38,
      true,
    );

    if (nfse.cancelada) {
      const lifecycle = [
        nfse.substituida
          ? `Substituída pela NFS-e ${nfse.nfseSubstituidora}.`
          : 'Cancelamento confirmado.',
        nfse.dataHoraCancelamento
          ? `Em ${dateTime(nfse.dataHoraCancelamento)}.`
          : '',
        nfse.motivoCancelamento,
      ]
        .filter(Boolean)
        .join(' ');
      drawTextSection(layout, 'SITUAÇÃO DA NOTA', lifecycle);
    }
    if (nfse.outrasInformacoes) {
      drawTextSection(layout, 'OUTRAS INFORMAÇÕES', nfse.outrasInformacoes);
    }

    const pageCount = document.bufferedPageRange().count;
    for (let index = 0; index < pageCount; index++) {
      document.switchToPage(index);
      footer(document, index + 1, pageCount);
    }
    document.end();
    return completed;
  }
}

function drawHeader(
  layout: Layout,
  number: string,
  accessKey: string,
  nfse: ParsedNfseDados,
  status: string,
) {
  const { document } = layout;
  document.rect(LEFT, 35, 4, 86).fill(ACCENT);
  document
    .font('Helvetica-Bold')
    .fontSize(8)
    .fillColor(ACCENT)
    .text('DOCUMENTO DE SERVIÇO · WEBISS', LEFT + 14, 38);
  document
    .font('Helvetica-Bold')
    .fontSize(18)
    .fillColor(INK)
    .text('Espelho da NFS-e', LEFT + 14, 55, { width: 305 });
  document
    .font('Helvetica')
    .fontSize(9)
    .fillColor(MUTED)
    .text('Nota Fiscal de Serviços Eletrônica', LEFT + 14, 81);
  document
    .fontSize(8)
    .text(
      'Visualização gerada pelo Kontabb a partir do XML importado.',
      LEFT + 14,
      101,
      { width: 305 },
    );

  document.roundedRect(372, 35, 187, 86, 5).fillAndStroke(PALE, BORDER);
  label(document, 'NÚMERO DA NOTA', 384, 45);
  document
    .font('Helvetica-Bold')
    .fontSize(16)
    .fillColor(INK)
    .text(number, 384, 58, { width: 163 });
  label(document, 'CÓDIGO DE VERIFICAÇÃO', 384, 84);
  document
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor(ACCENT)
    .text(nfse.codigoVerificacao, 384, 96, { width: 163 });

  document
    .moveTo(LEFT, 133)
    .lineTo(RIGHT, 133)
    .strokeColor(BORDER)
    .lineWidth(0.8)
    .stroke();
  drawHeaderField(
    document,
    'EMISSÃO',
    dateTime(nfse.dataHoraEmissao),
    LEFT,
    142,
    175,
  );
  drawHeaderField(
    document,
    'COMPETÊNCIA',
    competence(nfse.competencia),
    LEFT + 183,
    142,
    116,
  );
  drawHeaderField(
    document,
    'SITUAÇÃO',
    status === 'CANCELADA' ? 'CANCELADA' : 'AUTORIZADA',
    LEFT + 307,
    142,
    160,
    status === 'CANCELADA' ? '#a12828' : '#167248',
  );
  label(document, 'CHAVE DE ACESSO', LEFT, 173);
  document
    .font('Helvetica')
    .fontSize(8.4)
    .fillColor(INK)
    .text(accessKey, LEFT + 102, 172, { width: WIDTH - 102, lineBreak: false });
  document
    .moveTo(LEFT, 187)
    .lineTo(RIGHT, 187)
    .strokeColor(BORDER)
    .lineWidth(0.8)
    .stroke();
}

function drawHeaderField(
  document: Pdf,
  title: string,
  value: string,
  x: number,
  y: number,
  width: number,
  color = INK,
) {
  label(document, title, x, y);
  document
    .font('Helvetica-Bold')
    .fontSize(10)
    .fillColor(color)
    .text(value, x, y + 12, { width, lineBreak: false });
}

function drawParty(
  layout: Layout,
  title: string,
  participant: ParsedParticipanteFiscal,
  extra: {
    municipalRegistration: string;
    tradeName?: string;
    phone: string;
    email: string;
  },
) {
  const { document } = layout;
  const name = participant.nome || 'Nome não informado';
  const address = formatAddress(participant);
  const nameHeight = textHeight(document, name, WIDTH - 20, 10.3, true);
  const tradeHeight = extra.tradeName ? 19 : 0;
  const emailHeight = extra.email
    ? textHeight(document, extra.email, WIDTH * 0.44 - 10, 8.8)
    : 0;
  const contactHeight =
    extra.phone || extra.email ? Math.max(22, emailHeight + 11) : 0;
  const addressHeight = address
    ? textHeight(document, address, WIDTH - 20, 8.8) + 12
    : 0;
  const bodyHeight =
    21 + nameHeight + tradeHeight + 33 + addressHeight + contactHeight + 7;
  section(layout, title, bodyHeight + 18);
  let y = layout.y;
  label(document, 'RAZÃO SOCIAL / NOME', LEFT + 10, y);
  y += 11;
  document
    .font('Helvetica-Bold')
    .fontSize(10.3)
    .fillColor(INK)
    .text(name, LEFT + 10, y, { width: WIDTH - 20 });
  y += nameHeight + 1;
  if (extra.tradeName) {
    label(document, 'NOME FANTASIA', LEFT + 10, y);
    document
      .font('Helvetica')
      .fontSize(8.8)
      .fillColor(INK)
      .text(extra.tradeName, LEFT + 108, y - 1, {
        width: WIDTH - 120,
        lineBreak: false,
      });
    y += tradeHeight;
  }
  drawCell(
    document,
    'CPF / CNPJ',
    formatIdentifier(participant.cnpjCpf),
    LEFT + 10,
    y,
    179,
  );
  drawCell(
    document,
    'INSCRIÇÃO MUNICIPAL',
    extra.municipalRegistration || '—',
    LEFT + 195,
    y,
    151,
  );
  drawCell(document, 'UF', participant.uf || '—', LEFT + 353, y, 70);
  y += 32;
  if (address) {
    label(document, 'ENDEREÇO', LEFT + 10, y);
    y += 10;
    document
      .font('Helvetica')
      .fontSize(8.8)
      .fillColor(INK)
      .text(address, LEFT + 10, y, { width: WIDTH - 20 });
    y += addressHeight - 10;
  }
  if (contactHeight) {
    drawCell(
      document,
      'TELEFONE',
      formatPhone(extra.phone) || '—',
      LEFT + 10,
      y,
      245,
    );
    drawCell(
      document,
      'E-MAIL',
      extra.email || '—',
      LEFT + 266,
      y,
      WIDTH - 276,
      8.8,
    );
    y += contactHeight;
  }
  layout.y = y + 7;
}

function section(layout: Layout, title: string, expectedHeight: number) {
  ensureSpace(layout, expectedHeight);
  const { document } = layout;
  document.rect(LEFT, layout.y, WIDTH, 18).fill(PALE);
  document.rect(LEFT, layout.y, 3, 18).fill(ACCENT);
  document
    .font('Helvetica-Bold')
    .fontSize(8.6)
    .fillColor(ACCENT)
    .text(title, LEFT + 10, layout.y + 5, {
      width: WIDTH - 20,
      lineBreak: false,
    });
  layout.y += 23;
}

function drawGrid(
  layout: Layout,
  fields: [string, string][],
  columns: number,
  height: number,
  emphasizeLast = false,
) {
  const { document } = layout;
  const cellWidth = WIDTH / columns;
  for (const [index, [title, value]] of fields.entries()) {
    const x = LEFT + index * cellWidth + 9;
    const width = cellWidth - 15;
    label(document, title.toUpperCase(), x, layout.y, width);
    document
      .font(
        emphasizeLast && index === fields.length - 1
          ? 'Helvetica-Bold'
          : 'Helvetica',
      )
      .fontSize(emphasizeLast && index === fields.length - 1 ? 11 : 9.3)
      .fillColor(emphasizeLast && index === fields.length - 1 ? ACCENT : INK)
      .text(value || '—', x, layout.y + 12, {
        width,
        lineBreak: false,
        ellipsis: true,
      });
  }
  layout.y += height;
}

function drawTextSection(layout: Layout, title: string, value: string) {
  const lines = wrapText(layout.document, normalizeText(value), WIDTH - 20, 9);
  section(layout, title, Math.min(48, 25 + lines.length * 11));
  for (const line of lines) {
    ensureSpace(layout, 14);
    layout.document
      .font('Helvetica')
      .fontSize(9)
      .fillColor(INK)
      .text(line || ' ', LEFT + 10, layout.y, {
        width: WIDTH - 20,
        lineBreak: false,
      });
    layout.y += 11;
  }
  layout.y += 8;
}

function ensureSpace(layout: Layout, height: number) {
  if (layout.y + height <= CONTENT_BOTTOM) return;
  layout.document.addPage();
  layout.document.rect(LEFT, 36, 3, 42).fill(ACCENT);
  layout.document
    .font('Helvetica-Bold')
    .fontSize(15)
    .fillColor(INK)
    .text('Espelho da NFS-e · continuação', LEFT + 13, 39);
  layout.document
    .font('Helvetica')
    .fontSize(8)
    .fillColor(MUTED)
    .text('Dados extraídos do XML importado', LEFT + 13, 61);
  layout.document
    .moveTo(LEFT, 88)
    .lineTo(RIGHT, 88)
    .strokeColor(BORDER)
    .stroke();
  layout.y = 103;
}

function footer(document: Pdf, page: number, total: number) {
  document
    .moveTo(LEFT, 810)
    .lineTo(RIGHT, 810)
    .strokeColor(BORDER)
    .lineWidth(0.7)
    .stroke();
  document
    .font('Helvetica')
    .fontSize(7.5)
    .fillColor(MUTED)
    .text(
      'Espelho gerado pelo Kontabb a partir do XML. Confirme a autenticidade no portal do município.',
      LEFT,
      817,
      { width: WIDTH - 45, lineBreak: false },
    );
  document.text(`${page}/${total}`, RIGHT - 35, 817, {
    width: 35,
    align: 'right',
    lineBreak: false,
  });
}

function label(
  document: Pdf,
  value: string,
  x: number,
  y: number,
  width?: number,
) {
  document
    .font('Helvetica-Bold')
    .fontSize(7)
    .fillColor(MUTED)
    .text(value, x, y, { width, lineBreak: false });
}

function drawCell(
  document: Pdf,
  title: string,
  value: string,
  x: number,
  y: number,
  width: number,
  size = 9.2,
) {
  label(document, title, x, y, width);
  document
    .font('Helvetica')
    .fontSize(size)
    .fillColor(INK)
    .text(value, x, y + 11, { width, lineBreak: false, ellipsis: true });
}

function textHeight(
  document: Pdf,
  value: string,
  width: number,
  size: number,
  bold = false,
) {
  document.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
  return document.heightOfString(value, { width });
}

function wrapText(document: Pdf, value: string, width: number, size: number) {
  document.font('Helvetica').fontSize(size);
  const lines: string[] = [];
  for (const paragraph of value.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      let remaining = word;
      while (remaining) {
        const candidate = line ? `${line} ${remaining}` : remaining;
        if (document.widthOfString(candidate) <= width) {
          line = candidate;
          break;
        }
        if (line) {
          lines.push(line);
          line = '';
          continue;
        }
        let length = 1;
        while (
          length < remaining.length &&
          document.widthOfString(remaining.slice(0, length + 1)) <= width
        ) {
          length++;
        }
        lines.push(remaining.slice(0, length));
        remaining = remaining.slice(length);
      }
    }
    lines.push(line);
  }
  return lines;
}

function normalizeText(value: string) {
  return value
    .replace(/\\s\\n|\\n/g, '\n')
    .replace(/\\s/g, ' ')
    .trim();
}

function formatAddress(participant: ParsedParticipanteFiscal) {
  const street = [
    participant.endereco,
    participant.numero,
    participant.complemento,
  ]
    .filter(Boolean)
    .join(', ');
  const area = [participant.bairro, participant.uf].filter(Boolean).join(' - ');
  const cep = participant.cep
    ? `CEP ${participant.cep.replace(/^(\d{5})(\d{3})$/, '$1-$2')}`
    : '';
  return [street, area, cep].filter(Boolean).join(' · ');
}

function formatIdentifier(value: string) {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 14)
    return digits.replace(
      /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
      '$1.$2.$3/$4-$5',
    );
  if (digits.length === 11)
    return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return value || '—';
}

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 11)
    return digits.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
  if (digits.length === 10)
    return digits.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3');
  return value;
}

function dateTime(value: string) {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:T|\s)(\d{2}):(\d{2})(?::(\d{2}))?/.exec(value);
  return match
    ? `${match[3]}/${match[2]}/${match[1]} ${match[4]}:${match[5]}:${match[6] || '00'}`
    : value;
}

function competence(value: string) {
  const match = /^(\d{4})-(\d{2})/.exec(value);
  return match ? `${match[2]}/${match[1]}` : value;
}

function money(value: string) {
  const [integer = '0', fraction = ''] = value.split('.');
  return `R$ ${integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${fraction.padEnd(2, '0').slice(0, 2)}`;
}
