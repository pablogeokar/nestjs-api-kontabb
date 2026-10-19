import PDFDocument from 'pdfkit';
import type {
  FiscalIssLivroService,
  LivroIssLinha,
} from './fiscal-iss-livro.service';

type Book = Awaited<ReturnType<FiscalIssLivroService['obter']>>;
type Pdf = PDFKit.PDFDocument;
type Layout = { document: Pdf; book: Book; y: number };
type Operation = 'SAIDA' | 'ENTRADA';

const PAGE_WIDTH = 841.89;
const PAGE_HEIGHT = 595.28;
const LEFT = 24;
const WIDTH = PAGE_WIDTH - LEFT * 2;
const RIGHT = LEFT + WIDTH;
const CONTENT_BOTTOM = 542;
const INK = '#171717';
const MUTED = '#4b5563';
const BORDER = '#222222';
const PALE = '#f3f4f6';
const COLS = [90, 63, 135, 105, 52, 63, 55, 63, 42, 58, 66];
const HEADERS = [
  'Número / código',
  'Emissão\nCompet.',
  'Tomador / prestador',
  'Exigibilidade\nIncidência',
  'Serviço',
  'Total NFS-e',
  'Ded. / desc.',
  'BC (R$)',
  'Alíq. (%)',
  'ISSQN (R$)',
  'Retido / valor',
];

/** Livro auxiliar em paisagem. Os dados municipais oficiais devem ser conferidos no WebISS. */
export async function renderLivroIssPdf(book: Book): Promise<Buffer> {
  const document = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margins: { top: 18, right: LEFT, bottom: 7, left: LEFT },
    bufferPages: true,
    info: {
      Title: `Livro Fiscal de Serviços - ${book.cabecalho.competencia}`,
      Subject: 'Espelho auxiliar dos lançamentos e da apuração de ISS',
      Creator: 'Kontabb',
    },
  });
  const chunks: Buffer[] = [];
  document.on('data', (chunk: Buffer) => chunks.push(chunk));
  const completed = new Promise<Buffer>((resolve, reject) => {
    document.once('end', () => resolve(Buffer.concat(chunks)));
    document.once('error', reject);
  });
  const layout: Layout = { document, book, y: 0 };
  drawPageHeader(layout);

  const provided = book.linhas.filter((line) => line.tipo_operacao === 'SAIDA');
  const taken = book.linhas.filter((line) => line.tipo_operacao === 'ENTRADA');
  if (
    book.cabecalho.tipo_operacao === 'SAIDA' ||
    (book.cabecalho.tipo_operacao === 'TODAS' &&
      (provided.length > 0 || taken.length === 0))
  ) {
    drawRegister(layout, 'SAIDA', provided);
  }
  if (
    book.cabecalho.tipo_operacao === 'ENTRADA' ||
    (book.cabecalho.tipo_operacao === 'TODAS' && taken.length > 0)
  ) {
    drawRegister(layout, 'ENTRADA', taken);
  }
  document.addPage();
  drawPageHeader(layout);
  drawAssessment(layout);

  const pages = document.bufferedPageRange().count;
  for (let index = 0; index < pages; index++) {
    document.switchToPage(index);
    drawPageNumberAndFooter(document, index + 1, pages);
  }
  document.end();
  return completed;
}

function drawPageHeader(layout: Layout) {
  const { document, book } = layout;
  document
    .rect(LEFT, 17, WIDTH, 68)
    .strokeColor(BORDER)
    .lineWidth(0.8)
    .stroke();
  document
    .font('Helvetica-Bold')
    .fontSize(9.2)
    .fillColor(INK)
    .text(
      `Município de ${book.cabecalho.municipio || 'não informado'}`,
      LEFT + 7,
      23,
      { width: WIDTH - 145, lineBreak: false },
    );
  document
    .font('Helvetica-Bold')
    .fontSize(10.5)
    .text('Livro Fiscal de Serviços', LEFT + 7, 39);
  document
    .font('Helvetica-Bold')
    .fontSize(8.7)
    .text(
      `Inscrição Municipal: ${book.cabecalho.inscricao_municipal || 'não informada'}  |  Empresa: ${book.cabecalho.razao_social}`,
      LEFT + 7,
      62,
      { width: WIDTH - 145, lineBreak: false, ellipsis: true },
    );
  document
    .font('Helvetica')
    .fontSize(7.2)
    .fillColor(MUTED)
    .text('ESPELHO AUXILIAR · KONTABB', RIGHT - 165, 24, {
      width: 155,
      align: 'right',
      lineBreak: false,
    });
  document
    .font('Helvetica')
    .fontSize(7.4)
    .fillColor(INK)
    .text(`CNPJ ${formatIdentifier(book.cabecalho.cnpj)}`, RIGHT - 165, 42, {
      width: 155,
      align: 'right',
      lineBreak: false,
    });
  layout.y = 95;
}

