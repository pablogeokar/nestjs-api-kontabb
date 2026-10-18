import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, sql, type SQL } from 'drizzle-orm';
import PDFDocument from 'pdfkit';
import { DatabaseService } from '../../database/database.service';
import {
  clientes,
  documentosFiscais,
  documentosFiscaisItens,
} from '../../database/schema';

interface LivroIssInput {
  clienteId: string;
  competencia: string;
  tipoOperacao?: 'ENTRADA' | 'SAIDA';
}

export interface LivroIssLinha {
  documento_id: string;
  tipo_operacao: 'ENTRADA' | 'SAIDA';
  data_emissao: string;
  competencia: string;
  numero_nfse: string;
  codigo_verificacao: string | null;
  chave_acesso: string;
  contraparte_cnpj_cpf: string;
  contraparte_razao_social: string | null;
  contraparte_municipio: string | null;
  contraparte_uf: string | null;
  discriminacao: string;
  item_lista_servico: string | null;
  cnae: string | null;
  valor_servicos: string;
  valor_deducoes_descontos: string;
  base_calculo_iss: string;
  aliquota_iss: string;
  valor_iss: string;
  iss_retido: boolean;
  valor_iss_retido: string;
  municipio_incidencia: string | null;
  iss_outro_municipio: boolean;
  exigibilidade_iss: string | null;
  situacao: string;
}

@Injectable()
export class FiscalIssLivroService {
  constructor(private readonly database: DatabaseService) {}

  async obter(input: LivroIssInput) {
    const [cliente] = await this.database.db
      .select({
        id: clientes.id,
        razaoSocial: clientes.razaoSocial,
        cnpj: clientes.cnpj,
        logradouro: clientes.logradouro,
        numero: clientes.numero,
        complemento: clientes.complemento,
        bairro: clientes.bairro,
        municipio: clientes.municipio,
        uf: clientes.uf,
        regimeTributario: clientes.regimeTributario,
      })
      .from(clientes)
      .where(eq(clientes.id, input.clienteId))
      .limit(1);
    if (!cliente) throw new NotFoundException('Empresa não encontrada.');

    const inicio = `${input.competencia}-01`;
    const conditions: SQL[] = [
      eq(documentosFiscais.clienteId, input.clienteId),
      eq(documentosFiscais.tipoDocumento, 'NFSE'),
      sql`coalesce(${documentosFiscais.competenciaDeclarada}, ${documentosFiscais.dataEmissaoFiscal}, ${documentosFiscais.dataEmissao}::date) >= ${inicio}::date`,
      sql`coalesce(${documentosFiscais.competenciaDeclarada}, ${documentosFiscais.dataEmissaoFiscal}, ${documentosFiscais.dataEmissao}::date) < (${inicio}::date + interval '1 month')`,
    ];
    if (input.tipoOperacao) {
      conditions.push(
        eq(documentosFiscais.tipoOperacaoEscriturada, input.tipoOperacao),
      );
    }

    const rows = await this.database.db
      .select({
        documentoId: documentosFiscais.id,
        tipoOperacao: documentosFiscais.tipoOperacaoEscriturada,
        dataEmissao: documentosFiscais.dataEmissao,
        competencia: documentosFiscais.competenciaDeclarada,
        numeroDocumento: documentosFiscais.numeroDocumento,
        codigoVerificacao: documentosFiscais.codigoVerificacao,
        chaveAcesso: documentosFiscais.chaveAcesso,
        emitenteCnpjCpf: documentosFiscais.emitenteCnpjCpf,
        emitenteRazaoSocial: documentosFiscais.emitenteRazaoSocial,
        emitenteDados: documentosFiscais.emitenteDados,
        destinatarioCnpjCpf: documentosFiscais.destinatarioCnpjCpf,
        destinatarioRazaoSocial: documentosFiscais.destinatarioRazaoSocial,
        destinatarioDados: documentosFiscais.destinatarioDados,
        municipioIncidencia: documentosFiscais.municipioIncidencia,
        situacao: documentosFiscais.situacao,
        nfseDados: documentosFiscais.nfseDados,
        descricao: documentosFiscaisItens.descricao,
        itemListaServico: documentosFiscaisItens.itemListaServico,
        cnae: documentosFiscaisItens.cnae,
        valorServicos: documentosFiscaisItens.valorBrutoProduto,
        baseCalculoIss: documentosFiscaisItens.valorBcIss,
        aliquotaIss: documentosFiscaisItens.aliquotaIss,
        valorIss: documentosFiscaisItens.valorIss,
        issRetido: documentosFiscaisItens.issRetido,
        exigibilidadeIss: documentosFiscaisItens.exigibilidadeIss,
      })
      .from(documentosFiscais)
      .innerJoin(
        documentosFiscaisItens,
        eq(documentosFiscaisItens.documentoFiscalId, documentosFiscais.id),
      )
      .where(and(...conditions))
      .orderBy(
        asc(documentosFiscais.dataEmissao),
        asc(documentosFiscais.numeroDocumento),
        asc(documentosFiscaisItens.numeroItem),
      );

    const linhas: LivroIssLinha[] = rows.map((row) => {
      const nfse = record(row.nfseDados);
      const emitente = record(row.emitenteDados);
      const destinatario = record(row.destinatarioDados);
      const entrada = row.tipoOperacao === 'ENTRADA';
      const contraparte = entrada ? emitente : destinatario;
      const municipioPrestador = stringValue(emitente.codMun);
      const municipioIncidencia = row.municipioIncidencia;
      const deducoes =
        toCents(stringValue(nfse.valorDeducoes)) +
        toCents(stringValue(nfse.descontoIncondicionado));
      const valorIss = money(row.valorIss);
      return {
        documento_id: row.documentoId,
        tipo_operacao: row.tipoOperacao as 'ENTRADA' | 'SAIDA',
        data_emissao: row.dataEmissao.toISOString(),
        competencia: row.competencia ?? input.competencia + '-01',
        numero_nfse: row.numeroDocumento,
        codigo_verificacao: row.codigoVerificacao,
        chave_acesso: row.chaveAcesso,
        contraparte_cnpj_cpf: entrada
          ? row.emitenteCnpjCpf
          : row.destinatarioCnpjCpf,
        contraparte_razao_social: entrada
          ? row.emitenteRazaoSocial
          : row.destinatarioRazaoSocial,
        contraparte_municipio: stringValue(contraparte.codMun) || null,
        contraparte_uf: stringValue(contraparte.uf) || null,
        discriminacao: row.descricao,
        item_lista_servico: row.itemListaServico,
        cnae: row.cnae,
        valor_servicos: money(row.valorServicos),
        valor_deducoes_descontos: fromCents(deducoes),
        base_calculo_iss: money(row.baseCalculoIss),
        aliquota_iss: rate(row.aliquotaIss),
        valor_iss: valorIss,
        iss_retido: row.issRetido,
        valor_iss_retido: row.issRetido ? valorIss : '0.00',
        municipio_incidencia: municipioIncidencia,
        iss_outro_municipio: Boolean(
          municipioPrestador &&
          municipioIncidencia &&
          municipioPrestador !== municipioIncidencia,
        ),
        exigibilidade_iss: row.exigibilidadeIss,
        situacao: row.situacao,
      };
    });

    const regimeSimples = cliente.regimeTributario === 'SIMPLES_NACIONAL';
    const inscricaoMunicipal = rows
      .map((row) =>
        stringValue(record(row.nfseDados).inscricaoMunicipalPrestador),
      )
      .find(Boolean);

    return {
      cabecalho: {
        cliente_id: cliente.id,
        razao_social: cliente.razaoSocial,
        cnpj: cliente.cnpj,
        inscricao_municipal: inscricaoMunicipal ?? null,
        endereco: [
          cliente.logradouro,
          cliente.numero,
          cliente.complemento,
          cliente.bairro,
        ]
          .filter(Boolean)
          .join(', '),
        municipio: cliente.municipio,
        uf: cliente.uf,
        competencia: input.competencia,
        regime_tributario: cliente.regimeTributario,
        tipo_operacao: input.tipoOperacao ?? 'TODAS',
      },
      resumo: resumirLivroIss(linhas, regimeSimples),
      linhas,
    };
  }

