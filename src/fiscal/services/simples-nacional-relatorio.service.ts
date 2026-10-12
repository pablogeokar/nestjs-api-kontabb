import { Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import PDFDocument from 'pdfkit';
import { DatabaseService } from '../../database/database.service';
import { clientes } from '../../database/schema';
import { SimplesNacionalService } from './simples-nacional.service';

type Apuracao = Awaited<ReturnType<SimplesNacionalService['obterApuracao']>>;

const BLUE = '#0B4F78';
const BLUE_LIGHT = '#EAF4F9';
const SLATE = '#334155';
const MUTED = '#64748B';
const BORDER = '#CBD5E1';
const PAPER = '#F8FAFC';
const AMBER = '#92400E';

const ANEXOS: Record<string, string> = {
  ANEXO_I: 'Anexo I - Comércio',
  ANEXO_II: 'Anexo II - Indústria',
  ANEXO_III: 'Anexo III - Serviços',
  ANEXO_IV: 'Anexo IV - Serviços sem CPP no DAS',
  ANEXO_V: 'Anexo V - Serviços',
};

const SEGREGACOES: Record<string, string> = {
  TRIBUTACAO_INTEGRAL: 'Tributação integral',
  ICMS_ST: 'ICMS-ST',
  ICMS_ISENTO: 'ICMS isento',
  ISS_RETIDO: 'ISS retido',
  PIS_COFINS_MONOFASICO: 'PIS/COFINS monofásico',
};

const TRIBUTOS = [
  ['irpj', 'IRPJ'],
  ['csll', 'CSLL'],
  ['cofins', 'COFINS'],
  ['pis', 'PIS/Pasep'],
  ['cpp', 'CPP'],
  ['ipi', 'IPI'],
  ['icms', 'ICMS'],
  ['iss', 'ISS'],
] as const;

@Injectable()
export class SimplesNacionalRelatorioService {
  constructor(
    private readonly database: DatabaseService,
    private readonly simplesService: SimplesNacionalService,
  ) {}

  async gerarPdf(input: { clienteId: string; competencia: string }) {
    const [apuracao, clienteRows] = await Promise.all([
      this.simplesService.obterApuracao(input.clienteId, input.competencia),
      this.database.db
        .select({
          razaoSocial: clientes.razaoSocial,
          cnpj: clientes.cnpj,
          municipio: clientes.municipio,
          uf: clientes.uf,
          cnae: clientes.cnaePrincipalCodigo,
        })
        .from(clientes)
        .where(eq(clientes.id, input.clienteId))
        .limit(1),
    ]);
    const cliente = clienteRows[0];
    if (!cliente) throw new NotFoundException('Empresa não encontrada.');

    return renderSimplesNacionalPdf({
      apuracao,
      cliente,
      competencia: input.competencia,
      emitidoEm: new Date(),
    });
  }
}

export function renderSimplesNacionalPdf(input: {
  apuracao: Apuracao;
  cliente: {
    razaoSocial: string;
    cnpj: string;
    municipio: string | null;
    uf: string | null;
    cnae: string | null;
  };
  competencia: string;
  emitidoEm: Date;
}) {
  const { apuracao, cliente } = input;
  const document = new PDFDocument({
    size: 'A4',
    margins: { top: 34, right: 36, bottom: 48, left: 36 },
    bufferPages: true,
    info: {
      Title: `Demonstrativo de Apuração do Simples Nacional - ${input.competencia}`,
      Author: 'Kontabb',
      Subject: 'Memória de cálculo mensal do Simples Nacional',
    },
  });
  const chunks: Buffer[] = [];
  document.on('data', (chunk: Buffer) => chunks.push(chunk));
  const completed = new Promise<Buffer>((resolve, reject) => {
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);
  });

  drawHeader(document, input.competencia, apuracao.status);
  sectionTitle(document, '1. Identificação do contribuinte');
  keyValueGrid(document, [
    ['Razão social', cliente.razaoSocial],
    ['CNPJ', formatDocument(cliente.cnpj)],
    [
      'Município / UF',
      [cliente.municipio, cliente.uf].filter(Boolean).join(' / ') ||
        'Não informado',
    ],
    ['CNAE principal', cliente.cnae || 'Não informado'],
  ]);

  sectionTitle(document, '2. Resumo da apuração');
  metricGrid(document, [
    ['Receita bruta do mês', money(apuracao.receita_bruta_mes)],
    ['RBT12', money(apuracao.rbt12)],
    ['Folha dos últimos 12 meses', money(apuracao.folha_salarios_12m)],
    ['Fator R', apuracao.fator_r ? percent(apuracao.fator_r) : 'Não aplicável'],
    ['Sublimite estadual', money(apuracao.sublimite_estadual)],
    ['Total do DAS', money(apuracao.valor_total_das)],
  ]);

  ensureSpace(document, 72);
  const fatorRDetail = apuracao.fator_r
    ? `${percent(apuracao.fator_r)} — ${decimalCompare(apuracao.fator_r, '0.2800') >= 0 ? 'percentual igual ou superior a 28%; atividades sujeitas ao Fator R são enquadradas no Anexo III.' : 'percentual inferior a 28%; atividades sujeitas ao Fator R são enquadradas no Anexo V.'}`
    : 'Não calculado porque não houve base de receita suficiente para o período.';
  infoBox(document, 'Critério do Fator R', fatorRDetail);
  if (apuracao.excedeu_sublimite) {
    infoBox(
      document,
      'Sublimite estadual excedido',
      `O RBT12 ultrapassou ${money(apuracao.sublimite_estadual)}. A parcela de ICMS foi retirada do DAS e deve ser conferida na apuração estadual.`,
      true,
    );
  }

  sectionTitle(document, '3. Memória por atividade e segregação');
  paragraph(
    document,
    'Alíquota efetiva = [(RBT12 × alíquota nominal) - parcela a deduzir] ÷ RBT12. Em seguida, são retiradas as parcelas incompatíveis com cada segregação fiscal.',
  );
  drawItemsTable(document, apuracao);

  sectionTitle(document, '4. Demonstração das fórmulas');
  if (apuracao.itens.length === 0) {
    emptyState(
      document,
      'Não há receitas de saída classificadas para demonstrar.',
    );
  } else {
    apuracao.itens.forEach((item, index) => {
      ensureSpace(document, 65);
      const itemY = document.y;
      document
        .font('Helvetica-Bold')
        .fontSize(8)
        .fillColor(SLATE)
        .text(
          `${index + 1}. ${ANEXOS[item.anexo] ?? item.anexo} · ${SEGREGACOES[item.segregacao] ?? item.segregacao}`,
          36,
          itemY,
          { width: 523 },
        );
      document
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor(MUTED)
        .text(
          `[(${money(apuracao.rbt12)} × ${percent(item.aliquota_nominal)}) - ${money(item.parcela_deduzir)}] ÷ ${money(apuracao.rbt12)} = ${percent(item.aliquota_efetiva)}`,
          36,
          document.y,
          { width: 523, lineGap: 2 },
        )
        .text(
          `${money(item.receita_bruta_atividade)} × ${percent(item.aliquota_efetiva_apos_deducoes)} = ${money(item.valor_devido)} de DAS${item.aliquota_efetiva !== item.aliquota_efetiva_apos_deducoes ? ' após as segregações aplicáveis' : ''}.`,
          36,
          document.y,
          { width: 523, lineGap: 2 },
        );
      document.moveDown(0.65);
    });
  }

  ensureSpace(document, 190);
  sectionTitle(document, '5. Partilha estimada do DAS');
  drawTaxTable(document, apuracao);

  sectionTitle(document, '6. Fontes e conferências');
  const memoria = apuracao.memoria_calculo;
  keyValueGrid(document, [
    [
      'Receita documental do mês',
      money(stringValue(memoria.receitaMesDocumentos)),
    ],
    ['Receita classificada', money(stringValue(memoria.receitaClassificada))],
    ['Origem da receita', humanizeOrigin(apuracao.origens.receita)],
    ['Origem da folha', humanizeOrigin(apuracao.origens.folha)],
    ['Origem da RBT12', humanizeOrigin(apuracao.origens.rbt12)],
    ['Versão do motor', stringValue(memoria.motorVersao) || 'Não informada'],
  ]);

  const pendencias = Array.isArray(memoria.pendencias)
    ? memoria.pendencias.filter(
        (item): item is string => typeof item === 'string',
      )
    : [];
  ensureSpace(document, 56);
  document
    .font('Helvetica-Bold')
    .fontSize(8)
    .fillColor(SLATE)
    .text('Pendências de conferência');
  document.moveDown(0.35);
  if (pendencias.length === 0) {
    document
      .font('Helvetica')
      .fontSize(8)
      .fillColor(MUTED)
      .text('Nenhuma pendência automática identificada nesta apuração.');
  } else {
    for (const pendencia of pendencias) {
      ensureSpace(document, 26);
      document
        .font('Helvetica')
        .fontSize(8)
        .fillColor(AMBER)
        .text(`• ${pendencia}`, { indent: 6, lineGap: 2 });
    }
  }

  ensureSpace(document, 75);
  document.moveDown(1);
  document.roundedRect(36, document.y, 523, 58, 4).fillAndStroke(PAPER, BORDER);
  document
    .fillColor(SLATE)
    .font('Helvetica-Bold')
    .fontSize(8)
    .text('Observação importante', 48, document.y + 12, { width: 499 });
  document
    .font('Helvetica')
    .fontSize(7.5)
    .fillColor(MUTED)
    .text(
      'Este demonstrativo é uma memória auxiliar de conferência, elaborada com os documentos e parâmetros registrados no sistema. Ele não substitui a declaração, o recibo ou o extrato oficial do PGDAS-D, nem a validação do profissional responsável.',
      48,
      document.y + 5,
      { width: 499, lineGap: 2 },
    );

  addFooters(document, input.emitidoEm);
  document.end();
  return completed;
}

