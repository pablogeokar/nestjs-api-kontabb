import { extractDadosFolhaPagamento } from '../common/pdf-extraction-rh';

const textoAMS = `00012A M S IND E COM DE ARTEF DE PAPEIS LTDAEmpresa : End. : Ref.: ( RUA DR SIMOES FILHO, 416 ) 01/07/2026 31/07/2026a Dpto : Página : 00001 Código Nome Ref. Sal. Contratual Adicionais Descontos Líquido TODOS Recibo FOLHA DE PAGAMENTO 03198283000116CNPJ/CEI: 000015 CARLOS AUGUSTO DE SOUZA MATOS 2.260,00 0020000 01/10/2025Admissão : Folha. :Livro: Dep IR : Dep SF :0 0 Função : MOTORISTA DE CAMINHAO LEVE Salário Base 2.260,00220:00001 INSS Folha 179,08903 *************** ____/____/______ 2.260,00 179,08 2.080,92 Base INSS: 2.260,00 (Aliq.: 7,9238%) Base FGTS: 2.260,00 (Valor: 180,80) Base IRRF Folha: 1.652,80 000014 JOICE BISPO DOS SANTOS 1.850,00 0110001 01/09/2025Admissão : Folha. :Livro: Dep IR : Dep SF :0 0 Função : Promotor de vendas Salário Base 1.850,00220:00001 Desc. Vale Transporte 111,00623 INSS Folha 142,18903 *************** ____/____/______ 1.850,00 253,18 1.596,82 Base INSS: 1.850,00 (Aliq.: 7,6854%) Base FGTS: 1.850,00 (Valor: 148,00) Base IRRF Folha: 1.242,80 000006 PABLO GEORGE CARDOSO CAMPOS BORGES 1.760,00 0220001 01/12/2014Admissão : Folha. :Livro: Dep IR : Dep SF :1 1 Função : AUXILIAR DE CONTABILIDADE Salário Base 1.760,00220:00001 Triênio 264,00025 INSS Folha 157,84903 *************** ____/____/______ 2.024,00 157,84 1.866,16 Base INSS: 2.024,00 (Aliq.: 7,7984%) Base FGTS: 2.024,00 (Valor: 161,92) Base IRRF Folha: 1.416,80 ********************* ********************* Resumo da folha Total Geral da Folha ( - ) Total de Descontos ( = ) Total Líquido ********************* Informações adicionais Total Funcionários Total INSS Total FGTS Total IRRF 6.134,00 Total Cotas Sal. Família 590,10 5.543,90 3 0 479,10 490,72 0,00`;

const textoOlympus = `00034OLYMPUS ATIVIDADES FISICA LTDAEmpresa : End. : Ref.: ( RUA SENADOR QUINTINO, 3044 1º ANDAR ) 01/07/2026 31/07/2026a Dpto : Página : 00001 Código Nome Ref. Sal. Contratual Adicionais Descontos Líquido TODOS Recibo FOLHA DE PAGAMENTO 18103272000182CNPJ/CEI: 000001 CLAUDIA TRAJANO DA SILVA CAMPOS 13,80 0020001 25/10/2013Admissão : Folha. :Livro: Dep IR : Dep SF :1 1 Função : COORDENADOR TÉCNICO Salário Base 1.683,60122:00002 Biênio 1% 101,02010 Gratificação de Função 168,36030 Repouso Remunerado 325,50420 INSS Folha 180,74903 *************** ____/____/______ 2.278,48 180,74 2.097,74 Base INSS: 2.278,48 (Aliq.: 7,9324%) Base FGTS: 2.278,48 (Valor: 182,27) Base IRRF Folha: 1.671,28 000018 JAILTON OLIVEIRA ALVES JUNIOR 13,80 0180001 09/05/2024Admissão : Folha. :Livro: Dep IR : Dep SF :0 0 Função : INST.DE MUSCULAÇÃO Salário Base 800,40058:00002 Repouso Remunerado 133,40420 INSS Folha 70,03903 *************** ____/____/______ 933,80 70,03 863,77 Base INSS: 933,80 (Aliq.: 7,5%) Base FGTS: 933,80 (Valor: 74,70) Base IRRF Folha: 326,60 000017 VALNEI DA CRUZ VALADAO 13,80 0170001 18/03/2024Admissão : Folha. :Livro: Dep IR : Dep SF :0 0 Função : INST.DE MUSCULAÇÃO Salário Base 1.393,80101:00002 Repouso Remunerado 232,30420 INSS Folha 122,02903 *************** ____/____/______ 1.626,10 122,02 1.504,08 Base INSS: 1.626,10 (Aliq.: 7,5038%) Base FGTS: 1.626,10 (Valor: 130,08) Base IRRF Folha: 1.018,90 ********************* ********************* Resumo da folha Total Geral da Folha ( - ) Total de Descontos ( = ) Total Líquido ********************* Informações adicionais Total Funcionários Total INSS Total FGTS Total IRRF 4.838,38 Total Cotas Sal. Família 372,79 4.465,59 3 0 372,79 387,05 0,00`;

