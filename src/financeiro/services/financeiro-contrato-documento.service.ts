import { BadRequestException, Injectable } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import PDFDocument from 'pdfkit';
import { IbgeMunicipiosService } from '../../clientes/ibge-municipios.service';
import { DatabaseService } from '../../database/database.service';
import { clientes, contadores } from '../../database/schema';
import { SERVICOS_CONTRATO } from '../financeiro-servicos.catalogo';
import {
  competenciaDeData,
  competenciaNaVigencia,
  fromCents,
  isValidCivilDate,
  toCents,
} from '../financeiro.utils';
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
const BOTTOM = 763;

const money = (value: string | number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    Number(value),
  );
const civilDate = (value: string) => {
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
};
const dateInWords = (value: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T12:00:00Z`));
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
    localAssinatura: string | null;
    dataAssinatura: string | null;
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
    municipio: string | null;
    uf: string | null;
  };
  contador: {
    nome: string;
    documento: string;
    crc: string;
    endereco: string;
    municipio: string | null;
    uf: string | null;
  };
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
  if (
    !data.contrato.dataInicio ||
    !isValidCivilDate(data.contrato.dataInicio)
  ) {
    throw new BadRequestException(
      'Informe a data de início do contrato antes de imprimir.',
    );
  }
  if (!data.contrato.localAssinatura?.trim()) {
    throw new BadRequestException(
      'Informe o local de assinatura antes de imprimir.',
    );
  }
  if (
    !data.contrato.dataAssinatura ||
    !isValidCivilDate(data.contrato.dataAssinatura)
  ) {
    throw new BadRequestException(
      'Informe a data de assinatura antes de imprimir.',
    );
  }
  if (data.cliente.tipoPessoa === 'PJ' && !data.cliente.representante?.trim()) {
    throw new BadRequestException(
      'Informe o responsável pela empresa no cadastro do cliente antes de imprimir.',
    );
  }
  if (!data.contador.nome || !data.contador.documento || !data.contador.crc) {
    throw new BadRequestException(
      'Complete o cadastro do contador vinculado antes de imprimir.',
    );
  }
  if (!data.contador.municipio?.trim() || !data.contador.uf?.trim()) {
    throw new BadRequestException(
      'Informe um município válido no cadastro do contador vinculado antes de imprimir o contrato.',
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
        justify?: boolean;
        link?: string;
      } = {},
    ) => {
      const size = options.size ?? 9;
      const indent = options.indent ?? 0;
      const width = 515 - indent;
      const style = () =>
        pdf
          .font(options.bold ? 'Helvetica-Bold' : 'Helvetica')
          .fontSize(size)
          .fillColor(options.color ?? INK);
      style();
      const paragraphs = value
        .split(/\r?\n/)
        .map((paragraph) => wrap(pdf, paragraph, width));
      const lineCount = paragraphs.reduce(
        (total, lines) => total + lines.length,
        0,
      );
      const height = lineCount * (size + 2.5) + (options.gap ?? 4);
      if (height <= BOTTOM - 120) ensure(height);
      for (const lines of paragraphs) {
        for (const [index, line] of lines.entries()) {
          ensure(size + 3);
          style();
          const words = line.trim().split(/\s+/);
          const justify =
            options.justify !== false &&
            index < lines.length - 1 &&
            words.length > 1;
          const wordSpacing = justify
            ? Math.max(
                0,
                (width - pdf.widthOfString(line)) / (words.length - 1),
              )
            : 0;
          pdf.text(line || ' ', 40 + indent, y, {
            lineBreak: false,
            ...(wordSpacing > 0 ? { wordSpacing } : {}),
          });
          if (options.link) {
            pdf.link(
              40 + indent,
              y,
              pdf.widthOfString(line),
              size + 2.5,
              options.link,
            );
          }
          y += size + 2.5;
        }
      }
      y += options.gap ?? 4;
    };
    const section = (number: string, title: string) => {
      ensure(44);
      pdf
        .font('Helvetica-Bold')
        .fontSize(10)
        .fillColor(BLUE)
        .text(`${number}. ${title.toUpperCase()}`, 40, y);
      y += 16;
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
      section('3', 'Obrigações da contratante');
      text(
        'A CONTRATANTE entregará documentos, dados e esclarecimentos completos, legíveis e verdadeiros, com a antecedência indicada no calendário de entregas comunicado pelo(a) CONTRATADO(A). Informará sem demora fatos, movimentações, admissões, desligamentos, alterações cadastrais, notificações e demais eventos relacionados aos serviços contratados.',
      );
      text(
        'Cabe à CONTRATANTE manter acessos e autorizações necessários, conferir as informações e documentos que lhe forem submetidos, tomar as decisões de gestão e efetuar, nos prazos legais, os pagamentos de tributos, salários e encargos sob sua responsabilidade. A entrega ao(à) CONTRATADO(A) não substitui essas obrigações.',
      );
      text(
        'A CONTRATANTE responderá pelas consequências de atrasos, omissões, inexatidões, documentos falsos ou atos praticados por si ou por seus prepostos, inclusive quando contrariem orientação técnica comunicada por escrito. Multas, juros e despesas decorrentes desses fatos serão de sua responsabilidade na medida do nexo causal e da culpa de cada parte. O(A) CONTRATADO(A) comunicará as pendências identificadas e os prazos afetados, sempre que possível.',
      );
      section('4', 'Atuação e responsabilidade profissional');
      text(
        'O(A) CONTRATADO(A) executará os serviços selecionados com diligência e observância das normas legais e profissionais, orientará a CONTRATANTE sobre as pendências identificadas e responderá pelos danos decorrentes de erro, omissão, dolo ou culpa próprios, conforme a legislação aplicável.',
      );
      text(
        'O(A) CONTRATADO(A) não assume a autoria ou a veracidade de fatos e documentos produzidos pela CONTRATANTE, nem decisões de gestão, recolhimentos não confiados expressamente ou atos de terceiros fora do escopo contratado. Poderá solicitar correção ou esclarecimento e recusar, mediante comunicação escrita, instrução ou ato contrário à lei ou às normas profissionais. Esta cláusula não afasta responsabilidades legais ou profissionais próprias.',
      );
      text(
        'A CONTRATANTE não solicitará registros fictícios, omissões deliberadas ou práticas ilícitas e fornecerá as informações exigidas para identificação e conformidade. O(A) CONTRATADO(A) poderá deixar de praticar o ato inviabilizado até a regularização, após comunicar a pendência, e cumprirá seus deveres legais de comunicação às autoridades quando aplicáveis.',
      );
      section('5', 'Honorários e pagamento');
      for (const servico of servicosDoInstrumento(
        data.contrato.servicosContratados,
      )) {
        pdf.font('Helvetica').fontSize(9).fillColor(INK);
        const linhas = wrap(pdf, servico.nome, 365);
        const alturaLinha = linhas.length * 12 + 12;
        if (y + alturaLinha > BOTTOM) {
          nextPage();
          text('Honorários e pagamento (continuação)', {
            size: 8,
            bold: true,
            color: BLUE,
            gap: 8,
          });
        }
        pdf.font('Helvetica').fontSize(9).fillColor(INK);
        for (const [index, linha] of linhas.entries()) {
          pdf.text(linha, 52, y + index * 12, {
            width: 365,
            lineBreak: false,
          });
        }
        pdf.font('Helvetica-Bold').text(money(servico.valorMensal), 430, y, {
          width: 113,
          align: 'right',
        });
        y += linhas.length * 12 + 6;
        rule(y);
        y += 6;
      }
      text(
        `Honorários mensais base: ${money(data.contrato.valorMensalidade)}. O vencimento ocorre no dia ${data.contrato.diaVencimento} do mês subsequente à competência dos serviços. O fechamento para faturamento é realizado no dia ${data.contrato.diaFechamento}.`,
        { gap: 10 },
      );
      if (data.contrato.gera13o) {
        text(
          `No mês ${String(data.contrato.mes13o).padStart(2, '0')}, será cobrado adicional anual de encerramento de exercício equivalente a uma mensalidade base (${money(data.contrato.valorMensalidade)}).`,
        );
        text(
          'O adicional remunera o trabalho adicional de encerramento do exercício, conforme os serviços contratados e efetivamente prestados: fechamento da escrituração, demonstrações contábeis anuais, obrigações acessórias anuais e folha do 13º salário, quando aplicáveis ao escopo deste contrato.',
        );
        text(
          'Fundamentação normativa: Resolução CFC nº 1.590/2020, art. 2º, alíneas “b”, “e” e “f”, e art. 4º; e NBC PG 01 (Código de Ética Profissional do Contador), itens 7, 8 e 9. Essas normas exigem o detalhamento dos serviços, honorários e condições de pagamento, a fixação escrita dos valores e a formalização do contrato.',
        );
        text(
          'Conforme orientação do Conselho Federal de Contabilidade, a obrigação de pagamento decorre deste ajuste expresso para remunerar os serviços de encerramento, sem natureza salarial.',
        );
        text('Fontes oficiais para consulta:', { size: 8, bold: true });
        text(
          'Resolução CFC nº 1.590/2020 - contrato de prestação de serviços contábeis (arts. 2º e 4º).',
          {
            size: 8,
            color: BLUE,
            link: 'https://www1.cfc.org.br/sisweb/SRE/docs/Res_1590%20(Alterada).pdf',
          },
        );
        text(
          'NBC PG 01 - Código de Ética Profissional do Contador (itens 7, 8 e 9).',
          {
            size: 8,
            color: BLUE,
            link: 'https://www1.cfc.org.br/sisweb/SRE/docs/NBCPG01.pdf',
          },
        );
        text(
          'CFC - Perguntas frequentes: Cobrança de 13º Salário por parte do Contabilista.',
          {
            size: 8,
            color: BLUE,
            link: 'https://cfc.org.br/fiscalizacao-etica-e-disciplina/perguntas-frequentes/cobranca-de-13o-salario-por-parte-do-contabilista/',
            gap: 8,
          },
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
      const competenciaInicial = competenciaDeData(data.contrato.dataInicio!);
      const totalMensal = fixos.reduce((total, item) => {
        if (
          !competenciaNaVigencia(
            competenciaInicial,
            item.competenciaInicio,
            item.competenciaFim,
          )
        ) {
          return total;
        }
        return (
          total + toCents(item.valor) * (item.natureza === 'CREDITO' ? -1 : 1)
        );
      }, toCents(data.contrato.valorMensalidade));
      text(
        `Total a pagar no vencimento de cada ciclo ${money(fromCents(Math.max(0, totalMensal)))}`,
        { bold: true, color: DEEP, gap: 8 },
      );
      text(
        'Tributos, taxas públicas e serviços extraordinários não descritos neste instrumento não integram os honorários acima, salvo ajuste expresso.',
      );
      section('6', 'Reajuste anual dos honorários');
      text(
        'Após 12 meses do início da vigência, e a cada período subsequente de 12 meses, os honorários mensais base serão reajustados pela variação positiva acumulada do IPCA/IBGE nos 12 meses anteriores à data-base. Se o índice deixar de ser divulgado, será utilizado o índice oficial que o substituir. O novo valor será comunicado por escrito antes da primeira cobrança reajustada.',
      );
      text(
        'Se o aumento percentual do salário mínimo nacional superar o IPCA no mesmo período, as partes avaliarão o impacto comprovado nos custos dos serviços e poderão pactuar complemento por aditivo escrito. O salário mínimo não constitui indexador automático dos honorários. Mudanças no escopo ou no volume de trabalho também dependerão de ajuste escrito.',
      );
      section('7', 'Vigência e encerramento');
      text(
        `A prestação terá início em ${civilDate(data.contrato.dataInicio!)} e vigorará por prazo indeterminado. Qualquer parte poderá solicitar o encerramento por comunicação escrita com antecedência de ${data.contrato.avisoPrevioDias} dia(s), sem prejuízo dos valores devidos pelos serviços prestados até o encerramento.`,
      );
      section('8', 'Inadimplência, suspensão e rescisão');
      text(
        'Ao acumular 3 (três) mensalidades vencidas e não integralmente quitadas, consecutivas ou não, a CONTRATANTE terá os serviços contratados suspensos, independentemente de aviso prévio, enquanto persistir a inadimplência. O pagamento parcial não quita a mensalidade nem afasta sua contagem para esse fim. A retomada dependerá da quitação dos débitos ou de acordo escrito entre as partes.',
      );
      text(
        'A inadimplência também sujeita o contrato à rescisão unilateral motivada pelo(a) CONTRATADO(A), mediante comunicação escrita à CONTRATANTE. A suspensão e a rescisão não extinguem os valores vencidos nem afastam os deveres legais e ético-profissionais do(a) CONTRATADO(A), inclusive quanto ao distrato ou, se este não for possível, à notificação da cessação das responsabilidades e à disponibilização dos documentos da CONTRATANTE.',
      );
      section('9', 'Sigilo e dados');
      text(
        'As partes manterão confidenciais as informações recebidas em razão deste contrato, ressalvadas as comunicações exigidas por lei e as necessárias à execução dos serviços. O tratamento de dados pessoais observará a legislação aplicável e o escopo deste instrumento.',
      );
      section('10', 'Foro competente');
      text(
        `Para dirimir controvérsias decorrentes deste contrato, as partes elegem o foro da comarca que abrange o município de ${data.contador.municipio!.trim()}/${data.contador.uf!.trim()}, domicílio do(a) CONTRATADO(A), observadas as regras de competência inderrogável e os direitos do consumidor quando aplicáveis.`,
      );
      if (data.contrato.condicoesContratuais) {
        section('11', 'Condições adicionais');
        text(data.contrato.condicoesContratuais);
      }
      ensure(120);
      text('E, por estarem de acordo, as partes assinam este instrumento.', {
        gap: 6,
      });
      text(
        `${data.contrato.localAssinatura!.trim()}, ${dateInWords(data.contrato.dataAssinatura!)}.`,
        { bold: true, gap: 10 },
      );
      ensure(78);
      rule(y + 22);
      rule(y + 61);
      pdf
        .font('Helvetica')
        .fontSize(8)
        .fillColor(INK)
        .text(data.contador.nome, 40, y + 26, { width: 515, align: 'center' });
      pdf.text('CONTRATADO(A)', 40, y + 37, { width: 515, align: 'center' });
      pdf.text(
        data.cliente.representante || data.cliente.razaoSocial,
        40,
        y + 65,
        { width: 515, align: 'center' },
      );
      pdf.text('CONTRATANTE', 40, y + 76, { width: 515, align: 'center' });

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
    private readonly ibge: IbgeMunicipiosService,
  ) {}

  async gerarPdf(clienteId: string) {
    const original = await this.contratos.obterOriginal(clienteId);
    if (original) {
      if (!original.contador)
        throw new BadRequestException(
          'O contrato original não possui contador registrado.',
        );
      const localidade = await this.ibge.resolverLocalidade(
        original.contador.codigoMunicipioIbge,
      );
      if (!localidade)
        throw new BadRequestException(
          'Não foi possível confirmar o município do contador do contrato original. Tente novamente.',
        );
      return renderContratoPdf({
        contrato: { ...original.contrato, itens: original.itens },
        cliente: original.cliente,
        contador: {
          ...original.contador,
          ...localidade,
          endereco: address([
            original.contador.endereco,
            localidade.municipio,
            localidade.uf,
          ]),
        },
      });
    }
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
    const localidade = await this.ibge.resolverLocalidade(
      contador.codigoMunicipioIbge,
    );
    if (!localidade) {
      throw new BadRequestException(
        'Não foi possível confirmar o município do contador para definir o foro. Verifique o código IBGE no cadastro do contador e tente novamente.',
      );
    }
    return renderContratoPdf({
      contrato,
      cliente: {
        razaoSocial: cliente.razaoSocial,
        cnpj: cliente.cnpj,
        tipoPessoa: cliente.tipoPessoa,
        representante: cliente.responsavelNome,
        municipio: cliente.municipio,
        uf: cliente.uf,
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
        municipio: localidade.municipio,
        uf: localidade.uf,
        endereco: address([
          contador.logradouro,
          contador.numero,
          contador.complemento,
          contador.bairro,
          localidade.municipio,
          localidade.uf,
          contador.cep,
        ]),
      },
    });
  }
}
