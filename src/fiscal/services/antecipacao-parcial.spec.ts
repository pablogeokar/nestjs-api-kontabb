import { validateSync } from 'class-validator';
import { SimularAntecipacaoParcialDto } from '../dto/antecipacao-parcial.dto';
import {
  apurarItemAntecipacaoParcial,
  calcularAntecipacaoParcial,
} from './antecipacao-parcial';
import type { RegraVersaoResolvida } from './fiscal-normative-catalog.service';

const item = {
  documentoFiscalId: 'nota-1',
  numeroDocumento: '3167',
  competenciaEmissao: '2026-10',
  itemId: 'item-1',
  numeroItem: 1,
  ncm: '17041000',
  cest: '2804100',
  emitenteUf: 'SE',
  origemMercadoria: '0',
  cstIcms: null,
  csosnIcms: '102',
  valorBrutoProduto: '1000.00',
  valorFrete: null,
  valorSeguro: null,
  valorOutrasDespesas: null,
  valorDesconto: null,
  valorIpi: null,
  aliquotaIcms: null,
  valorIcms: null,
  valorIcmsSt: null,
  valorIcmsStRetido: null,
};

function regra(escopoAprovado: boolean): RegraVersaoResolvida {
  return {
    id: 'regra-teste',
    catalogoVersaoId: 'catalogo-teste',
    chave: 'ANTECIPACAO_PARCIAL',
    revisao: 1,
    fonte: 'Regra de teste',
    fonteUrl: null,
    responsavelPor: null,
    vigenciaInicio: '2026-10-01',
    vigenciaFim: '2026-10-31',
    competencia: '2026-10-01',
    escopoAprovado,
    pendente: !escopoAprovado,
    conteudo: {
      enquadramentos: [
        {
          ncm: item.ncm,
          cest: item.cest,
          regime: 'SIMPLES_NACIONAL',
          uf_origem: 'SE',
          origem_mercadoria: '0',
          tratamento: 'APLICAVEL',
          aliquota_interna: '20.50',
          aliquota_interestadual: '12',
        },
      ],
    },
  };
}

describe('Antecipação Parcial', () => {
  it('aplica a diferença de alíquotas e a redução informada sobre o imposto', () => {
    const result = calcularAntecipacaoParcial({
      baseCalculo: '1000.00',
      aliquotaInterna: '20.50',
      aliquotaInterestadual: '12.00',
      percentualReducao: '20.00',
    });
    expect(result).toMatchObject({
      imposto_apurado: '85.00',
      reducao: '17.00',
      valor_antecipacao: '68.00',
    });
  });

  it('arredonda a diferença diretamente quando usa alíquotas', () => {
    const result = calcularAntecipacaoParcial({
      baseCalculo: '0.25',
      aliquotaInterna: '20.50',
      aliquotaInterestadual: '18.00',
    });
    expect(result.valor_antecipacao).toBe('0.01');
  });

  it('separa a base de destino da base interestadual quando o IPI compõe apenas a primeira', () => {
    const result = calcularAntecipacaoParcial({
      baseCalculo: '1020.00',
      baseCalculoOrigem: '1000.00',
      aliquotaInterna: '20.5',
      aliquotaInterestadual: '12',
    });
    expect(result).toMatchObject({
      icms_interno: '209.10',
      deducao_origem: '120.00',
      imposto_apurado: '89.10',
      base_calculo_origem: '1000.00',
    });
  });

  it('reproduz a dedução do ICMS de origem do Acórdão JJF nº 0236-05/25-VD', () => {
    const result = calcularAntecipacaoParcial({
      baseCalculo: '23542.36',
      aliquotaInterna: '20.50',
      deducaoOrigem: '2801.52',
    });
    expect(result.valor_antecipacao).toBe('2024.66');
  });

  it('mantém em conferência o item sem regra ou sem o mesmo enquadramento', () => {
    const semRegra = apurarItemAntecipacaoParcial(
      item,
      'SIMPLES_NACIONAL',
      null,
    );
    expect(semRegra.situacao).toBe('PENDENTE');
    expect(semRegra.motivo).toContain('Não há regra normativa');
    const semEnquadramento = apurarItemAntecipacaoParcial(
      { ...item, cest: '0000000' },
      'SIMPLES_NACIONAL',
      regra(true),
    );
    expect(semEnquadramento.situacao).toBe('PENDENTE');
    expect(semEnquadramento.motivo).toContain('CEST 0000000');
  });

  it('mostra os dois cenários com IPI sem lançar valor no total', () => {
    const result = apurarItemAntecipacaoParcial(
      { ...item, valorIpi: '20.00' },
      'SIMPLES_NACIONAL',
      regra(true),
    );
    expect(result).toMatchObject({
      situacao: 'PENDENTE',
      valor_ipi: '20.00',
      calculo: null,
      cenarios_ipi: {
        sem_ipi: { base_calculo: '1000.00', valor_antecipacao: '85.00' },
        com_ipi: {
          base_calculo: '1020.00',
          base_calculo_origem: '1000.00',
          valor_antecipacao: '89.10',
        },
      },
    });
  });

  it('usa a decisão fundamentada sobre IPI na base', () => {
    for (const [tratamento, base, devido] of [
      ['INCLUIR', '1020.00', '89.10'],
      ['EXCLUIR', '1000.00', '85.00'],
    ] as const) {
      const r = regra(true);
      Object.assign(
        (r.conteudo.enquadramentos as Array<Record<string, unknown>>)[0],
        {
          ipi_na_base: tratamento,
          fundamento_ipi:
            'Lei 7.014/96, arts. 17, § 2º, e 23, III; hipótese revisada.',
        },
      );
      expect(
        apurarItemAntecipacaoParcial(
          { ...item, valorIpi: '20.00' },
          'SIMPLES_NACIONAL',
          r,
        ),
      ).toMatchObject({
        situacao: 'CALCULADO',
        tratamento_ipi: tratamento,
        calculo: { base_calculo: base, valor_antecipacao: devido },
      });
    }
  });

  it('usa a alíquota aprovada para a combinação exata quando o XML não a traz', () => {
    expect(
      apurarItemAntecipacaoParcial(item, 'SIMPLES_NACIONAL', regra(true)),
    ).toMatchObject({
      situacao: 'CALCULADO',
      calculo: { valor_antecipacao: '85.00' },
    });
    expect(
      apurarItemAntecipacaoParcial(item, 'SIMPLES_NACIONAL', regra(false))
        .situacao,
    ).toBe('SIMULACAO');
    expect(
      apurarItemAntecipacaoParcial(
        { ...item, origemMercadoria: '1' },
        'SIMPLES_NACIONAL',
        regra(true),
      ).situacao,
    ).toBe('PENDENTE');
  });

  it('mantém em conferência o ICMS-ST indicado pelo XML sem enquadramento aprovado compatível', () => {
    expect(
      apurarItemAntecipacaoParcial(
        { ...item, csosnIcms: '500' },
        'SIMPLES_NACIONAL',
        regra(true),
      ),
    ).toMatchObject({ situacao: 'PENDENTE', calculo: null });
    expect(
      apurarItemAntecipacaoParcial(
        { ...item, csosnIcms: '500' },
        'SIMPLES_NACIONAL',
        null,
      ),
    ).toMatchObject({ situacao: 'PENDENTE', calculo: null });
    const r = regra(true);
    (
      r.conteudo.enquadramentos as Array<Record<string, unknown>>
    )[0].tratamento = 'ICMS_ST';
    expect(
      apurarItemAntecipacaoParcial(
        { ...item, csosnIcms: '500' },
        'SIMPLES_NACIONAL',
        r,
      ),
    ).toMatchObject({ situacao: 'ICMS_ST', calculo: null });
  });

  it('mantém bloqueado o enquadramento cadastrado para conferência fiscal', () => {
    const r = regra(false);
    r.conteudo.enquadramentos = [
      {
        ncm: item.ncm,
        cest: item.cest,
        regime: 'SIMPLES_NACIONAL',
        tratamento: 'CONFERIR',
        motivo: 'Revisar a alíquota da operação.',
      },
    ];
    expect(
      apurarItemAntecipacaoParcial(item, 'SIMPLES_NACIONAL', r),
    ).toMatchObject({
      situacao: 'PENDENTE',
      motivo: 'Revisar a alíquota da operação.',
      calculo: null,
    });
  });

  it('exige o parâmetro de origem do método selecionado e valida os decimais', () => {
    const dto = Object.assign(new SimularAntecipacaoParcialDto(), {
      metodo: 'DIFERENCA_ALIQUOTAS',
      baseCalculo: '1000.00',
      aliquotaInterna: '20.5',
    });
    expect(validateSync(dto).map((error) => error.property)).toEqual([
      'aliquotaInterestadual',
    ]);
    dto.aliquotaInterestadual = '12';
    expect(validateSync(dto)).toEqual([]);
    dto.aliquotaInterna = '-20.5';
    expect(validateSync(dto).map((error) => error.property)).toEqual([
      'aliquotaInterna',
    ]);
  });
});

