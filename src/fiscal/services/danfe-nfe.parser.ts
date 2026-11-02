import { XMLParser, XMLValidator } from 'fast-xml-parser';
import {
  isValidFiscalAccessKey,
  normalizeFiscalAccessKey,
  normalizeFiscalTaxId,
} from './fiscal-identifier';

type XmlRecord = Record<string, unknown>;

export interface DanfeParty {
  nome: string;
  documento: string;
  inscricaoEstadual: string;
  endereco: string;
  municipioUf: string;
  cep: string;
  telefone: string;
  bairro: string;
  municipio: string;
  uf: string;
}

export interface DanfeItem {
  codigo: string;
  descricao: string;
  ncm: string;
  cst: string;
  csosn: string;
  cfop: string;
  unidade: string;
  quantidade: string;
  valorUnitario: string;
  valorTotal: string;
  baseIcms: string;
  valorIcms: string;
  aliqIcms: string;
  valorIpi: string;
  aliqIpi: string;
}

export interface DanfeTotals {
  baseIcms: string;
  valorIcms: string;
  baseIcmsSt: string;
  valorIcmsSt: string;
  totalProdutos: string;
  frete: string;
  seguro: string;
  desconto: string;
  outrasDespesas: string;
  ipi: string;
  pis: string;
  cofins: string;
  valorNota: string;
}

export interface DanfeData {
  chaveAcesso: string;
  modelo: '55' | '65';
  serie: string;
  numero: string;
  emissao: string;
  ambiente: 'HOMOLOGAÇÃO' | 'PRODUÇÃO';
  tipoOperacao: '0' | '1';
  naturezaOperacao: string;
  protocolo: string;
  protocoloData: string;
  saida: string;
  inscricaoEstadualSt: string;
  status: string;
  emitente: DanfeParty;
  destinatario: DanfeParty;
  itens: DanfeItem[];
  totais: DanfeTotals;
  modalidadeFrete: string;
  transporte: {
    rntrc: string;
    placa: string;
    ufVeiculo: string;
  };
  transportadora: DanfeParty;
  volumes: {
    quantidade: string;
    especie: string;
    marca: string;
    numero: string;
    pesoBruto: string;
    pesoLiquido: string;
  };
  fatura: string;
  duplicatas: Array<{ numero: string; vencimento: string; valor: string }>;
  pagamentos: Array<{ tipo: string; descricao: string; valor: string }>;
  troco: string;
  informacoesComplementares: string;
  informacoesFisco: string;
  issqn: { base: string; valor: string; servicos: string } | null;
  qrCode: string;
  urlChave: string;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

function record(value: unknown): XmlRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as XmlRecord)
    : {};
}

function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function party(value: unknown, addressField: string): DanfeParty {
  const data = record(value);
  const address = record(data[addressField]);
  const document = normalizeFiscalTaxId(text(data.CNPJ) || text(data.CPF));
  return {
    nome: text(data.xNome) || text(data.xFant),
    documento: document,
    inscricaoEstadual: text(data.IE),
    endereco: [
      text(address.xLgr),
      text(address.nro),
      text(address.xCpl),
      text(address.xBairro),
    ]
      .filter(Boolean)
      .join(', '),
    municipioUf: [text(address.xMun), text(address.UF)]
      .filter(Boolean)
      .join(' / '),
    cep: text(address.CEP),
    telefone: text(address.fone),
    bairro: text(address.xBairro),
    municipio: text(address.xMun),
    uf: text(address.UF),
  };
}

function icmsValue(value: unknown): XmlRecord {
  const icms = record(value);
  const variant = Object.entries(icms).find(([name]) =>
    /^ICMS|^ICMSSN/.test(name),
  );
  return record(variant?.[1]);
}

function item(value: unknown): DanfeItem {
  const data = record(value);
  const product = record(data.prod);
  const tax = record(data.imposto);
  const icms = icmsValue(record(tax.ICMS));
  const ipi = record(tax.IPI);
  const ipiTax = record(ipi.IPITrib);
  return {
    codigo: text(product.cProd),
    descricao: text(product.xProd),
    ncm: text(product.NCM),
    cst: text(icms.CST),
    csosn: text(icms.CSOSN),
    cfop: text(product.CFOP),
    unidade: text(product.uCom),
    quantidade: text(product.qCom),
    valorUnitario: text(product.vUnCom),
    valorTotal: text(product.vProd),
    baseIcms: text(icms.vBC),
    valorIcms: text(icms.vICMS),
    aliqIcms: text(icms.pICMS),
    valorIpi: text(ipiTax.vIPI),
    aliqIpi: text(ipiTax.pIPI),
  };
}

