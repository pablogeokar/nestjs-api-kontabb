import {
  extractDadosAdiantamento13,
  isAdiantamento13,
} from '../common/pdf-extraction-rh';

// Texto extraído verbatim de `13 SAL.pdf` (unpdf, mergePages: true).
// Adiantamento do 13º salário — 4 funcionários, CNPJ 13.744.722/0001-00.
const textoRita = `00045RITA RAIMUNDA CONCEICAO SILVA - MEEmpresa : End. : Ref.: ( R QUINTINO BOCAIUVA, 65 A ) 01/10/2026 31/10/2026a Dpto : Página : 00001 Código Nome Ref. Sal. Contratual Adicionais Descontos Líquido TODOS Recibo FOLHA DE ADIANTAMENTO DE 13º 13744722000100CNPJ/CEI: 000025 ALDENORA VITORIA DE CARVALHO 1.682,00 0040000 02/06/2025Admissão : Folha. :Livro: Dep IR : Dep SF :0 0 Função : COSTUREIRO (A) 1a. Parcela Décimo Terceiro Salário 841,00012,00003 Anuênio 2,5% 21,03023 *************** ____/____/______ 862,03 0,00 862,03 Base INSS: 0,00 (Aliq.: 0%) Base FGTS: 862,03 (Valor: 68,96) 000011 MARCELO SANTANA BORGES 2.800,00 0280002 15/01/2020Admissão : Folha. :Livro: Dep IR : Dep SF :0 0 Função : ESTOFADOR 1a. Parcela Décimo Terceiro Salário 1.400,00012,00003 Anuênio 2,5% 140,00023 *************** ____/____/______ 1.540,00 0,00 1.540,00 Base INSS: 0,00 (Aliq.: 0%) Base FGTS: 1.540,00 (Valor: 123,20) 000026 PABLO SILVA BARRETO 1.661,00 0050001 21/01/2026Admissão : Folha. :Livro: Dep IR : Dep SF :0 0 Função : AUXILIAR DE MARCENARIA Benefício de 01/10/2026 até 25/10/2026 (183:20) 1a. Parcela Décimo Terceiro Salário 553,67008,00003 *************** ____/____/______ 553,67 0,00 553,67 Base INSS: 0,00 (Aliq.: 0%) Base FGTS: 553,67 (Valor: 44,29) 000016 ZILDGAR CAMPOS DA SILVA 1.621,00 0330002 13/09/2021Admissão : Folha. :Livro: Dep IR : Dep SF :0 0 Função : AUX.ADMINISTRATIVO(A) 1a. Parcela Décimo Terceiro Salário 810,50012,00003 Anuênio 2,5% 81,05023 *************** ____/____/______ 891,55 0,00 891,55 Base INSS: 0,00 (Aliq.: 0%) Base FGTS: 891,55 (Valor: 71,32) ********************* ********************* Resumo da folha Total Geral da Folha ( - ) Total de Descontos ( = ) Total Líquido ********************* Informações adicionais Total Funcionários Total INSS Total FGTS Total IRRF 3.847,25 Total Cotas Sal. Família 0,00 3.847,25 4 0 0,00 307,77 0,00`;

