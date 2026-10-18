import {
  FiscalIssLivroService,
  resumirLivroIss,
  type LivroIssLinha,
} from './fiscal-iss-livro.service';

function linha(
  numero: string,
  valorServicos: string,
  valorIss: string,
): LivroIssLinha {
  return {
    documento_id: numero,
    tipo_operacao: 'SAIDA',
    data_emissao: '2026-09-19T19:06:32.473Z',
    competencia: '2026-09-01',
    numero_nfse: numero,
    codigo_verificacao: 'TESTE',
    chave_acesso: numero.padEnd(50, '0'),
    contraparte_cnpj_cpf: '88636933587',
    contraparte_razao_social: 'Tomador',
    contraparte_municipio: '2910800',
    contraparte_uf: 'BA',
    discriminacao: 'Psicoterapia',
    item_lista_servico: '0416',
    cnae: '8650003',
    valor_servicos: valorServicos,
    valor_deducoes_descontos: '0.00',
    base_calculo_iss: valorServicos,
    aliquota_iss: '2.0000',
    valor_iss: valorIss,
    iss_retido: false,
    valor_iss_retido: '0.00',
    municipio_incidencia: '2910800',
    iss_outro_municipio: false,
    exigibilidade_iss: '1',
    situacao: 'AUTORIZADA',
  };
}

describe('resumirLivroIss', () => {
  it('concilia os três XMLs WebISS de homologação', () => {
    const resumo = resumirLivroIss(
      [
        linha('2026000000196', '225.00', '4.50'),
        linha('2026000000197', '225.00', '4.50'),
        linha('2026000000198', '560.00', '11.20'),
      ],
      true,
    );

    expect(resumo).toMatchObject({
      quantidade_documentos: 3,
      total_servicos: '1010.00',
      base_calculo_municipio: '1010.00',
      total_iss_proprio: '20.20',
      total_iss_retido: '0.00',
      saldo_iss_recolher_municipio: '0.00',
      forma_recolhimento: 'DAS',
    });
  });

  it('exclui canceladas dos totais e separa ISS retido', () => {
    const retida = {
      ...linha('2', '100.00', '2.00'),
      iss_retido: true,
      valor_iss_retido: '2.00',
    };
    const cancelada = {
      ...linha('3', '500.00', '10.00'),
      situacao: 'CANCELADA',
    };
    const resumo = resumirLivroIss([retida, cancelada], false);

    expect(resumo.total_servicos).toBe('100.00');
    expect(resumo.total_iss_proprio).toBe('0.00');
    expect(resumo.total_iss_retido).toBe('2.00');
  });

  it('não soma o ISS do serviço tomado ao ISS próprio da empresa', () => {
    const resumo = resumirLivroIss(
      [
        linha('prestado', '100.00', '2.00'),
        {
          ...linha('tomado', '200.00', '4.00'),
          tipo_operacao: 'ENTRADA',
        },
      ],
      false,
    );

    expect(resumo.quantidade_documentos).toBe(2);
    expect(resumo.total_servicos).toBe('300.00');
    expect(resumo.total_iss_proprio).toBe('2.00');
    expect(resumo.saldo_iss_recolher_municipio).toBe('2.00');
  });
});

describe('FiscalIssLivroService PDF', () => {
  it('gera um livro completo a partir dos dados da competência', async () => {
    const service = Object.create(
      FiscalIssLivroService.prototype,
    ) as FiscalIssLivroService;
    const linhas = [linha('2026000000196', '225.00', '4.50')];
    jest.spyOn(service, 'obter').mockResolvedValue({
      cabecalho: {
        cliente_id: 'cliente-1',
        razao_social: 'Empresa de exemplo',
        cnpj: '03155128000112',
        inscricao_municipal: '12345',
        endereco: 'Rua de exemplo, 1',
        municipio: 'Feira de Santana',
        uf: 'BA',
        competencia: '2026-09',
        regime_tributario: 'SIMPLES_NACIONAL',
        tipo_operacao: 'TODAS',
      },
      resumo: resumirLivroIss(linhas, true),
      linhas,
    });

    const pdf = await service.gerarPdf({
      clienteId: 'cliente-1',
      competencia: '2026-09',
    });

    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(pdf.subarray(-1_024).includes('%%EOF')).toBe(true);
    expect(
      (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length,
    ).toBe(2);
  });
});
