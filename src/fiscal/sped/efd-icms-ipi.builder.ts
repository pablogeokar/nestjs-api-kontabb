import type {
  documentosFiscais,
  documentosFiscaisCteEscrituracao,
  documentosFiscaisItens,
  spedAjustesApuracao,
  spedInventarioItens,
  spedInventarios,
  spedObrigacoesRecolhimento,
  spedSaldosApuracao,
} from '../../database/schema';
import {
  createSpedRecord,
  dateField,
  decimalField,
  integerField,
  type SpedRecord,
} from './core';
import {
  fromScaledInteger,
  maximum,
  positive,
  toScaledInteger,
} from './sped-decimal';
import type { SpedApuracaoPreview, SpedInconsistencia } from './sped-efd.types';

type DocumentoRow = typeof documentosFiscais.$inferSelect;
type ItemRow = typeof documentosFiscaisItens.$inferSelect;
type CteRow = typeof documentosFiscaisCteEscrituracao.$inferSelect;
type SaldoRow = typeof spedSaldosApuracao.$inferSelect;
type AjusteRow = typeof spedAjustesApuracao.$inferSelect;
type ObrigacaoRow = typeof spedObrigacoesRecolhimento.$inferSelect;
type InventarioRow = typeof spedInventarios.$inferSelect;
type InventarioItemRow = typeof spedInventarioItens.$inferSelect;

export interface SpedEmpresaBuilderData {
  razaoSocial: string;
  nomeFantasia: string;
  cnpj: string;
  cpf: string | null;
  uf: string;
  inscricaoEstadual: string;
  codigoMunicipioIbge: string;
  inscricaoMunicipal: string | null;
  suframa: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  telefone: string | null;
  fax: string | null;
  email: string | null;
  perfil: 'A' | 'B' | 'C';
  indAtiv: '0' | '1';
  classificacaoEstabelecimentoIndustrial: string | null;
  regimeTributario: string | null;
}

export interface SpedContabilistaBuilderData {
  nome: string;
  cpf: string | null;
  crc: string;
  cnpj: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  telefone: string | null;
  fax: string | null;
  email: string | null;
  codigoMunicipioIbge: string;
}

export interface SpedParticipanteBuilderData {
  codigo: string;
  documento: string;
  tipoDocumento: 'CNPJ' | 'CPF';
  nome: string;
  codigoPais: string;
  inscricaoEstadual: string | null;
  codigoMunicipioIbge: string | null;
  suframa: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  uf: string | null;
}

export interface SpedUnidadeBuilderData {
  codigo: string;
  descricao: string;
}

export interface SpedItemCatalogoBuilderData {
  codigo: string;
  codigoExterno: string;
  descricao: string;
  codigoBarras: string | null;
  unidade: string;
  tipoItem: string;
  tipoItemInferido: boolean;
  ncm: string | null;
  exIpi: string | null;
  codigoGenero: string | null;
  codigoServico: string | null;
  aliquotaIcms: string | null;
  cest: string | null;
  participanteOrigemCodigo: string | null;
}

export interface SpedItemDocumentoBuilderData {
  row: ItemRow;
  codigoItem: string;
  codigoUnidade: string;
}

export interface SpedDocumentoNfeBuilderData {
  row: DocumentoRow;
  participanteCodigo: string | null;
  participanteUf: string | null;
  itens: SpedItemDocumentoBuilderData[];
  codigoInformacaoComplementar: string | null;
}

export interface SpedDocumentoCteBuilderData {
  row: DocumentoRow;
  cte: CteRow;
  participanteCodigo: string;
  participanteUf: string | null;
}

export interface SpedInventarioBuilderData {
  row: InventarioRow;
  itens: Array<{
    row: InventarioItemRow;
    codigoItem: string;
    participanteCodigo: string | null;
  }>;
}

export interface SpedEfdBuilderInput {
  competencia: string;
  finalidade: '0' | '1';
  inicio: Date;
  fim: Date;
  empresa: SpedEmpresaBuilderData;
  contabilista: SpedContabilistaBuilderData;
  participantes: SpedParticipanteBuilderData[];
  unidades: SpedUnidadeBuilderData[];
  itensCatalogo: SpedItemCatalogoBuilderData[];
  informacoesComplementares: Array<{ codigo: string; texto: string }>;
  nfe: SpedDocumentoNfeBuilderData[];
  cte: SpedDocumentoCteBuilderData[];
  saldos: SaldoRow[];
  ajustes: AjusteRow[];
  obrigacoes: ObrigacaoRow[];
  responsabilidades: Array<{ tipo: string; uf: string }>;
  inventario: SpedInventarioBuilderData | null;
  indicadores1010: Record<string, 'S' | 'N'>;
  inconsistencias: SpedInconsistencia[];
}

