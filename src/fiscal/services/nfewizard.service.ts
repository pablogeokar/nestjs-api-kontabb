import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
} from 'node:crypto';
import * as https from 'node:https';
import { rootCertificates } from 'node:tls';
import forge from 'node-forge';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import {
  CertificateAccessError,
  CertificadoService,
} from './certificado.service';
import { SefazConsultaControlService } from './sefaz-consulta-control.service';
import {
  isValidFiscalAccessKey,
  normalizeFiscalAccessKey,
  normalizeFiscalCnpj,
} from './fiscal-identifier';

type ManifestacaoTipoEvento = '210210' | '210200' | '210220' | '210240';
type XmlRecord = Record<string, unknown>;
type SefazKind = 'nfe' | 'cte';

const NFE_NS = 'http://www.portalfiscal.inf.br/nfe';
const CTE_NS = 'http://www.portalfiscal.inf.br/cte';
const XMLDSIG_NS = 'http://www.w3.org/2000/09/xmldsig#';
const C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
const MAX_SOAP_BYTES = 64 * 1024 * 1024;
const TIMEOUT_MS = 30_000;

const ENDPOINTS = {
  nfe: {
    1: 'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx',
    2: 'https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx',
  },
  cte: {
    1: 'https://www1.cte.fazenda.gov.br/CTeDistribuicaoDFe/CTeDistribuicaoDFe.asmx',
    2: 'https://hom1.cte.fazenda.gov.br/CTeDistribuicaoDFe/CTeDistribuicaoDFe.asmx',
  },
  evento: {
    1: 'https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
    2: 'https://hom1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
  },
} as const;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

export interface ManifestacaoSefazResult {
  status: number;
  motivo: string;
  protocolo?: string;
}

export class ManifestacaoSefazRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManifestacaoSefazRejectedError';
  }
}

export function extractManifestacaoSefazResult(
  value: unknown,
): ManifestacaoSefazResult | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const result = extractManifestacaoSefazResult(item);
      if (result) return result;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;

  const record = value as XmlRecord;
  const info = record.infEvento;
  if (info && typeof info === 'object') {
    const event = info as XmlRecord;
    const status = Number(event.cStat);
    if (Number.isFinite(status)) {
      return {
        status,
        motivo: typeof event.xMotivo === 'string' ? event.xMotivo : '',
        protocolo: typeof event.nProt === 'string' ? event.nProt : undefined,
      };
    }
  }
  for (const nested of Object.values(record)) {
    const result = extractManifestacaoSefazResult(nested);
    if (result) return result;
  }
  return null;
}

function asRecord(value: unknown): XmlRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as XmlRecord)
    : null;
}

function findNode(value: unknown, name: string): unknown {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findNode(item, name);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const record = asRecord(value);
  if (!record) return undefined;
  if (record[name] !== undefined) return record[name];
  for (const nested of Object.values(record)) {
    const found = findNode(nested, name);
    if (found !== undefined) return found;
  }
  return undefined;
}

function xmlText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
}

function embeddedXml(value: unknown): XmlRecord | null {
  const content = xmlText(value) || xmlText(asRecord(value)?.['#text']);
  return content.trimStart().startsWith('<') ? parseSoap(content) : null;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r/g, '&#xD;');
}

function parseSoap(xml: string): XmlRecord {
  if (!xml.trimStart().startsWith('<') || /<!DOCTYPE\b|<!ENTITY\b/i.test(xml)) {
    throw new Error('Resposta XML inválida da SEFAZ.');
  }
  if (XMLValidator.validate(xml) !== true) {
    throw new Error('Resposta SOAP malformada da SEFAZ.');
  }
  const parsed = asRecord(parser.parse(xml));
  if (!parsed) throw new Error('Resposta SOAP vazia da SEFAZ.');
  const fault = asRecord(findNode(parsed, 'Fault'));
  if (fault) {
    const reason = asRecord(fault.Reason);
    throw new Error(
      `SOAP Fault da SEFAZ: ${xmlText(findNode(reason, 'Text')) || xmlText(fault.faultstring) || 'sem detalhe'}`,
    );
  }
  return parsed;
}