describe('Antecipação Parcial — redução ME/EPP parametrizada (RICMS-BA art. 274)', () => {
  const comReducao = (aprovada: boolean, reducao: unknown) => {
    const r = regra(aprovada);
    r.conteudo.reducao_me_epp = reducao;
    return r;
  };
  const art274 = {
    percentual: '20',
    fundamento: 'RICMS-BA, art. 274',
    condicao: 'Recolhimento no prazo regulamentar',
  };

  it('Simples: separa a redução condicionada do total sem comprovante de prazo', () => {
    const r = apurarItemAntecipacaoParcial(
      item,
      'SIMPLES_NACIONAL',
      comReducao(true, art274),
    );
    expect(r).toMatchObject({
      situacao: 'CALCULADO',
      calculo: {
        imposto_apurado: '85.00',
        reducao: '0.00',
        valor_antecipacao: '85.00',
      },
      reducao_condicionada: {
        percentual: '20',
        fundamento: 'RICMS-BA, art. 274',
        valor_reducao: '17.00',
        valor_com_reducao: '68.00',
      },
    });
  });

  it('sem o parâmetro na regra, não reduz', () => {
    const r = apurarItemAntecipacaoParcial(
      item,
      'SIMPLES_NACIONAL',
      regra(true),
    );
    expect(r).toMatchObject({
      calculo: { reducao: '0.00', valor_antecipacao: '85.00' },
      reducao_condicionada: null,
    });
  });

  it('regime normal não recebe a redução de ME/EPP', () => {
    const r = comReducao(true, art274);
    (r.conteudo.enquadramentos as Array<Record<string, unknown>>).forEach(
      (e) => (e.regime = 'LUCRO_REAL'),
    );
    const out = apurarItemAntecipacaoParcial(
      { ...item, valorIcms: '120.00' },
      'LUCRO_REAL',
      r,
    );
    expect(out).toMatchObject({
      calculo: { reducao: '0.00' },
      reducao_condicionada: null,
    });
  });

  it('parâmetro inválido deixa o item pendente', () => {
    for (const invalido of [
      { percentual: '20' },
      { percentual: '120', fundamento: 'x' },
      'sim',
    ]) {
      expect(
        apurarItemAntecipacaoParcial(
          item,
          'SIMPLES_NACIONAL',
          comReducao(true, invalido),
        ).situacao,
      ).toBe('PENDENTE');
    }
  });
});