// Texto extraído verbatim de `FOLHA 13 SALARIO.pdf` (unpdf, mergePages: true).
// Adiantamento do 13º salário multi-página — 12 funcionários, CNPJ 07.754.759/0001-09.
const textoPadaria = `00003PADARIA RIO DE CONTAS LTDAEmpresa : End. : Ref.: ( RUA RIO DE CONTAS Nº, 436 ) 01/10/2026 31/10/2026a Dpto : Página : 00001 Código Nome Ref. Sal. Contratual Adicionais Descontos Líquido TODOS Recibo FOLHA DE ADIANTAMENTO DE 13º 07754759000109CNPJ/CEI: 000024 ANTONIO CARLOS BARBOSA NASCIMENTO 2.211,00 0270001 01/11/2020Admissão : Folha. :Livro: Dep IR : Dep SF :0 0 Função : FORNEIRO Férias de 01/10/2026 até 30/10/2026 Dia(s) 30 (220:00) 1a. Parcela Décimo Terceiro Salário 1.105,50012,00003 Adic.Tempo de Serviço 22,11033 *************** ____/____/______ 1.127,61 0,00 1.127,61 Base INSS: 0,00 (Aliq.: 0%) Base FGTS: 1.127,61 (Valor: 90,20) 000039 ANTONIO PEREIRA DA SILVA NETO 2.211,00 0420001 20/08/2025Admissão : Folha. :Livro: Dep IR : Dep SF :1 1 Função : FORNEIRO 1a. Parcela Décimo Terceiro Salário 1.105,50012,00003 *************** ____/____/______ 1.105,50 0,00 1.105,50 Base INSS: 0,00 (Aliq.: 0%) Base FGTS: 1.105,50 (Valor: 88,44) 000042 CARLA SANTOS DE JESUS 1.662,00 0450001 07/03/2026Admissão : Folha. :Livro: Dep IR : Dep SF :1 1 Função : BALCONISTA 1a. Parcela Décimo Terceiro Salário 554,00008,00003 *************** ____/____/______ 554,00 0,00 554,00 Base INSS: 0,00 (Aliq.: 0%) Base FGTS: 554,00 (Valor: 44,32) 000003 EDUARDO DE OLIVEIRA BISPO 2.279,00 0040001 01/08/2006Admissão : Folha. :Livro: Dep IR : Dep SF :0 0 Função : PADEIRO 1a. Parcela Décimo Terceiro Salário 1.139,50012,00003 Adic.Tempo de Serviço 56,97033 *************** ____/____/______ 1.196,47 0,00 1.196,47 Base INSS: 0,00 (Aliq.: 0%) Base FGTS: 1.196,47 (Valor: 95,71) 000043 ISAILTON RODRIGUES PORTUGAL 2.211,00 0460001 22/09/2026Admissão : Folha. :Livro: Dep IR : Dep SF :1 1 Função : MASSEIRO 1a. Parcela Décimo Terceiro Salário 92,13001,00003 *************** ____/____/______ 92,13 0,00 92,13 Base INSS: 0,00 (Aliq.: 0%) Base FGTS: 92,13 (Valor: 7,37) 000028 LUIZ ANTONIO FERREIRA PORTO 2.211,00 0310001 04/04/2022Admissão : Folha. :Livro: Dep IR : Dep SF :0 0 Função : FORNEIRO 1a. Parcela Décimo Terceiro Salário 1.105,50012,00003 *************** ____/____/______ 1.105,50 0,00 1.105,50 Base INSS: 0,00 (Aliq.: 0%) Base FGTS: 1.105,50 (Valor: 88,44) 00003PADARIA RIO DE CONTAS LTDAEmpresa : End. : Ref.: ( RUA RIO DE CONTAS Nº, 436 ) 01/10/2026 31/10/2026a Dpto : Página : 00002 Código Nome Ref. Sal. Contratual Adicionais Descontos Líquido TODOS Recibo FOLHA DE ADIANTAMENTO DE 13º 07754759000109CNPJ/CEI: 000032 MANUELE DE OLIVEIRA MARQUES 1.662,00 0350001 04/10/2022Admissão : Folha. :Livro: Dep IR : Dep SF :0 0 Função : CAIXA DE PADARIA Férias de 01/10/2026 até 30/10/2026 Dia(s) 30 (220:00) 1a. Parcela Décimo Terceiro Salário 831,00012,00003 Quebra de Caixa 83,10013 *************** ____/____/______ 914,10 0,00 914,10 Base INSS: 0,00 (Aliq.: 0%) Base FGTS: 914,10 (Valor: 73,12) 000036 MARIO FELISBERTO NASCIMENTO 2.279,00 0390001 08/03/2024Admissão : Folha. :Livro: Dep IR : Dep SF :0 0 Função : PADEIRO 1a. Parcela Décimo Terceiro Salário 1.139,50012,00003 *************** ____/____/______ 1.139,50 0,00 1.139,50 Base INSS: 0,00 (Aliq.: 0%) Base FGTS: 1.139,50 (Valor: 91,16) 000035 MARISA DOS SANTOS SILVA PORTUGAL 1.662,00 0380001 25/01/2024Admissão : Folha. :Livro: Dep IR : Dep SF :1 1 Função : BALCONISTA 1a. Parcela Décimo Terceiro Salário 831,00012,00003 *************** ____/____/______ 831,00 0,00 831,00 Base INSS: 0,00 (Aliq.: 0%) Base FGTS: 831,00 (Valor: 66,48) 000037 REBECA SANTOS DE FRANÇA 1.662,00 0400001 11/04/2024Admissão : Folha. :Livro: Dep IR : Dep SF :1 1 Função : BALCONISTA 1a. Parcela Décimo Terceiro Salário 831,00012,00003 *************** ____/____/______ 831,00 0,00 831,00 Base INSS: 0,00 (Aliq.: 0%) Base FGTS: 831,00 (Valor: 66,48) 000019 ROSANE PEREIRA DE OLIVEIRA 1.739,56 0220001 01/08/2019Admissão : Folha. :Livro: Dep IR : Dep SF :1 0 Função : AJUDANTE DE PRODUCAO 1a. Parcela Décimo Terceiro Salário 869,78012,00003 Adic.Tempo de Serviço 17,39033 *************** ____/____/______ 887,17 0,00 887,17 Base INSS: 0,00 (Aliq.: 0%) Base FGTS: 887,17 (Valor: 70,97) 000034 TATIANE BRANDÃO SANTANA 1.662,00 0370001 07/08/2023Admissão : Folha. :Livro: Dep IR : Dep SF :0 0 Função : BALCONISTA 1a. Parcela Décimo Terceiro Salário 831,00012,00003 *************** ____/____/______ 831,00 0,00 831,00 Base INSS: 0,00 (Aliq.: 0%) Base FGTS: 831,00 (Valor: 66,48) 00003PADARIA RIO DE CONTAS LTDAEmpresa : End. : Ref.: ( RUA RIO DE CONTAS Nº, 436 ) 01/10/2026 31/10/2026a Dpto : Página : 00003 Código Nome Ref. Sal. Contratual Adicionais Descontos Líquido TODOS Recibo FOLHA DE ADIANTAMENTO DE 13º 07754759000109CNPJ/CEI: ********************* ********************* Resumo da folha Total Geral da Folha ( - ) Total de Descontos ( = ) Total Líquido ********************* Informações adicionais Total Funcionários Total INSS Total FGTS Total IRRF 10.614,98 Total Cotas Sal. Família 0,00 10.614,98 12 0 0,00 849,17 0,00`;