function drawHeader(
  document: PDFKit.PDFDocument,
  competencia: string,
  status: string,
) {
  document.rect(0, 0, document.page.width, 92).fill(BLUE);
  document
    .fillColor('#FFFFFF')
    .font('Helvetica-Bold')
    .fontSize(17)
    .text('Demonstrativo de Apuração', 36, 27, { width: 360 });
  document.fontSize(11).text('Simples Nacional', 36, 51);
  document
    .font('Helvetica')
    .fontSize(8)
    .text(`Competência ${formatCompetencia(competencia)}`, 405, 31, {
      width: 154,
      align: 'right',
    })
    .text(`Situação: ${statusLabel(status)}`, 405, 48, {
      width: 154,
      align: 'right',
    });
  document.y = 110;
}

function sectionTitle(document: PDFKit.PDFDocument, title: string) {
  ensureSpace(document, 42);
  document.moveDown(0.7);
  const y = document.y;
  document.rect(36, y, 4, 18).fill(BLUE);
  document
    .font('Helvetica-Bold')
    .fontSize(10)
    .fillColor(SLATE)
    .text(title, 48, y + 3, { width: 511 });
  document.x = 36;
  document.y = y + 25;
}

function keyValueGrid(
  document: PDFKit.PDFDocument,
  values: Array<[string, string]>,
) {
  const width = 255.5;
  for (let index = 0; index < values.length; index += 2) {
    ensureSpace(document, 43);
    const y = document.y;
    for (let column = 0; column < 2; column += 1) {
      const value = values[index + column];
      if (!value) continue;
      const x = 36 + column * (width + 12);
      document.roundedRect(x, y, width, 36, 3).fillAndStroke(PAPER, BORDER);
      document
        .font('Helvetica-Bold')
        .fontSize(6.5)
        .fillColor(MUTED)
        .text(value[0].toUpperCase(), x + 9, y + 7, { width: width - 18 });
      document
        .font('Helvetica')
        .fontSize(8.5)
        .fillColor(SLATE)
        .text(value[1], x + 9, y + 18, { width: width - 18, ellipsis: true });
    }
    document.y = y + 43;
  }
  document.x = 36;
}