function normalizeDistributionResponse(soapXml: string): unknown {
  const soap = parseSoap(soapXml);
  let ret = findNode(soap, 'retDistDFeInt');
  if (ret === undefined) {
    const result =
      findNode(soap, 'nfeDistDFeInteresseResult') ??
      findNode(soap, 'cteDistDFeInteresseResult');
    const embedded = embeddedXml(result);
    if (embedded) ret = findNode(embedded, 'retDistDFeInt');
  }
  const data = asRecord(ret);
  if (!data) throw new Error('A SEFAZ não retornou retDistDFeInt.');

  const lote = asRecord(data.loteDistDFeInt);
  const docZip = lote?.docZip;
  const docs = (Array.isArray(docZip) ? docZip : docZip ? [docZip] : [])
    .map((value) => {
      const item = asRecord(value);
      if (!item) return null;
      const content = xmlText(item['#text']);
      return content
        ? {
            $: {
              NSU: xmlText(item['@_NSU']),
              schema: xmlText(item['@_schema']),
            },
            _: content,
          }
        : null;
    })
    .filter((value) => value !== null);

  return {
    data: {
      retDistDFeInt: {
        cStat: xmlText(data.cStat),
        xMotivo: xmlText(data.xMotivo),
        ultNSU: xmlText(data.ultNSU),
        maxNSU: xmlText(data.maxNSU),
        loteDistDFeInt: { docZip: docs },
      },
    },
  };
}

interface CertificateMaterial {
  key: string;
  cert: string;
  leaf: string;
}

export function extractA1Certificate(
  buffer: Buffer,
  senha: string,
): CertificateMaterial {
  try {
    const p12 = forge.pkcs12.pkcs12FromAsn1(
      forge.asn1.fromDer(buffer.toString('binary')),
      false,
      senha,
    );
    const keyBags = [
      ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
        forge.pki.oids.pkcs8ShroudedKeyBag
      ] ?? []),
      ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[
        forge.pki.oids.keyBag
      ] ?? []),
    ];
    const privateKey = keyBags.find((bag) => bag.key)?.key;
    if (!privateKey) throw new Error('Chave privada ausente no certificado.');
    const key = forge.pki.privateKeyToPem(privateKey);
    const publicKey = createPublicKey(createPrivateKey(key))
      .export({ type: 'spki', format: 'pem' })
      .toString();
    const certBags =
      p12.getBags({ bagType: forge.pki.oids.certBag })[
        forge.pki.oids.certBag
      ] ?? [];
    const certs = certBags
      .map((bag) => bag.cert)
      .filter((cert): cert is forge.pki.Certificate => Boolean(cert));
    const leaf = certs.find(
      (cert) =>
        createPublicKey(forge.pki.certificateToPem(cert))
          .export({ type: 'spki', format: 'pem' })
          .toString() === publicKey,
    );
    if (!leaf) throw new Error('Certificado da chave privada não encontrado.');
    const leafPem = forge.pki.certificateToPem(leaf);
    const chain = certs
      .filter((cert) => cert !== leaf)
      .map((cert) => forge.pki.certificateToPem(cert));
    return { key, cert: [leafPem, ...chain].join('\n'), leaf: leafPem };
  } catch (cause) {
    throw new CertificateAccessError(
      'CERTIFICATE_INITIALIZATION_FAILED',
      'Não foi possível preparar o certificado A1.',
      { cause },
    );
  }
}

function envelope(
  operation: string,
  wsdlNamespace: string,
  data: string,
): string {
  // Sem prefixos herdados: C14N inclusiva da assinatura do evento permanece
  // idêntica antes e depois de embutir envEvento no corpo SOAP.
  return `<?xml version="1.0" encoding="UTF-8"?><Envelope xmlns="http://www.w3.org/2003/05/soap-envelope"><Body><${operation} xmlns="${wsdlNamespace}"><${operation === 'cteDistDFeInteresse' ? 'cteDadosMsg' : 'nfeDadosMsg'}>${data}</${operation === 'cteDistDFeInteresse' ? 'cteDadosMsg' : 'nfeDadosMsg'}></${operation}></Body></Envelope>`;
}

