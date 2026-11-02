import { EventEmitter } from 'node:events';
import { createHash, generateKeyPairSync, verify } from 'node:crypto';
import * as https from 'node:https';
import forge from 'node-forge';
import { ConfigService } from '@nestjs/config';
import {
  buildSignedManifestacaoXml,
  extractA1Certificate,
  extractManifestacaoSefazResult,
  ManifestacaoSefazRejectedError,
  NfeWizardService,
} from './nfewizard.service';
import {
  extractDfeDocZips,
  extractDfeResponseMetadata,
} from './dfe-document.parser';
import { CertificadoService } from './certificado.service';
import { SefazConsultaControlService } from './sefaz-consulta-control.service';
import { buildAccessKey } from './__fixtures__/danfe-xml';

jest.mock('node:https', () => ({
  Agent: jest.fn().mockImplementation(() => ({})),
  request: jest.fn(),
}));

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { format: 'pem', type: 'spki' },
  privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
});

const certificate = {
  key: privateKey,
  cert: 'CERT',
  leaf: '-----BEGIN CERTIFICATE-----\nQUJD\n-----END CERTIFICATE-----',
};

function setup(responseXml: string, ambiente = 'PRODUCAO') {
  const requests: Array<{
    url: string;
    body: string;
    options: Record<string, unknown>;
  }> = [];
  const request = https.request as jest.Mock;
  request.mockReset();
  request.mockImplementation(
    (
      url: string,
      options: Record<string, unknown>,
      callback: (res: EventEmitter) => void,
    ) => {
      const req = new EventEmitter() as EventEmitter & {
        end(body: string): void;
        destroy(error: Error): void;
      };
      req.end = (body: string) => {
        requests.push({ url, body, options });
        const res = new EventEmitter() as EventEmitter & { statusCode: number };
        res.statusCode = 200;
        callback(res);
        process.nextTick(() => {
          res.emit('data', Buffer.from(responseXml));
          res.emit('end');
        });
      };
      req.destroy = (error: Error) => req.emit('error', error);
      return req;
    },
  );
  const control = {
    consultar: jest.fn(
      async (_context: unknown, action: () => Promise<unknown>) => action(),
    ),
  };
  const service = new NfeWizardService(
    {} as CertificadoService,
    new ConfigService({ SEFAZ_AMBIENTE: ambiente }),
    control as unknown as SefazConsultaControlService,
  );
  jest
    .spyOn(service as never, 'certificate')
    .mockResolvedValue(certificate as never);
  return { service, control, requests };
}

function distributionResponse(status = '138') {
  return `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
    <soap:Body><nfeDistDFeInteresseResponse>
      <nfeDistDFeInteresseResult>
        <retDistDFeInt><cStat>${status}</cStat><xMotivo>Documento localizado</xMotivo>
          <ultNSU>000000000000042</ultNSU><maxNSU>000000000000043</maxNSU>
          <loteDistDFeInt><docZip NSU="000000000000042" schema="resNFe_v1.01.xsd">QUJD</docZip>
          </loteDistDFeInt></retDistDFeInt>
      </nfeDistDFeInteresseResult></nfeDistDFeInteresseResponse>
    </soap:Body></soap:Envelope>`;
}