function metricGrid(
  document: PDFKit.PDFDocument,
  values: Array<[string, string]>,
) {
  const width = 166;
  for (let index = 0; index < values.length; index += 3) {
    ensureSpace(document, 55);
    const y = document.y;
    for (let column = 0; column < 3; column += 1) {
      const value = values[index + column];
      if (!value) continue;
      const x = 36 + column * (width + 12.5);
      document
        .roundedRect(x, y, width, 47, 4)
        .fillAndStroke(
          column === 2 && index === 3 ? BLUE_LIGHT : '#FFFFFF',
          BORDER,
        );
      document
        .font('Helvetica-Bold')
        .fontSize(6.5)
        .fillColor(MUTED)
        .text(value[0].toUpperCase(), x + 9, y + 8, { width: width - 18 });
      document
        .font('Helvetica-Bold')
        .fontSize(11)
        .fillColor(column === 2 && index === 3 ? BLUE : SLATE)
        .text(value[1], x + 9, y + 23, { width: width - 18 });
    }
    document.y = y + 55;
  }
}

function infoBox(
  document: PDFKit.PDFDocument,
  title: string,
  text: string,
  warning = false,
) {
  ensureSpace(document, 54);
  const height = document.heightOfString(text, { width: 493, lineGap: 2 }) + 31;
  const y = document.y;
  document
    .roundedRect(36, y, 523, height, 4)
    .fillAndStroke(
      warning ? '#FFF7ED' : BLUE_LIGHT,
      warning ? '#FDBA74' : '#BAE6FD',
    );
  document
    .font('Helvetica-Bold')
    .fontSize(7.5)
    .fillColor(warning ? AMBER : BLUE)
    .text(title, 48, y + 9, { width: 499 });
  document
    .font('Helvetica')
    .fontSize(7.5)
    .fillColor(SLATE)
    .text(text, 48, y + 21, { width: 499, lineGap: 2 });
  document.y = y + height + 6;
}