describe('extractDadosFolhaPagamento', () => {
  it('deve extrair corretamente a folha AMS', () => {
    const result = extractDadosFolhaPagamento(textoAMS);
    expect(result).not.toBeNull();
    expect(result!.cnpj).toBe('03.198.283/0001-16');
    expect(result!.competencia).toBe('07/2026');
    expect(result!.funcionarios).toHaveLength(3);
    expect(result!.totalBruto).toBeCloseTo(6134.0, 2);
    expect(result!.totalDescontos).toBeCloseTo(590.1, 2);
    expect(result!.totalLiquido).toBeCloseTo(5543.9, 2);
    expect(result!.totalFuncionarios).toBe(3);
    expect(result!.totalInss).toBeCloseTo(479.1, 2);
    expect(result!.totalFgts).toBeCloseTo(490.72, 2);
    // Verificar primeiro funcionário
    const carlos = result!.funcionarios.find(
      (f) => f.codigoFuncionario === '000015',
    );
    expect(carlos).toBeDefined();
    expect(carlos!.nomeCompleto).toBe('CARLOS AUGUSTO DE SOUZA MATOS');
    expect(carlos!.cargo).toContain('MOTORISTA');
    expect(carlos!.salarioBase).toBeCloseTo(2260.0, 2);
    expect(carlos!.salarioLiquido).toBeCloseTo(2080.92, 2);
    expect(carlos!.valorFgts).toBeCloseTo(180.8, 2);
    expect(carlos!.baseInss).toBeCloseTo(2260.0, 2);
    expect(carlos!.aliquotaInss).toBeCloseTo(7.9238, 4);
  });

  it('deve extrair corretamente a folha Olympus com múltiplas rubricas de provento', () => {
    const result = extractDadosFolhaPagamento(textoOlympus);
    expect(result).not.toBeNull();
    expect(result!.cnpj).toBe('18.103.272/0001-82');
    expect(result!.funcionarios).toHaveLength(3);
    expect(result!.totalBruto).toBeCloseTo(4838.38, 2);
    const claudia = result!.funcionarios.find(
      (f) => f.codigoFuncionario === '000001',
    );
    expect(claudia).toBeDefined();
    expect(
      claudia!.rubricas.find((r) =>
        r.descricao.toLowerCase().includes('biênio'),
      ),
    ).toBeDefined();
    expect(
      claudia!.rubricas.find((r) =>
        r.descricao.toLowerCase().includes('gratifica'),
      ),
    ).toBeDefined();
    expect(claudia!.rubricas.find((r) => r.tipo === 'DESCONTO')).toBeDefined();
  });

  it('deve retornar null para texto não relacionado a folha de pagamento', () => {
    expect(
      extractDadosFolhaPagamento('Guia de FGTS Digital Simples Nacional'),
    ).toBeNull();
  });

  it('deve calcular competencia corretamente a partir do período', () => {
    const result = extractDadosFolhaPagamento(textoAMS);
    expect(result!.periodoInicio).toBe('2026-07-01');
    expect(result!.periodoFim).toBe('2026-07-31');
    expect(result!.competencia).toBe('07/2026');
  });
});