export interface SpedEfdBuilderResult {
  records: SpedRecord[];
  apuracao: SpedApuracaoPreview;
}

interface AnaliticoC190 {
  cst: string;
  cfop: string;
  aliquota: string;
  valorOperacao: bigint;
  valorBcIcms: bigint;
  valorIcms: bigint;
  valorBcIcmsSt: bigint;
  valorIcmsSt: bigint;
  valorReducaoBc: bigint;
  valorIpi: bigint;
}

export function buildEfdIcmsIpiRecords(
  input: SpedEfdBuilderInput,
): SpedEfdBuilderResult {
  const records: SpedRecord[] = [];
  records.push(...buildBloco0(input));
  records.push(...buildBlocoC(input));
  records.push(...buildBlocoD(input));
  const blocoE = buildBlocoE(input);
  records.push(...blocoE.records);
  records.push(...buildBlocoH(input));
  records.push(...buildBloco1(input.indicadores1010));
  return { records, apuracao: blocoE.apuracao };
}

function buildBloco0(input: SpedEfdBuilderInput): SpedRecord[] {
  const empresa = input.empresa;
  const contabilista = input.contabilista;
  const records: SpedRecord[] = [
    createSpedRecord(
      '0000',
      '020',
      input.finalidade,
      dateField(input.inicio),
      dateField(input.fim),
      empresa.razaoSocial,
      empresa.cnpj,
      empresa.cpf,
      empresa.uf,
      empresa.inscricaoEstadual,
      empresa.codigoMunicipioIbge,
      empresa.inscricaoMunicipal,
      empresa.suframa,
      empresa.perfil,
      empresa.indAtiv,
    ),
  ];

  if (empresa.indAtiv === '0') {
    records.push(
      createSpedRecord('0002', empresa.classificacaoEstabelecimentoIndustrial),
    );
  }

  records.push(
    createSpedRecord(
      '0005',
      empresa.nomeFantasia,
      empresa.cep,
      empresa.logradouro,
      empresa.numero,
      empresa.complemento,
      empresa.bairro,
      empresa.telefone,
      empresa.fax,
      empresa.email,
    ),
    createSpedRecord(
      '0100',
      contabilista.nome,
      contabilista.cpf,
      contabilista.crc,
      contabilista.cnpj,
      contabilista.cep,
      contabilista.logradouro,
      contabilista.numero,
      contabilista.complemento,
      contabilista.bairro,
      contabilista.telefone,
      contabilista.fax,
      contabilista.email,
      contabilista.codigoMunicipioIbge,
    ),
  );

  for (const participante of [...input.participantes].sort((a, b) =>
    a.codigo.localeCompare(b.codigo, 'pt-BR'),
  )) {
    records.push(
      createSpedRecord(
        '0150',
        participante.codigo,
        participante.nome,
        participante.codigoPais,
        participante.tipoDocumento === 'CNPJ' ? participante.documento : null,
        participante.tipoDocumento === 'CPF' ? participante.documento : null,
        participante.inscricaoEstadual,
        participante.codigoMunicipioIbge,
        participante.suframa,
        participante.logradouro,
        participante.numero,
        participante.complemento,
        participante.bairro,
      ),
    );
  }

  for (const unidade of [...input.unidades].sort((a, b) =>
    a.codigo.localeCompare(b.codigo, 'pt-BR'),
  )) {
    records.push(createSpedRecord('0190', unidade.codigo, unidade.descricao));
  }

  for (const item of [...input.itensCatalogo].sort((a, b) =>
    a.codigo.localeCompare(b.codigo, 'pt-BR'),
  )) {
    records.push(
      createSpedRecord(
        '0200',
        item.codigo,
        item.descricao,
        item.codigoBarras,
        null,
        item.unidade,
        item.tipoItem,
        item.ncm,
        item.exIpi,
        item.codigoGenero,
        item.codigoServico,
        item.aliquotaIcms ? decimalField(item.aliquotaIcms) : null,
        item.cest,
      ),
    );
  }

  for (const informacao of [...input.informacoesComplementares].sort((a, b) =>
    a.codigo.localeCompare(b.codigo, 'pt-BR'),
  )) {
    records.push(createSpedRecord('0450', informacao.codigo, informacao.texto));
  }

  return records;
}