describe('NfeWizardService SOAP nativo', () => {
  afterEach(() => jest.clearAllMocks());

  it('preserva o contrato de distribuição NF-e e o controle de consultas', async () => {
    const { service, control, requests } = setup(distributionResponse());
    const response = await service.consultarDistribuicaoDFe({
      clienteId: 'cliente',
      cnpj: '12345678000195',
      uf: 'BA',
      ultimoNsu: 41,
    });
    expect(control.consultar).toHaveBeenCalledWith(
      { cnpj: '12345678000195', ambiente: 1, porChave: false },
      expect.any(Function),
    );
    expect(requests[0].url).toContain('www1.nfe.fazenda.gov.br');
    expect(requests[0].body).toContain('versao="1.01"');
    expect(requests[0].body).toContain('<ultNSU>000000000000041</ultNSU>');
    expect(requests[0].options.method).toBe('POST');
    const headers = requests[0].options.headers as Record<string, string>;
    expect(headers['Content-Type']).toContain(
      'application/soap+xml; charset=utf-8; action=',
    );
    expect(extractDfeResponseMetadata(response)).toMatchObject({
      cStat: 138,
      ultimoNsu: 42,
      maxNsu: 43,
    });
    expect(extractDfeDocZips(response)).toEqual([
      {
        nsu: 42,
        schema: 'resNFe_v1.01.xsd',
        content: 'QUJD',
      },
    ]);
  });

  it('consulta CT-e em homologação pelo endpoint e namespace próprios', async () => {
    const { service, control, requests } = setup(
      distributionResponse('137'),
      'HOMOLOGACAO',
    );
    const response = await service.consultarDistribuicaoCTe({
      clienteId: 'cliente',
      cnpj: '12345678000195',
      uf: 'SP',
      ultimoNsu: 0,
    });
    expect(control.consultar).not.toHaveBeenCalled();
    expect(requests[0].url).toContain('hom1.cte.fazenda.gov.br');
    expect(requests[0].body).toContain(
      '<cteDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/cte/wsdl/CTeDistribuicaoDFe">',
    );
    expect(requests[0].body).toContain('versao="1.00"');
    expect(extractDfeResponseMetadata(response).cStat).toBe(137);
  });

  it('consulta por chave sob o controle compartilhado', async () => {
    const { service, control, requests } = setup(distributionResponse());
    await service.consultarPorChave({
      clienteId: 'cliente',
      cnpj: '12345678000195',
      uf: 'BA',
      chaveAcesso: buildAccessKey('55'),
    });
    expect(control.consultar).toHaveBeenCalledWith(
      { cnpj: '12345678000195', ambiente: 1, porChave: true },
      expect.any(Function),
    );
    expect(requests[0].body).toContain(
      `<consChNFe><chNFe>${buildAccessKey('55')}</chNFe></consChNFe>`,
    );
  });

  it('interpreta XML de distribuição escapado no resultado SOAP', async () => {
    const inner =
      '<retDistDFeInt><cStat>137</cStat><xMotivo>Nenhum documento</xMotivo><ultNSU>0</ultNSU><maxNSU>0</maxNSU></retDistDFeInt>';
    const response = `<Envelope><Body><nfeDistDFeInteresseResult>${inner
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')}</nfeDistDFeInteresseResult></Body></Envelope>`;
    const { service } = setup(response);
    const result = await service.consultarDistribuicaoDFe({
      clienteId: 'cliente',
      cnpj: '12345678000195',
      uf: 'BA',
      ultimoNsu: 0,
    });
    expect(extractDfeResponseMetadata(result).cStat).toBe(137);
  });

  it('assina o evento e interpreta o status do evento, não o status do lote', async () => {
    const eventResponse = `<Envelope><Body><retEnvEvento><cStat>128</cStat>
      <retEvento><infEvento><cStat>135</cStat><xMotivo>Evento registrado</xMotivo>
      <nProt>123456789</nProt></infEvento></retEvento>
      </retEnvEvento></Body></Envelope>`;
    const { service, requests } = setup(eventResponse);
    const result = await service.enviarManifestacao({
      clienteId: 'cliente',
      cnpj: '12345678000195',
      uf: 'BA',
      chaveAcesso: buildAccessKey('55'),
      tipoEvento: '210210',
    });
    expect(result).toEqual({
      status: 135,
      motivo: 'Evento registrado',
      protocolo: '123456789',
    });
    expect(requests[0].body).toContain('<Signature ');
    expect(requests[0].body).toContain('<tpEvento>210210</tpEvento>');
  });

  it('rejeita evento que não foi aceito', async () => {
    const response = `<Envelope><Body><retEnvEvento><cStat>128</cStat>
      <retEvento><infEvento><cStat>573</cStat><xMotivo>Duplicidade</xMotivo>
      </infEvento></retEvento></retEnvEvento></Body></Envelope>`;
    const { service } = setup(response);
    await expect(
      service.enviarManifestacao({
        clienteId: 'cliente',
        cnpj: '12345678000195',
        uf: 'BA',
        chaveAcesso: buildAccessKey('55'),
        tipoEvento: '210210',
      }),
    ).rejects.toBeInstanceOf(ManifestacaoSefazRejectedError);
  });

  it('interpreta retorno de evento escapado no resultado SOAP', async () => {
    const inner =
      '<retEnvEvento><cStat>128</cStat><retEvento><infEvento><cStat>136</cStat><xMotivo>Registrado</xMotivo></infEvento></retEvento></retEnvEvento>';
    const response = `<Envelope><Body><nfeResultMsg>${inner
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')}</nfeResultMsg></Body></Envelope>`;
    const { service } = setup(response);
    await expect(
      service.enviarManifestacao({
        clienteId: 'cliente',
        cnpj: '12345678000195',
        uf: 'BA',
        chaveAcesso: buildAccessKey('55'),
        tipoEvento: '210210',
      }),
    ).resolves.toMatchObject({ status: 136, motivo: 'Registrado' });
  });
});

