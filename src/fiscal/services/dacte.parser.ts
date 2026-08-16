import { XMLParser } from 'fast-xml-parser';

type XmlRecord = Record<string, unknown>;

export interface DacteParty {
  nome: string;
  documento: string;
  inscricaoEstadual: string;
  endereco: string;
  municipioUf: string;
  cep: string;
  telefone: string;
}

export interface DacteValueItem {
  label: string;
  value: string;
}

export interface DacteData {
  chaveAcesso: string;
  modelo: string;
  serie: string;
  numero: string;
  emissao: string;
  ambiente: string;
  tipoCte: string;
  tipoServico: string;
  modal: string;
  cfop: string;
  naturezaOperacao: string;
  origem: string;
  destino: string;
  protocolo: string;
  protocoloData: string;
  status: string;
  qrCode: string;
  emitente: DacteParty;
  remetente: DacteParty;
  destinatario: DacteParty;
  tomador: DacteParty;
  produtoPredominante: string;
  outrasCaracteristicas: string;
  valorCarga: string;
  valorTotalServico: string;
  valorReceber: string;
  componentes: DacteValueItem[];
  impostos: DacteValueItem[];
  quantidades: DacteValueItem[];
  documentosOriginarios: string[];
  modalInfo: DacteValueItem[];
  observacoes: string[];
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

export function parseDacteXml(xml: string): DacteData {
  if (!xml.trimStart().startsWith('<') || xml.length > 15 * 1024 * 1024) {
    throw new Error('XML de CT-e inválido.');
  }

  const parsed = asRecord(xmlParser.parse(xml));
  const cteProc = asRecord(parsed.cteProc);
  const cte = asRecord(cteProc.CTe ?? parsed.CTe);
  const infCte = asRecord(cte.infCte);
  const ide = asRecord(infCte.ide);
  const protocolo = asRecord(asRecord(cteProc.protCTe).infProt);

  const modelo = text(ide.mod);
  if (modelo !== '57') {
    throw new Error('O XML informado não é um CT-e modelo 57.');
  }

  const chaveAcesso =
    digits(text(infCte['@_Id'])) || digits(text(protocolo.chCTe));
  if (!/^\d{44}$/.test(chaveAcesso)) {
    throw new Error('Chave de acesso do CT-e inválida.');
  }

  const emitente = readParty(infCte.emit, 'enderEmit');
  if (!emitente.nome || !emitente.documento) {
    throw new Error('Emitente do CT-e não encontrado.');
  }

  const normal = asRecord(infCte.infCTeNorm);
  const carga = asRecord(normal.infCarga);
  const supl = asRecord(cte.infCTeSupl);

  return {
    chaveAcesso,
    modelo,
    serie: text(ide.serie),
    numero: text(ide.nCT),
    emissao: formatDateTime(text(ide.dhEmi)),
    ambiente: text(ide.tpAmb) === '2' ? 'HOMOLOGAÇÃO' : 'PRODUÇÃO',
    tipoCte: mapValue(text(ide.tpCTe), {
      '0': 'NORMAL',
      '1': 'COMPLEMENTO DE VALORES',
      '2': 'ANULAÇÃO DE VALORES',
      '3': 'SUBSTITUTO',
    }),
    tipoServico: mapValue(text(ide.tpServ), {
      '0': 'NORMAL',
      '1': 'SUBCONTRATAÇÃO',
      '2': 'REDESPACHO',
      '3': 'REDESPACHO INTERMEDIÁRIO',
      '4': 'SERVIÇO VINCULADO A MULTIMODAL',
    }),
    modal: mapValue(text(ide.modal), {
      '01': 'RODOVIÁRIO',
      '02': 'AÉREO',
      '03': 'AQUAVIÁRIO',
      '04': 'FERROVIÁRIO',
      '05': 'DUTOVIÁRIO',
      '06': 'MULTIMODAL',
    }),
    cfop: text(ide.CFOP),
    naturezaOperacao: text(ide.natOp),
    origem: joinNonEmpty(text(ide.xMunIni), text(ide.UFIni), ' / '),
    destino: joinNonEmpty(text(ide.xMunFim), text(ide.UFFim), ' / '),
    protocolo: text(protocolo.nProt),
    protocoloData: formatDateTime(text(protocolo.dhRecbto)),
    status:
      text(protocolo.cStat) === '100'
        ? 'AUTORIZADO'
        : text(protocolo.xMotivo) || 'SEM PROTOCOLO',
    qrCode: text(supl.qrCodCTe) || text(supl.urlChave) || chaveAcesso,
    emitente,
    remetente: readParty(infCte.rem, 'enderReme'),
    destinatario: readParty(infCte.dest, 'enderDest'),
    tomador: readTomador(infCte, ide),
    produtoPredominante: text(carga.proPred) || '-',
    outrasCaracteristicas: text(carga.xOutCat) || '-',
    valorCarga: formatMoney(text(carga.vCarga)),
    valorTotalServico: formatMoney(text(asRecord(infCte.vPrest).vTPrest)),
    valorReceber: formatMoney(text(asRecord(infCte.vPrest).vRec)),
    componentes: readComponentes(infCte.vPrest),
    impostos: readImpostos(infCte.imp),
    quantidades: readQuantidades(carga.infQ),
    documentosOriginarios: readDocumentosOriginarios(normal.infDoc),
    modalInfo: readModalInfo(normal.infModal),
    observacoes: readObservacoes(infCte.compl),
  };
}

function readParty(value: unknown, addressKey: string): DacteParty {
  const party = asRecord(value);
  const address = asRecord(party[addressKey]);
  const addressLine = [
    text(address.xLgr),
    text(address.nro),
    text(address.xCpl),
    text(address.xBairro),
  ]
    .filter(Boolean)
    .join(', ');

  return {
    nome: text(party.xNome) || text(party.xFant),
    documento: formatTaxId(text(party.CNPJ) || text(party.CPF)),
    inscricaoEstadual: text(party.IE),
    endereco: addressLine,
    municipioUf: joinNonEmpty(text(address.xMun), text(address.UF), ' / '),
    cep: formatCep(text(address.CEP)),
    telefone: text(address.fone) || text(party.fone),
  };
}

function readTomador(infCte: XmlRecord, ide: XmlRecord) {
  const toma4 = asRecord(ide.toma4);
  if (Object.keys(toma4).length > 0) return readParty(toma4, 'enderToma');

  const code = text(asRecord(ide.toma3).toma);
  const partyByCode: Record<string, [unknown, string]> = {
    '0': [infCte.rem, 'enderReme'],
    '1': [infCte.exped, 'enderExped'],
    '2': [infCte.receb, 'enderReceb'],
    '3': [infCte.dest, 'enderDest'],
  };
  const party = partyByCode[code];
  return party ? readParty(party[0], party[1]) : emptyParty();
}

function readComponentes(value: unknown): DacteValueItem[] {
  return toArray(asRecord(value).Comp)
    .map((item) => asRecord(item))
    .map((item) => ({
      label: text(item.xNome),
      value: formatMoney(text(item.vComp)),
    }))
    .filter((item) => item.label || item.value !== '0,00');
}

function readImpostos(value: unknown): DacteValueItem[] {
  const imposto = asRecord(value);
  const icmsContainer = asRecord(imposto.ICMS);
  const icms = asRecord(Object.values(icmsContainer)[0]);
  return [
    { label: 'CST/CSOSN', value: text(icms.CST) || text(icms.CSOSN) },
    { label: 'BASE ICMS', value: formatMoney(text(icms.vBC)) },
    {
      label: 'ALÍQUOTA ICMS',
      value: text(icms.pICMS) ? `${formatDecimal(text(icms.pICMS))}%` : '',
    },
    { label: 'VALOR ICMS', value: formatMoney(text(icms.vICMS)) },
    { label: 'TOTAL TRIBUTOS', value: formatMoney(text(imposto.vTotTrib)) },
  ].filter((item) => item.value && item.value !== '0,00');
}

function readQuantidades(value: unknown): DacteValueItem[] {
  return toArray(value)
    .map((item) => asRecord(item))
    .map((item) => ({
      label: [text(item.cUnid), text(item.tpMed)].filter(Boolean).join(' - '),
      value: formatDecimal(text(item.qCarga)),
    }))
    .filter((item) => item.label || item.value);
}

function readDocumentosOriginarios(value: unknown) {
  const documentos = asRecord(value);
  const chavesNfe = toArray(documentos.infNFe)
    .map((item) => text(asRecord(item).chave))
    .filter((key) => /^\d{44}$/.test(key))
    .map((key) => `NF-e ${formatAccessKey(key)}`);
  const notas = toArray(documentos.infNF)
    .map((item) => asRecord(item))
    .map(
      (item) =>
        `NF ${text(item.nDoc) || '-'} · Série ${text(item.serie) || '-'} · ${formatMoney(text(item.vNF))}`,
    );
  const outros = toArray(documentos.infOutros)
    .map((item) => asRecord(item))
    .map(
      (item) =>
        `${text(item.tpDoc) || 'OUTRO'} ${text(item.nDoc) || '-'} · ${formatMoney(text(item.vDocFisc))}`,
    );
  return [...chavesNfe, ...notas, ...outros];
}

function readModalInfo(value: unknown): DacteValueItem[] {
  const modal = asRecord(value);
  const rodo = asRecord(modal.rodo);
  if (Object.keys(rodo).length === 0) return [];
  return [
    { label: 'RNTRC', value: text(rodo.RNTRC) },
    { label: 'PREVISÃO DE ENTREGA', value: formatDate(text(rodo.dPrev)) },
    { label: 'LOTAÇÃO', value: text(rodo.lota) === '1' ? 'SIM' : 'NÃO' },
  ].filter((item) => item.value);
}

function readObservacoes(value: unknown) {
  const complementos = asRecord(value);
  const observacoes = [
    text(complementos.xCaracAd),
    text(complementos.xCaracSer),
    text(complementos.xEmi),
    text(complementos.xObs),
  ].filter(Boolean);

  for (const item of [
    ...toArray(complementos.ObsCont),
    ...toArray(complementos.ObsFisco),
  ]) {
    const record = asRecord(item);
    const label = text(record['@_xCampo']);
    const content = text(record.xTexto);
    if (label || content)
      observacoes.push(`${label ? `${label}: ` : ''}${content}`);
  }
  return observacoes;
}

export function formatAccessKey(key: string) {
  return key.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
}

function emptyParty(): DacteParty {
  return {
    nome: '',
    documento: '',
    inscricaoEstadual: '',
    endereco: '',
    municipioUf: '',
    cep: '',
    telefone: '',
  };
}

function asRecord(value: unknown): XmlRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as XmlRecord)
    : {};
}

