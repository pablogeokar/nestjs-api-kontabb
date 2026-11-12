import { BadRequestException } from '@nestjs/common';
import {
  renderContratoPdf,
  servicosDoInstrumento,
  validarContratoParaImpressao,
  type ContratoPdfData,
} from '../services/financeiro-contrato-documento.service';

const exemplo: ContratoPdfData = {
  contrato: {
    id: 'contrato-1',
    valorMensalidade: '420.00',
    diaVencimento: 10,
    diaFechamento: 25,
    gera13o: false,
    mes13o: 12,
    ativo: true,
    dataInicio: '2026-11-12',
    avisoPrevioDias: 30,
    condicoesContratuais: null,
    servicosContratados: [
      { codigo: 'DEPARTAMENTO_PESSOAL', valorMensal: '250.00' },
      { codigo: 'ESOCIAL_DOMESTICO', valorMensal: '170.00' },
    ],
    itens: [],
  },
  cliente: {
    razaoSocial: 'Cliente Exemplo Ltda',
    cnpj: '12345678000190',
    tipoPessoa: 'PJ',
    representante: 'Maria Exemplo',
    endereco: 'Rua Exemplo, 100, Feira de Santana, BA',
  },
  contador: {
    nome: 'Contador Responsável',
    documento: '12345678901',
    crc: 'BA-12345/O',
    endereco: 'Rua do Escritório, 10',
  },
};

describe('contrato financeiro personalizado', () => {
  it('inclui apenas os serviços selecionados, os honorários e o contador vinculado', async () => {
    const pdf = await renderContratoPdf(exemplo);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(
      servicosDoInstrumento(exemplo.contrato.servicosContratados).map(
        (item) => item.nome,
      ),
    ).toEqual([
      'Departamento de Pessoal',
      'eSocial de empregado(a) doméstico(a)',
    ]);
  });

  it('rejeita impressão incompleta', () => {
    expect(() =>
      validarContratoParaImpressao({
        ...exemplo,
        contrato: { ...exemplo.contrato, servicosContratados: [] },
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      validarContratoParaImpressao({
        ...exemplo,
        contador: { ...exemplo.contador, crc: '' },
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      validarContratoParaImpressao({
        ...exemplo,
        cliente: { ...exemplo.cliente, representante: null },
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      validarContratoParaImpressao({
        ...exemplo,
        contrato: { ...exemplo.contrato, valorMensalidade: '430.00' },
      }),
    ).toThrow(BadRequestException);
  });
});