function postSoap(
  url: string,
  body: string,
  certificate: CertificateMaterial,
  action: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: 'POST',
        agent: new https.Agent({
          key: certificate.key,
          cert: certificate.cert,
          ca: [...rootCertificates],
          rejectUnauthorized: true,
        }),
        headers: {
          'Content-Type': `application/soap+xml; charset=utf-8; action="${action}"`,
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_SOAP_BYTES) {
            req.destroy(
              new Error('Resposta da SEFAZ excedeu o limite de tamanho.'),
            );
            return;
          }
          chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('end', () => {
          const xml = Buffer.concat(chunks).toString('utf8');
          if (
            !res.statusCode ||
            res.statusCode < 200 ||
            res.statusCode >= 300
          ) {
            reject(new Error(`SEFAZ respondeu HTTP ${res.statusCode ?? 0}.`));
            return;
          }
          resolve(xml);
        });
      },
    );
    req.on('timeout', () =>
      req.destroy(new Error('Tempo limite da SEFAZ excedido.')),
    );
    req.on('error', reject);
    req.end(body);
  });
}

/**
 * Mantém o token público enquanto substitui a implementação do wizard.
 * Consultas de distribuição usam apenas mTLS; eventos também exigem XMLDSig.
 */
@Injectable()
export class NfeWizardService {
  private readonly logger = new Logger(NfeWizardService.name);

  constructor(
    private readonly certificadoService: CertificadoService,
    private readonly configService: ConfigService,
    private readonly consultaControl: SefazConsultaControlService,
  ) {}

  async validarAmbienteCliente(input: {
    clienteId: string;
    cnpj: string;
    uf: string;
  }): Promise<void> {
    await this.certificate(input.clienteId);
  }

  async consultarDistribuicaoDFe(input: {
    clienteId: string;
    cnpj: string;
    uf: string;
    ultimoNsu: number;
  }): Promise<unknown> {
    return this.consultaControl.consultar(
      { cnpj: input.cnpj, ambiente: this.ambiente(), porChave: false },
      () => this.distribution('nfe', input),
    );
  }

  async consultarDistribuicaoCTe(input: {
    clienteId: string;
    cnpj: string;
    uf: string;
    ultimoNsu: number;
  }): Promise<unknown> {
    return this.distribution('cte', input);
  }

  async consultarPorChave(input: {
    clienteId: string;
    cnpj: string;
    uf: string;
    chaveAcesso: string;
  }): Promise<unknown> {
    return this.consultaControl.consultar(
      { cnpj: input.cnpj, ambiente: this.ambiente(), porChave: true },
      () => this.distribution('nfe', input),
    );
  }

  async enviarManifestacao(input: {
    clienteId: string;
    cnpj: string;
    uf: string;
    chaveAcesso: string;
    tipoEvento: ManifestacaoTipoEvento;
    sequencia?: number;
    justificativa?: string;
  }): Promise<ManifestacaoSefazResult> {
    const certificate = await this.certificate(input.clienteId);
    const evento = buildSignedManifestacaoXml(
      input,
      this.ambiente(),
      certificate,
    );
    const ns = `${NFE_NS}/wsdl/NFeRecepcaoEvento4`;
    const body = envelope('nfeRecepcaoEvento', ns, evento);
    const response = parseSoap(
      await postSoap(
        ENDPOINTS.evento[this.ambiente()],
        body,
        certificate,
        `${ns}/nfeRecepcaoEvento`,
      ),
    );
    const eventResponse =
      embeddedXml(
        findNode(response, 'nfeResultMsg') ??
          findNode(response, 'nfeRecepcaoEventoResult') ??
          findNode(response, 'nfeRecepcaoEventoNFResult'),
      ) ?? response;
    const result = extractManifestacaoSefazResult(eventResponse);
    if (!result) {
      const lote = asRecord(findNode(eventResponse, 'retEnvEvento'));
      if (lote) {
        throw new ManifestacaoSefazRejectedError(
          `A SEFAZ rejeitou o lote de manifestação (${xmlText(lote.cStat)}): ${xmlText(lote.xMotivo) || 'motivo não informado'}`,
        );
      }
      throw new Error('A SEFAZ retornou uma resposta de evento inválida.');
    }
    if (result.status !== 135 && result.status !== 136) {
      throw new ManifestacaoSefazRejectedError(
        `A SEFAZ rejeitou a manifestação (${result.status}): ${result.motivo || 'motivo não informado'}`,
      );
    }
    return result;
  }