function paragraph(document: PDFKit.PDFDocument, text: string) {
  document
    .font('Helvetica')
    .fontSize(7.5)
    .fillColor(MUTED)
    .text(text, { lineGap: 2 });
  document.moveDown(0.7);
}

function drawItemsTable(document: PDFKit.PDFDocument, apuracao: Apuracao) {
  const widths = [157, 76, 54, 54, 70, 76];
  const headers = [
    'Enquadramento',
    'Receita',
    'Nominal',
    'Efetiva',
    'Após deduções',
    'DAS',
  ];
  tableHeader(document, widths, headers);
  if (apuracao.itens.length === 0) {
    emptyState(document, 'Nenhuma receita classificada nesta competência.');
    return;
  }
  for (const item of apuracao.itens) {
    ensureSpace(document, 39, () => tableHeader(document, widths, headers));
    const y = document.y;
    document.rect(36, y, 523, 34).fillAndStroke('#FFFFFF', BORDER);
    const cells = [
      `${ANEXOS[item.anexo] ?? item.anexo}\nFaixa ${item.faixa_enquadrada} · ${SEGREGACOES[item.segregacao] ?? item.segregacao}`,
      money(item.receita_bruta_atividade),
      percent(item.aliquota_nominal),
      percent(item.aliquota_efetiva),
      percent(item.aliquota_efetiva_apos_deducoes),
      money(item.valor_devido),
    ];
    drawCells(document, y, widths, cells, true);
    document.y = y + 34;
  }
}

function drawTaxTable(document: PDFKit.PDFDocument, apuracao: Apuracao) {
  const totals = Object.fromEntries(
    TRIBUTOS.map(([key]) => [
      key,
      sumMoney(
        apuracao.itens.map((item) => item.tributos_partilhados[key] ?? '0'),
      ),
    ]),
  ) as Record<(typeof TRIBUTOS)[number][0], string>;
  const widths = [130, 130, 130, 133];
  tableHeader(document, widths, ['Tributo', 'Valor', 'Tributo', 'Valor']);
  for (let index = 0; index < TRIBUTOS.length; index += 2) {
    ensureSpace(document, 29, () =>
      tableHeader(document, widths, ['Tributo', 'Valor', 'Tributo', 'Valor']),
    );
    const first = TRIBUTOS[index];
    const second = TRIBUTOS[index + 1];
    const y = document.y;
    document.rect(36, y, 523, 25).fillAndStroke('#FFFFFF', BORDER);
    drawCells(document, y, widths, [
      first[1],
      money(totals[first[0]]),
      second[1],
      money(totals[second[0]]),
    ]);
    document.y = y + 25;
  }
  ensureSpace(document, 35);
  document.rect(36, document.y, 523, 28).fillAndStroke(BLUE_LIGHT, BORDER);
  document
    .font('Helvetica-Bold')
    .fontSize(8.5)
    .fillColor(BLUE)
    .text('Total do DAS', 46, document.y + 9, { width: 360 });
  document.text(money(apuracao.valor_total_das), 418, document.y, {
    width: 131,
    align: 'right',
  });
  document.y += 36;
}

function tableHeader(
  document: PDFKit.PDFDocument,
  widths: number[],
  headers: string[],
) {
  ensureSpace(document, 25);
  const y = document.y;
  document.rect(36, y, 523, 22).fill(BLUE);
  drawCells(document, y, widths, headers, false, true);
  document.y = y + 22;
}