function buildBlocoC(input: SpedEfdBuilderInput): SpedRecord[] {
  const records: SpedRecord[] = [];
  for (const documento of input.nfe) {
    const row = documento.row;
    const regular = (row.codSituacaoSped ?? '00') === '00';
    const totals = asTotals(row.totaisDeclaradosXml);
    const indOper = row.tipoOperacaoEscriturada === 'SAIDA' ? '1' : '0';
    const indEmit = sameIdentifier(row.emitenteCnpjCpf, input.empresa.cnpj)
      ? '0'
      : '1';
    const pisSt = sumItems(documento.itens, 'valorPisSt');
    const cofinsSt = sumItems(documento.itens, 'valorCofinsSt');

    records.push(
      createSpedRecord(
        'C100',
        indOper,
        indEmit,
        documento.participanteCodigo,
        row.modelo,
        row.codSituacaoSped ?? '00',
        row.serie,
        row.numeroDocumento,
        row.chaveAcesso,
        regular ? dateField(row.dataEmissaoFiscal ?? row.dataEmissao) : null,
        regular
          ? dateField(
              row.dataEntradaSaidaFiscal ??
                row.dataEmissaoFiscal ??
                row.dataEntradaSaida ??
                row.dataEmissao,
            )
          : null,
        regular
          ? decimalField(totalValue(totals, 'vNF', row.valorTotal))
          : null,
        null,
        regular ? decimalOrZero(totals.vDesc) : null,
        regular ? null : null,
        regular ? decimalField(totalValue(totals, 'vProd', '0')) : null,
        regular ? row.modalidadeFrete : null,
        regular ? decimalOrZero(totals.vFrete) : null,
        regular ? decimalOrZero(totals.vSeg) : null,
        regular ? decimalOrZero(totals.vOutro) : null,
        regular ? decimalOrZero(totals.vBC) : null,
        regular ? decimalOrZero(totals.vICMS) : null,
        regular ? decimalOrZero(totals.vBCST) : null,
        regular ? decimalOrZero(totals.vST) : null,
        regular ? decimalOrZero(totals.vIPI) : null,
        regular ? decimalOrZero(totals.vPIS) : null,
        regular ? decimalOrZero(totals.vCOFINS) : null,
        regular ? decimalField(pisSt) : null,
        regular ? decimalField(cofinsSt) : null,
      ),
    );

    if (!regular) continue;

    const difal = sumDifal(documento.itens);
    if (difal.fcp !== 0n || difal.destino !== 0n || difal.remetente !== 0n) {
      records.push(
        createSpedRecord(
          'C101',
          decimalField(fromScaledInteger(difal.fcp)),
          decimalField(fromScaledInteger(difal.destino)),
          decimalField(fromScaledInteger(difal.remetente)),
        ),
      );
    }

    if (documento.codigoInformacaoComplementar) {
      records.push(
        createSpedRecord(
          'C110',
          documento.codigoInformacaoComplementar,
          row.informacoesComplementares,
        ),
      );
    }

    if (
      row.modelo === '55' &&
      indEmit === '1' &&
      input.empresa.perfil !== 'C'
    ) {
      for (const item of documento.itens) records.push(buildC170(item));
    }

    for (const analitico of aggregateC190(documento.itens)) {
      records.push(
        createSpedRecord(
          'C190',
          analitico.cst,
          analitico.cfop,
          decimalField(analitico.aliquota),
          decimalField(fromScaledInteger(analitico.valorOperacao)),
          decimalField(fromScaledInteger(analitico.valorBcIcms)),
          decimalField(fromScaledInteger(analitico.valorIcms)),
          decimalField(fromScaledInteger(analitico.valorBcIcmsSt)),
          decimalField(fromScaledInteger(analitico.valorIcmsSt)),
          decimalField(fromScaledInteger(analitico.valorReducaoBc)),
          decimalField(fromScaledInteger(analitico.valorIpi)),
          null,
        ),
      );
    }
  }
  return records;
}

function buildC170(item: SpedItemDocumentoBuilderData): SpedRecord {
  const row = item.row;
  return createSpedRecord(
    'C170',
    integerField(row.numeroItem),
    item.codigoItem,
    row.informacoesAdicionais,
    decimalField(row.quantidadeComercial),
    item.codigoUnidade,
    decimalField(row.valorBrutoProduto),
    row.valorDesconto ? decimalField(row.valorDesconto) : null,
    '0',
    normalizeCstIcms(row),
    row.cfop,
    null,
    decimalOrNull(row.valorBcIcms),
    decimalOrNull(row.aliquotaIcms),
    decimalOrNull(row.valorIcms),
    decimalOrNull(row.valorBcIcmsSt),
    decimalOrNull(row.aliquotaIcmsSt),
    decimalOrNull(row.valorIcmsSt),
    '0',
    row.cstIpi,
    row.codigoEnquadramentoIpi,
    decimalOrNull(row.valorBcIpi),
    decimalOrNull(row.aliquotaIpi),
    decimalOrNull(row.valorIpi),
    row.cstPis,
    decimalOrNull(row.valorBcPis),
    decimalOrNull(row.aliquotaPisPercentual),
    decimalOrNull(row.quantidadeBcPis),
    decimalOrNull(row.aliquotaPisReais),
    decimalOrNull(row.valorPis),
    row.cstCofins,
    decimalOrNull(row.valorBcCofins),
    decimalOrNull(row.aliquotaCofinsPercentual),
    decimalOrNull(row.quantidadeBcCofins),
    decimalOrNull(row.aliquotaCofinsReais),
    decimalOrNull(row.valorCofins),
    row.codCtaSped,
    null,
  );
}

