/**
 * Fixtures normativas INDEPENDENTES do builder — domínio CFOP completo e
 * obrigatoriedade condicional do C190 (R3.2, R3.3; tarefa 3.2).
 *
 * Por que este spec existe
 * ------------------------
 * A tarefa 3.1 cobriu as 7 camadas de verificação; a 3.2 fecha duas lacunas
 * normativas específicas (R3.3):
 *   1. DOMÍNIO CFOP COMPLETO — os seis primeiros dígitos canônicos de CFOP
 *      (entrada/saída × estadual/interestadual/exterior) devem ser escriturados
 *      no C190 preservando o código tal como classificado, sem conversão
 *      silenciosa de sentido/abrangência.
 *   2. OBRIGATORIEDADE CONDICIONAL — os campos do C190 que só são devidos sob
 *      certas condições (ICMS-ST, IPI) devem aparecer com valor APENAS quando a
 *      operação os comporta, e ficar em `0,00` caso contrário.
 *
 * Independência do oráculo (R3.2)
 * -------------------------------
 * As linhas esperadas abaixo NÃO são produzidas chamando o builder. Cada
 * expectativa é uma string de valor literal, derivada à mão das normas do
 * leiaute EFD (ordem oficial dos campos do C190) e da aritmética do próprio
 * documento. O input vem dos montadores de linha crua de `normative-rows.ts`,
 * que, por contrato, não usam `makeInput`/`makeNfe`/`makeItem` do builder. O
 * builder é o OBJETO SOB TESTE; estas fixtures são a referência externa. Se o
 * builder trocar a posição de dois campos, converter o CFOP indevidamente ou
 * emitir ICMS-ST numa operação sem ST, a comparação falha.
 *
 * Ordem oficial dos campos do C190 (após o REG), usada como oráculo de posição:
 *   [0] CST_ICMS    (origem + CST; origem prefixada uma vez)
 *   [1] CFOP        (código escriturado)
 *   [2] ALIQ_ICMS   (2 casas)
 *   [3] VL_OPR      (líquido + ICMS-ST + FCP-ST + IPI)
 *   [4] VL_BC_ICMS
 *   [5] VL_ICMS
 *   [6] VL_BC_ICMS_ST
 *   [7] VL_ICMS_ST
 *   [8] VL_RED_BC
 *   [9] VL_IPI
 *   [10] COD_OBS    (vazio)
 */
import { buildEfdIcmsIpiRecords } from './efd-icms-ipi.builder';
import { serializeSpedRecord, type SpedRecord } from './core';
import {
  EMPRESA_CNPJ,
  inputFixture,
  itemRow,
  nfeFixture,
} from './__fixtures__/normative-rows';

/** Campos (após REG) da n-ésima ocorrência de um registro no arquivo gerado. */
function camposDaLinha(
  records: readonly SpedRecord[],
  reg: string,
  ocorrencia: number,
): string[] {
  const alvo = records.filter((record) => record.reg === reg)[ocorrencia];
  if (!alvo) {
    throw new Error(`Registro ${reg}[${ocorrencia}] ausente no arquivo gerado.`);
  }
  // |REG|c0|c1|...| ⇒ remove os vazios de borda e o próprio REG.
  return serializeSpedRecord(alvo).split('|').slice(2, -1);
}

/**
 * Monta uma NF-e com UM item tributado por ICMS "normal" (CST 00, origem 0),
 * variando apenas o CFOP e o sentido escriturado. Fornecedor/empresa ficam
 * coerentes com o sentido para que o builder emita o C100/C190 sem bloqueio.
 */
function nfeComCfop(params: {
  id: string;
  numero: string;
  cfop: string;
  sentido: 'ENTRADA' | 'SAIDA';
}) {
  // Saída própria: a empresa é a emitente. Entrada: um terceiro emite para ela.
  const emitente = params.sentido === 'SAIDA' ? EMPRESA_CNPJ : '12345678000199';
  const destinatario = params.sentido === 'SAIDA' ? '12345678000199' : EMPRESA_CNPJ;
  return nfeFixture(
    {
      id: params.id,
      chaveAcesso: params.id.padEnd(44, '0'),
      numeroDocumento: params.numero,
      emitenteCnpjCpf: emitente,
      destinatarioCnpjCpf: destinatario,
      tipoOperacaoEscriturada: params.sentido,
      tpNfXml: params.sentido === 'SAIDA' ? '1' : '0',
    },
    [
      itemRow({
        cstIcms: '00',
        csosnIcms: null,
        cfop: params.cfop,
        origemMercadoria: '0',
        valorBrutoProduto: '1000.00',
        valorBcIcms: '1000.00',
        aliquotaIcms: '18.00',
        valorIcms: '180.00',
        // Sem ST e sem IPI neste cenário base.
        valorBcIcmsSt: '0.00',
        aliquotaIcmsSt: '0.00',
        valorIcmsSt: '0.00',
        valorFcpSt: '0.00',
        cstIpi: null,
        valorBcIpi: null,
        aliquotaIpi: null,
        valorIpi: '0.00',
      }),
    ],
  );
}

