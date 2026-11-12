import { BadRequestException, Injectable } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import PDFDocument from 'pdfkit';
import { DatabaseService } from '../../database/database.service';
import { clientes, contadores } from '../../database/schema';
import { SERVICOS_CONTRATO } from '../financeiro-servicos.catalogo';
import { isValidCivilDate, toCents } from '../financeiro.utils';
import { FinanceiroContratosService } from './financeiro-contratos.service';

const LOGO = readFileSync(
  resolve(__dirname, '../../assets/financeiro/kontabb-logo.png'),
);
const BLUE = '#1456A3';
const DEEP = '#0C2D56';
const INK = '#172B4D';
const MUTED = '#60728B';
const LINE = '#DCE5EF';
const RIGHT = 555;
const BOTTOM = 750;

const money = (value: string | number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    Number(value),
  );
const civilDate = (value: string) => {
  const [year, month, day] = value.split('-');
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
const address = (parts: Array<string | null | undefined>) =>
  parts.filter(Boolean).join(', ');

export interface ContratoPdfData {
  contrato: {
    id: string;
    valorMensalidade: string;
    diaVencimento: number;
    diaFechamento: number;
    gera13o: boolean;
    mes13o: number;
    ativo: boolean;
    dataInicio: string | null;
    avisoPrevioDias: number;
    condicoesContratuais: string | null;
    servicosContratados: Array<{
      codigo: string;
      descricao?: string;
      valorMensal: string;
    }>;
    itens: Array<{
      descricao: string;
      valor: string;
      natureza: string;
      ativo: boolean;
      competenciaInicio: string | null;
      competenciaFim: string | null;
    }>;
  };
  cliente: {
    razaoSocial: string;
    cnpj: string;
    tipoPessoa: string;
    representante: string | null;
    endereco: string;
  };
  contador: { nome: string; documento: string; crc: string; endereco: string };
}

export function servicosDoInstrumento(
  selecionados: ContratoPdfData['contrato']['servicosContratados'],
) {
  return selecionados.map((servico) => {
    const catalogo = SERVICOS_CONTRATO.find(
      (item) => item.codigo === servico.codigo,
    );
    return {
      nome:
        servico.codigo === 'OUTROS'
          ? (servico.descricao ?? '')
          : (catalogo?.nome ?? ''),
      escopo: servico.codigo === 'OUTROS' ? '' : (catalogo?.escopo ?? ''),
      valorMensal: servico.valorMensal,
    };
  });
}

export function validarContratoParaImpressao(data: ContratoPdfData) {
  if (!data.contrato.servicosContratados.length) {
    throw new BadRequestException(
      'Selecione os serviços contratados antes de imprimir.',
    );
  }
  if (!data.contrato.dataInicio || !isValidCivilDate(data.contrato.dataInicio)) {
    throw new BadRequestException(
      'Informe a data de início do contrato antes de imprimir.',
    );
  }
  if (data.cliente.tipoPessoa === 'PJ' && !data.cliente.representante?.trim()) {
    throw new BadRequestException(
      'Informe o representante do cliente antes de imprimir.',
    );
  }
  if (!data.contador.nome || !data.contador.documento || !data.contador.crc) {
    throw new BadRequestException(
      'Complete o cadastro do contador vinculado antes de imprimir.',
    );
  }
  for (const servico of data.contrato.servicosContratados) {
    if (
      !SERVICOS_CONTRATO.some((item) => item.codigo === servico.codigo) ||
      (servico.codigo === 'OUTROS' && !servico.descricao?.trim())
    ) {
      throw new BadRequestException(
        'Revise os serviços contratados antes de imprimir.',
      );
    }
  }
  const total = data.contrato.servicosContratados.reduce(
    (soma, servico) => soma + toCents(servico.valorMensal),
    0,
  );
  if (total !== toCents(data.contrato.valorMensalidade)) {
    throw new BadRequestException(
      'A mensalidade deve corresponder à soma dos serviços contratados.',
    );
  }
}

function wrap(pdf: PDFKit.PDFDocument, value: string, width: number) {
  const result: string[] = [];
  for (const paragraph of value.split(/\r?\n/)) {
    let current = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = current ? `${current} ${word}` : word;
      if (current && pdf.widthOfString(candidate) > width) {
        result.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    result.push(current);
  }
  return result;
}

export function renderContratoPdf(data: ContratoPdfData): Promise<Buffer> {
  validarContratoParaImpressao(data);
  return new Promise((resolvePdf, reject) => {
    const pdf = new PDFDocument({
      size: 'A4',
      margin: 0,
      bufferPages: true,
      info: {
        Author: 'Kontabb',
        Creator: 'Kontabb',
        Title: 'Contrato de prestação de serviços',
      },
    });
    const chunks: Buffer[] = [];
    pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
    pdf.on('end', () => resolvePdf(Buffer.concat(chunks)));
    pdf.on('error', reject);
    let y = 118;
    const rule = (at: number) =>
      pdf
        .strokeColor(LINE)
        .lineWidth(0.7)
        .moveTo(40, at)
        .lineTo(RIGHT, at)
        .stroke();
    const pageHeader = (continued = false) => {
      pdf.rect(0, 0, 595.28, 9).fill(BLUE);
      pdf.image(LOGO, 40, 18, { fit: [160, 68] });
      pdf
        .font('Helvetica-Bold')
        .fontSize(13)
        .fillColor(DEEP)
        .text('CONTRATO DE PRESTAÇÃO', 226, 42, { width: 329, align: 'right' });
      pdf.text('DE SERVIÇOS CONTÁBEIS', 226, 59, {
        width: 329,
        align: 'right',
      });
      if (continued)
        pdf
          .font('Helvetica')
          .fontSize(8)
          .fillColor(MUTED)
          .text('Continuação', 460, 81, { width: 95, align: 'right' });
      rule(103);
      rule(784);
      pdf
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor(MUTED)
        .text('Kontabb · Instrumento para assinatura das partes', 40, 793, {
          width: 515,
          align: 'center',
        });
    };
    const nextPage = () => {
      pdf.addPage();
      pageHeader(true);
      y = 120;
    };
    const ensure = (height: number) => {
      if (y + height > BOTTOM) nextPage();
    };
    const text = (
      value: string,
      options: {
        size?: number;
        bold?: boolean;
        color?: string;
        indent?: number;
        gap?: number;
      } = {},
    ) => {
      const size = options.size ?? 9;
      const indent = options.indent ?? 0;
      const width = 515 - indent;
      pdf
        .font(options.bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(size)
        .fillColor(options.color ?? INK);
      const lines = wrap(pdf, value, width);
      const height = lines.length * (size + 3.5) + (options.gap ?? 6);
      if (height <= BOTTOM - 120) ensure(height);
      for (const line of lines) {
        ensure(size + 4);
        pdf.text(line || ' ', 40 + indent, y, { width, lineBreak: false });
        y += size + 3.5;
      }
      y += options.gap ?? 6;
    };
    const section = (number: string, title: string) => {
      ensure(27);
      pdf
        .font('Helvetica-Bold')
        .fontSize(10)
        .fillColor(BLUE)
        .text(`${number}. ${title.toUpperCase()}`, 40, y);
      y += 18;
    };

    try {
      pageHeader();
      text('INSTRUMENTO PARTICULAR', {
        size: 8,
        bold: true,
        color: BLUE,
        gap: 12,
      });
      section('1', 'Partes');
      text(
        `CONTRATADO(A): ${data.contador.nome}, inscrito(a) sob CPF/CNPJ ${documentId(data.contador.documento)}, registro CRC ${data.contador.crc}${data.contador.endereco ? `, com endereço em ${data.contador.endereco}` : ''}.`,
      );
      text(
        `CONTRATANTE: ${data.cliente.razaoSocial}, CPF/CNPJ ${documentId(data.cliente.cnpj)}${data.cliente.endereco ? `, com endereço em ${data.cliente.endereco}` : ''}${data.cliente.representante ? `, representada por ${data.cliente.representante}` : ''}.`,
      );
      section('2', 'Objeto e serviços contratados');
      text(
        'O objeto deste instrumento compreende exclusivamente os serviços selecionados abaixo, conforme informações e documentos fornecidos pela CONTRATANTE:',
      );
      for (const [index, servico] of servicosDoInstrumento(
        data.contrato.servicosContratados,
      ).entries()) {
        text(
          `${index + 1}. ${servico.nome}${servico.escopo ? ` — ${servico.escopo}` : ''}`,
          { indent: 12, gap: 6 },
        );
      }
      text(
        'Serviços não relacionados acima dependerão de ajuste escrito entre as partes.',
      );
      section('3', 'Execução e responsabilidades');
      text(
        'O(A) CONTRATADO(A) executará os serviços contratados com observância das normas profissionais aplicáveis. A CONTRATANTE fornecerá, em tempo hábil, documentos, dados, acessos e esclarecimentos necessários à execução dos serviços e responderá pela veracidade das informações que entregar. Prazos legais dependem do recebimento tempestivo dessas informações.',
      );
      section('4', 'Honorários e pagamento');
      for (const servico of servicosDoInstrumento(
        data.contrato.servicosContratados,
      )) {
        pdf.font('Helvetica').fontSize(9).fillColor(INK);
        const linhas = wrap(pdf, servico.nome, 365);
        ensure(linhas.length * 13 + 14);
        for (const [index, linha] of linhas.entries()) {
          pdf.text(linha, 52, y + index * 13, {
            width: 365,
            lineBreak: false,
          });
        }
        pdf.font('Helvetica-Bold').text(money(servico.valorMensal), 430, y, {
          width: 113,
          align: 'right',
        });
        y += linhas.length * 13 + 7;
        rule(y);
        y += 7;
      }
      text(
        `Honorários mensais base: ${money(data.contrato.valorMensalidade)}. O vencimento ocorre no dia ${data.contrato.diaVencimento} do mês subsequente à competência dos serviços. O fechamento para faturamento é realizado no dia ${data.contrato.diaFechamento}.`,
        { gap: 10 },
      );
      if (data.contrato.gera13o) {
        text(
          `No mês ${String(data.contrato.mes13o).padStart(2, '0')}, será cobrado adicional anual de encerramento de exercício equivalente a uma mensalidade base (${money(data.contrato.valorMensalidade)}).`,
        );
      }
      const fixos = data.contrato.itens.filter((item) => item.ativo);
      if (fixos.length) {
        text(
          'Lançamentos recorrentes adicionais, sujeitos à vigência indicada:',
          { bold: true, gap: 4 },
        );
        for (const item of fixos) {
          const periodo =
            item.competenciaInicio || item.competenciaFim
              ? ` (vigência ${item.competenciaInicio ?? 'início não definido'} a ${item.competenciaFim ?? 'sem fim definido'})`
              : '';
          text(
            `${item.descricao}: ${item.natureza === 'CREDITO' ? 'desconto de ' : ''}${money(item.valor)}${periodo}.`,
            { indent: 12, gap: 4 },
          );
        }
      }
      text(
        'Qualquer reajuste dos honorários dependerá de acordo escrito entre as partes. Tributos, taxas públicas e serviços extraordinários não descritos neste instrumento não integram os honorários acima, salvo ajuste expresso.',
      );
      section('5', 'Vigência e encerramento');
      text(
        `A prestação terá início em ${civilDate(data.contrato.dataInicio!)} e vigorará por prazo indeterminado. Qualquer parte poderá solicitar o encerramento por comunicação escrita com antecedência de ${data.contrato.avisoPrevioDias} dia(s), sem prejuízo dos valores devidos pelos serviços prestados até o encerramento.`,
      );
      section('6', 'Sigilo e dados');
      text(
        'As partes manterão confidenciais as informações recebidas em razão deste contrato, ressalvadas as comunicações exigidas por lei e as necessárias à execução dos serviços. O tratamento de dados pessoais observará a legislação aplicável e o escopo deste instrumento.',
      );
      if (data.contrato.condicoesContratuais) {
        section('7', 'Condições adicionais');
        text(data.contrato.condicoesContratuais);
      }
      ensure(120);
      text('E, por estarem de acordo, as partes assinam este instrumento.', {
        gap: 6,
      });
      ensure(102);
      rule(y + 27);
      rule(y + 71);
      pdf
        .font('Helvetica')
        .fontSize(8)
        .fillColor(INK)
        .text(data.contador.nome, 40, y + 31, { width: 515, align: 'center' });
      pdf.text('CONTRATADO(A)', 40, y + 42, { width: 515, align: 'center' });
      pdf.text(
        data.cliente.representante || data.cliente.razaoSocial,
        40,
        y + 75,
        { width: 515, align: 'center' },
      );
      pdf.text('CONTRATANTE', 40, y + 86, { width: 515, align: 'center' });

      const range = pdf.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        pdf.switchToPage(i);
        pdf
          .font('Helvetica')
          .fontSize(7.5)
          .fillColor(MUTED)
          .text(`Página ${i - range.start + 1} de ${range.count}`, 480, 810, {
            width: 75,
            align: 'right',
          });
      }
      pdf.end();
    } catch (error) {
      reject(
        error instanceof Error ? error : new Error('Falha ao gerar contrato.'),
      );
      pdf.destroy();
    }
  });
}

@Injectable()
export class FinanceiroContratoDocumentoService {
  constructor(
    private readonly database: DatabaseService,
    private readonly contratos: FinanceiroContratosService,
  ) {}

  async gerarPdf(clienteId: string) {
    const contrato = await this.contratos.getByCliente(clienteId);
    const [row] = await this.database.db
      .select({ cliente: clientes, contador: contadores })
      .from(clientes)
      .leftJoin(contadores, eq(contadores.id, clientes.contadorId))
      .where(eq(clientes.id, clienteId))
      .limit(1);
    if (!row?.contador) {
      throw new BadRequestException(
        'Vincule um contador ao cliente antes de imprimir o contrato.',
      );
    }
    const cliente = row.cliente;
    const contador = row.contador;
    return renderContratoPdf({
      contrato,
      cliente: {
        razaoSocial: cliente.razaoSocial,
        cnpj: cliente.cnpj,
        tipoPessoa: cliente.tipoPessoa,
        representante: contrato.contratanteRepresentante,
        endereco: address([
          cliente.logradouro,
          cliente.numero,
          cliente.complemento,
          cliente.bairro,
          cliente.municipio,
          cliente.uf,
          cliente.cep,
        ]),
      },
      contador: {
        nome: contador.nome,
        documento: contador.cpf ?? contador.cnpj ?? '',
        crc: contador.crc,
        endereco: address([
          contador.logradouro,
          contador.numero,
          contador.complemento,
          contador.bairro,
          contador.cep,
        ]),
      },
    });
  }
}
