import { XMLParser } from 'fast-xml-parser';
import type {
  ParsedDocumentoFiscal,
  ParsedParticipanteFiscal,
} from './dfe-document.parser';
import type { RelatorioIntegridadeDocumentoFiscal } from './dfe-document.integrity';
import type { ParsedNfeItem } from './nfe-item.parser';
import { normalizeFiscalCnpj, normalizeFiscalCpf } from './fiscal-identifier';

type XmlRecord = Record<string, unknown>;

export interface ParsedNfseDados {
  provedor: 'WEBISS';
  versaoAbrasf: string;
  codigoVerificacao: string;
  competencia: string;
  municipioIncidencia: string;
  municipioPrestacao: string;
  municipioPrestador: string;
  regimeEspecialTributacao: string;
  optanteSimplesNacional: boolean;
  exigibilidadeIss: string;
  issRetido: boolean;
  itemListaServico: string;
  cnae: string;
  codigoTributacaoMunicipio: string;
  inscricaoMunicipalPrestador: string;
  valorServicos: string;
  baseCalculoIss: string;
  aliquotaIss: string;
  valorIss: string;
  valorIssRetido: string;
  valorLiquidoNfse: string;
  valorDeducoes: string;
  descontoIncondicionado: string;
  retencoesFederais: string;
  outrasInformacoes: string;
  discriminacao: string;
  cancelada: boolean;
  substituida: boolean;
  dataHoraCancelamento: string;
  codigoCancelamento: string;
  motivoCancelamento: string;
  nfseSubstituidora: string;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

/**
 * Converte uma NFS-e WebISS/ABRASF 2.02 para o contrato canônico consumido
 * pela importação fiscal. Mantém decimais como texto para não introduzir
 * arredondamento IEEE-754 em valores fiscais.
 */
export function parseNfseWebissXml(xml: string): ParsedDocumentoFiscal | null {
  if (!xml.trim() || /<!DOCTYPE\b|<!ENTITY\b/i.test(xml)) return null;

  let parsed: unknown;
  try {
    parsed = parser.parse(xml) as unknown;
  } catch {
    return null;
  }

  const nfse = findRecordByKey(parsed, 'Nfse');
  const infNfse = nfse
    ? asRecord(nfse.InfNfse)
    : findRecordByKey(parsed, 'InfNfse');
  if (!infNfse) return null;

  const declaracao = asRecord(infNfse.DeclaracaoPrestacaoServico);
  const infDeclaracao =
    asRecord(declaracao?.InfDeclaracaoPrestacaoServico) ?? declaracao;
  const servico = asRecord(infDeclaracao?.Servico);
  const valoresServico = asRecord(servico?.Valores) ?? {};
  const valoresNfse = asRecord(infNfse.ValoresNfse) ?? {};
  if (!infDeclaracao || !servico) return null;

  const prestadorServico = asRecord(infNfse.PrestadorServico);
  const prestadorDeclaracao = asRecord(infDeclaracao.Prestador);
  const prestador = parsePrestador(prestadorServico, prestadorDeclaracao);
  const tomador = parseTomador(asRecord(infDeclaracao.Tomador));
  if (!prestador?.cnpjCpf || !tomador?.cnpjCpf) return null;

  const chaveInformada = text(infNfse.ChaveAcesso);
  const idInfNfse = text(infNfse['@_Id']);
  const chaveAcesso = validNfseIdentifier(chaveInformada)
    ? chaveInformada
    : validNfseIdentifier(idInfNfse)
      ? idInfNfse
      : '';
  if (!chaveAcesso) return null;

  const numeroDocumento = text(infNfse.Numero);
  const codigoVerificacao = text(infNfse.CodigoVerificacao);
  const dataEmissaoValue = text(infNfse.DataEmissao);
  const dataEmissaoFiscal = fiscalDate(dataEmissaoValue);
  const competencia = fiscalDate(text(infDeclaracao.Competencia));
  const dataEmissao = new Date(dataEmissaoValue);
  if (
    !/^\d{1,30}$/.test(numeroDocumento) ||
    !codigoVerificacao ||
    codigoVerificacao.length > 32 ||
    Number.isNaN(dataEmissao.getTime()) ||
    !dataEmissaoFiscal ||
    !competencia
  ) {
    return null;
  }
  const cicloVida = parseNfseLifecycle(parsed, numeroDocumento);

  const valorServicos = money(valoresServico.ValorServicos);
  const valorDeducoes = money(valoresServico.ValorDeducoes, '0');
  const descontoIncondicionado = money(
    valoresServico.DescontoIncondicionado,
    '0',
  );
  const baseCalculoIss = money(valoresNfse.BaseCalculo);
  const aliquotaIss = rate(valoresNfse.Aliquota);
  const valorIss = money(valoresNfse.ValorIss);
  const valorLiquidoNfse = money(valoresNfse.ValorLiquidoNfse, valorServicos);
  if (!valorServicos || !baseCalculoIss || !aliquotaIss || !valorIss) {
    return null;
  }

  const issRetido = text(servico.IssRetido) === '1';
  const itemListaServico = text(servico.ItemListaServico);
  const cnae = digits(servico.CodigoCnae);
  const codigoTributacaoMunicipio = text(servico.CodigoTributacaoMunicipio);
  const exigibilidadeIss = text(servico.ExigibilidadeISS);
  const municipioIncidencia = digits(servico.MunicipioIncidencia);
  const municipioPrestacao = digits(servico.CodigoMunicipio);
  if (
    !itemListaServico ||
    !/^\d{7}$/.test(cnae) ||
    !/^\d{1,2}$/.test(exigibilidadeIss) ||
    !/^\d{7}$/.test(municipioIncidencia)
  ) {
    return null;
  }

  const retencoesFederais = sumMoney([
    valoresServico.ValorPis,
    valoresServico.ValorCofins,
    valoresServico.ValorInss,
    valoresServico.ValorIr,
    valoresServico.ValorCsll,
    valoresServico.OutrasRetencoes,
  ]);
  const valorIssRetido = issRetido
    ? money(valoresServico.ValorIss, valorIss)
    : '0.00';
  const nfseDados: ParsedNfseDados = {
    provedor: 'WEBISS',
    versaoAbrasf: text(nfse?.['@_versao']) || '2.02',
    codigoVerificacao,
    competencia,
    municipioIncidencia,
    municipioPrestacao,
    municipioPrestador: prestador.codMun,
    regimeEspecialTributacao: text(infDeclaracao.RegimeEspecialTributacao),
    optanteSimplesNacional: text(infDeclaracao.OptanteSimplesNacional) === '1',
    exigibilidadeIss,
    issRetido,
    itemListaServico,
    cnae,
    codigoTributacaoMunicipio,
    inscricaoMunicipalPrestador:
      text(
        asRecord(prestadorServico?.IdentificacaoPrestador)?.InscricaoMunicipal,
      ) || text(prestadorDeclaracao?.InscricaoMunicipal),
    valorServicos,
    baseCalculoIss,
    aliquotaIss,
    valorIss,
    valorIssRetido,
    valorLiquidoNfse,
    valorDeducoes,
    descontoIncondicionado,
    retencoesFederais,
    outrasInformacoes: text(infNfse.OutrasInformacoes),
    discriminacao: text(servico.Discriminacao),
    ...cicloVida,
  };
  const integridade = conferirIntegridadeNfse(nfseDados);
  const item = buildServiceItem(nfseDados);

  return {
    chaveAcesso,
    nsu: 0,
    tipoDocumento: 'NFSE',
    modelo: 'NFSE',
    serie: '',
    numeroDocumento,
    emitenteCnpjCpf: prestador.cnpjCpf,
    emitenteRazaoSocial: prestador.nome,
    destinatarioCnpjCpf: tomador.cnpjCpf,
    destinatarioRazaoSocial: tomador.nome,
    emitente: prestador,
    destinatario: tomador,
    tomador,
    dataEmissao,
    dataEmissaoFiscal,
    dataEntradaSaida: null,
    dataEntradaSaidaFiscal: null,
    modalidadeFrete: null,
    valorTotal: valorServicos,
    tpNfXml: '1',
    situacao: nfseDados.cancelada ? 'CANCELADA' : 'AUTORIZADA',
    participantesCnpjCpf: [prestador.cnpjCpf, tomador.cnpjCpf],
    itens: [item],
    quantidadeItensDeclarada: 1,
    icmsTot: null,
    pisCofinsTotais: null,
    informacoesComplementares: {
      contribuinte: nfseDados.outrasInformacoes,
      fisco: '',
    },
    documentosReferenciados: [],
    integridade,
    cteEscrituracao: null,
    nfseDados,
    xmlContent: xml,
  };
}

function parseNfseLifecycle(parsed: unknown, numeroDocumento: string) {
  const cancelamento = findRecordByKey(parsed, 'NfseCancelamento');
  const confirmacao = asRecord(cancelamento?.Confirmacao);
  const pedido = asRecord(confirmacao?.Pedido);
  const infPedido = asRecord(pedido?.InfPedidoCancelamento);
  const identificacao = asRecord(infPedido?.IdentificacaoNfse);
  const numeroCancelado = text(identificacao?.Numero);
  const cancelamentoConfirmado = Boolean(
    confirmacao && (!numeroCancelado || numeroCancelado === numeroDocumento),
  );

  const substituicao = findRecordByKey(parsed, 'NfseSubstituicao');
  const substituicaoNfse = asRecord(substituicao?.SubstituicaoNfse);
  const numeroSubstituidora = digits(substituicaoNfse?.NfseSubstituidora);
  const nfseSubstituidora = /^\d{1,30}$/.test(numeroSubstituidora)
    ? numeroSubstituidora
    : '';
  const substituida = Boolean(nfseSubstituidora);

  return {
    cancelada: cancelamentoConfirmado || substituida,
    substituida,
    dataHoraCancelamento: cancelamentoConfirmado
      ? text(confirmacao?.DataHora)
      : '',
    codigoCancelamento: cancelamentoConfirmado
      ? text(infPedido?.CodigoCancelamento)
      : '',
    motivoCancelamento: cancelamentoConfirmado
      ? text(infPedido?.MotivoCancelamento)
      : '',
    nfseSubstituidora,
  };
}

function buildServiceItem(nfse: ParsedNfseDados): ParsedNfeItem {
  return {
    numeroItem: 1,
    codigoProduto: nfse.itemListaServico || nfse.cnae,
    descricao: nfse.discriminacao || 'Serviço prestado',
    ncm: null,
    cfop: '5933',
    unidadeComercial: 'UN',
    quantidadeComercial: '1',
    valorUnitarioComercial: nfse.valorServicos,
    valorBrutoProduto: nfse.valorServicos,
    valorDesconto: nfse.descontoIncondicionado,
    indTotal: '1',
    valorBcIss: nfse.baseCalculoIss,
    aliquotaIss: nfse.aliquotaIss,
    valorIss: nfse.valorIss,
    issRetido: nfse.issRetido,
    itemListaServico: nfse.itemListaServico,
    cnae: nfse.cnae,
    codigoTributacaoMunicipio: nfse.codigoTributacaoMunicipio,
    exigibilidadeIss: nfse.exigibilidadeIss,
    municipioIncidencia: nfse.municipioIncidencia,
  } as ParsedNfeItem;
}

function conferirIntegridadeNfse(
  nfse: ParsedNfseDados,
): RelatorioIntegridadeDocumentoFiscal {
  const tolerance = 2n;
  const service = cents(nfse.valorServicos);
  const deductions = cents(nfse.valorDeducoes);
  const discount = cents(nfse.descontoIncondicionado);
  const declaredBase = cents(nfse.baseCalculoIss);
  const calculatedBase = service - deductions - discount;
  const aliquotaBasisPoints = rateBasisPoints(nfse.aliquotaIss);
  const declaredIss = cents(nfse.valorIss);
  const calculatedIss = divideRound(
    calculatedBase * aliquotaBasisPoints,
    1_000_000n,
  );
  const federal = cents(nfse.retencoesFederais);
  const retainedIss = nfse.issRetido ? cents(nfse.valorIssRetido) : 0n;
  const declaredLiquid = cents(nfse.valorLiquidoNfse);
  const calculatedLiquid = service - federal - retainedIss;
  const checks = [
    integrityCheck('BASE_CALCULO_ISS', declaredBase, calculatedBase, tolerance),
    integrityCheck('VALOR_ISS', declaredIss, calculatedIss, tolerance),
    integrityCheck(
      'VALOR_LIQUIDO_NFSE',
      declaredLiquid,
      calculatedLiquid,
      tolerance,
    ),
  ];
  const divergencias = checks.filter((item) => item.status === 'DIVERGENTE');
  return {
    status: divergencias.length > 0 ? 'DIVERGENTE' : 'CONFORME',
    tolerancia: '0.02',
    quantidadeItensDeclarada: 1,
    quantidadeItensProcessada: 1,
    valorDocumentoComparadoComSomaProdutos: false,
    verificacoes: checks,
    divergencias,
  };
}

function integrityCheck(
  codigo: string,
  declarado: bigint,
  calculado: bigint,
  tolerancia: bigint,
) {
  const diferenca = absoluto(declarado - calculado);
  return {
    codigo,
    tipo: 'SOMA_ITENS' as const,
    campoTotal: null,
    campoItem: null,
    declarado: formatCents(declarado),
    calculado: formatCents(calculado),
    diferenca: formatCents(diferenca),
    tolerancia: formatCents(tolerancia),
    status:
      diferenca <= tolerancia ? ('CONFORME' as const) : ('DIVERGENTE' as const),
  };
}

function parsePrestador(
  prestadorServico: XmlRecord | null,
  prestadorDeclaracao: XmlRecord | null,
): ParsedParticipanteFiscal | null {
  if (!prestadorServico && !prestadorDeclaracao) return null;
  const identificacao =
    asRecord(prestadorServico?.IdentificacaoPrestador) ?? prestadorDeclaracao;
  return parseParticipante(
    identificacao,
    prestadorServico,
    text(prestadorServico?.RazaoSocial),
  );
}

function parseTomador(tomador: XmlRecord | null) {
  if (!tomador) return null;
  return parseParticipante(
    asRecord(tomador.IdentificacaoTomador),
    tomador,
    text(tomador.RazaoSocial),
  );
}

function parseParticipante(
  identificacao: XmlRecord | null,
  dados: XmlRecord | null,
  nome: string,
): ParsedParticipanteFiscal | null {
  const cpfCnpj = asRecord(identificacao?.CpfCnpj) ?? identificacao;
  const cnpj = normalizeFiscalCnpj(text(cpfCnpj?.Cnpj));
  const cpf = normalizeFiscalCpf(text(cpfCnpj?.Cpf));
  const endereco = asRecord(dados?.Endereco) ?? {};
  const id = cnpj || cpf;
  if (!id) return null;
  return {
    cnpjCpf: id,
    cnpj,
    cpf,
    nome,
    ie: text(identificacao?.InscricaoEstadual),
    uf: text(endereco.Uf).toUpperCase(),
    codMun: digits(endereco.CodigoMunicipio),
    endereco: text(endereco.Endereco),
    numero: text(endereco.Numero),
    complemento: text(endereco.Complemento),
    bairro: text(endereco.Bairro),
    cep: digits(endereco.Cep),
    suframa: '',
    codPais: digits(endereco.CodigoPais),
    pais: '',
  };
}

function findRecordByKey(
  value: unknown,
  key: string,
  depth = 0,
): XmlRecord | null {
  if (depth > 12) return null;
  const record = asRecord(value);
  if (!record) return null;
  const direct = asRecord(record[key]);
  if (direct) return direct;
  for (const child of Object.values(record)) {
    const values = Array.isArray(child) ? child : [child];
    for (const candidate of values) {
      const found = findRecordByKey(candidate, key, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function asRecord(value: unknown): XmlRecord | null {
  let normalized: unknown = value;
  if (Array.isArray(value)) normalized = (value as unknown[])[0];
  return normalized && typeof normalized === 'object'
    ? (normalized as XmlRecord)
    : null;
}

function text(value: unknown): string {
  let normalized: unknown = value;
  if (Array.isArray(value)) normalized = (value as unknown[])[0];
  if (
    typeof normalized === 'string' ||
    typeof normalized === 'number' ||
    typeof normalized === 'boolean'
  ) {
    return String(normalized).trim();
  }
  const record = asRecord(normalized);
  return record ? text(record['#text']) : '';
}

function digits(value: unknown) {
  return text(value).replace(/\D/g, '');
}

function validNfseIdentifier(value: string) {
  return (
    value.length >= 14 && value.length <= 50 && /^[0-9A-Za-z_-]+$/.test(value)
  );
}

function fiscalDate(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? `${match[1]}-${match[2]}-${match[3]}`
    : null;
}

function money(value: unknown, fallback = ''): string {
  return decimal(value, 2) || fallback;
}

function rate(value: unknown): string {
  return decimal(value, 4);
}

function decimal(value: unknown, scale: number): string {
  const raw = text(value).replace(',', '.');
  const match = /^(\d{1,13})(?:\.(\d+))?$/.exec(raw);
  if (!match || (match[2]?.length ?? 0) > scale) return '';
  const fraction = (match[2] ?? '').padEnd(scale, '0');
  return `${BigInt(match[1]).toString()}.${fraction}`;
}

function sumMoney(values: unknown[]): string {
  return formatCents(
    values.reduce<bigint>(
      (sum, value) => sum + cents(money(value, '0.00')),
      0n,
    ),
  );
}

function cents(value: string) {
  const [integer, fraction = ''] = value.split('.');
  return (
    BigInt(integer || '0') * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2))
  );
}

function rateBasisPoints(value: string) {
  const [integer, fraction = ''] = value.split('.');
  return (
    BigInt(integer || '0') * 10_000n +
    BigInt(fraction.padEnd(4, '0').slice(0, 4))
  );
}

function divideRound(numerator: bigint, denominator: bigint) {
  return (numerator + denominator / 2n) / denominator;
}

function formatCents(value: bigint) {
  const abs = absoluto(value);
  return `${value < 0n ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

function absoluto(value: bigint) {
  return value < 0n ? -value : value;
}
