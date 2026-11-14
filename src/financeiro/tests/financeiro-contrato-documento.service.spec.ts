import { BadRequestException } from '@nestjs/common';
import { execFileSync } from 'node:child_process';
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
    localAssinatura: 'Feira de Santana/BA',
    dataAssinatura: '2026-11-14',
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
    municipio: 'Feira de Santana',
    uf: 'BA',
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
    const texto = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "import { extractText } from 'unpdf'; const chunks = []; for await (const chunk of process.stdin) chunks.push(chunk); const result = await extractText(new Uint8Array(Buffer.concat(chunks)), { mergePages: true }); process.stdout.write(result.text ?? '');",
      ],
      { input: pdf, encoding: 'utf8' },
    );
    expect(texto).toContain('INADIMPLÊNCIA, SUSPENSÃO E RESCISÃO');
    expect(texto).toContain('3 (três) mensalidades vencidas');
    expect(texto).toContain('independentemente de aviso prévio');
    expect(texto).toContain('rescisão unilateral motivada');
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
    expect(() =>
      validarContratoParaImpressao({
        ...exemplo,
        contrato: { ...exemplo.contrato, localAssinatura: '' },
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      validarContratoParaImpressao({
        ...exemplo,
        contrato: { ...exemplo.contrato, dataAssinatura: '2026-02-30' },
      }),
    ).toThrow(BadRequestException);
  });
});
