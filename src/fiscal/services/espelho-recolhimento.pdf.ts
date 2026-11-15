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
  valorComReducaoCondicionada?: string | null;
  valorReducaoCondicionada?: string | null;
  quantidadeItensComReducao?: number;
  percentualReducaoCondicionada?: string | null;
  fundamentoReducaoCondicionada?: string | null;
  condicaoReducaoCondicionada?: string | null;
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
    const y = (input.memoria ? 522 : 526) + index * (input.memoria ? 23 : 28);
    if (index === 3) pdf.rect(left, y - 4, width, 25).fill('#eaf3fc');
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
    const memoria = input.memoria;
    pdf.rect(left, 618, width, 51).fill('#edf5ff');
    pdf
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .fillColor(BLUE)
      .text(
        `NF-e analisadas: ${memoria.quantidadeNotas}  •  Com cálculo: ${memoria.quantidadeNotasCalculadas}`,
        left + 9,
        625,
        { width: 220 },
      );
    pdf.text(
      `Valor integral: ${money(memoria.valorIntegralSemReducao20)}`,
      left + 229,
      625,
      { width: width - 238, align: 'right' },
    );
    pdf
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(INK)
      .text(
        memoria.valorComReducaoCondicionada
          ? `${input.ufFavorecida === 'BA' && memoria.percentualReducaoCondicionada === '20' ? 'Cenário no prazo com redução de 20%' : 'Cenário com redução condicionada'}: ${money(memoria.valorComReducaoCondicionada)}`
          : 'Sem redução condicionada parametrizada para os itens calculados.',
        left + 9,
        643,
        { width: width - 18 },
      );
    if (memoria.valorReducaoCondicionada) {
      pdf
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor(MUTED)
        .text(
          `Redução potencial: ${money(memoria.valorReducaoCondicionada)} em ${memoria.quantidadeItensComReducao ?? 0} itens • sujeita à conferência no portal`,
          left + 9,
          656,
          { width: width - 18 },
        );
    }
  }

  const originY = input.memoria ? 680 : 657;
  pdf
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor(BLUE)
    .text('ORIGEM E CONFERÊNCIA', left, originY);
  pdf
    .moveTo(left, originY + 15)
    .lineTo(left + width, originY + 15)
    .strokeColor(BORDER)
    .stroke();
  pdf
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor(INK)
    .text(
      `Referência interna: ${text(input.referenciaInterna)}  •  Origem: ${text(input.origem)}`,
      left,
      originY + 25,
      { width, height: 19, ellipsis: true },
    );
  const notes = input.observacoes.length
    ? input.observacoes
    : ['Confira os dados no portal oficial antes do pagamento.'];
  pdf
    .font('Helvetica')
    .fontSize(input.memoria ? 7.5 : 8)
    .fillColor(MUTED)
    .text(
      notes.map((item) => `• ${text(item)}`).join('\n'),
      left,
      originY + 45,
      {
        width,
        height: input.memoria ? 27 : 45,
        ellipsis: true,
        lineGap: 2,
      },
    );
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

