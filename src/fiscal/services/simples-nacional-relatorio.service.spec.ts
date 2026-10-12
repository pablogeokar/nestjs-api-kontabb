import { renderSimplesNacionalPdf } from './simples-nacional-relatorio.service';

describe('SimplesNacionalRelatorioService', () => {
  it('gera um PDF com a memória detalhada da apuração', async () => {
    const buffer = await renderSimplesNacionalPdf({
      cliente: {
        razaoSocial: 'EMPRESA DE SERVICOS EXEMPLO LTDA',
        cnpj: '12345678000195',
        municipio: 'Salvador',
        uf: 'BA',
        cnae: '8650003',
      },
      competencia: '2026-09',
      emitidoEm: new Date('2026-10-12T13:00:00.000Z'),
      apuracao: {
        id: null,
        cliente_id: '11111111-1111-4111-8111-111111111111',
        tabela_id: '22222222-2222-4222-8222-222222222222',
        competencia: '2026-09-01',
        versao: null,
        status: 'PREVIEW',
        corrente: false,
        rbt12: '240000.00',
        rbt12_proporcional: false,
        receita_bruta_mes: '20000.00',
        folha_salarios_12m: '72000.00',
        fator_r: '0.3000',
        valor_total_das: '1200.00',
        excedeu_sublimite: false,
        sublimite_estadual: '3600000.00',
        fechamento_id: null,
        guia_id: null,
        origens: {
          rbt12: 'RECEITAS_DOCUMENTOS_12_MESES_ANTERIORES',
          receita: 'DOCUMENTOS_FISCAIS_SAIDA_AUTORIZADOS',
          folha: 'FOLHAS_PAGAMENTO',
          sublimite: 'TABELA_ESTADUAL',
          classificacaoAnexo: 'CFOP_CNAE_LC116_FATOR_R',
        },
        memoria_calculo: {
          motorVersao: 'simples-nacional@2',
          receitaMesDocumentos: '20000.00',
          receitaClassificada: '20000.00',
          pendencias: [],
        },
        itens: [
          {
            anexo: 'ANEXO_III',
            faixa_enquadrada: 2,
            aliquota_nominal: '0.1120',
            parcela_deduzir: '9360.00',
            aliquota_efetiva: '0.0730',
            receita_bruta_atividade: '20000.00',
            segregacao: 'TRIBUTACAO_INTEGRAL',
            aliquota_efetiva_apos_deducoes: '0.0600',
            valor_devido: '1200.00',
            tributos_partilhados: {
              irpj: '48.00',
              csll: '42.00',
              cofins: '153.60',
              pis: '33.00',
              cpp: '521.40',
              ipi: '0.00',
              icms: '0.00',
              iss: '402.00',
            },
            deducoes: [],
          },
        ],
      },
    });

    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
    expect(buffer.length).toBeGreaterThan(5_000);
  });
});