  private async distribution(
    kind: SefazKind,
    input: {
      clienteId: string;
      cnpj: string;
      uf: string;
      ultimoNsu?: number;
      chaveAcesso?: string;
    },
  ): Promise<unknown> {
    const certificate = await this.certificate(input.clienteId);
    const cnpj = normalizeFiscalCnpj(input.cnpj);
    if (!cnpj) throw new Error('CNPJ inválido para consulta à SEFAZ.');
    const accessKey = input.chaveAcesso
      ? normalizeFiscalAccessKey(input.chaveAcesso)
      : '';
    if (input.chaveAcesso && !isValidFiscalAccessKey(accessKey)) {
      throw new Error('Chave de acesso inválida para consulta à SEFAZ.');
    }
    if (
      !input.chaveAcesso &&
      (!Number.isSafeInteger(input.ultimoNsu) ||
        (input.ultimoNsu ?? -1) < 0 ||
        (input.ultimoNsu ?? 0) > 999_999_999_999_999)
    ) {
      throw new Error('Último NSU inválido para consulta à SEFAZ.');
    }
    const ambiente = this.ambiente();
    const isNfe = kind === 'nfe';
    const ns = isNfe ? NFE_NS : CTE_NS;
    const operation = isNfe ? 'nfeDistDFeInteresse' : 'cteDistDFeInteresse';
    const wsdl = `${ns}/wsdl/${isNfe ? 'NFe' : 'CTe'}DistribuicaoDFe`;
    const query = input.chaveAcesso
      ? `<consChNFe><chNFe>${accessKey}</chNFe></consChNFe>`
      : `<distNSU><ultNSU>${String(input.ultimoNsu ?? 0).padStart(15, '0')}</ultNSU></distNSU>`;
    const data = `<distDFeInt xmlns="${ns}" versao="${isNfe ? '1.01' : '1.00'}"><tpAmb>${ambiente}</tpAmb><cUFAutor>${getCodigoUF(input.uf)}</cUFAutor><CNPJ>${cnpj}</CNPJ>${query}</distDFeInt>`;
    const body = envelope(operation, wsdl, data);
    this.logger.log(
      `Consultando distribuição ${kind.toUpperCase()} para ${input.cnpj}`,
    );
    return normalizeDistributionResponse(
      await postSoap(
        ENDPOINTS[kind][ambiente],
        body,
        certificate,
        `${wsdl}/${operation}`,
      ),
    );
  }

  private async certificate(clienteId: string): Promise<CertificateMaterial> {
    const data =
      await this.certificadoService.getDecryptedCertificate(clienteId);
    if (!data) {
      throw new CertificateAccessError(
        'CERTIFICATE_UNAVAILABLE',
        `Nenhum certificado digital A1 ativo para o cliente ${clienteId}`,
      );
    }
    return extractA1Certificate(data.buffer, data.senha);
  }

  private ambiente(): 1 | 2 {
    return this.configService.get<string>('SEFAZ_AMBIENTE') === 'PRODUCAO'
      ? 1
      : 2;
  }
}

function getCodigoUF(uf: string): number {
  const codes: Record<string, number> = {
    AC: 12,
    AL: 27,
    AM: 13,
    AP: 16,
    BA: 29,
    CE: 23,
    DF: 53,
    ES: 32,
    GO: 52,
    MA: 21,
    MG: 31,
    MS: 50,
    MT: 51,
    PA: 15,
    PB: 25,
    PE: 26,
    PI: 22,
    PR: 41,
    RJ: 33,
    RN: 24,
    RO: 11,
    RR: 14,
    RS: 43,
    SC: 42,
    SE: 28,
    SP: 35,
    TO: 17,
  };
  return codes[uf.toUpperCase()] ?? 91;
}