function memoryLines(
  item: EspelhoItemMemoria,
  memoria: EspelhoMemoria,
): string[] {
  const lines = [
    `Item ${item.numero}  •  NCM ${text(item.ncm)} / CEST ${text(item.cest)}  •  ${text(item.situacao)}`,
    `CFOP ${text(item.cfop)}  •  ${text(item.regimeTributario)}  •  origem mercadoria ${text(item.origemMercadoria)}  •  operação ${money(item.valorOperacao)}  •  IPI ${money(item.valorIpi)}`,
  ];
  if (item.composicaoOperacao) {
    const c = item.composicaoOperacao;
    lines.push(
      `Composição: produto ${money(c.produto)} + frete ${money(c.frete)} + seguro ${money(c.seguro)} + outras ${money(c.outrasDespesas)} - desconto ${money(c.desconto)}`,
    );
  }
  if (item.calculo) {
    const calc = item.calculo;
    const deducao =
      calc.aliquotaInterestadual == null
        ? `ICMS de origem destacado na NF-e = dedução ${money(calc.deducaoOrigem)}`
        : `origem ${money(calc.baseCalculoOrigem ?? calc.baseCalculo)} × ${calc.aliquotaInterestadual}% = dedução ${money(calc.deducaoOrigem)}`;
    const metodo =
      calc.aliquotaInterestadual == null || calc.baseCalculoOrigem != null
        ? 'ICMS interno - dedução'
        : 'base destino × diferença das alíquotas';
    lines.push(
      `Destino ${money(calc.baseCalculo)} × ${calc.aliquotaInterna}% = ICMS ${money(calc.icmsInterno)}  •  ${deducao}`,
      `Integral ${money(calc.impostoIntegral)} (${metodo})${item.reducaoCondicionada ? `  •  redução ${item.reducaoCondicionada.percentual}% ${money(item.reducaoCondicionada.valorReducao)} = cenário no prazo ${money(item.reducaoCondicionada.valorComReducao)}` : ''}`,
    );
  } else {
    lines.push(`Fora do total: ${text(item.motivo)}`);
  }
  if (item.regra) {
    lines.push(
      `Regra ${text(item.regra.chave)} rev. ${item.regra.revisao} (${text(item.regra.tratamento)}), vig. ${date(item.regra.vigenciaInicio)}-${item.regra.vigenciaFim ? date(item.regra.vigenciaFim) : 'aberta'}  •  ${text(item.regra.fonte)}`,
    );
  }
  if (item.tratamentoIpi) {
    lines.push(
      `IPI na base: ${item.tratamentoIpi}  •  fundamento: ${text(item.fundamentoIpi)}`,
    );
  }
  if (item.reducaoCondicionada) {
    const r = item.reducaoCondicionada;
    if (
      r.condicao !== memoria.condicaoReducaoCondicionada ||
      r.fundamento !== memoria.fundamentoReducaoCondicionada
    ) {
      lines.push(
        `Redução condicionada: ${text(r.condicao)}  •  fundamento: ${text(r.fundamento)}`,
      );
    }
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
    pdf.rect(left, 40, width, 49).fill(BLUE);
    pdf
      .font('Helvetica-Bold')
      .fontSize(13)
      .fillColor('#ffffff')
      .text('Notas fiscais e memória de cálculo', left + 13, 50, {
        width: width - 30,
      });
    pdf
      .font('Helvetica')
      .fontSize(7)
      .fillColor('#e6f1ff')
      .text('ANEXO AO ESPELHO • SEM VALOR FISCAL', left + 13, 70, {
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
    y = 102;
  };
  newPage();
  pdf
    .font('Helvetica-Bold')
    .fontSize(8.5)
    .fillColor(INK)
    .text(
      `${memoria.quantidadeNotas} NF-e analisadas  •  ${memoria.quantidadeNotasCalculadas} com cálculo  •  integral ${money(memoria.valorIntegralSemReducao20)}`,
      left,
      y,
      { width },
    );
  y += 15;
  if (memoria.valorComReducaoCondicionada) {
    pdf
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .fillColor(BLUE)
      .text(
        `${memoria.percentualReducaoCondicionada === '20' ? 'Cenário com redução de 20% no prazo' : 'Cenário com redução condicionada'}: ${money(memoria.valorComReducaoCondicionada)}  •  redução potencial ${money(memoria.valorReducaoCondicionada ?? '0')}`,
        left,
        y,
        { width },
      );
    y += 15;
  }
  pdf
    .font('Helvetica')
    .fontSize(7)
    .fillColor(MUTED)
    .text(
      memoria.valorComReducaoCondicionada
        ? `Cenário não aplicado ao total integral; confirme prazo e valor no portal. ${memoria.condicaoReducaoCondicionada ?? ''}${memoria.fundamentoReducaoCondicionada ? ` • ${memoria.fundamentoReducaoCondicionada}` : ''}`
        : 'Valores integrais dos itens calculados; pendências e simulações ficam fora do total.',
      left,
      y,
      { width },
    );
  y += 23;

  const noteHeader = (nota: EspelhoNotaMemoria, continued = false) => {
    if (y + 34 > 754) newPage();
    pdf.rect(left, y, width, 30).fill('#eaf3fc');
    pdf
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .fillColor(INK)
      .text(
        `NF-e ${text(nota.numero)} · Série ${text(nota.serie)} · Origem ${text(nota.ufOrigem)}${continued ? ' (continuação)' : ''}`,
        left + 7,
        y + 4,
        { width: width - 14 },
      );
    pdf
      .font('Helvetica')
      .fontSize(7)
      .fillColor(MUTED)
      .text(
        `Chave de acesso: ${text(nota.chaveAcesso)}  •  ${nota.itens.length} ${nota.itens.length === 1 ? 'item analisado' : 'itens analisados'}`,
        left + 7,
        y + 17,
        { width: width - 14 },
      );
    y += 34;
  };

  const lineHeight = (line: string, heading: boolean) =>
    pdf
      .font(heading ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(7.3)
      .heightOfString(text(line), { width: width - 14, lineGap: 0 });
  const itemHeight = (lines: string[]) =>
    7 +
    lines.reduce(
      (sum, line, index) => sum + lineHeight(line, index === 0) + 1,
      0,
    );

  for (const nota of memoria.notas) {
    const firstItem = nota.itens[0];
    if (firstItem && y + 34 + itemHeight(memoryLines(firstItem, memoria)) > 754)
      newPage();
    noteHeader(nota);
    for (const item of nota.itens) {
      const lines = memoryLines(item, memoria);
      const heights = lines.map((line, index) => lineHeight(line, index === 0));
      const height = itemHeight(lines);
      if (y + height > 754) {
        newPage();
        noteHeader(nota, true);
      }
      pdf.rect(left, y, width, height).fill('#f8fafc');
      pdf
        .moveTo(left, y + height)
        .lineTo(left + width, y + height)
        .strokeColor(BORDER)
        .lineWidth(0.5)
        .stroke();
      let lineY = y + 3;
      lines.forEach((line, index) => {
        pdf
          .font(index === 0 ? 'Helvetica-Bold' : 'Helvetica')
          .fontSize(7.3)
          .fillColor(index === 0 ? INK : MUTED)
          .text(text(line), left + 7, lineY, {
            width: width - 14,
            lineGap: 0,
          });
        lineY += heights[index] + 1;
      });
      y += height + 3;
    }
    y += 4;
  }
}