describe('XMLDSig da manifestação', () => {
  it('assina o digest de infEvento e SignedInfo com RSA-SHA1', () => {
    const xml = buildSignedManifestacaoXml(
      {
        cnpj: '12345678000195',
        uf: 'BA',
        chaveAcesso: buildAccessKey('55'),
        tipoEvento: '210240',
        justificativa: 'Mercadoria não foi entregue',
      },
      2,
      certificate,
      new Date('2026-11-01T12:00:00Z'),
    );
    const info = xml.match(/<infEvento\b[\s\S]*?<\/infEvento>/)?.[0];
    const signedInfo = xml.match(/<SignedInfo\b[\s\S]*?<\/SignedInfo>/)?.[0];
    const digest = xml.match(/<DigestValue>([^<]+)<\/DigestValue>/)?.[1];
    const signature = xml.match(
      /<SignatureValue>([^<]+)<\/SignatureValue>/,
    )?.[1];
    expect(info).toBeDefined();
    expect(signedInfo).toBeDefined();
    expect(digest).toBe(
      createHash('sha1')
        .update(info as string)
        .digest('base64'),
    );
    expect(
      verify(
        'RSA-SHA1',
        Buffer.from(signedInfo as string),
        publicKey,
        Buffer.from(signature as string, 'base64'),
      ),
    ).toBe(true);
    expect(xml).toContain('REC-xml-c14n-20010315');
  });

  it('mantém a extração do contrato público', () => {
    expect(
      extractManifestacaoSefazResult({
        retEvento: { infEvento: { cStat: '136', xMotivo: 'Registrado' } },
      }),
    ).toEqual({ status: 136, motivo: 'Registrado', protocolo: undefined });
  });

  it('não inclui xJust no evento de Desconhecimento', () => {
    const xml = buildSignedManifestacaoXml(
      {
        cnpj: '12345678000195',
        uf: 'BA',
        chaveAcesso: buildAccessKey('55'),
        tipoEvento: '210220',
        justificativa: 'Texto recebido do cliente',
      },
      2,
      certificate,
    );
    expect(xml).toContain('<tpEvento>210220</tpEvento>');
    expect(xml).not.toContain('<xJust>');
  });
});

describe('certificado A1', () => {
  it('extrai a chave correspondente ao certificado público do PFX', () => {
    const keys = forge.pki.rsa.generateKeyPair({ bits: 1024 });
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = '01';
    cert.validity.notBefore = new Date('2025-01-01T00:00:00Z');
    cert.validity.notAfter = new Date('2028-01-01T00:00:00Z');
    cert.setSubject([{ name: 'commonName', value: 'Teste Kontabb' }]);
    cert.setIssuer([{ name: 'commonName', value: 'Teste Kontabb' }]);
    cert.sign(keys.privateKey);
    const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, cert, 'senha-teste');
    const buffer = Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary');

    const extracted = extractA1Certificate(buffer, 'senha-teste');
    expect(extracted.key).toContain('BEGIN RSA PRIVATE KEY');
    expect(extracted.leaf).toContain('BEGIN CERTIFICATE');
    expect(extracted.cert).toContain(extracted.leaf);
  });
});