const textoMCentral = `00013MERCADINHO CENTRAL LTDA.Empresa : End. : Ref.: ( RUA SIMOES FILHO NUM, 525 ) 01/07/2026 31/07/2026a Dpto : Página : 00001 Código Nome Ref. Sal. Contratual Adicionais Descontos Líquido TODOS Recibo FOLHA DE PAGAMENTO 40511347000113CNPJ/CEI: 000037 EDVAN LIMA MOTA 1.966,00 0220002 02/01/2021Admissão : Folha. :Livro: Dep IR : Dep SF :0 0 Função : CONFERENTE MERCADORIAS Salário Base 1.966,00220:00001 Triênio 137,62025 Cesta Básica 69,00592 Horas Extras 497,22026:00409 Repouso Remunerado 95,62420 INSS Folha 218,36903 *************** ____/____/______ 2.765,46 218,36 2.547,10 Base INSS: 2.696,46 (Aliq.: 8,098%) Base FGTS: 2.696,46 (Valor: 215,71) Base IRRF Folha: 2.089,26 000039 ELOINA MARQUES DE ABREU 1.770,00 0240002 20/06/2023Admissão : Folha. :Livro: Dep IR : Dep SF :2 0 Função : CAIXA SUPERMERCADO Salário Base 1.770,00220:00001 Triênio 123,90025 Cesta Básica 69,00592 Horas Extras 447,65026:00409 Repouso Remunerado 86,09420 INSS Folha 194,16903 Empréstimo (Crédito Trabalhador) Parc. 11/12 64,32625 Empréstimo (Crédito Trabalhador) Parc. 11/30 133,04625 Empréstimo (Crédito Trabalhador) Parc. 11/36 287,81625 Empréstimo (Crédito Trabalhador) Parc. 6/24 78,17625 *************** ____/____/______ 2.496,64 757,50 1.739,14 Base INSS: 2.427,64 (Aliq.: 7,9978%) Base FGTS: 2.427,64 (Valor: 194,21) Base IRRF Folha: 1.820,44 000029 JOSE CARLOS SANTOS LIMA 2.247,16 0140002 02/05/2016Admissão : Folha. :Livro: Dep IR : Dep SF :1 0 Função : MOTORISTA Salário Base 2.247,16220:00001 Triênio 471,90025 Cesta Básica 69,00592 INSS Folha 220,39903 *************** ____/____/______ 2.788,06 220,39 2.567,67 Base INSS: 2.719,06 (Aliq.: 8,1053%) Base FGTS: 2.719,06 (Valor: 217,52) Base IRRF Folha: 2.111,86 00013MERCADINHO CENTRAL LTDA.Empresa : End. : Ref.: ( RUA SIMOES FILHO NUM, 525 ) 01/07/2026 31/07/2026a Dpto : Página : 00002 Código Nome Ref. Sal. Contratual Adicionais Descontos Líquido TODOS Recibo FOLHA DE PAGAMENTO 40511347000113CNPJ/CEI: 000036 LILIANE SANTANA DA SILVA 1.770,00 0210002 02/10/2018Admissão : Folha. :Livro: Dep IR : Dep SF :0 0 Função : REPOSITOR(A) Férias de 06/07/2026 até 04/08/2026 Dia(s) 26 (190:40) Salário Base 295,00036:40001 Triênio 41,30025 Cesta Básica 69,00592 Horas Extras 128,41007:00409 Repouso Remunerado 24,69420 INSS Folha 58,73903 *************** ____/____/______ 558,40 58,73 499,67 Base INSS: 489,41 (Aliq.: 8,7516%) Base FGTS: 489,40 (Valor: 39,15) 000023 RAIMUNDO COSTA BISPO 1.770,00 0080002 02/02/2015Admissão : Folha. :Livro: Dep IR : Dep SF :0 0 Função : REPOSITOR(A) Salário Base 1.770,00220:00001 Triênio 371,70025 Cesta Básica 69,00592 Horas Extras 506,22026:00409 Repouso Remunerado 97,35420 INSS Folha 222,75903 *************** ____/____/______ 2.814,27 222,75 2.591,52 Base INSS: 2.745,27 (Aliq.: 8,1139%) Base FGTS: 2.745,27 (Valor: 219,62) Base IRRF Folha: 2.138,07 000035 VANUZIA SILVA LUCIANO 1.770,00 0200002 02/01/2018Admissão : Folha. :Livro: Dep IR : Dep SF :0 0 Função : CAIXA SUPERMERCADO Salário Base 1.770,00220:00001 Triênio 247,80025 Cesta Básica 69,00592 Horas Extras 476,93026:00409 Repouso Remunerado 91,72420 INSS Folha 208,46903 *************** ____/____/______ 2.655,45 208,46 2.446,99 Base INSS: 2.586,45 (Aliq.: 8,0596%) Base FGTS: 2.586,45 (Valor: 206,91) Base IRRF Folha: 1.979,25 00013MERCADINHO CENTRAL LTDA.Empresa : End. : Ref.: ( RUA SIMOES FILHO NUM, 525 ) 01/07/2026 31/07/2026a Dpto : Página : 00003 Código Nome Ref. Sal. Contratual Adicionais Descontos Líquido TODOS Recibo FOLHA DE PAGAMENTO 40511347000113CNPJ/CEI: 000038 WIANA LARISSA BEZERRA GUERRA 1.770,00 0230002 22/01/2021Admissão : Folha. :Livro: Dep IR : Dep SF :1 1 Função : CAIXA SUPERMERCADO Salário Base 1.770,00220:00001 Triênio 123,90025 Cesta Básica 69,00592 Horas Extras 447,65026:00409 Repouso Remunerado 86,09420 INSS Folha 194,16903 Empréstimo (Crédito Trabalhador) Parc. 14/24 422,17625 *************** ____/____/______ 2.496,64 616,33 1.880,31 Base INSS: 2.427,64 (Aliq.: 7,9978%) Base FGTS: 2.427,64 (Valor: 194,21) Base IRRF Folha: 1.820,44 ********************* ********************* Resumo da folha Total Geral da Folha ( - ) Total de Descontos ( = ) Total Líquido ********************* Informações adicionais Total Funcionários Total INSS Total FGTS Total IRRF 16.574,92 Total Cotas Sal. Família 2.302,52 14.272,40 7 0 1.317,01 1.287,33 0,00`;

