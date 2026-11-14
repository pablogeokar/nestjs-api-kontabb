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

  it('separa o ICMS-ST mesmo com regra aplicável', () => {
    expect(
      apurarItemAntecipacaoParcial(
        { ...item, csosnIcms: '500' },
        'SIMPLES_NACIONAL',
        regra(true),
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