function drawRegister(
  layout: Layout,
  operation: Operation,
  lines: LivroIssLinha[],
) {
  drawRegisterHeader(layout, operation, lines, false);
  if (!lines.length) {
    ensure(layout, 32, () =>
      drawRegisterHeader(layout, operation, lines, true),
    );
    layout.document
      .rect(LEFT, layout.y, WIDTH, 28)
      .strokeColor(BORDER)
      .lineWidth(0.5)
      .stroke();
    layout.document
      .font('Helvetica')
      .fontSize(8)
      .fillColor(MUTED)
      .text(
        `Sem serviços ${operation === 'SAIDA' ? 'prestados' : 'tomados'} nesta competência.`,
        LEFT + 7,
        layout.y + 9,
      );
    layout.y += 28;
  }
  for (const [index, line] of lines.entries()) {
    const height = rowHeight(layout.document, line);
    ensure(layout, height, () =>
      drawRegisterHeader(layout, operation, lines, true),
    );
    drawRow(layout, line, height, index % 2 === 1);
  }
  ensure(layout, 30, () => {
    layout.document
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor(INK)
      .text(
        `SERVIÇOS ${operation === 'SAIDA' ? 'PRESTADOS' : 'TOMADOS'} · TOTAL`,
        LEFT,
        layout.y,
      );
    layout.y += 18;
  });
  drawSubtotal(layout, operation, lines);
  layout.y += 12;
}

function drawRegisterHeader(
  layout: Layout,
  operation: Operation,
  lines: LivroIssLinha[],
  continued: boolean,
) {
  ensure(layout, 78);
  const { document, book } = layout;
  const period = formatPeriod(book.cabecalho.competencia);
  const valid = lines.filter((line) => line.situacao === 'AUTORIZADA');
  const total = sum(valid, (line) => line.valor_servicos);
  document
    .rect(LEFT, layout.y, WIDTH, 48)
    .strokeColor(BORDER)
    .lineWidth(0.7)
    .stroke();
  document
    .font('Helvetica-Bold')
    .fontSize(8.2)
    .fillColor(INK)
    .text(
      `${operation === 'SAIDA' ? 'Serviços prestados' : 'Serviços tomados'}${continued ? ' - continuação' : ''} | Período de Emissão - ${period}`,
      LEFT + 7,
      layout.y + 6,
    );
  document
    .font('Helvetica')
    .fontSize(7.5)
    .text(
      `Valor Total de NFS-e no Período - R$ ${formatCents(total)}`,
      LEFT + 7,
      layout.y + 20,
    );
  document.text(
    `Quantidade de NFS-e do Período - ${distinctCount(valid)}`,
    LEFT + 7,
    layout.y + 32,
  );
  layout.y += 48;
  document
    .rect(LEFT, layout.y, WIDTH, 29)
    .strokeColor(BORDER)
    .lineWidth(0.7)
    .stroke();
  let x = LEFT;
  for (const [index, heading] of HEADERS.entries()) {
    document
      .font('Helvetica-Bold')
      .fontSize(6.6)
      .fillColor(INK)
      .text(heading, x + 3, layout.y + 5, {
        width: COLS[index] - 6,
        height: 20,
        align: index >= 5 ? 'right' : 'left',
      });
    x += COLS[index];
  }
  layout.y += 29;
}