function buildBlocoD(input: SpedEfdBuilderInput): SpedRecord[] {
  const records: SpedRecord[] = [];
  for (const documento of input.cte) {
    const row = documento.row;
    const cte = documento.cte;
    const regular = (row.codSituacaoSped ?? '00') === '00';
    const indOper = cte.tipoOperacaoEscriturada === 'SAIDA' ? '1' : '0';
    const indEmit = sameIdentifier(row.emitenteCnpjCpf, input.empresa.cnpj)
      ? '0'
      : '1';
    const creditavel = toScaledInteger(cte.valorIcmsCreditavel);
    const valorBc = creditavel > 0n ? cte.valorBcIcms : null;
    const valorIcms = creditavel > 0n ? cte.valorIcmsCreditavel : null;
    const valorNaoTributado = maximum(
      toScaledInteger(cte.valorTotalServico) - toScaledInteger(valorBc),
      0n,
    );

    records.push(
      createSpedRecord(
        'D100',
        indOper,
        indEmit,
        documento.participanteCodigo,
        row.modelo,
        row.codSituacaoSped ?? '00',
        row.serie,
        null,
        row.numeroDocumento,
        row.chaveAcesso,
        regular ? dateField(row.dataEmissaoFiscal ?? row.dataEmissao) : null,
        regular
          ? dateField(
              row.dataEntradaSaidaFiscal ??
                row.dataEmissaoFiscal ??
                row.dataEntradaSaida ??
                row.dataEmissao,
            )
          : null,
        regular ? cte.tpCte : null,
        regular && cte.tpCte === '3' ? cte.chaveCteReferenciado : null,
        regular ? decimalField(row.valorTotal) : null,
        regular ? decimalField('0') : null,
        regular ? mapCteFreightIndicator(cte.tomadorPapel) : null,
        regular ? decimalField(cte.valorTotalServico) : null,
        regular ? decimalOrNull(valorBc) : null,
        regular ? decimalOrNull(valorIcms) : null,
        regular ? decimalField(fromScaledInteger(valorNaoTributado)) : null,
        null,
        null,
        regular ? cte.codigoMunicipioOrigem : null,
        regular ? cte.codigoMunicipioDestino : null,
      ),
    );

    if (!regular) continue;
    records.push(
      createSpedRecord(
        'D190',
        normalizeCstCte(cte),
        cte.cfop,
        decimalField(cte.aliquotaIcms ?? '0'),
        decimalField(cte.valorTotalServico),
        decimalField(valorBc ?? '0'),
        decimalField(valorIcms ?? '0'),
        decimalField('0'),
        null,
      ),
    );
  }
  return records;
}

