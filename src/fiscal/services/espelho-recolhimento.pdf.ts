import PDFDocument from 'pdfkit';

/** Contrato independente de UF e do tipo de documento usado pelo órgão. */
export interface EspelhoRecolhimento {
  referenciaInterna: string;
  ufFavorecida: string;
  tributo: string;
  tipoDocumentoSugerido: string;
  codigoReceita: string;
  competencia: string;
  vencimento: string;
  contribuinte: {
    nome: string;
    documento: string;
    inscricaoEstadual?: string | null;
    logradouro?: string | null;
    numero?: string | null;
    bairro?: string | null;
    municipio?: string | null;
    uf?: string | null;
    cep?: string | null;
  };
  valores: {
    principal: string;
    multa: string;
    juros: string;
    total: string;
  };
  origem: string;
  observacoes: string[];
  geradoEm: Date;
}

const INK = '#17243d';
const MUTED = '#64748b';
const BORDER = '#d8e0eb';
const BLUE = '#0d4c8d';
const PAGE = { width: 595.28, margin: 42 };

function text(value: string | null | undefined): string {
  const cleaned = Array.from(value ?? '')
    .map((character) =>
      character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
        ? ' '
        : character,
    )
    .join('')
    .trim();
  return (cleaned || 'Não informado').slice(0, 220);
}

function money(value: string): string {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      }).format(amount)
    : 'Valor inválido';
}

function date(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : text(value);
}

function field(
  pdf: PDFKit.PDFDocument,
  label: string,
  value: string | null | undefined,
  x: number,
  y: number,
  width: number,
) {
  pdf
    .font('Helvetica-Bold')
    .fontSize(8)
    .fillColor(MUTED)
    .text(label.toUpperCase(), x, y, { width });
  pdf
    .font('Helvetica')
    .fontSize(10.5)
    .fillColor(INK)
    .text(text(value), x, y + 13, { width, height: 31, ellipsis: true });
}

