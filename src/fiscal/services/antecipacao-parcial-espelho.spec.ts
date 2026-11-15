import { montarMemoriaAntecipacaoParcial } from './antecipacao-parcial-espelho';

describe('Memória do espelho de Antecipação Parcial', () => {
  it('conta NF-e distintas e soma somente o imposto integral dos itens calculados', () => {
    const items = [
      {
        documento_fiscal_id: 'nf-1',
        numero_documento: '101',
        serie_documento: '1',
        chave_acesso: '1'.repeat(44),
        uf_origem: 'SE',
        numero_item: 1,
        ncm: '17041000',
        cest: '2804100',
        valor_operacao: '1000.00',
        valor_ipi: '0',
        situacao: 'CALCULADO',
        motivo: 'RICMS-BA art. 274',
        calculo: {
          base_calculo: '1000.00',
          base_calculo_origem: null,
          aliquota_interna: '20.5',
          aliquota_interestadual: '12',
          icms_interno: '205.00',
          deducao_origem: '120.00',
          imposto_apurado: '85.00',
          valor_antecipacao: '85.00',
        },
        reducao_condicionada: {
          percentual: '20',
          fundamento: 'RICMS-BA art. 274',
          condicao: 'Pagamento no prazo',
          valor_reducao: '17.00',
          valor_com_reducao: '68.00',
        },
        regra_aplicada: {
          chave: 'ANTECIPACAO_PARCIAL',
          revisao: 2,
          fonte: 'RICMS-BA',
          vigencia_inicio: '2026-01-01',
          vigencia_fim: null,
          tratamento: 'APLICAVEL',
        },
      },
      {
        documento_fiscal_id: 'nf-1',
        numero_documento: '101',
        uf_origem: 'SE',
        numero_item: 2,
        ncm: '18063220',
        cest: '1700301',
        valor_operacao: '200.00',
        valor_ipi: '0',
        situacao: 'PENDENTE',
        motivo: 'IPI sem decisão',
        calculo: null,
      },
      {
        documento_fiscal_id: 'nf-2',
        numero_documento: '102',
        uf_origem: 'PE',
        numero_item: 1,
        ncm: '17041000',
        cest: '2804100',
        valor_operacao: '300.00',
        valor_ipi: '0',
        situacao: 'ICMS_ST',
        motivo: 'Retido',
        calculo: null,
      },
    ] as never;

    const result = montarMemoriaAntecipacaoParcial(items);
    expect(result.quantidadeNotas).toBe(2);
    expect(result.quantidadeNotasCalculadas).toBe(1);
    expect(result.valorIntegralSemReducao20).toBe('85.00');
    expect(result.notas[0].itens).toHaveLength(2);
    expect(result.notas[0].itens[0]).toMatchObject({
      regra: { chave: 'ANTECIPACAO_PARCIAL', revisao: 2 },
      reducaoCondicionada: { valorComReducao: '68.00' },
    });
    expect(result.notas[1].itens[0].calculo).toBeNull();
  });
});
