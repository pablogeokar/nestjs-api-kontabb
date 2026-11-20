import { BadRequestException } from '@nestjs/common';
import { execFileSync } from 'node:child_process';
import { IbgeMunicipiosService } from '../../clientes/ibge-municipios.service';
import type { DatabaseService } from '../../database/database.service';
import type { FinanceiroContratosService } from '../services/financeiro-contratos.service';
import {
  FinanceiroContratoDocumentoService,
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
    municipio: 'Salvador',
    uf: 'BA',
  },
};

function extrairTexto(pdf: Buffer) {
  return execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "import { extractText } from 'unpdf'; const chunks = []; for await (const chunk of process.stdin) chunks.push(chunk); const result = await extractText(new Uint8Array(Buffer.concat(chunks)), { mergePages: true }); process.stdout.write(result.text ?? '');",
    ],
    { input: pdf, encoding: 'utf8' },
  ).replace(/\s+/g, ' ');
}

describe('contrato financeiro personalizado', () => {
  it('inclui apenas os serviços selecionados, os honorários e o contador vinculado', async () => {
    const pdf = await renderContratoPdf(exemplo);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const texto = extrairTexto(pdf);
    expect(texto).toContain('INADIMPLÊNCIA, SUSPENSÃO E RESCISÃO');
    expect(texto).toContain('3 (três) mensalidades vencidas');
    expect(texto).toContain('independentemente de aviso prévio');
    expect(texto).toContain('rescisão unilateral motivada');
    expect(texto).toContain(
      'foro da comarca que abrange o município de Salvador/BA, domicílio do(a) CONTRATADO(A)',
    );
    expect(texto).not.toContain('domicílio da CONTRATANTE');
    expect(texto).not.toContain('será cobrado adicional anual');
    expect(texto).not.toContain('Fundamentação normativa:');
    expect(
      servicosDoInstrumento(exemplo.contrato.servicosContratados).map(
        (item) => item.nome,
      ),
    ).toEqual([
      'Departamento de Pessoal',
      'eSocial de empregado(a) doméstico(a)',
    ]);
  });

  it('fundamenta o adicional pactuado na cláusula 5 e inclui as fontes oficiais', async () => {
    const pdf = await renderContratoPdf({
      ...exemplo,
      contrato: { ...exemplo.contrato, gera13o: true, mes13o: 11 },
    });
    const texto = extrairTexto(pdf);
    const clausula = texto
      .split('5. HONORÁRIOS E PAGAMENTO')[1]
      .split('6. REAJUSTE')[0];
    expect(clausula).toContain('No mês 11, será cobrado adicional anual');
    expect(clausula).toContain('uma mensalidade base (R$ 420,00)');
    expect(clausula).toContain('serviços contratados e efetivamente prestados');
    expect(clausula).toContain('Resolução CFC nº 1.590/2020');
    expect(clausula).toContain('NBC PG 01');
    expect(clausula).toContain('itens 7, 8 e 9');
    expect(clausula).toContain(
      'obrigação de pagamento decorre deste ajuste expresso',
    );
    expect(clausula).not.toContain(
      'não fixa o valor nem institui cobrança automática',
    );
    expect(clausula).toContain('Fontes oficiais para consulta:');
    for (const url of [
      'https://www1.cfc.org.br/sisweb/SRE/docs/Res_1590%20',
      'https://www1.cfc.org.br/sisweb/SRE/docs/NBCPG01.pdf',
      'https://cfc.org.br/fiscalizacao-etica-e-disciplina/perguntas-frequentes/cobranca-de-13o-salario-por-parte-do-contabilista/',
    ]) {
      expect(pdf.toString('latin1')).toContain(url);
    }
  });

  it.each([null, '', '   '])(
    'rejeita foro sem município ou UF do contador (%p)',
    (valor) => {
      for (const campo of ['municipio', 'uf']) {
        expect(() =>
          validarContratoParaImpressao({
            ...exemplo,
            contador: { ...exemplo.contador, [campo]: valor },
          }),
        ).toThrow('Informe um município válido no cadastro do contador');
      }
    },
  );

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

describe('geração com o município cadastrado do contador', () => {
  function preparar() {
    const query = {
      from: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([
        {
          cliente: {
            ...exemplo.cliente,
            responsavelNome: exemplo.cliente.representante,
          },
          contador: {
            ...exemplo.contador,
            cpf: exemplo.contador.documento,
            codigoMunicipioIbge: '2927408',
            logradouro: 'Rua do Escritório',
            numero: '10',
          },
        },
      ]),
    };
    const database = {
      db: { select: jest.fn().mockReturnValue(query) },
    } as unknown as DatabaseService;
    const contratos = {
      getByCliente: jest.fn().mockResolvedValue(exemplo.contrato),
    } as unknown as FinanceiroContratosService;
    const ibge = new IbgeMunicipiosService();
    const resolver = jest.spyOn(ibge, 'resolverLocalidade');
    const service = new FinanceiroContratoDocumentoService(
      database,
      contratos,
      ibge,
    );
    return { service, resolver };
  }

  it('usa a localidade IBGE do contador mesmo quando cliente e assinatura são de outra cidade', async () => {
    const { service, resolver } = preparar();
    resolver.mockResolvedValue({ municipio: 'Salvador', uf: 'BA' });
    const texto = extrairTexto(await service.gerarPdf('cliente-1'));
    expect(resolver).toHaveBeenCalledWith('2927408');
    expect(texto).toContain(
      'foro da comarca que abrange o município de Salvador/BA',
    );
    expect(texto).toContain('Rua do Escritório, 10, Salvador, BA');
    expect(texto).toContain('Feira de Santana/BA, 14 de novembro de 2026');
  });

  it('impede gerar o contrato quando não consegue confirmar o município do contador', async () => {
    const { service, resolver } = preparar();
    resolver.mockResolvedValue(null);
    await expect(service.gerarPdf('cliente-1')).rejects.toThrow(
      'Não foi possível confirmar o município do contador para definir o foro',
    );
  });
});
