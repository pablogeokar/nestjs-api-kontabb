import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  renderEspelhoRecolhimentoPdf,
  type EspelhoItemMemoria,
} from './espelho-recolhimento.pdf';

function item(numero: number): EspelhoItemMemoria {
  return {
    numero,
    cfop: '2102',
    regimeTributario: 'SIMPLES_NACIONAL',
    origemMercadoria: '0',
    ncm: '19053100',
    cest: '1705301',
    situacao: 'CALCULADO',
    motivo: 'Regra aprovada',
    valorOperacao: '162.00',
    valorIpi: numero > 3 ? '6.34' : '0.00',
    composicaoOperacao: {
      produto: '161.00',
      frete: '0.00',
      seguro: '0.00',
      outrasDespesas: '1.00',
      desconto: '0.00',
    },
    calculo: {
      baseCalculo: '162.00',
      baseCalculoOrigem: '162.00',
      aliquotaInterna: '20.5000',
      aliquotaInterestadual: '12.0000',
      icmsInterno: '33.21',
      deducaoOrigem: '19.44',
      impostoIntegral: '13.77',
    },
    tratamentoIpi: numero > 3 ? 'EXCLUIR' : null,
    fundamentoIpi: numero > 3 ? 'Decisão fiscal fundamentada' : null,
    reducaoCondicionada: {
      percentual: '20',
      fundamento: 'RICMS-BA, art. 274',
      condicao: 'Recolhimento no prazo regulamentar',
      valorReducao: '2.75',
      valorComReducao: '11.02',
    },
    regra: {
      chave: 'ANTECIPACAO_PARCIAL',
      revisao: 15,
      fonte: 'Lei 7.014/96 art. 12-A; RICMS-BA art. 321; Anexo 1/2026',
      vigenciaInicio: '2026-01-01',
      vigenciaFim: '2026-12-31',
      tratamento: 'APLICAVEL',
    },
  };
}

describe('PDF compacto do espelho de recolhimento', () => {
  it('mantém sete itens e o cenário de redução em duas páginas', async () => {
    const pdf = await renderEspelhoRecolhimentoPdf({
      referenciaInterna: 'Prévia de antecipação parcial 10/2026',
      ufFavorecida: 'BA',
      tributo: 'ICMS ANTECIPAÇÃO PARCIAL',
      tipoDocumentoSugerido: 'DAE',
      codigoReceita: '2175',
      competencia: '10/2026',
      vencimento: 'A confirmar no portal oficial',
      contribuinte: {
        nome: 'EMPRESA DE EXEMPLO LTDA',
        documento: '00000000000100',
        inscricaoEstadual: '000000000',
        logradouro: 'RUA DE EXEMPLO',
        numero: '100',
        bairro: 'CENTRO',
        municipio: 'SALVADOR',
        uf: 'BA',
        cep: '40000000',
      },
      valores: {
        principal: '96.39',
        multa: '0.00',
        juros: '0.00',
        total: '96.39',
      },
      origem: 'Prévia da apuração; obrigação ainda não registrada',
      observacoes: ['Confirme valor e vencimento no portal oficial.'],
      memoria: {
        quantidadeNotas: 2,
        quantidadeNotasCalculadas: 2,
        valorIntegralSemReducao20: '96.39',
        valorComReducaoCondicionada: '77.14',
        valorReducaoCondicionada: '19.25',
        quantidadeItensComReducao: 7,
        percentualReducaoCondicionada: '20',
        fundamentoReducaoCondicionada: 'RICMS-BA, art. 274',
        condicaoReducaoCondicionada: 'Recolhimento no prazo regulamentar',
        notas: [
          {
            id: 'nota-1',
            numero: '341055',
            serie: '1',
            chaveAcesso: '1'.repeat(44),
            ufOrigem: 'SE',
            itens: [item(1), item(2), item(3)],
          },
          {
            id: 'nota-2',
            numero: '3881809',
            serie: '1',
            chaveAcesso: '2'.repeat(44),
            ufOrigem: 'MG',
            itens: [item(4), item(5), item(6), item(7)],
          },
        ],
      },
      geradoEm: new Date('2026-11-15T18:00:00Z'),
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    if (process.env.KONTABB_PDF_PREVIEW === '1') {
      const directory = join(process.cwd(), 'output', 'pdf');
      mkdirSync(directory, { recursive: true });
      writeFileSync(
        join(directory, 'espelho-antecipacao-compacto-exemplo.pdf'),
        pdf,
      );
    }
    expect(pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).toHaveLength(
      2,
    );
  });
});