export function buildSignedManifestacaoXml(
  input: {
    cnpj: string;
    uf: string;
    chaveAcesso: string;
    tipoEvento: ManifestacaoTipoEvento;
    sequencia?: number;
    justificativa?: string;
  },
  ambiente: 1 | 2,
  certificate: CertificateMaterial,
  now = new Date(),
): string {
  const sequence = input.sequencia ?? 1;
  const cnpj = normalizeFiscalCnpj(input.cnpj);
  const accessKey = normalizeFiscalAccessKey(input.chaveAcesso);
  if (!cnpj || !isValidFiscalAccessKey(accessKey)) {
    throw new Error('CNPJ ou chave de acesso inválidos para manifestação.');
  }
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 20) {
    throw new Error('Sequência do evento inválida.');
  }
  const description: Record<ManifestacaoTipoEvento, string> = {
    '210210': 'Ciencia da Operacao',
    '210200': 'Confirmacao da Operacao',
    '210220': 'Desconhecimento da Operacao',
    '210240': 'Operacao nao Realizada',
  };
  if (
    input.tipoEvento === '210240' &&
    (!input.justificativa ||
      input.justificativa.length < 15 ||
      input.justificativa.length > 255)
  ) {
    throw new Error('Justificativa da operação não realizada inválida.');
  }
  const id = `ID${input.tipoEvento}${accessKey}${String(sequence).padStart(2, '0')}`;
  const timestamp = now.toISOString().replace(/\.\d{3}Z$/, '+00:00');
  const justification =
    input.tipoEvento === '210240'
      ? `<xJust>${escapeXml(input.justificativa ?? '')}</xJust>`
      : '';
  const detail = `<detEvento versao="1.00"><descEvento>${description[input.tipoEvento]}</descEvento>${justification}</detEvento>`;
  // Namespace e ordem de atributos já estão em C14N 1.0 para este XML gerado.
  const info = `<infEvento xmlns="${NFE_NS}" Id="${id}"><cOrgao>${getCodigoUF(input.uf)}</cOrgao><tpAmb>${ambiente}</tpAmb><CNPJ>${cnpj}</CNPJ><chNFe>${accessKey}</chNFe><dhEvento>${timestamp}</dhEvento><tpEvento>${input.tipoEvento}</tpEvento><nSeqEvento>${sequence}</nSeqEvento><verEvento>1.00</verEvento>${detail}</infEvento>`;
  const digest = createHash('sha1').update(info, 'utf8').digest('base64');
  const signedInfo = `<SignedInfo xmlns="${XMLDSIG_NS}"><CanonicalizationMethod Algorithm="${C14N}"></CanonicalizationMethod><SignatureMethod Algorithm="${XMLDSIG_NS}rsa-sha1"></SignatureMethod><Reference URI="#${id}"><Transforms><Transform Algorithm="${XMLDSIG_NS}enveloped-signature"></Transform><Transform Algorithm="${C14N}"></Transform></Transforms><DigestMethod Algorithm="${XMLDSIG_NS}sha1"></DigestMethod><DigestValue>${digest}</DigestValue></Reference></SignedInfo>`;
  const signature = sign(
    'RSA-SHA1',
    Buffer.from(signedInfo, 'utf8'),
    certificate.key,
  ).toString('base64');
  const x509 = certificate.leaf.replace(
    /-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s/g,
    '',
  );
  const signatureXml = `<Signature xmlns="${XMLDSIG_NS}">${signedInfo}<SignatureValue>${signature}</SignatureValue><KeyInfo><X509Data><X509Certificate>${x509}</X509Certificate></X509Data></KeyInfo></Signature>`;
  return `<envEvento xmlns="${NFE_NS}" versao="1.00"><idLote>${now.getTime()}</idLote><evento versao="1.00">${info}${signatureXml}</evento></envEvento>`;
}