/** Documento de conferência: sem marca oficial, linha digitável, PIX ou dados de pagamento. */
export async function renderEspelhoRecolhimentoPdf(
  input: EspelhoRecolhimento,
): Promise<Buffer> {
  const pdf = new PDFDocument({
    size: 'A4',
    margin: PAGE.margin,
    info: {
      Title: `Espelho de recolhimento - ${input.referenciaInterna}`,
      Subject: 'Documento auxiliar sem valor fiscal',
      Creator: 'Kontabb',
    },
  });
  const chunks: Buffer[] = [];
  pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
  const completed = new Promise<Buffer>((resolve, reject) => {
    pdf.once('end', () => resolve(Buffer.concat(chunks)));
    pdf.once('error', reject);
  });
  const left = PAGE.margin;
  const width = PAGE.width - 2 * left;

  pdf.rect(left, 40, width, 91).fill(BLUE);
  pdf
    .font('Helvetica-Bold')
    .fontSize(18)
    .fillColor('#ffffff')
    .text('Espelho de recolhimento', left + 17, 55, { width: width - 34 });
  pdf
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor('#ffffff')
    .text('SEM VALOR FISCAL  •  NÃO É GUIA DE PAGAMENTO', left + 17, 84, {
      width: width - 34,
    });
  pdf
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor('#e6f1ff')
    .text(
      'Use estes dados para conferir e emitir o documento verdadeiro no portal do órgão arrecadador.',
      left + 17,
      107,
      { width: width - 34 },
    );

  pdf
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor(BLUE)
    .text('IDENTIFICAÇÃO DA OBRIGAÇÃO', left, 153);
  pdf
    .moveTo(left, 168)
    .lineTo(left + width, 168)
    .strokeColor(BORDER)
    .stroke();
  field(pdf, 'UF favorecida', input.ufFavorecida, left, 181, 78);
  field(pdf, 'Tributo', input.tributo, left + 94, 181, 255);
  field(
    pdf,
    'Documento no portal',
    input.tipoDocumentoSugerido,
    left + 364,
    181,
    148,
  );
  field(pdf, 'Código da receita', input.codigoReceita, left, 235, 150);
  field(pdf, 'Competência', input.competencia, left + 166, 235, 155);
  field(
    pdf,
    'Vencimento informado',
    date(input.vencimento),
    left + 337,
    235,
    175,
  );

  pdf
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor(BLUE)
    .text('CONTRIBUINTE', left, 300);
  pdf
    .moveTo(left, 315)
    .lineTo(left + width, 315)
    .strokeColor(BORDER)
    .stroke();
  field(pdf, 'Razão social / nome', input.contribuinte.nome, left, 328, 325);
  field(pdf, 'CPF / CNPJ', input.contribuinte.documento, left + 341, 328, 171);
  field(
    pdf,
    'Inscrição estadual',
    input.contribuinte.inscricaoEstadual,
    left,
    380,
    168,
  );
  field(
    pdf,
    'Endereço',
    [input.contribuinte.logradouro, input.contribuinte.numero]
      .filter(Boolean)
      .join(', '),
    left + 184,
    380,
    328,
  );
  field(pdf, 'Bairro', input.contribuinte.bairro, left, 432, 170);
  field(
    pdf,
    'Município / UF',
    [input.contribuinte.municipio, input.contribuinte.uf]
      .filter(Boolean)
      .join(' / '),
    left + 184,
    432,
    200,
  );
  field(pdf, 'CEP', input.contribuinte.cep, left + 400, 432, 112);

  pdf
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor(BLUE)
    .text('VALORES REGISTRADOS', left, 496);
  pdf
    .moveTo(left, 511)
    .lineTo(left + width, 511)
    .strokeColor(BORDER)
    .stroke();
  const amounts = [
    ['Principal', input.valores.principal],
    ['Multa', input.valores.multa],
    ['Juros', input.valores.juros],
    ['Total para conferência', input.valores.total],
  ] as const;
  amounts.forEach(([label, value], index) => {
    const y = 526 + index * 28;
    if (index === 3) pdf.rect(left, y - 5, width, 27).fill('#eaf3fc');
    pdf
      .font(index === 3 ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(index === 3 ? 11 : 9.5)
      .fillColor(INK)
      .text(label, left + 8, y, { width: 280 });
    pdf.text(money(value), left + 310, y, {
      width: width - 318,
      align: 'right',
    });
  });

  pdf
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor(BLUE)
    .text('ORIGEM E CONFERÊNCIA', left, 657);
  pdf
    .moveTo(left, 672)
    .lineTo(left + width, 672)
    .strokeColor(BORDER)
    .stroke();
  pdf
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor(INK)
    .text(
      `Referência interna: ${text(input.referenciaInterna)}  •  Origem: ${text(input.origem)}`,
      left,
      682,
      { width },
    );
  const notes = input.observacoes.length
    ? input.observacoes
    : ['Confira os dados no portal oficial antes do pagamento.'];
  pdf
    .font('Helvetica')
    .fontSize(8)
    .fillColor(MUTED)
    .text(notes.map((item) => `• ${text(item)}`).join('\n'), left, 702, {
      width,
      height: 45,
      ellipsis: true,
      lineGap: 2,
    });
  pdf
    .moveTo(left, 755)
    .lineTo(left + width, 755)
    .strokeColor(BORDER)
    .stroke();
  pdf
    .font('Helvetica-Bold')
    .fontSize(8)
    .fillColor(BLUE)
    .text(
      'SEM VALOR FISCAL  •  NÃO PODE SER UTILIZADO PARA PAGAMENTO',
      left,
      764,
      { width },
    );
  pdf
    .font('Helvetica')
    .fontSize(7.5)
    .fillColor(MUTED)
    .text(
      `Gerado em ${input.geradoEm.toLocaleString('pt-BR', { timeZone: 'America/Bahia' })}  •  Kontabb`,
      left,
      780,
      { width },
    );
  pdf.end();
  return completed;
}
