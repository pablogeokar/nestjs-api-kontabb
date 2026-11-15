import PDFDocument from 'pdfkit';

export interface EspelhoItemMemoria {
  numero: number;
  cfop?: string | null;
  regimeTributario?: string | null;
  origemMercadoria?: string | null;
  ncm: string | null;
  cest: string | null;
  situacao: string;
  motivo: string;
  valorOperacao: string;
  composicaoOperacao?: {
    produto: string;
    frete: string;
    seguro: string;
    outrasDespesas: string;
    desconto: string;
  } | null;
  valorIpi: string;
  calculo: {
    baseCalculo: string;
    baseCalculoOrigem?: string | null;
    aliquotaInterna: string;
    aliquotaInterestadual: string | null;
    icmsInterno: string;
    deducaoOrigem: string;
    impostoIntegral: string;
  } | null;
  tratamentoIpi?: string | null;
  fundamentoIpi?: string | null;
  reducaoCondicionada?: {
    percentual: string;
    fundamento: string;
    condicao: string | null;
    valorReducao: string;
    valorComReducao: string;
  } | null;
  regra?: {
    chave: string;
    revisao: number;
    fonte: string;
    vigenciaInicio: string;
    vigenciaFim: string | null;
    tratamento: string;
  } | null;
  cenariosIpi?: { semIpi: string; comIpi: string } | null;
}

export interface EspelhoNotaMemoria {
  id: string;
  numero: string;
  serie?: string | null;
  chaveAcesso?: string | null;
  ufOrigem: string | null;
  itens: EspelhoItemMemoria[];
}

export interface EspelhoMemoria {
  quantidadeNotas: number;
  quantidadeNotasCalculadas: number;
  valorIntegralSemReducao20: string;
  notas: EspelhoNotaMemoria[];
}

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
  memoria?: EspelhoMemoria;
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
    .text(
      input.memoria
        ? 'VALORES APURADOS PARA CONFERÊNCIA'
        : 'VALORES REGISTRADOS',
      left,
      496,
    );
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

  if (input.memoria) {
    pdf.rect(left, 631, width, 22).fill('#edf5ff');
    pdf
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .fillColor(BLUE)
      .text(
        `NF-e analisadas: ${input.memoria.quantidadeNotas}  •  Com cálculo: ${input.memoria.quantidadeNotasCalculadas}`,
        left + 9,
        637,
        { width: 220 },
      );
    pdf.text(
      `Sem redução de 20%: ${money(input.memoria.valorIntegralSemReducao20)}`,
      left + 229,
      637,
      { width: width - 238, align: 'right' },
    );
  }

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
  if (input.memoria) drawMemoryPages(pdf, input.memoria);
  pdf.end();
  return completed;
}

function memoryLines(item: EspelhoItemMemoria): string[] {
  const lines = [
    `Item ${item.numero} • NCM ${text(item.ncm)} • CEST ${text(item.cest)} • ${text(item.situacao)}`,
    `CFOP ${text(item.cfop)} • Regime ${text(item.regimeTributario)} • Origem mercadoria ${text(item.origemMercadoria)}`,
    `Operação: ${money(item.valorOperacao)} • IPI destacado: ${money(item.valorIpi)}`,
  ];
  if (item.composicaoOperacao) {
    const c = item.composicaoOperacao;
    lines.push(
      `Composição: produto ${money(c.produto)} + frete ${money(c.frete)} + seguro ${money(c.seguro)} + outras ${money(c.outrasDespesas)} - desconto ${money(c.desconto)}`,
    );
  }
  if (item.calculo) {
    const calc = item.calculo;
    lines.push(
      `Base BA: ${money(calc.baseCalculo)} • Base de origem: ${money(calc.baseCalculoOrigem ?? calc.baseCalculo)}`,
      `Alíquota interna: ${calc.aliquotaInterna}% • Interestadual: ${calc.aliquotaInterestadual == null ? 'ICMS destacado na NF-e' : `${calc.aliquotaInterestadual}%`}`,
      calc.aliquotaInterestadual == null
        ? 'Método: ICMS interno menos ICMS de origem destacado na NF-e.'
        : calc.baseCalculoOrigem == null
          ? 'Método: base BA × diferença das alíquotas; arredondamento em centavos.'
          : 'Método: ICMS interno menos (base de origem × alíquota interestadual).',
      `ICMS interno: ${money(calc.icmsInterno)} • Dedução origem: ${money(calc.deducaoOrigem)}`,
      `Imposto integral sem redução de 20%: ${money(calc.impostoIntegral)}`,
    );
  } else {
    lines.push(`Fora do total: ${text(item.motivo)}`);
  }
  if (item.regra) {
    lines.push(
      `Regra: ${text(item.regra.chave)} · revisão ${item.regra.revisao} · ${text(item.regra.tratamento)} · vigência ${date(item.regra.vigenciaInicio)} a ${item.regra.vigenciaFim ? date(item.regra.vigenciaFim) : 'em aberto'}`,
      `Fonte normativa: ${text(item.regra.fonte)}`,
    );
  }
  if (item.tratamentoIpi) {
    lines.push(
      `IPI na base: ${item.tratamentoIpi} • Fundamento: ${text(item.fundamentoIpi)}`,
    );
  }
  if (item.reducaoCondicionada) {
    const r = item.reducaoCondicionada;
    lines.push(
      `Cenário condicionado: redução ${r.percentual}% de ${money(r.valorReducao)}; valor com redução ${money(r.valorComReducao)}. NÃO APLICADO AO TOTAL.`,
      `Condição: ${text(r.condicao)} • Fundamento: ${text(r.fundamento)}`,
    );
  }
  if (item.cenariosIpi) {
    lines.push(
      `IPI pendente de decisão: sem IPI ${money(item.cenariosIpi.semIpi)}; com IPI ${money(item.cenariosIpi.comIpi)}. Ambos fora do total.`,
    );
  }
  return lines;
}