function drawRow(
  layout: Layout,
  line: LivroIssLinha,
  height: number,
  alternate: boolean,
) {
  const { document } = layout;
  const y = layout.y;
  if (alternate) document.rect(LEFT, y, WIDTH, height).fill(PALE);
  document
    .rect(LEFT, y, WIDTH, height)
    .strokeColor(BORDER)
    .lineWidth(0.45)
    .stroke();
  const x = positions();
  const name = line.contraparte_razao_social || '—';
  const rate = formatRate(line.aliquota_iss);
  const columns = [
    line.numero_nfse,
    date(line.data_emissao),
    name,
    exigibility(line.exigibilidade_iss),
    line.item_lista_servico || '—',
    formatCents(cents(line.valor_servicos)),
    formatCents(cents(line.valor_deducoes_descontos)),
    formatCents(cents(line.base_calculo_iss)),
    rate,
    formatCents(cents(line.valor_iss)),
    line.iss_retido ? 'SIM' : 'NÃO',
  ];
  for (let index = 0; index < columns.length; index++) {
    document
      .font(index === 0 ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(index >= 5 ? 7.1 : 7.2)
      .fillColor(INK)
      .text(columns[index], x[index] + 4, y + 5, {
        width: COLS[index] - 8,
        height: index === 2 ? height - 18 : 12,
        align: index >= 5 ? 'right' : 'left',
        lineBreak: index === 2,
        ellipsis: index === 2,
      });
  }
  small(
    document,
    line.codigo_verificacao || 'Sem código de verificação',
    x[0] + 4,
    y + 18,
    COLS[0] - 8,
  );
  document
    .font('Helvetica-Bold')
    .fontSize(6.2)
    .fillColor(line.situacao === 'CANCELADA' ? '#9a2020' : MUTED)
    .text(line.situacao, x[0] + 4, y + 31, {
      width: COLS[0] - 8,
      lineBreak: false,
    });
  small(
    document,
    formatPeriod(line.competencia),
    x[1] + 4,
    y + 19,
    COLS[1] - 8,
  );
  if (line.contraparte_cnpj_cpf) {
    small(
      document,
      formatIdentifier(line.contraparte_cnpj_cpf),
      x[2] + 4,
      y + height - 12,
      COLS[2] - 8,
    );
  }
  const incidence =
    line.municipio_incidencia_label ||
    (line.municipio_incidencia
      ? `IBGE ${line.municipio_incidencia}`
      : 'Não informado');
  document
    .font('Helvetica')
    .fontSize(6.3)
    .fillColor(MUTED)
    .text(incidence, x[3] + 4, y + 18, {
      width: COLS[3] - 8,
      height: height - 23,
    });
  small(document, `CNAE ${line.cnae || '—'}`, x[4] + 4, y + 19, COLS[4] - 8);
  if (line.iss_retido) {
    small(
      document,
      formatCents(cents(line.valor_iss_retido)),
      x[10] + 4,
      y + 19,
      COLS[10] - 8,
      'right',
    );
  }
  layout.y += height;
}

function drawSubtotal(
  layout: Layout,
  operation: Operation,
  lines: LivroIssLinha[],
) {
  const { document } = layout;
  const valid = lines.filter((line) => line.situacao === 'AUTORIZADA');
  document
    .rect(LEFT, layout.y, WIDTH, 28)
    .strokeColor(BORDER)
    .lineWidth(0.7)
    .stroke();
  document
    .font('Helvetica-Bold')
    .fontSize(7.3)
    .fillColor(INK)
    .text(
      `TOTAL ${operation === 'SAIDA' ? 'PRESTADOS' : 'TOMADOS'} · ${distinctCount(valid)} NFS-e`,
      LEFT + 6,
      layout.y + 9,
      {
        width: COLS.slice(0, 5).reduce((a, b) => a + b, 0) - 10,
        lineBreak: false,
      },
    );
  const values = [
    formatCents(sum(valid, (line) => line.valor_servicos)),
    formatCents(sum(valid, (line) => line.valor_deducoes_descontos)),
    formatCents(sum(valid, (line) => line.base_calculo_iss)),
    '',
    formatCents(sum(valid, (line) => line.valor_iss)),
    formatCents(sum(valid, (line) => line.valor_iss_retido)),
  ];
  const x = positions();
  for (let index = 0; index < values.length; index++) {
    document
      .font('Helvetica-Bold')
      .fontSize(7.2)
      .text(values[index], x[index + 5] + 4, layout.y + 9, {
        width: COLS[index + 5] - 8,
        align: 'right',
        lineBreak: false,
      });
  }
  layout.y += 28;
}

function drawAssessment(layout: Layout) {
  const { document, book } = layout;
  const out = book.linhas.filter((line) => line.tipo_operacao === 'SAIDA');
  const issued = out.filter((line) => line.situacao === 'AUTORIZADA');
  const taken = book.linhas.filter(
    (line) =>
      line.tipo_operacao === 'ENTRADA' && line.situacao === 'AUTORIZADA',
  );
  const cancelled = out.filter((line) => line.situacao === 'CANCELADA');
  const current = issued.filter(
    (line) => line.data_emissao.slice(0, 7) === book.cabecalho.competencia,
  );
  const other = issued.filter(
    (line) => line.data_emissao.slice(0, 7) !== book.cabecalho.competencia,
  );
  const left = LEFT + 7;
  const middle = LEFT + WIDTH / 2 + 5;
  const colWidth = WIDTH / 2 - 15;
  document
    .rect(LEFT, 95, WIDTH, 440)
    .strokeColor(BORDER)
    .lineWidth(0.7)
    .stroke();
  document
    .font('Helvetica')
    .fontSize(10)
    .fillColor(INK)
    .text(
      `Período de Emissão: ${formatPeriod(book.cabecalho.competencia)}`,
      left,
      105,
    );

  sectionTitle(document, 'Notas Fiscais Emitidas', left, 133);
  tableHeading(document, left, 153, colWidth);
  summaryRow(
    document,
    'Período Atual',
    distinctCount(current),
    sum(current, (line) => line.valor_servicos),
    left,
    173,
    colWidth,
  );
  summaryRow(
    document,
    'Demais Períodos',
    distinctCount(other),
    sum(other, (line) => line.valor_servicos),
    left,
    192,
    colWidth,
  );
  summaryRow(
    document,
    'Total',
    distinctCount(issued),
    sum(issued, (line) => line.valor_servicos),
    left,
    211,
    colWidth,
    true,
  );

  if (taken.length) {
    sectionTitle(document, 'Serviços Tomados', left, 241);
    summaryRow(
      document,
      'NFS-e tomadas',
      distinctCount(taken),
      sum(taken, (line) => line.valor_servicos),
      left,
      261,
      colWidth,
    );
    amountRow(
      document,
      'ISS retido em serviços tomados',
      sum(taken, (line) => line.valor_iss_retido),
      left,
      281,
      colWidth,
    );
  }

  sectionTitle(document, 'Resumo do Período', left, 302);
  amountRow(
    document,
    'B.C. NFS-e Emitidas',
    sum(issued, (line) => line.base_calculo_iss),
    left,
    325,
    colWidth,
    distinctCount(issued),
  );
  amountRow(
    document,
    'ISSQN próprio apurado',
    cents(book.resumo.total_iss_proprio),
    left,
    346,
    colWidth,
  );
  amountRow(
    document,
    'B.C. NFS-e com ISS retido',
    sum(
      issued.filter((line) => line.iss_retido),
      (line) => line.base_calculo_iss,
    ),
    left,
    367,
    colWidth,
  );
  amountRow(
    document,
    'Imposto Retido nas Emitidas',
    sum(issued, (line) => line.valor_iss_retido),
    left,
    388,
    colWidth,
  );
  amountRow(
    document,
    'B.C. NFS-e Canceladas',
    sum(cancelled, (line) => line.base_calculo_iss),
    left,
    409,
    colWidth,
    distinctCount(cancelled),
  );
  amountRow(
    document,
    'Total dos serviços emitidos',
    sum(issued, (line) => line.valor_servicos),
    left,
    430,
    colWidth,
    distinctCount(issued),
  );

  sectionTitle(document, 'Alíquota', middle, 133);
  label(document, 'VALOR B.C.', middle + colWidth - 105, 134, 105, 'right');
  const rates = groupByRate(issued);
  for (const [index, [rate, base]] of rates.slice(0, 5).entries()) {
    document
      .font('Helvetica')
      .fontSize(8)
      .fillColor(INK)
      .text(`${formatRate(rate)}%`, middle, 155 + index * 17);
    document.text(
      `R$ ${formatCents(base)}`,
      middle + colWidth - 115,
      155 + index * 17,
      { width: 115, align: 'right', lineBreak: false },
    );
  }
  if (rates.length > 5) {
    document
      .font('Helvetica')
      .fontSize(7.2)
      .fillColor(MUTED)
      .text(
        `Mais ${rates.length - 5} alíquotas no quadro complementar.`,
        middle,
        242,
      );
  }

  sectionTitle(document, 'Impostos Federais', middle, 270);
  const taxes: [string, keyof LivroIssLinha][] = [
    ['PIS', 'valor_pis'],
    ['CSLL', 'valor_csll'],
    ['COFINS', 'valor_cofins'],
    ['IR', 'valor_ir'],
    ['INSS', 'valor_inss'],
    ['Outras retenções', 'outras_retencoes'],
  ];
  for (const [index, [title, key]] of taxes.entries()) {
    const amounts = issued.map((line) => line[key]);
    const aggregate = issued.every(
      (line) => line.retencoes_federais === '0.00',
    );
    const amount = amounts.every((value) => typeof value === 'string')
      ? `R$ ${formatCents(amounts.reduce<bigint>((total, value) => total + cents(value), 0n))}`
      : aggregate || amounts.length === 0
        ? 'R$ 0,00'
        : 'Não disponível';
    label(document, title, middle, 292 + index * 20, colWidth - 125);
    document
      .font('Helvetica')
      .fontSize(8)
      .fillColor(INK)
      .text(amount, middle + colWidth - 130, 292 + index * 20, {
        width: 130,
        align: 'right',
        lineBreak: false,
      });
  }

  document
    .font('Helvetica')
    .fontSize(7.3)
    .fillColor(MUTED)
    .text(book.resumo.observacao, left, 471, { width: WIDTH - 18, height: 22 });
  document.text(
    'Notas canceladas aparecem no registro e não integram a apuração.',
    left,
    492,
  );
  document
    .moveTo(RIGHT - 260, 509)
    .lineTo(RIGHT - 12, 509)
    .strokeColor(BORDER)
    .stroke();
  document
    .font('Helvetica')
    .fontSize(7.1)
    .fillColor(MUTED)
    .text('Conferência do contribuinte ou representante', RIGHT - 260, 515, {
      width: 248,
      align: 'center',
    });
  if (rates.length > 5) drawRateAnnex(layout, rates);
}

function drawRateAnnex(layout: Layout, rates: [string, bigint][]) {
  for (let offset = 0; offset < rates.length; offset += 19) {
    const chunk = rates.slice(offset, offset + 19);
    layout.document.addPage();
    drawPageHeader(layout);
    const { document } = layout;
    document
      .rect(LEFT, 95, WIDTH, 35 + chunk.length * 20)
      .strokeColor(BORDER)
      .stroke();
    sectionTitle(document, 'Quadro complementar de alíquotas', LEFT + 8, 104);
    for (const [index, [rate, amount]] of chunk.entries()) {
      document
        .font('Helvetica')
        .fontSize(8)
        .fillColor(INK)
        .text(`${formatRate(rate)}%`, LEFT + 10, 136 + index * 20);
      document.text(`R$ ${formatCents(amount)}`, LEFT + 140, 136 + index * 20);
    }
  }
}

function drawPageNumberAndFooter(document: Pdf, page: number, pages: number) {
  document
    .font('Helvetica-Bold')
    .fontSize(7.7)
    .fillColor(INK)
    .text(`Folha ${page}`, RIGHT - 73, 64, {
      width: 62,
      align: 'right',
      lineBreak: false,
    });
  document
    .moveTo(LEFT, PAGE_HEIGHT - 38)
    .lineTo(RIGHT, PAGE_HEIGHT - 38)
    .strokeColor(BORDER)
    .lineWidth(0.5)
    .stroke();
  document
    .font('Helvetica')
    .fontSize(7)
    .fillColor(MUTED)
    .text(
      'Espelho auxiliar do Kontabb. Confira o livro oficial no sistema municipal.',
      LEFT,
      PAGE_HEIGHT - 29,
      { width: WIDTH - 100, lineBreak: false },
    );
  document.text(`${page}/${pages}`, RIGHT - 75, PAGE_HEIGHT - 29, {
    width: 75,
    align: 'right',
    lineBreak: false,
  });
}

function ensure(layout: Layout, needed: number, afterNewPage?: () => void) {
  if (layout.y + needed <= CONTENT_BOTTOM) return;
  layout.document.addPage();
  drawPageHeader(layout);
  afterNewPage?.();
}

function rowHeight(document: Pdf, line: LivroIssLinha) {
  document.font('Helvetica').fontSize(7.2);
  const nameHeight = document.heightOfString(
    line.contraparte_razao_social || 'Não identificado',
    { width: COLS[2] - 8 },
  );
  return Math.max(46, Math.ceil(nameHeight) + 19);
}

function positions() {
  const result = [LEFT];
  for (const width of COLS) result.push(result[result.length - 1] + width);
  return result;
}

function small(
  document: Pdf,
  value: string,
  x: number,
  y: number,
  width: number,
  align: 'left' | 'right' = 'left',
) {
  document
    .font('Helvetica')
    .fontSize(6.1)
    .fillColor(MUTED)
    .text(value, x, y, { width, align, lineBreak: false, ellipsis: true });
}

function label(
  document: Pdf,
  value: string,
  x: number,
  y: number,
  width?: number,
  align: 'left' | 'right' = 'left',
) {
  document
    .font('Helvetica')
    .fontSize(7.7)
    .fillColor(INK)
    .text(value, x, y, { width, align, lineBreak: false });
}

function sectionTitle(document: Pdf, value: string, x: number, y: number) {
  document
    .font('Helvetica-Bold')
    .fontSize(10.2)
    .fillColor(INK)
    .text(value, x, y);
}

function tableHeading(document: Pdf, x: number, y: number, width: number) {
  document
    .font('Helvetica-Bold')
    .fontSize(8.2)
    .fillColor(INK)
    .text('Quantidade', x + width - 185, y, { width: 80, align: 'right' });
  document.text('Valor', x + width - 96, y, { width: 96, align: 'right' });
}

function summaryRow(
  document: Pdf,
  name: string,
  quantity: number,
  value: bigint,
  x: number,
  y: number,
  width: number,
  bold = false,
) {
  document
    .font(bold ? 'Helvetica-Bold' : 'Helvetica')
    .fontSize(8.1)
    .fillColor(INK)
    .text(name, x, y, { width: width - 190 });
  document.text(String(quantity), x + width - 180, y, {
    width: 75,
    align: 'right',
  });
  document.text(`R$ ${formatCents(value)}`, x + width - 97, y, {
    width: 97,
    align: 'right',
  });
}

function amountRow(
  document: Pdf,
  name: string,
  value: bigint,
  x: number,
  y: number,
  width: number,
  quantity?: number,
) {
  document
    .font('Helvetica')
    .fontSize(8)
    .fillColor(INK)
    .text(name, x, y, { width: width - 190 });
  if (quantity !== undefined) {
    document.text(String(quantity), x + width - 180, y, {
      width: 75,
      align: 'right',
    });
  }
  document.text(`R$ ${formatCents(value)}`, x + width - 97, y, {
    width: 97,
    align: 'right',
  });
}

function groupByRate(lines: LivroIssLinha[]): [string, bigint][] {
  const groups = new Map<string, bigint>();
  for (const line of lines) {
    groups.set(
      line.aliquota_iss,
      (groups.get(line.aliquota_iss) || 0n) + cents(line.base_calculo_iss),
    );
  }
  return [...groups.entries()].sort(([a], [b]) => Number(a) - Number(b));
}

function sum(lines: LivroIssLinha[], value: (line: LivroIssLinha) => string) {
  return lines.reduce((total, line) => total + cents(value(line)), 0n);
}

function distinctCount(lines: LivroIssLinha[]) {
  return new Set(lines.map((line) => line.documento_id)).size;
}

function exigibility(value: string | null) {
  return value === '1' ? 'Exigível' : value ? `Cód. ${value}` : 'Não informada';
}

function date(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

function formatPeriod(value: string) {
  const match = /^(\d{4})-(\d{2})/.exec(value);
  return match ? `${match[2]}/${match[1]}` : value;
}

function formatRate(value: string) {
  const [integer, fraction = ''] = value.split('.');
  return `${integer},${fraction.replace(/0+$/, '').padEnd(2, '0')}`;
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
  return value;
}

function cents(value: string) {
  const [integer = '0', fraction = ''] = value.split('.');
  return BigInt(integer) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
}

function formatCents(value: bigint) {
  const integer = (value / 100n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${integer},${(value % 100n).toString().padStart(2, '0')}`;
}