function buildBlocoE(input: SpedEfdBuilderInput): {
  records: SpedRecord[];
  apuracao: SpedApuracaoPreview;
} {
  const records: SpedRecord[] = [];
  const simples = input.empresa.regimeTributario === 'SIMPLES_NACIONAL';
  const ajustesIcms = input.ajustes.filter((row) => row.registro === 'E111');
  const debitos = simples ? 0n : totalIcmsDocumentos(input.nfe, 'SAIDA');
  const creditosMercadorias = simples
    ? 0n
    : totalIcmsDocumentos(input.nfe, 'ENTRADA', input.inconsistencias);
  const creditosFrete = simples
    ? 0n
    : input.cte.reduce(
        (sum, documento) =>
          sum + toScaledInteger(documento.cte.valorIcmsCreditavel),
        0n,
      );
  const creditos = creditosMercadorias + creditosFrete;
  const ajustesDebitos = totalAjustes(ajustesIcms, 'DEBITO');
  const ajustesCreditos = totalAjustes(ajustesIcms, 'CREDITO');
  const estornosDebitos = totalAjustes(ajustesIcms, 'ESTORNO_DEBITO');
  const estornosCreditos = totalAjustes(ajustesIcms, 'ESTORNO_CREDITO');
  const deducoes = totalAjustes(ajustesIcms, 'DEDUCAO');
  const saldoAnterior = getSaldo(input.saldos, 'ICMS_PROPRIO', null);
  const saldoCalculado =
    debitos +
    ajustesDebitos +
    estornosCreditos -
    creditos -
    ajustesCreditos -
    estornosDebitos -
    saldoAnterior;
  const saldoApurado = positive(saldoCalculado);
  const saldoCredor = positive(-saldoCalculado);
  const recolher = positive(saldoApurado - deducoes);

  records.push(
    createSpedRecord('E100', dateField(input.inicio), dateField(input.fim)),
    createSpedRecord(
      'E110',
      money(debitos),
      money(0n),
      money(ajustesDebitos),
      money(estornosCreditos),
      money(creditos),
      money(0n),
      money(ajustesCreditos),
      money(estornosDebitos),
      money(saldoAnterior),
      money(saldoApurado),
      money(deducoes),
      money(recolher),
      money(saldoCredor),
      money(0n),
    ),
  );

  for (const ajuste of ajustesIcms) {
    records.push(
      createSpedRecord(
        'E111',
        ajuste.codigoAjuste,
        ajuste.descricao,
        decimalField(ajuste.valor),
      ),
    );
  }

  const obrigacaoIcms = findObrigacao(input.obrigacoes, 'ICMS_PROPRIO', null);
  if (recolher > 0n && obrigacaoIcms) {
    records.push(buildObrigacaoRecord('E116', obrigacaoIcms));
  }

  const stRows = buildIcmsSt(input, records);
  const difalRows = buildDifalFcp(input, records);
  const ipi = input.empresa.indAtiv === '0' ? buildIpi(input, records) : null;

  return {
    records,
    apuracao: {
      icmsProprio: {
        debitos: fromScaledInteger(debitos),
        creditos: fromScaledInteger(creditos),
        saldoCredorAnterior: fromScaledInteger(saldoAnterior),
        ajustesDebitos: fromScaledInteger(ajustesDebitos),
        ajustesCreditos: fromScaledInteger(ajustesCreditos),
        estornosCreditos: fromScaledInteger(estornosCreditos),
        estornosDebitos: fromScaledInteger(estornosDebitos),
        deducoes: fromScaledInteger(deducoes),
        saldoApurado: fromScaledInteger(saldoApurado),
        icmsRecolher: fromScaledInteger(recolher),
        saldoCredorTransportar: fromScaledInteger(saldoCredor),
      },
      icmsStPorUf: stRows,
      difalFcpPorUf: difalRows,
      ipi,
    },
  };
}

function buildIcmsSt(
  input: SpedEfdBuilderInput,
  records: SpedRecord[],
): SpedApuracaoPreview['icmsStPorUf'] {
  const totals = new Map<string, bigint>();
  for (const documento of input.nfe) {
    if (documento.row.tipoOperacaoEscriturada !== 'SAIDA') continue;
    const uf = documento.participanteUf;
    if (!uf) continue;
    const value = documento.itens.reduce(
      (sum, item) => sum + toScaledInteger(item.row.valorIcmsSt),
      0n,
    );
    if (value > 0n) totals.set(uf, (totals.get(uf) ?? 0n) + value);
  }

  const configuredUfs = input.responsabilidades
    .filter((row) => row.tipo === 'ICMS_ST')
    .map((row) => row.uf);
  const ufs = [...new Set([...configuredUfs, ...totals.keys()])].sort();
  const result: SpedApuracaoPreview['icmsStPorUf'] = [];
  for (const uf of ufs) {
    const debitos = totals.get(uf) ?? 0n;
    const saldoAnterior = getSaldo(input.saldos, 'ICMS_ST', uf);
    const recolher = positive(debitos - saldoAnterior);
    const saldoCredor = positive(saldoAnterior - debitos);
    records.push(
      createSpedRecord(
        'E200',
        uf,
        dateField(input.inicio),
        dateField(input.fim),
      ),
      createSpedRecord(
        'E210',
        debitos > 0n ? '1' : '0',
        money(saldoAnterior),
        money(0n),
        money(0n),
        money(0n),
        money(0n),
        money(debitos),
        money(0n),
        money(0n),
        money(debitos),
        money(0n),
        money(recolher),
        money(saldoCredor),
        money(0n),
      ),
    );
    const obrigacao = findObrigacao(input.obrigacoes, 'ICMS_ST', uf);
    if (recolher > 0n && obrigacao) {
      records.push(buildObrigacaoRecord('E250', obrigacao));
    }
    result.push({
      uf,
      debitos: fromScaledInteger(debitos),
      saldoCredorAnterior: fromScaledInteger(saldoAnterior),
      recolher: fromScaledInteger(recolher),
      saldoCredorTransportar: fromScaledInteger(saldoCredor),
    });
  }
  return result;
}