describe('isAdiantamento13', () => {
  it('retorna true para a folha de adiantamento do 13º', () => {
    expect(isAdiantamento13(textoRita)).toBe(true);
    expect(isAdiantamento13(textoPadaria)).toBe(true);
  });

  it('retorna false para uma folha de pagamento mensal', () => {
    expect(
      isAdiantamento13(
        '00012A M S LTDA FOLHA DE PAGAMENTO 03198283000116CNPJ/CEI:',
      ),
    ).toBe(false);
  });

  it('retorna false para um recibo de férias', () => {
    expect(
      isAdiantamento13('RECIBO DE FÉRIAS JAILTON OLIVEIRA ALVES JUNIOR'),
    ).toBe(false);
  });
});

describe('extractDadosAdiantamento13 - RITA RAIMUNDA (4 funcionários)', () => {
  it('extrai CNPJ, competência e número de funcionários', () => {
    const result = extractDadosAdiantamento13(textoRita);
    expect(result).not.toBeNull();
    expect(result!.cnpj).toBe('13.744.722/0001-00');
    expect(result!.competencia).toBe('10/2026');
    expect(result!.funcionarios).toHaveLength(4);
    expect(result!.totalFuncionarios).toBe(4);
  });

  it('extrai o funcionário ALDENORA com o líquido correto', () => {
    const result = extractDadosAdiantamento13(textoRita)!;
    const aldenora = result.funcionarios.find(
      (f) => f.nomeCompleto === 'ALDENORA VITORIA DE CARVALHO',
    );
    expect(aldenora).toBeDefined();
    expect(aldenora!.salarioLiquido).toBeCloseTo(862.03, 2);
  });

  it('extrai o cargo da ALDENORA sem absorver a 1a parcela do 13º', () => {
    const result = extractDadosAdiantamento13(textoRita)!;
    const aldenora = result.funcionarios.find(
      (f) => f.nomeCompleto === 'ALDENORA VITORIA DE CARVALHO',
    )!;
    // Bug reportado: o cargo vinha como "COSTUREIRO (A) 1a. Parcela Décim..."
    expect(aldenora.cargo).toBe('COSTUREIRO (A)');
  });

  it('extrai o cargo do PABLO sem absorver o fragmento de benefício', () => {
    const result = extractDadosAdiantamento13(textoRita)!;
    const pablo = result.funcionarios.find(
      (f) => f.nomeCompleto === 'PABLO SILVA BARRETO',
    )!;
    // O fragmento "Benefício de ... (183:20)" não pode entrar no cargo
    expect(pablo.cargo).toBe('AUXILIAR DE MARCENARIA');
    expect(pablo.cargo).not.toMatch(/Benef[ií]cio/);
    expect(pablo.cargo).not.toMatch(/Parcela/);
  });

  it('nenhum cargo contém fragmentos de rubrica, benefício ou férias', () => {
    const result = extractDadosAdiantamento13(textoRita)!;
    for (const f of result.funcionarios) {
      expect(f.cargo).not.toBeNull();
      expect(f.cargo!).not.toMatch(/Parcela/);
      expect(f.cargo!).not.toMatch(/Décimo/);
      expect(f.cargo!).not.toMatch(/Benef[ií]cio/);
      expect(f.cargo!).not.toMatch(/F[eé]rias/);
    }
  });

  it('extrai as rubricas da ALDENORA com código/descrição/referência corretos', () => {
    const result = extractDadosAdiantamento13(textoRita)!;
    const aldenora = result.funcionarios.find(
      (f) => f.nomeCompleto === 'ALDENORA VITORIA DE CARVALHO',
    )!;

    expect(aldenora.rubricas).toHaveLength(2);

    // A rubrica da 1a parcela do 13º NÃO pode ser extraída como "012 Salário"
    const parcela13 = aldenora.rubricas.find((r) => r.codigo === '003');
    expect(parcela13).toBeDefined();
    expect(parcela13!.descricao).toBe('1a. Parcela Décimo Terceiro Salário');
    expect(parcela13!.referencia).toBe('012,00');
    expect(parcela13!.valor).toBeCloseTo(841.0, 2);
    expect(parcela13!.tipo).toBe('PROVENTO');

    const anuenio = aldenora.rubricas.find((r) => r.codigo === '023');
    expect(anuenio).toBeDefined();
    expect(anuenio!.descricao).toBe('Anuênio 2,5%');
    expect(anuenio!.referencia).toBeNull();
    expect(anuenio!.valor).toBeCloseTo(21.03, 2);
    expect(anuenio!.tipo).toBe('PROVENTO');

    // Guardas contra o bug reportado: nenhuma rubrica "012" nem descrição "Salário"
    expect(aldenora.rubricas.some((r) => r.codigo === '012')).toBe(false);
    expect(aldenora.rubricas.some((r) => r.descricao === 'Salário')).toBe(
      false,
    );
  });

  it('não interpreta o fragmento "Benefício de ... (183:20)" como rubrica (PABLO)', () => {
    const result = extractDadosAdiantamento13(textoRita)!;
    const pablo = result.funcionarios.find(
      (f) => f.nomeCompleto === 'PABLO SILVA BARRETO',
    )!;

    expect(pablo.rubricas).toHaveLength(1);
    const parcela13 = pablo.rubricas[0];
    expect(parcela13.codigo).toBe('003');
    expect(parcela13.descricao).toBe('1a. Parcela Décimo Terceiro Salário');
    expect(parcela13.referencia).toBe('008,00');
    expect(parcela13.valor).toBeCloseTo(553.67, 2);
    expect(parcela13.tipo).toBe('PROVENTO');

    // O fragmento de benefício não pode virar rubrica
    expect(pablo.rubricas.some((r) => r.descricao.includes('Benefício'))).toBe(
      false,
    );
    expect(pablo.rubricas.some((r) => r.referencia === '183:20')).toBe(false);
  });

  it('extrai os totais gerais da folha', () => {
    const result = extractDadosAdiantamento13(textoRita)!;
    expect(result.totalBruto).toBeCloseTo(3847.25, 2);
    expect(result.totalDescontos).toBeCloseTo(0, 2);
    expect(result.totalLiquido).toBeCloseTo(3847.25, 2);
    expect(result.totalFgts).toBeCloseTo(307.77, 2);
  });

  it('retorna null para texto que não é adiantamento do 13º', () => {
    expect(extractDadosAdiantamento13('Guia de FGTS Digital')).toBeNull();
  });
});

