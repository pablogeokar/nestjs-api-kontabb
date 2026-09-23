import {
  extractDadosFerias,
  isReciboFerias,
} from '../common/pdf-extraction-ferias';

const textoJailton = `Até 15 (quinze) dias antes do término do período aquisitivo o empregado solicita a concessão de abono pecuniário.
JAILTON OLIVEIRA ALVES JUNIOR
09/05/2025 08/05/2026
Período aquisitivo
a
Período a ser gozado
15/09/2026 14/10/2026
OLYMPUS ATIVIDADES FISICA LTDA 00034
18103272000182
INST.DE MUSCULAÇÃOAdmissão: 09/05/2024
RECIBO DE FÉRIAS
Adicional Desconto
Empresa:
CNPJ.:
Funcionário:
Função:
Depto.: 0001
F É R I A S
Data: Assinatura do Funcionário
Data: Assinatura da Empresa
Duração
a
Data Assinatura do Funcionário
Data
Dias
Descrição
SOLICITAÇÃO DE ABONO
NOTIFICAÇÃO DE FÉRIAS
000018
30
Assinatura da Empresa
14/08/2026
14/08/2026
(
(
)
) /
Faltas
00 Dias
CTPS: 04549545 / 00040
Até 30 (trinta) dias antes do início de gozo a empresa acima comunica a concessão das férias abaixo:
039 Férias Horista 914,34
597 1/3 Férias 304,78
902 INSS Férias 91,42
******************** ********************
*******************Líquido:
Assinatura do Funcionário
Recebi a importância de Um Mil, Cento e Vinte e Sete Reais e Setenta Centavos * * * * * * * * * * * * * * * * * * * * * * * * * * * *
1.219,12 91,42
1.127,70
Detalhamento do Cálculo do INSS
Ref. Base Aliq. Valor
09/2026 7,5000% 48,76650,19 8.475,55
10/2026 7,5000% 42,66568,93 8.475,55
1.219,12
Data de Pagamento
___/___/_____`;

const textoEbert = `Até 15 (quinze) dias antes do término do período aquisitivo o empregado solicita a concessão de abono pecuniário.
EBERT SANTOS SANTANA
01/12/2024 30/11/2025
Período aquisitivo
a
Período a ser gozado
01/10/2026 30/10/2026
ULTRA INFORMATICA LTDA 00002
05776490000136
AUXILIAR TEC DE INFORMATICAAdmissão: 01/12/2019
RECIBO DE FÉRIAS
Adicional Desconto
Empresa:
CNPJ.:
Funcionário:
Função:
Depto.: 0001
F É R I A S
Data: Assinatura do Funcionário
Data: Assinatura da Empresa
Duração
a
Data Assinatura do Funcionário
Data
Dias
Descrição
SOLICITAÇÃO DE ABONO
NOTIFICAÇÃO DE FÉRIAS
000013
30
Assinatura da Empresa
01/09/2026
01/09/2026
(
(
)
) /
Faltas
00 Dias
CTPS: 00705415 / 00020
Até 30 (trinta) dias antes do início de gozo a empresa acima comunica a concessão das férias abaixo:
009 Férias 1.760,00
597 1/3 Férias 586,67
902 INSS Férias 186,88
******************** ********************
*******************Líquido:
Assinatura do Funcionário
Recebi a importância de Dois Mil, Cento e Cinquenta e Nove Reais e Setenta e Nove Centavos * * * * * * * * * * * * * * * * * *
2.346,67 186,88
2.159,79
Detalhamento do Cálculo do INSS
Ref. Base Aliq. Valor
10/2026 7,9636% 186,882.346,67 8.475,55
2.346,67
Data de Pagamento
___/___/_____`;