// ---------------------------------------------------------------------------
// 1) DOMÍNIO CFOP COMPLETO (R3.3)
// ---------------------------------------------------------------------------
// Um caso por primeiro dígito canônico de CFOP. O C190 deve preservar o CFOP
// classificado (sem conversão silenciosa) e o CST composto (origem 0 + CST 00).
interface CasoDominioCfop {
  descricao: string;
  cfop: string;
  sentido: 'ENTRADA' | 'SAIDA';
  /** VL_OPR esperado = líquido do item (sem ST/IPI neste cenário). */
  valorOperacao: string;
}

const CASOS_DOMINIO_CFOP: readonly CasoDominioCfop[] = [
  {
    descricao: 'entrada estadual (1xxx)',
    cfop: '1102',
    sentido: 'ENTRADA',
    valorOperacao: '1000,00',
  },
  {
    descricao: 'entrada interestadual (2xxx)',
    cfop: '2102',
    sentido: 'ENTRADA',
    valorOperacao: '1000,00',
  },
  {
    descricao: 'entrada do exterior (3xxx)',
    cfop: '3102',
    sentido: 'ENTRADA',
    valorOperacao: '1000,00',
  },
  {
    descricao: 'saída estadual (5xxx)',
    cfop: '5102',
    sentido: 'SAIDA',
    valorOperacao: '1000,00',
  },
  {
    descricao: 'saída interestadual (6xxx)',
    cfop: '6102',
    sentido: 'SAIDA',
    valorOperacao: '1000,00',
  },
  {
    descricao: 'saída para o exterior (7xxx)',
    cfop: '7102',
    sentido: 'SAIDA',
    valorOperacao: '1000,00',
  },
];

describe('Domínio CFOP completo no C190 — oráculo externo (R3.2, R3.3)', () => {
  it.each(CASOS_DOMINIO_CFOP)(
    '$descricao: escritura o CFOP $cfop sem converter sentido/abrangência',
    (caso) => {
      const input = inputFixture({
        nfe: [
          nfeComCfop({
            id: `cfop-${caso.cfop}`,
            numero: `9${caso.cfop}`,
            cfop: caso.cfop,
            sentido: caso.sentido,
          }),
        ],
      });
      const { records } = buildEfdIcmsIpiRecords(input);
      const campos = camposDaLinha(records, 'C190', 0);

      // Oráculo campo a campo, escrito à mão a partir do leiaute e da aritmética
      // do documento (não derivado do builder).
      expect({
        cst: campos[0],
        cfop: campos[1],
        aliquota: campos[2],
        vlOpr: campos[3],
        vlBcIcms: campos[4],
        vlIcms: campos[5],
        vlBcIcmsSt: campos[6],
        vlIcmsSt: campos[7],
        vlRedBc: campos[8],
        vlIpi: campos[9],
        codObs: campos[10],
      }).toEqual({
        cst: '000', // origem 0 + CST 00, prefixada uma vez
        cfop: caso.cfop, // preservado, sem conversão silenciosa
        aliquota: '18,00',
        vlOpr: caso.valorOperacao,
        vlBcIcms: '1000,00',
        vlIcms: '180,00',
        vlBcIcmsSt: '0,00',
        vlIcmsSt: '0,00',
        vlRedBc: '0,00',
        vlIpi: '0,00',
        codObs: '', // COD_OBS sempre vazio neste domínio
      });
    },
  );

  it('cobre as três abrangências em entrada e em saída (12 primeiros dígitos canônicos)', () => {
    const prefixos = new Set(CASOS_DOMINIO_CFOP.map((c) => c.cfop[0]));
    // 1,2,3 (entrada) e 5,6,7 (saída) — domínio canônico completo.
    expect([...prefixos].sort()).toEqual(['1', '2', '3', '5', '6', '7']);
  });
});

// ---------------------------------------------------------------------------
// 2) OBRIGATORIEDADE CONDICIONAL (R3.3)
// ---------------------------------------------------------------------------
// Os campos de ICMS-ST e IPI do C190 só carregam valor quando a operação os
// comporta. O oráculo abaixo prova a condição em ambos os sentidos: presença
// quando devido, `0,00` quando não devido.