function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null ? [] : [value];
}

function text(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value).trim();
  }
  return '';
}

function digits(value: string) {
  return value.replace(/\D/g, '');
}

function mapValue(value: string, values: Record<string, string>) {
  return values[value] || value || '-';
}

function joinNonEmpty(first: string, second: string, separator: string) {
  return [first, second].filter(Boolean).join(separator);
}

function formatTaxId(value: string) {
  const normalized = digits(value);
  if (normalized.length === 14) {
    return normalized.replace(
      /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
      '$1.$2.$3/$4-$5',
    );
  }
  if (normalized.length === 11) {
    return normalized.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  }
  return normalized;
}

function formatCep(value: string) {
  const normalized = digits(value);
  return normalized.length === 8
    ? normalized.replace(/^(\d{5})(\d{3})$/, '$1-$2')
    : normalized;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return value && !Number.isNaN(date.getTime())
    ? date.toLocaleString('pt-BR', { timeZone: 'America/Bahia' })
    : value;
}

function formatDate(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  return value && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString('pt-BR', { timeZone: 'UTC' })
    : value;
}

function formatDecimal(value: string) {
  const number = Number(value);
  return Number.isFinite(number)
    ? number.toLocaleString('pt-BR', { maximumFractionDigits: 4 })
    : value;
}

function formatMoney(value: string) {
  const number = Number(value);
  return Number.isFinite(number)
    ? number.toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      })
    : 'R$ 0,00';
}