function buildDifalFcp(
  input: SpedEfdBuilderInput,
  records: SpedRecord[],
): SpedApuracaoPreview['difalFcpPorUf'] {
  const totals = new Map<string, { difal: bigint; fcp: bigint }>();
  for (const documento of input.nfe) {
    if (documento.row.tipoOperacaoEscriturada !== 'SAIDA') continue;
    const uf = documento.participanteUf;
    if (!uf) continue;
    const difal = sumDifal(documento.itens);
    if (difal.destino === 0n && difal.fcp === 0n) continue;
    const current = totals.get(uf) ?? { difal: 0n, fcp: 0n };
    current.difal += difal.destino;
    current.fcp += difal.fcp;
    totals.set(uf, current);
  }

  const configuredUfs = input.responsabilidades
    .filter((row) => row.tipo === 'DIFAL_FCP')
    .map((row) => row.uf);
  const ufs = [...new Set([...configuredUfs, ...totals.keys()])].sort();
  const result: SpedApuracaoPreview['difalFcpPorUf'] = [];
  for (const uf of ufs) {
    const total = totals.get(uf) ?? { difal: 0n, fcp: 0n };
    const recolherDifal = positive(total.difal);
    const recolherFcp = positive(total.fcp);
    const recolher = recolherDifal + recolherFcp;
    records.push(
      createSpedRecord(
        'E300',
        uf,
        dateField(input.inicio),
        dateField(input.fim),
      ),
      createSpedRecord(
        'E310',
        recolher > 0n ? '1' : '0',
        money(0n),
        money(total.difal),
        money(0n),
        money(0n),
        money(0n),
        money(total.difal),
        money(0n),
        money(recolherDifal),
        money(0n),
        money(0n),
        money(0n),
        money(total.fcp),
        money(0n),
        money(0n),
        money(0n),
        money(total.fcp),
        money(0n),
        money(recolherFcp),
        money(0n),
        money(0n),
      ),
    );
    const obrigacao = findObrigacao(input.obrigacoes, 'DIFAL_FCP', uf);
    if (recolher > 0n && obrigacao) {
      records.push(buildObrigacaoRecord('E316', obrigacao));
    }
    result.push({
      uf,
      difal: fromScaledInteger(total.difal),
      fcp: fromScaledInteger(total.fcp),
      recolher: fromScaledInteger(recolher),
    });
  }
  return result;
}

function buildIpi(
  input: SpedEfdBuilderInput,
  records: SpedRecord[],
): NonNullable<SpedApuracaoPreview['ipi']> {
  const groups = new Map<
    string,
    {
      cfop: string;
      cst: string;
      valorContabil: bigint;
      bc: bigint;
      ipi: bigint;
    }
  >();
  let debitos = 0n;
  let creditos = 0n;
  for (const documento of input.nfe) {
    for (const item of documento.itens) {
      const row = item.row;
      if (!row.cstIpi) continue;
      const key = `${row.cfop}|${row.cstIpi}`;
      const group = groups.get(key) ?? {
        cfop: row.cfop,
        cst: row.cstIpi,
        valorContabil: 0n,
        bc: 0n,
        ipi: 0n,
      };
      const ipi = toScaledInteger(row.valorIpi);
      group.valorContabil += itemOperationValue(row);
      group.bc += toScaledInteger(row.valorBcIpi);
      group.ipi += ipi;
      groups.set(key, group);
      if (documento.row.tipoOperacaoEscriturada === 'SAIDA') debitos += ipi;
      else creditos += ipi;
    }
  }

  const saldoAnterior = getSaldo(input.saldos, 'IPI', null);
  const ajustes = input.ajustes.filter((row) => row.registro === 'E530');
  const outrosDebitos = ajustes
    .filter((row) => row.indicador === 'DEBITO')
    .reduce((sum, row) => sum + toScaledInteger(row.valor), 0n);
  const outrosCreditos = ajustes
    .filter((row) => row.indicador === 'CREDITO')
    .reduce((sum, row) => sum + toScaledInteger(row.valor), 0n);
  const saldo =
    debitos + outrosDebitos - saldoAnterior - creditos - outrosCreditos;
  const recolher = positive(saldo);
  const saldoCredor = positive(-saldo);

  records.push(
    createSpedRecord(
      'E500',
      '0',
      dateField(input.inicio),
      dateField(input.fim),
    ),
  );
  for (const group of [...groups.values()].sort((a, b) =>
    `${a.cfop}|${a.cst}`.localeCompare(`${b.cfop}|${b.cst}`, 'pt-BR'),
  )) {
    records.push(
      createSpedRecord(
        'E510',
        group.cfop,
        group.cst,
        money(group.valorContabil),
        money(group.bc),
        money(group.ipi),
      ),
    );
  }
  records.push(
    createSpedRecord(
      'E520',
      money(saldoAnterior),
      money(debitos),
      money(creditos),
      money(outrosDebitos),
      money(outrosCreditos),
      money(saldoCredor),
      money(recolher),
    ),
  );
  for (const ajuste of ajustes) {
    records.push(
      createSpedRecord(
        'E530',
        ajuste.indicador === 'CREDITO' ? '1' : '0',
        decimalField(ajuste.valor),
        ajuste.codigoAjuste,
        '9',
        ajuste.numeroDocumento,
        ajuste.descricao ?? ajuste.codigoAjuste,
      ),
    );
  }
  return {
    debitos: fromScaledInteger(debitos),
    creditos: fromScaledInteger(creditos),
    saldoCredorAnterior: fromScaledInteger(saldoAnterior),
    recolher: fromScaledInteger(recolher),
    saldoCredorTransportar: fromScaledInteger(saldoCredor),
  };
}