describe('extractDadosFerias', () => {
  it('deve identificar corretamente recibo de férias', () => {
    expect(isReciboFerias(textoJailton)).toBe(true);
    expect(isReciboFerias(textoEbert)).toBe(true);
    expect(isReciboFerias('FOLHA DE PAGAMENTO 12345678000199')).toBe(false);
  });

  it('deve extrair com precisão os dados de férias de Jailton', () => {
    const dados = extractDadosFerias(textoJailton);
    expect(dados).not.toBeNull();
    expect(dados!.cnpj).toBe('18.103.272/0001-82');
    expect(dados!.razaoSocial).toBe('OLYMPUS ATIVIDADES FISICA LTDA');
    expect(dados!.competencia).toBe('09/2026');
    expect(dados!.periodoInicio).toBe('2026-09-15');
    expect(dados!.periodoFim).toBe('2026-10-14');
    expect(dados!.aquisitivoInicio).toBe('09/05/2025');
    expect(dados!.aquisitivoFim).toBe('08/05/2026');
    expect(dados!.gozoInicio).toBe('15/09/2026');
    expect(dados!.gozoFim).toBe('14/10/2026');
    expect(dados!.diasGozo).toBe(30);

    expect(dados!.funcionario.codigoFuncionario).toBe('000018');
    expect(dados!.funcionario.nomeCompleto).toBe(
      'JAILTON OLIVEIRA ALVES JUNIOR',
    );
    expect(dados!.funcionario.cargo).toBe('INST.DE MUSCULAÇÃO');
    expect(dados!.funcionario.dataAdmissao).toBe('09/05/2024');

    expect(dados!.totalBruto).toBeCloseTo(1219.12, 2);
    expect(dados!.totalDescontos).toBeCloseTo(91.42, 2);
    expect(dados!.totalLiquido).toBeCloseTo(1127.7, 2);
    expect(dados!.totalInss).toBeCloseTo(91.42, 2);

    expect(dados!.funcionario.rubricas).toHaveLength(3);
    const rubricaFerias = dados!.funcionario.rubricas.find(
      (r) => r.codigo === '039',
    );
    expect(rubricaFerias?.descricao).toBe('Férias Horista');
    expect(rubricaFerias?.tipo).toBe('PROVENTO');
    expect(rubricaFerias?.valor).toBeCloseTo(914.34, 2);

    const rubricaTerco = dados!.funcionario.rubricas.find(
      (r) => r.codigo === '597',
    );
    expect(rubricaTerco?.descricao).toBe('1/3 Férias');
    expect(rubricaTerco?.tipo).toBe('PROVENTO');
    expect(rubricaTerco?.valor).toBeCloseTo(304.78, 2);

    const rubricaInss = dados!.funcionario.rubricas.find(
      (r) => r.codigo === '902',
    );
    expect(rubricaInss?.descricao).toBe('INSS Férias');
    expect(rubricaInss?.tipo).toBe('DESCONTO');
    expect(rubricaInss?.valor).toBeCloseTo(91.42, 2);
  });

  it('deve extrair com precisão os dados de férias de Ebert', () => {
    const dados = extractDadosFerias(textoEbert);
    expect(dados).not.toBeNull();
    expect(dados!.cnpj).toBe('05.776.490/0001-36');
    expect(dados!.razaoSocial).toBe('ULTRA INFORMATICA LTDA');
    expect(dados!.competencia).toBe('10/2026');
    expect(dados!.periodoInicio).toBe('2026-10-01');
    expect(dados!.periodoFim).toBe('2026-10-30');
    expect(dados!.aquisitivoInicio).toBe('01/12/2024');
    expect(dados!.aquisitivoFim).toBe('30/11/2025');
    expect(dados!.gozoInicio).toBe('01/10/2026');
    expect(dados!.gozoFim).toBe('30/10/2026');
    expect(dados!.diasGozo).toBe(30);

    expect(dados!.funcionario.codigoFuncionario).toBe('000013');
    expect(dados!.funcionario.nomeCompleto).toBe('EBERT SANTOS SANTANA');
    expect(dados!.funcionario.cargo).toBe('AUXILIAR TEC DE INFORMATICA');
    expect(dados!.funcionario.dataAdmissao).toBe('01/12/2019');

    expect(dados!.totalBruto).toBeCloseTo(2346.67, 2);
    expect(dados!.totalDescontos).toBeCloseTo(186.88, 2);
    expect(dados!.totalLiquido).toBeCloseTo(2159.79, 2);
    expect(dados!.totalInss).toBeCloseTo(186.88, 2);
  });

  it('deve extrair dados quando o leitor de PDF mesclar as linhas', () => {
    const dados = extractDadosFerias(textoJailton.replace(/\s+/g, ' '));

    expect(dados).toMatchObject({
      cnpj: '18.103.272/0001-82',
      razaoSocial: 'OLYMPUS ATIVIDADES FISICA LTDA',
      competencia: '09/2026',
      periodoInicio: '2026-09-15',
      periodoFim: '2026-10-14',
      totalBruto: 1219.12,
      totalDescontos: 91.42,
      totalLiquido: 1127.7,
      funcionario: {
        codigoFuncionario: '000018',
        nomeCompleto: 'JAILTON OLIVEIRA ALVES JUNIOR',
      },
    });
    expect(dados?.funcionario.rubricas).toHaveLength(3);
  });

  it('deve retornar null para texto não relacionado a férias', () => {
    expect(
      extractDadosFerias('Guia de FGTS Digital Simples Nacional'),
    ).toBeNull();
  });
});
