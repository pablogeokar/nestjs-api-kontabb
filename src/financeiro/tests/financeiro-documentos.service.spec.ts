import { NotFoundException } from '@nestjs/common';
import { FinanceiroDocumentosService } from '../services/financeiro-documentos.service';

const fatura = {
  id: 'fatura-1',
  clienteId: 'cliente-1',
  numero: 'FAT-202611-0001',
  competencia: '11/2026',
  dataEmissao: '2026-11-01',
  dataVencimento: '2026-11-15',
  clienteRazaoSocial: 'Empresa Exemplo Ltda',
  valorBruto: '100.00',
  valorDescontos: '0.00',
  valorLiquido: '100.00',
  saldoAberto: '50.00',
  status: 'PARCIALMENTE_PAGA',
  observacoes: null,
  pixCopiaECola: null,
  linhaDigitavel: null,
  lancamentos: [
    {
      id: 'item-1',
      descricao: 'Mensalidade contábil',
      tipoNome: 'Mensalidade',
      natureza: 'DEBITO',
      valor: '100.00',
    },
  ],
  baixas: [
    {
      id: 'baixa-1',
      valorRecebido: '50.00',
      dataPagamento: '2026-11-10',
      formaPagamento: 'PIX',
      valorMulta: '0.00',
      valorJuros: '0.00',
      valorDesconto: '0.00',
      estornado: false,
    },
  ],
};

function serviceFor(current = fatura) {
  const getById = jest.fn().mockResolvedValue(current);
  const database = {
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([{ cnpj: '12345678000190' }]),
          }),
        }),
      }),
    },
  };
  const service = new FinanceiroDocumentosService(
    database as never,
    { getById } as never,
  );
  return { service, getById };
}

describe('FinanceiroDocumentosService', () => {
  it('gera uma fatura PDF e respeita o escopo do cliente', async () => {
    const { service, getById } = serviceFor();
    const pdf = await service.faturaPdf('fatura-1', 'cliente-1');
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(getById).toHaveBeenCalledWith('fatura-1', 'cliente-1');
  });

  it('gera recibo somente para baixa ativa da fatura', async () => {
    const { service } = serviceFor();
    const pdf = await service.reciboPdf('fatura-1', 'baixa-1', 'cliente-1');
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    await expect(
      service.reciboPdf('fatura-1', 'outra-baixa', 'cliente-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('não emite recibo de pagamento estornado', async () => {
    const { service } = serviceFor({
      ...fatura,
      baixas: [{ ...fatura.baixas[0], estornado: true }],
    });
    await expect(
      service.reciboPdf('fatura-1', 'baixa-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