function buildBlocoH(input: SpedEfdBuilderInput): SpedRecord[] {
  if (!input.inventario) return [];
  const records: SpedRecord[] = [
    createSpedRecord(
      'H005',
      dateField(input.inventario.row.dataInventario),
      decimalField(input.inventario.row.valorTotal),
      input.inventario.row.motivo,
    ),
  ];
  for (const item of input.inventario.itens) {
    records.push(
      createSpedRecord(
        'H010',
        item.codigoItem,
        item.row.unidade,
        decimalField(item.row.quantidade),
        decimalField(item.row.valorUnitario),
        decimalField(item.row.valorItem),
        item.row.indicadorPropriedade,
        item.participanteCodigo,
        item.row.textoComplementar,
        item.row.codigoConta,
        decimalOrNull(item.row.valorItemIr),
      ),
    );
  }
  return records;
}

function buildBloco1(indicadores: Record<string, 'S' | 'N'>): SpedRecord[] {
  const keys = [
    'IND_EXP',
    'IND_CCRF',
    'IND_COMB',
    'IND_USINA',
    'IND_VA',
    'IND_EE',
    'IND_CART',
    'IND_FORM',
    'IND_AER',
    'IND_GIAF1',
    'IND_GIAF3',
    'IND_GIAF4',
    'IND_REST_RESSARC_COMPL_ICMS',
  ];
  return [
    createSpedRecord(
      '1010',
      ...keys.map((key) => (indicadores[key] === 'S' ? 'S' : 'N')),
    ),
  ];
}

function aggregateC190(items: SpedItemDocumentoBuilderData[]): AnaliticoC190[] {
  const groups = new Map<string, AnaliticoC190>();
  for (const item of items) {
    const row = item.row;
    const cst = normalizeCstIcms(row);
    const aliquota = row.aliquotaIcms ?? '0';
    const key = `${cst}|${row.cfop}|${aliquota}`;
    const group = groups.get(key) ?? {
      cst,
      cfop: row.cfop,
      aliquota,
      valorOperacao: 0n,
      valorBcIcms: 0n,
      valorIcms: 0n,
      valorBcIcmsSt: 0n,
      valorIcmsSt: 0n,
      valorReducaoBc: 0n,
      valorIpi: 0n,
    };
    const valorItemLiquido =
      toScaledInteger(row.valorBrutoProduto) -
      toScaledInteger(row.valorDesconto) +
      toScaledInteger(row.valorFrete) +
      toScaledInteger(row.valorSeguro) +
      toScaledInteger(row.valorOutrasDespesas);
    group.valorOperacao += itemOperationValue(row);
    group.valorBcIcms += toScaledInteger(row.valorBcIcms);
    group.valorIcms += toScaledInteger(row.valorIcms);
    group.valorBcIcmsSt += toScaledInteger(row.valorBcIcmsSt);
    group.valorIcmsSt += toScaledInteger(row.valorIcmsSt);
    group.valorReducaoBc += positive(
      valorItemLiquido - toScaledInteger(row.valorBcIcms),
    );
    group.valorIpi += toScaledInteger(row.valorIpi);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) =>
    `${a.cst}|${a.cfop}|${a.aliquota}`.localeCompare(
      `${b.cst}|${b.cfop}|${b.aliquota}`,
      'pt-BR',
    ),
  );
}

function itemOperationValue(row: ItemRow): bigint {
  return (
    toScaledInteger(row.valorBrutoProduto) -
    toScaledInteger(row.valorDesconto) +
    toScaledInteger(row.valorFrete) +
    toScaledInteger(row.valorSeguro) +
    toScaledInteger(row.valorOutrasDespesas) +
    toScaledInteger(row.valorIcmsSt) +
    toScaledInteger(row.valorFcpSt) +
    toScaledInteger(row.valorIpi)
  );
}