describe('extractDadosFolhaPagamento - Mercadinho Central (multi-página)', () => {
  it('deve extrair todos os 7 funcionários de um PDF com 3 páginas', () => {
    const result = extractDadosFolhaPagamento(textoMCentral);
    expect(result).not.toBeNull();
    expect(result!.cnpj).toBe('40.511.347/0001-13');
    expect(result!.competencia).toBe('07/2026');
    expect(result!.funcionarios).toHaveLength(7);
    expect(result!.totalFuncionarios).toBe(7);
  });

  it('deve extrair totais gerais corretamente', () => {
    const result = extractDadosFolhaPagamento(textoMCentral)!;
    expect(result.totalBruto).toBeCloseTo(16574.92, 2);
    expect(result.totalDescontos).toBeCloseTo(2302.52, 2);
    expect(result.totalLiquido).toBeCloseTo(14272.4, 2);
    expect(result.totalInss).toBeCloseTo(1317.01, 2);
    expect(result.totalFgts).toBeCloseTo(1287.33, 2);
    expect(result.totalIrrf).toBeCloseTo(0, 2);
  });

  it('deve extrair cargo com parênteses como REPOSITOR(A)', () => {
    const result = extractDadosFolhaPagamento(textoMCentral)!;
    const liliane = result.funcionarios.find(
      (f) => f.codigoFuncionario === '000036',
    );
    expect(liliane).toBeDefined();
    expect(liliane!.cargo).toBe('REPOSITOR(A)');

    const raimundo = result.funcionarios.find(
      (f) => f.codigoFuncionario === '000023',
    );
    expect(raimundo).toBeDefined();
    expect(raimundo!.cargo).toBe('REPOSITOR(A)');
  });

  it('deve extrair cargo corretamente quando seguido de informação de férias', () => {
    const result = extractDadosFolhaPagamento(textoMCentral)!;
    const liliane = result.funcionarios.find(
      (f) => f.codigoFuncionario === '000036',
    );
    expect(liliane!.cargo).toBe('REPOSITOR(A)');
    // Não deve incluir texto de férias no cargo
    expect(liliane!.cargo).not.toContain('Férias');
  });

  it('deve extrair empréstimos como rubricas de desconto', () => {
    const result = extractDadosFolhaPagamento(textoMCentral)!;

    // ELOINA tem 4 empréstimos
    const eloina = result.funcionarios.find(
      (f) => f.codigoFuncionario === '000039',
    );
    expect(eloina).toBeDefined();
    const emprestimosEloina = eloina!.rubricas.filter((r) =>
      r.descricao.includes('Empréstimo'),
    );
    expect(emprestimosEloina).toHaveLength(4);
    expect(emprestimosEloina.every((r) => r.tipo === 'DESCONTO')).toBe(true);
    expect(emprestimosEloina[0].valor).toBeCloseTo(64.32, 2);
    expect(emprestimosEloina[1].valor).toBeCloseTo(133.04, 2);
    expect(emprestimosEloina[2].valor).toBeCloseTo(287.81, 2);
    expect(emprestimosEloina[3].valor).toBeCloseTo(78.17, 2);

    // WIANA tem 1 empréstimo
    const wiana = result.funcionarios.find(
      (f) => f.codigoFuncionario === '000038',
    );
    expect(wiana).toBeDefined();
    const emprestimosWiana = wiana!.rubricas.filter((r) =>
      r.descricao.includes('Empréstimo'),
    );
    expect(emprestimosWiana).toHaveLength(1);
    expect(emprestimosWiana[0].tipo).toBe('DESCONTO');
    expect(emprestimosWiana[0].valor).toBeCloseTo(422.17, 2);
  });

  it('deve calcular proventos/descontos/líquido corretos para cada funcionário', () => {
    const result = extractDadosFolhaPagamento(textoMCentral)!;

    const edvan = result.funcionarios.find(
      (f) => f.codigoFuncionario === '000037',
    );
    expect(edvan!.totalProventos).toBeCloseTo(2765.46, 2);
    expect(edvan!.totalDescontos).toBeCloseTo(218.36, 2);
    expect(edvan!.salarioLiquido).toBeCloseTo(2547.1, 2);

    const eloina = result.funcionarios.find(
      (f) => f.codigoFuncionario === '000039',
    );
    expect(eloina!.totalProventos).toBeCloseTo(2496.64, 2);
    expect(eloina!.totalDescontos).toBeCloseTo(757.5, 2);
    expect(eloina!.salarioLiquido).toBeCloseTo(1739.14, 2);

    const liliane = result.funcionarios.find(
      (f) => f.codigoFuncionario === '000036',
    );
    expect(liliane!.totalProventos).toBeCloseTo(558.4, 2);
    expect(liliane!.totalDescontos).toBeCloseTo(58.73, 2);
    expect(liliane!.salarioLiquido).toBeCloseTo(499.67, 2);
  });

  it('deve extrair Base INSS e FGTS corretamente', () => {
    const result = extractDadosFolhaPagamento(textoMCentral)!;

    const edvan = result.funcionarios.find(
      (f) => f.codigoFuncionario === '000037',
    );
    expect(edvan!.baseInss).toBeCloseTo(2696.46, 2);
    expect(edvan!.aliquotaInss).toBeCloseTo(8.098, 3);
    expect(edvan!.baseFgts).toBeCloseTo(2696.46, 2);
    expect(edvan!.valorFgts).toBeCloseTo(215.71, 2);
  });

  it('deve extrair Desc. Vale Transporte como desconto (código 623)', () => {
    // Verificar no texto AMS que vale transporte está como desconto
    const result = extractDadosFolhaPagamento(textoAMS)!;
    const joice = result.funcionarios.find(
      (f) => f.codigoFuncionario === '000014',
    );
    expect(joice).toBeDefined();
    const valeTransp = joice!.rubricas.find((r) =>
      r.descricao.includes('Vale Transporte'),
    );
    expect(valeTransp).toBeDefined();
    expect(valeTransp!.tipo).toBe('DESCONTO');
    expect(valeTransp!.valor).toBeCloseTo(111.0, 2);
  });
});