function drawMemoryPages(pdf: PDFKit.PDFDocument, memoria: EspelhoMemoria) {
  const left = PAGE.margin;
  const width = PAGE.width - left * 2;
  let y = 0;
  const newPage = () => {
    pdf.addPage();
    pdf.rect(left, 40, width, 65).fill(BLUE);
    pdf
      .font('Helvetica-Bold')
      .fontSize(16)
      .fillColor('#ffffff')
      .text('Notas fiscais e memória de cálculo', left + 15, 55, {
        width: width - 30,
      });
    pdf
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#e6f1ff')
      .text('ANEXO AO ESPELHO • SEM VALOR FISCAL', left + 15, 82, {
        width: width - 30,
      });
    pdf
      .moveTo(left, 770)
      .lineTo(left + width, 770)
      .strokeColor(BORDER)
      .stroke();
    pdf
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor(BLUE)
      .text('SEM VALOR FISCAL • NÃO UTILIZAR PARA PAGAMENTO', left, 780, {
        width,
      });
    y = 124;
  };
  newPage();
  pdf
    .font('Helvetica-Bold')
    .fontSize(10)
    .fillColor(INK)
    .text(
      `${memoria.quantidadeNotas} NF-e analisadas • ${memoria.quantidadeNotasCalculadas} com itens calculados`,
      left,
      y,
      { width },
    );
  y += 21;
  pdf
    .font('Helvetica-Bold')
    .fontSize(10)
    .fillColor(BLUE)
    .text(
      `Valor integral sem redução de 20%: ${money(memoria.valorIntegralSemReducao20)}`,
      left,
      y,
      { width },
    );
  y += 23;
  pdf
    .font('Helvetica')
    .fontSize(8)
    .fillColor(MUTED)
    .text(
      'A redução de 20% é apenas um cenário condicionado quando indicada para o item; confirme enquadramento e pagamento tempestivo no portal.',
      left,
      y,
      { width },
    );
  y += 36;

  const noteHeader = (nota: EspelhoNotaMemoria, continued = false) => {
    if (y + 52 > 754) newPage();
    pdf.rect(left, y, width, 43).fill('#eaf3fc');
    pdf
      .font('Helvetica-Bold')
      .fontSize(10)
      .fillColor(INK)
      .text(
        `NF-e ${text(nota.numero)} · Série ${text(nota.serie)} · Origem ${text(nota.ufOrigem)}${continued ? ' (continuação)' : ''}`,
        left + 9,
        y + 7,
        { width: width - 18 },
      );
    pdf
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(MUTED)
      .text(
        `Chave de acesso: ${text(nota.chaveAcesso)}  •  ${nota.itens.length} ${nota.itens.length === 1 ? 'item analisado' : 'itens analisados'}`,
        left + 9,
        y + 25,
        { width: width - 18 },
      );
    y += 50;
  };

  for (const nota of memoria.notas) {
    const firstItem = nota.itens[0];
    if (firstItem) {
      const firstLines = memoryLines(firstItem);
      pdf.font('Helvetica').fontSize(8);
      const firstHeight =
        13 +
        firstLines.reduce(
          (sum, line) =>
            sum +
            pdf.heightOfString(text(line), { width: width - 22, lineGap: 1 }) +
            4,
          0,
        );
      if (y + 50 + firstHeight > 754) newPage();
    }
    noteHeader(nota);
    for (const item of nota.itens) {
      const lines = memoryLines(item);
      pdf.font('Helvetica').fontSize(8);
      const heights = lines.map((line) =>
        pdf.heightOfString(text(line), { width: width - 22, lineGap: 1 }),
      );
      const height =
        13 + heights.reduce((sum, lineHeight) => sum + lineHeight + 4, 0);
      if (y + height > 754) {
        newPage();
        noteHeader(nota, true);
      }
      pdf
        .rect(left, y, width, height)
        .strokeColor(BORDER)
        .lineWidth(0.5)
        .stroke();
      let lineY = y + 7;
      lines.forEach((line, index) => {
        pdf
          .font(index === 0 ? 'Helvetica-Bold' : 'Helvetica')
          .fontSize(8)
          .fillColor(index === 0 ? INK : MUTED)
          .text(text(line), left + 10, lineY, {
            width: width - 22,
            lineGap: 1,
          });
        lineY += heights[index] + 4;
      });
      y += height + 8;
    }
    y += 7;
  }
}