function totalIcmsDocumentos(
  documentos: SpedDocumentoNfeBuilderData[],
  operacao: 'ENTRADA' | 'SAIDA',
  issues?: SpedInconsistencia[],
): bigint {
  return documentos
    .filter((documento) => documento.row.tipoOperacaoEscriturada === operacao)
    .reduce(
      (sum, documento) =>
        sum +
        documento.itens.reduce((itemSum, item) => {
          const row = item.row;
          if (operacao === 'SAIDA') {
            return itemSum + toScaledInteger(row.valorIcms);
          }

          const creditoSn = toScaledInteger(row.valorCreditoIcmsSn);
          if (creditoSn > 0n) {
            if (row.csosnIcms === '101' || row.csosnIcms === '201') {
              return itemSum + creditoSn;
            }
            reportAmbiguousCredit(documento, item, issues);
            return itemSum;
          }

          const creditoIcms = toScaledInteger(row.valorIcms);
          const cst = row.cstIcms?.slice(-2) ?? null;
          if (
            creditoIcms > 0n &&
            ['00', '10', '20', '70'].includes(cst ?? '')
          ) {
            return itemSum + creditoIcms;
          }
          if (creditoIcms > 0n) {
            reportAmbiguousCredit(documento, item, issues);
          }
          return itemSum;
        }, 0n),
      0n,
    );
}

function reportAmbiguousCredit(
  documento: SpedDocumentoNfeBuilderData,
  item: SpedItemDocumentoBuilderData,
  issues: SpedInconsistencia[] | undefined,
) {
  issues?.push({
    codigo: 'ICMS_CREDITO_EXIGE_REVISAO',
    severidade: 'ERRO',
    mensagem: `O crédito de ICMS do item ${item.row.numeroItem} usa CST/CSOSN não autorizado para apropriação automática. Informe um ajuste fiscal após revisão.`,
    documentoId: documento.row.id,
    chaveAcesso: documento.row.chaveAcesso,
    campo: `item.${item.row.numeroItem}.cstIcms`,
  });
}

function sumDifal(items: SpedItemDocumentoBuilderData[]) {
  return items.reduce(
    (sum, item) => ({
      fcp: sum.fcp + toScaledInteger(item.row.valorFcpUfDest),
      destino: sum.destino + toScaledInteger(item.row.valorIcmsUfDest),
      remetente: sum.remetente + toScaledInteger(item.row.valorIcmsUfRemetente),
    }),
    { fcp: 0n, destino: 0n, remetente: 0n },
  );
}

function sumItems(
  items: SpedItemDocumentoBuilderData[],
  field: 'valorPisSt' | 'valorCofinsSt',
) {
  return fromScaledInteger(
    items.reduce((sum, item) => sum + toScaledInteger(item.row[field]), 0n),
  );
}

function normalizeCstIcms(row: ItemRow): string {
  if (row.cstIcms) {
    return row.cstIcms.length === 2
      ? `${row.origemMercadoria ?? '0'}${row.cstIcms}`
      : row.cstIcms;
  }
  return row.csosnIcms ?? '000';
}

function normalizeCstCte(row: CteRow): string {
  return row.cstIcms ?? row.csosnIcms ?? '000';
}

function mapCteFreightIndicator(tomadorPapel: string): string {
  return ['REMETENTE', 'DESTINATARIO'].includes(tomadorPapel) ? '1' : '2';
}

function getSaldo(rows: SaldoRow[], tipo: string, uf: string | null): bigint {
  const row = rows.find((item) => item.tipo === tipo && item.uf === uf);
  return toScaledInteger(row?.saldoCredorAnterior);
}

function totalAjustes(rows: AjusteRow[], indicador: string): bigint {
  return rows
    .filter((row) => row.indicador === indicador)
    .reduce((sum, row) => sum + toScaledInteger(row.valor), 0n);
}

function findObrigacao(rows: ObrigacaoRow[], tipo: string, uf: string | null) {
  return rows.find((row) => row.tipo === tipo && row.uf === uf);
}

function buildObrigacaoRecord(
  reg: 'E116' | 'E250' | 'E316',
  row: ObrigacaoRow,
): SpedRecord {
  return createSpedRecord(
    reg,
    row.codigoObrigacao,
    decimalField(row.valor),
    dateField(row.dataVencimento),
    row.codigoReceita,
    row.numeroProcesso,
    row.indicadorProcesso,
    row.processo,
    row.textoComplementar,
    row.mesReferencia,
  );
}

function sameIdentifier(first: string, second: string): boolean {
  return normalizeIdentifier(first) === normalizeIdentifier(second);
}

function normalizeIdentifier(value: string): string {
  return value.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
}

function asTotals(value: unknown): Record<string, string | null> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, string | null>;
}

function totalValue(
  totals: Record<string, string | null>,
  key: string,
  fallback: string,
) {
  return totals[key] ?? fallback;
}

function decimalOrZero(value: string | null | undefined) {
  return decimalField(value ?? '0');
}

function decimalOrNull(value: string | null | undefined) {
  return value == null || value === '' ? null : decimalField(value);
}

function money(value: bigint) {
  return decimalField(fromScaledInteger(value));
}