describe('extractDadosAdiantamento13 - PADARIA (multi-página, 12 funcionários)', () => {
  it('mantém os 12 funcionários e totais com CNPJ alfanumérico em todos os cabeçalhos', () => {
    const original = extractDadosAdiantamento13(textoPadaria);
    const alfanumerico = extractDadosAdiantamento13(
      textoPadaria.replaceAll(
        '07754759000109CNPJ/CEI:',
        'AB12CD34EF5678CNPJ/CEI:',
      ),
    );
    expect(original).not.toBeNull();
    expect(alfanumerico).toEqual({
      ...original,
      cnpj: 'AB.12C.D34/EF56-78',
    });
  });

  it('extrai todos os 12 funcionários e os totais', () => {
    const result = extractDadosAdiantamento13(textoPadaria);
    expect(result).not.toBeNull();
    expect(result!.cnpj).toBe('07.754.759/0001-09');
    expect(result!.funcionarios).toHaveLength(12);
    expect(result!.totalFuncionarios).toBe(12);
    expect(result!.totalLiquido).toBeCloseTo(10614.98, 2);
    expect(result!.totalFgts).toBeCloseTo(849.17, 2);
  });

  it('extrai as rubricas do ANTONIO CARLOS e ignora o fragmento de férias', () => {
    const result = extractDadosAdiantamento13(textoPadaria)!;
    const antonio = result.funcionarios.find(
      (f) => f.nomeCompleto === 'ANTONIO CARLOS BARBOSA NASCIMENTO',
    )!;

    expect(antonio.rubricas).toHaveLength(2);

    const parcela13 = antonio.rubricas.find((r) => r.codigo === '003');
    expect(parcela13).toBeDefined();
    expect(parcela13!.descricao).toBe('1a. Parcela Décimo Terceiro Salário');
    expect(parcela13!.referencia).toBe('012,00');
    expect(parcela13!.valor).toBeCloseTo(1105.5, 2);
    expect(parcela13!.tipo).toBe('PROVENTO');

    const adicTempo = antonio.rubricas.find((r) => r.codigo === '033');
    expect(adicTempo).toBeDefined();
    expect(adicTempo!.descricao).toBe('Adic.Tempo de Serviço');
    expect(adicTempo!.referencia).toBeNull();
    expect(adicTempo!.valor).toBeCloseTo(22.11, 2);
    expect(adicTempo!.tipo).toBe('PROVENTO');

    // O fragmento "Férias de ... (220:00)" não pode virar rubrica
    expect(antonio.rubricas.some((r) => r.descricao.includes('Férias'))).toBe(
      false,
    );
    expect(antonio.rubricas.some((r) => r.referencia === '220:00')).toBe(false);

    // Guardas contra o bug reportado
    expect(antonio.rubricas.some((r) => r.codigo === '012')).toBe(false);
    expect(antonio.rubricas.some((r) => r.descricao === 'Salário')).toBe(false);
  });

  it('extrai o cargo FORNEIRO sem absorver o fragmento de férias nem a 1a parcela', () => {
    const result = extractDadosAdiantamento13(textoPadaria)!;
    const antonioCarlos = result.funcionarios.find(
      (f) => f.nomeCompleto === 'ANTONIO CARLOS BARBOSA NASCIMENTO',
    )!;
    // Bloco com "Férias de ... (220:00)" antes da 1a parcela
    expect(antonioCarlos.cargo).toBe('FORNEIRO');

    const antonioPereira = result.funcionarios.find(
      (f) => f.nomeCompleto === 'ANTONIO PEREIRA DA SILVA NETO',
    )!;
    // Bloco sem fragmento intermediário, 1a parcela logo após o cargo
    expect(antonioPereira.cargo).toBe('FORNEIRO');
  });

  it('nenhum cargo contém fragmentos de rubrica, benefício ou férias', () => {
    const result = extractDadosAdiantamento13(textoPadaria)!;
    for (const f of result.funcionarios) {
      expect(f.cargo).not.toBeNull();
      expect(f.cargo!).not.toMatch(/Parcela/);
      expect(f.cargo!).not.toMatch(/Décimo/);
      expect(f.cargo!).not.toMatch(/Benef[ií]cio/);
      expect(f.cargo!).not.toMatch(/F[eé]rias/);
    }
  });

  it('extrai a rubrica "Quebra de Caixa" (013) da MANUELE', () => {
    const result = extractDadosAdiantamento13(textoPadaria)!;
    const manuele = result.funcionarios.find(
      (f) => f.nomeCompleto === 'MANUELE DE OLIVEIRA MARQUES',
    )!;

    const parcela13 = manuele.rubricas.find((r) => r.codigo === '003');
    expect(parcela13).toBeDefined();
    expect(parcela13!.descricao).toBe('1a. Parcela Décimo Terceiro Salário');
    expect(parcela13!.referencia).toBe('012,00');
    expect(parcela13!.valor).toBeCloseTo(831.0, 2);

    const quebraCaixa = manuele.rubricas.find((r) => r.codigo === '013');
    expect(quebraCaixa).toBeDefined();
    expect(quebraCaixa!.descricao).toBe('Quebra de Caixa');
    expect(quebraCaixa!.referencia).toBeNull();
    expect(quebraCaixa!.valor).toBeCloseTo(83.1, 2);
  });

  it('nenhuma rubrica do 13º é extraída como "012" ou descrição "Salário"', () => {
    const result = extractDadosAdiantamento13(textoPadaria)!;
    const todasRubricas = result.funcionarios.flatMap((f) => f.rubricas);
    expect(todasRubricas.length).toBeGreaterThan(0);
    expect(todasRubricas.some((r) => r.codigo === '012')).toBe(false);
    expect(todasRubricas.some((r) => r.descricao === 'Salário')).toBe(false);
    // Toda rubrica código 003 deve ter a descrição completa da 1a parcela
    for (const r of todasRubricas.filter((x) => x.codigo === '003')) {
      expect(r.descricao).toBe('1a. Parcela Décimo Terceiro Salário');
    }
  });
});