  async gerarPdf(input: LivroIssInput) {
    const livro = await this.obter(input);
    const document = new PDFDocument({ size: 'A4', margin: 36 });
    const chunks: Buffer[] = [];
    document.on('data', (chunk: Buffer) => chunks.push(chunk));
    const completed = new Promise<Buffer>((resolve, reject) => {
      document.on('end', () => resolve(Buffer.concat(chunks)));
      document.on('error', reject);
    });

    document.fontSize(15).text('Livro de Registro e Apuração do ISS', {
      align: 'center',
    });
    document.moveDown(0.5);
    document.fontSize(9).text(livro.cabecalho.razao_social);
    document.text(
      `CNPJ: ${livro.cabecalho.cnpj}  |  IM: ${livro.cabecalho.inscricao_municipal ?? 'não informada'}`,
    );
    document.text(
      `Competência: ${livro.cabecalho.competencia}  |  Regime: ${livro.cabecalho.regime_tributario ?? 'não informado'}`,
    );
    document.text(`Operação: ${livro.cabecalho.tipo_operacao}`);
    document.moveDown();
    document.fontSize(11).text('Resumo da competência');
    document.fontSize(9);
    document.text(`NFS-e autorizadas: ${livro.resumo.quantidade_documentos}`);
    document.text(
      `Serviços prestados e tomados: R$ ${formatBrMoney(toCents(livro.resumo.total_servicos))}`,
    );
    document.text(
      `Base no município: R$ ${formatBrMoney(toCents(livro.resumo.base_calculo_municipio))}`,
    );
    document.text(
      `Base em outros municípios: R$ ${formatBrMoney(toCents(livro.resumo.base_calculo_outros_municipios))}`,
    );
    document.text(
      `ISS próprio: R$ ${formatBrMoney(toCents(livro.resumo.total_iss_proprio))}`,
    );
    document.text(
      `ISS retido: R$ ${formatBrMoney(toCents(livro.resumo.total_iss_retido))}`,
    );
    document.text(
      `ISS próprio a recolher no município: R$ ${formatBrMoney(toCents(livro.resumo.saldo_iss_recolher_municipio))}`,
    );
    document.text(livro.resumo.observacao);
    document.moveDown();
    document.fontSize(11).text('Documentos');
    document
      .fontSize(7)
      .fillColor('#475569')
      .text(
        'Notas canceladas constam para conferência e não integram os totais da apuração.',
      )
      .fillColor('#000000');
    document.moveDown(0.5);
    for (const linha of livro.linhas) {
      if (document.y > 680) document.addPage();
      document
        .font('Helvetica-Bold')
        .fontSize(8)
        .text(
          `NFS-e ${linha.numero_nfse} | ${linha.data_emissao.slice(0, 10)} | ${linha.tipo_operacao === 'SAIDA' ? 'Prestado' : 'Tomado'} | ${linha.situacao}`,
        );
      document
        .font('Helvetica')
        .fontSize(7)
        .fillColor('#475569')
        .text(
          `Contraparte: ${linha.contraparte_razao_social ?? linha.contraparte_cnpj_cpf} | CNPJ/CPF: ${linha.contraparte_cnpj_cpf}`,
        )
        .text(
          `Serviço: ${linha.item_lista_servico ?? 'não informado'} | CNAE: ${linha.cnae ?? 'não informado'} | Município de incidência: ${linha.municipio_incidencia ?? 'não informado'}`,
        )
        .text(
          `Valor: R$ ${formatBrMoney(toCents(linha.valor_servicos))} | Base ISS: R$ ${formatBrMoney(toCents(linha.base_calculo_iss))} | Alíquota: ${linha.aliquota_iss}% | ISS: R$ ${formatBrMoney(toCents(linha.valor_iss))}${linha.iss_retido ? ' (retido)' : ''}`,
        )
        .fillColor('#000000');
      document.moveDown(0.5);
    }
    document.end();
    return completed;
  }
}

