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
        const carlos = result!.funcionarios.find((f) => f.codigoFuncionario === '000015');
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
        const claudia = result!.funcionarios.find((f) => f.codigoFuncionario === '000001');
        expect(claudia).toBeDefined();
        expect(claudia!.rubricas.find((r) => r.descricao.toLowerCase().includes('biênio'))).toBeDefined();
        expect(claudia!.rubricas.find((r) => r.descricao.toLowerCase().includes('gratifica'))).toBeDefined();
        expect(claudia!.rubricas.find((r) => r.tipo === 'DESCONTO')).toBeDefined();
    });

    it('deve retornar null para texto não relacionado a folha de pagamento', () => {
        expect(extractDadosFolhaPagamento('Guia de FGTS Digital Simples Nacional')).toBeNull();
    });

    it('deve calcular competencia corretamente a partir do período', () => {
        const result = extractDadosFolhaPagamento(textoAMS);
        expect(result!.periodoInicio).toBe('2026-07-01');
        expect(result!.periodoFim).toBe('2026-07-31');
        expect(result!.competencia).toBe('07/2026');
    });
});