describe('Obrigatoriedade condicional no C190 — oráculo externo (R3.2, R3.3)', () => {
  it('ICMS-ST: campos VL_BC_ICMS_ST/VL_ICMS_ST só carregam valor quando há ST', () => {
    // CST 10 (tributada com cobrança de ICMS por ST). ICMS-ST destacado.
    const input = inputFixture({
      nfe: [
        nfeFixture(
          {
            id: 'st-doc',
            chaveAcesso: 'st-doc'.padEnd(44, '0'),
            numeroDocumento: '7001',
            emitenteCnpjCpf: EMPRESA_CNPJ,
            destinatarioCnpjCpf: '12345678000199',
            tipoOperacaoEscriturada: 'SAIDA',
            tpNfXml: '1',
          },
          [
            itemRow({
              cstIcms: '10',
              csosnIcms: null,
              cfop: '5401',
              origemMercadoria: '0',
              valorBrutoProduto: '1000.00',
              valorBcIcms: '1000.00',
              aliquotaIcms: '18.00',
              valorIcms: '180.00',
              valorBcIcmsSt: '1200.00',
              aliquotaIcmsSt: '18.00',
              valorIcmsSt: '36.00',
              valorFcpSt: '0.00',
              cstIpi: null,
              valorBcIpi: null,
              aliquotaIpi: null,
              valorIpi: '0.00',
            }),
          ],
        ),
      ],
    });
    const { records } = buildEfdIcmsIpiRecords(input);
    const campos = camposDaLinha(records, 'C190', 0);

    expect({
      cst: campos[0],
      cfop: campos[1],
      // VL_OPR inclui o ICMS-ST (1000 + 36 = 1036).
      vlOpr: campos[3],
      vlBcIcmsSt: campos[6],
      vlIcmsSt: campos[7],
      vlIpi: campos[9],
    }).toEqual({
      cst: '010',
      cfop: '5401',
      vlOpr: '1036,00',
      vlBcIcmsSt: '1200,00',
      vlIcmsSt: '36,00',
      vlIpi: '0,00',
    });
  });

  it('IPI: campo VL_IPI do C190 só carrega valor quando o item tem IPI destacado', () => {
    // Estabelecimento industrial que destaca IPI (CST 50) numa saída.
    const input = inputFixture({
      nfe: [
        nfeFixture(
          {
            id: 'ipi-doc',
            chaveAcesso: 'ipi-doc'.padEnd(44, '0'),
            numeroDocumento: '7002',
            emitenteCnpjCpf: EMPRESA_CNPJ,
            destinatarioCnpjCpf: '12345678000199',
            tipoOperacaoEscriturada: 'SAIDA',
            tpNfXml: '1',
          },
          [
            itemRow({
              cstIcms: '00',
              csosnIcms: null,
              cfop: '5101',
              origemMercadoria: '0',
              valorBrutoProduto: '1000.00',
              valorBcIcms: '1000.00',
              aliquotaIcms: '18.00',
              valorIcms: '180.00',
              valorBcIcmsSt: '0.00',
              aliquotaIcmsSt: '0.00',
              valorIcmsSt: '0.00',
              valorFcpSt: '0.00',
              cstIpi: '50',
              valorBcIpi: '1000.00',
              aliquotaIpi: '10.00',
              valorIpi: '100.00',
            }),
          ],
        ),
      ],
    });
    const { records } = buildEfdIcmsIpiRecords(input);
    const campos = camposDaLinha(records, 'C190', 0);

    expect({
      cst: campos[0],
      cfop: campos[1],
      // VL_OPR inclui o IPI (1000 + 100 = 1100).
      vlOpr: campos[3],
      vlBcIcmsSt: campos[6],
      vlIcmsSt: campos[7],
      vlIpi: campos[9],
    }).toEqual({
      cst: '000',
      cfop: '5101',
      vlOpr: '1100,00',
      vlBcIcmsSt: '0,00',
      vlIcmsSt: '0,00',
      vlIpi: '100,00',
    });
  });

  it('sem ST nem IPI: os campos condicionais ficam em 0,00 (não omitidos nem com lixo)', () => {
    const input = inputFixture({
      nfe: [
        nfeComCfop({
          id: 'base-00',
          numero: '7003',
          cfop: '1102',
          sentido: 'ENTRADA',
        }),
      ],
    });
    const { records } = buildEfdIcmsIpiRecords(input);
    const campos = camposDaLinha(records, 'C190', 0);

    // Posição fixa: os campos condicionais existem e valem 0,00.
    expect(campos[6]).toBe('0,00'); // VL_BC_ICMS_ST
    expect(campos[7]).toBe('0,00'); // VL_ICMS_ST
    expect(campos[9]).toBe('0,00'); // VL_IPI
  });
});
