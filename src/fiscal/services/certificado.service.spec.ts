import {
  extractCertificateCnpj,
  normalizeCertificateCnpj,
} from './certificado.service';

describe('identificação do certificado A1', () => {
  it('normaliza CNPJ numérico legado e CNPJ alfanumérico', () => {
    expect(normalizeCertificateCnpj('09.157.533/0001-56')).toBe(
      '09157533000156',
    );
    expect(normalizeCertificateCnpj('12.abc.345/01de-95')).toBe(
      '12ABC34501DE95',
    );
  });

  it('mantém os dois dígitos verificadores estritamente numéricos', () => {
    expect(normalizeCertificateCnpj('12ABC34501DE9X')).toBeNull();
    expect(normalizeCertificateCnpj('12ABC34501DE9')).toBeNull();
  });

  it('extrai o CNPJ do CN do certificado sem incorporar o nome empresarial', () => {
    expect(extractCertificateCnpj('EMPRESA EXEMPLO:12ABC34501DE95')).toBe(
      '12ABC34501DE95',
    );
    expect(extractCertificateCnpj('EMPRESA EXEMPLO: 09.157.533/0001-56')).toBe(
      '09157533000156',
    );
  });
});