export function parseDanfeXml(xml: string): DanfeData {
  const normalized = xml.replace(/^\uFEFF/, '').trim();
  if (!normalized.startsWith('<') || normalized.length > 10 * 1024 * 1024) {
    throw new Error('XML de NF-e inválido.');
  }
  if (/<!DOCTYPE\b|<!ENTITY\b/i.test(normalized)) {
    throw new Error('XML de NF-e com DTD ou entidade não é aceito.');
  }
  if (XMLValidator.validate(normalized) !== true) {
    throw new Error('XML de NF-e malformado.');
  }
  const parsed = record(parser.parse(normalized));
  const proc = record(parsed.nfeProc);
  const nfe = record(proc.NFe ?? parsed.NFe);
  const info = record(nfe.infNFe);
  const ide = record(info.ide);
  const protocol = record(record(proc.protNFe).infProt);
  const modelo = text(ide.mod);
  if (modelo !== '55' && modelo !== '65') {
    throw new Error('O XML informado não é NF-e modelo 55 ou NFC-e modelo 65.');
  }
  const key = normalizeFiscalAccessKey(text(info['@_Id']));
  const protocolKey = normalizeFiscalAccessKey(text(protocol.chNFe));
  if (
    !isValidFiscalAccessKey(key) ||
    key.slice(20, 22) !== modelo ||
    (protocolKey && protocolKey !== key)
  ) {
    throw new Error('Chave de acesso da NF-e inválida.');
  }
  const emitente = party(info.emit, 'enderEmit');
  if (!emitente.nome || !emitente.documento) {
    throw new Error('Emitente da NF-e não encontrado.');
  }
  const total = record(record(info.total).ICMSTot);
  const transport = record(info.transp);
  const volume = record(list(transport.vol)[0]);
  const cobr = record(info.cobr);
  const pag = record(info.pag);
  const additional = record(info.infAdic);
  const supl = record(nfe.infNFeSupl);
  const issqn = record(record(info.total).ISSQNtot);
  const statusCode = text(protocol.cStat);

  return {
    chaveAcesso: key,
    modelo,
    serie: text(ide.serie),
    numero: text(ide.nNF),
    emissao: text(ide.dhEmi) || text(ide.dEmi),
    ambiente: text(ide.tpAmb) === '2' ? 'HOMOLOGAÇÃO' : 'PRODUÇÃO',
    tipoOperacao: text(ide.tpNF) === '0' ? '0' : '1',
    naturezaOperacao: text(ide.natOp),
    protocolo: text(protocol.nProt),
    protocoloData: text(protocol.dhRecbto),
    saida: text(ide.dhSaiEnt) || text(ide.dSaiEnt),
    inscricaoEstadualSt: text(record(info.emit).IEST),
    status:
      statusCode === '100'
        ? 'AUTORIZADA'
        : text(protocol.xMotivo) || 'SEM PROTOCOLO',
    emitente,
    destinatario: party(info.dest, 'enderDest'),
    itens: list(info.det).map(item),
    totais: {
      baseIcms: text(total.vBC),
      valorIcms: text(total.vICMS),
      baseIcmsSt: text(total.vBCST),
      valorIcmsSt: text(total.vST),
      totalProdutos: text(total.vProd),
      frete: text(total.vFrete),
      seguro: text(total.vSeg),
      desconto: text(total.vDesc),
      outrasDespesas: text(total.vOutro),
      ipi: text(total.vIPI),
      pis: text(total.vPIS),
      cofins: text(total.vCOFINS),
      valorNota: text(total.vNF),
    },
    modalidadeFrete: text(transport.modFrete),
    transporte: {
      rntrc: text(record(transport.veicTransp).RNTC),
      placa: text(record(transport.veicTransp).placa),
      ufVeiculo: text(record(transport.veicTransp).UF),
    },
    transportadora: party(transport.transporta, 'enderTransp'),
    volumes: {
      quantidade: text(volume.qVol),
      especie: text(volume.esp),
      marca: text(volume.marca),
      numero: text(volume.nVol),
      pesoBruto: text(volume.pesoB),
      pesoLiquido: text(volume.pesoL),
    },
    fatura: text(record(cobr.fat).nFat),
    duplicatas: list(cobr.dup).map((value) => {
      const dup = record(value);
      return {
        numero: text(dup.nDup),
        vencimento: text(dup.dVenc),
        valor: text(dup.vDup),
      };
    }),
    pagamentos: list(pag.detPag).map((value) => {
      const payment = record(value);
      return {
        tipo: text(payment.tPag),
        descricao: text(payment.xPag),
        valor: text(payment.vPag),
      };
    }),
    troco: text(pag.vTroco),
    informacoesComplementares: text(additional.infCpl),
    informacoesFisco: text(additional.infAdFisco),
    issqn: Object.keys(issqn).length
      ? {
          base: text(issqn.vBC),
          valor: text(issqn.vISS),
          servicos: text(issqn.vServ),
        }
      : null,
    qrCode: text(supl.qrCode),
    urlChave: text(supl.urlChave),
  };
}