function drawCells(
  document: PDFKit.PDFDocument,
  y: number,
  widths: number[],
  cells: string[],
  compact = false,
  header = false,
) {
  let x = 36;
  cells.forEach((cell, index) => {
    const numeric = index > 0 && (cells.length !== 4 || index % 2 === 1);
    document
      .font(
        header || index === cells.length - 1 ? 'Helvetica-Bold' : 'Helvetica',
      )
      .fontSize(header ? 6.5 : compact ? 7 : 7.5)
      .fillColor(header ? '#FFFFFF' : SLATE)
      .text(cell, x + 6, y + (header ? 7 : compact ? 7 : 8), {
        width: widths[index] - 12,
        align: numeric ? 'right' : 'left',
        lineGap: 1,
      });
    x += widths[index];
  });
}

function emptyState(document: PDFKit.PDFDocument, text: string) {
  ensureSpace(document, 42);
  const y = document.y;
  document.rect(36, y, 523, 34).fillAndStroke(PAPER, BORDER);
  document
    .font('Helvetica')
    .fontSize(8)
    .fillColor(MUTED)
    .text(text, 46, y + 12, { width: 503, align: 'center' });
  document.y = y + 40;
}

function ensureSpace(
  document: PDFKit.PDFDocument,
  height: number,
  afterPage?: () => void,
) {
  if (document.y + height <= document.page.height - 72) return;
  document.addPage();
  document.y = 36;
  afterPage?.();
}

function addFooters(document: PDFKit.PDFDocument, emitidoEm: Date) {
  const range = document.bufferedPageRange();
  for (let page = range.start; page < range.start + range.count; page += 1) {
    document.switchToPage(page);
    document
      .moveTo(36, 779)
      .lineTo(559, 779)
      .strokeColor(BORDER)
      .lineWidth(0.5)
      .stroke();
    document
      .font('Helvetica')
      .fontSize(6.5)
      .fillColor(MUTED)
      .text(`Emitido em ${formatDateTime(emitidoEm)} · Kontabb`, 36, 784, {
        width: 390,
        lineBreak: false,
      })
      .text(`Página ${page + 1} de ${range.count}`, 400, 784, {
        width: 159,
        align: 'right',
        lineBreak: false,
      });
  }
}

function money(value: unknown) {
  const cents = toCents(stringValue(value));
  const absolute = cents < 0n ? -cents : cents;
  const integer = (absolute / 100n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${cents < 0n ? '-' : ''}R$ ${integer},${(absolute % 100n).toString().padStart(2, '0')}`;
}

function sumMoney(values: string[]) {
  return fromCents(values.reduce((sum, value) => sum + toCents(value), 0n));
}

function toCents(value: string) {
  const match = /^(-?)(\d+)(?:\.(\d{1,4}))?$/.exec(value || '0');
  if (!match) return 0n;
  const result =
    BigInt(match[2]) * 100n +
    BigInt((match[3] ?? '').padEnd(2, '0').slice(0, 2));
  return match[1] === '-' ? -result : result;
}

function fromCents(value: bigint) {
  const absolute = value < 0n ? -value : value;
  return `${value < 0n ? '-' : ''}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
}

function percent(value: unknown) {
  const raw = Number(stringValue(value) || 0) * 100;
  return `${raw.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}%`;
}

function decimalCompare(left: string, right: string) {
  const scale = (value: string) =>
    BigInt(value.replace('.', '').padEnd(5, '0').slice(0, 5));
  return scale(left) === scale(right) ? 0 : scale(left) > scale(right) ? 1 : -1;
}

function formatCompetencia(value: string) {
  const [year, month] = value.slice(0, 7).split('-');
  return `${month}/${year}`;
}

function formatDocument(value: string) {
  const digits = value.replace(/\D/g, '');
  return digits.length === 14
    ? digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
    : value;
}

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Bahia',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(value);
}

function statusLabel(status: string) {
  return (
    (
      {
        PREVIEW: 'Prévia não salva',
        RASCUNHO: 'Rascunho',
        FECHADO: 'Fechada',
        RETIFICADO: 'Retificada',
      } as Record<string, string>
    )[status] ?? status
  );
}

function stringValue(value: unknown) {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : '';
}

function humanizeOrigin(value: unknown) {
  const text = stringValue(value);
  return text
    ? text
        .replaceAll('_', ' ')
        .replaceAll(':', ' · ')
        .toLocaleLowerCase('pt-BR')
    : 'Não informada';
}