export function resumirLivroIss(
  linhas: LivroIssLinha[],
  regimeSimples: boolean,
) {
  const validas = linhas.filter((linha) => linha.situacao === 'AUTORIZADA');
  const soma = (selector: (linha: LivroIssLinha) => string) =>
    fromCents(
      validas.reduce((total, linha) => total + toCents(selector(linha)), 0n),
    );
  const issProprio = validas.filter(
    (linha) =>
      linha.tipo_operacao === 'SAIDA' &&
      linha.exigibilidade_iss === '1' &&
      !linha.iss_retido &&
      !linha.iss_outro_municipio,
  );
  const issRetido = validas.filter((linha) => linha.iss_retido);
  const totalIssProprio = issProprio.reduce(
    (total, linha) => total + toCents(linha.valor_iss),
    0n,
  );
  const totalIssRetido = issRetido.reduce(
    (total, linha) => total + toCents(linha.valor_iss_retido),
    0n,
  );
  return {
    quantidade_documentos: new Set(validas.map((linha) => linha.documento_id))
      .size,
    total_servicos: soma((linha) => linha.valor_servicos),
    total_deducoes_descontos: soma((linha) => linha.valor_deducoes_descontos),
    base_calculo_municipio: fromCents(
      validas
        .filter((linha) => !linha.iss_outro_municipio)
        .reduce((total, linha) => total + toCents(linha.base_calculo_iss), 0n),
    ),
    base_calculo_outros_municipios: fromCents(
      validas
        .filter((linha) => linha.iss_outro_municipio)
        .reduce((total, linha) => total + toCents(linha.base_calculo_iss), 0n),
    ),
    total_iss_proprio: fromCents(totalIssProprio),
    total_iss_retido: fromCents(totalIssRetido),
    saldo_iss_recolher_municipio: regimeSimples
      ? '0.00'
      : fromCents(totalIssProprio),
    forma_recolhimento: regimeSimples ? ('DAS' as const) : ('DAM' as const),
    observacao: regimeSimples
      ? `ISS próprio englobado no DAS do Simples Nacional; parcela retida na fonte segregada no valor de R$ ${formatBrMoney(totalIssRetido)}.`
      : 'ISS próprio a recolher por guia municipal (DAM), observadas retenções e incidência em outros municípios.',
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown) {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : '';
}

function money(value: string | null) {
  return value == null ? '0.00' : fromCents(toCents(value));
}

function rate(value: string | null) {
  if (value == null) return '0.0000';
  const [integer, fraction = ''] = value.split('.');
  return `${integer}.${fraction.padEnd(4, '0').slice(0, 4)}`;
}

function toCents(value: string) {
  const match = /^(\d+)(?:\.(\d{1,4}))?$/.exec(value || '0');
  if (!match) return 0n;
  return (
    BigInt(match[1]) * 100n +
    BigInt((match[2] ?? '').padEnd(2, '0').slice(0, 2))
  );
}

function fromCents(value: bigint) {
  return `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
}

function formatBrMoney(value: bigint) {
  return (Number(value) / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
