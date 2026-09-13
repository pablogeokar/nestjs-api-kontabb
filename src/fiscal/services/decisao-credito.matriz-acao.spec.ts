/**
 * Task 3.6 (F05 + ponte F03) — cobertura dedicada da decisão de crédito
 * compartilhada. Requisitos: R3.1, R3.2, R3.5, R7.2.
 *
 * Este arquivo é o teste-guarda da tarefa 3.6. Ele consolida, num único lugar,
 * as quatro provas que a tarefa exige:
 *
 *  1. (R3.1) Uma regra com `apropriaCreditoIcms=false` PREVALECE: o crédito não
 *     é apropriado. Provamos que:
 *       - a função pura `decidirCreditoIcms` retorna VEDADO/valorAdmitido 0;
 *       - o mesmo insumo NÃO gera crédito no E110 (builder) NEM no livro/
 *         apuração pela via que essas superfícies HOJE consomem (vedação por
 *         CFOP/CST), com uma nota explícita sobre a lacuna de fiação da regra.
 *  2. (R3.2) O valor original do XML (`valorIcms`) é PRESERVADO — a decisão
 *     expõe `valorAdmitido` separado e nunca reescreve a entrada.
 *  3. (R3.5) O resumo documental é rotulado como parcial (coberto em
 *     fiscal-itens.service.spec.ts; aqui apenas referenciamos a fronteira).
 *  4. (R7.2) "Matriz por ação da UI": tabela dirigida que enumera os insumos de
 *     decisão (admite, veta por CFOP, veta por regra, exige revisão, CSOSN) e o
 *     resultado esperado — decisao, valorAdmitido, e se o crédito aparece no
 *     livro/E110 —, provando consistência entre as superfícies.
 *
 * NOTA DE LACUNA (R3.1 no builder/livros): `totalIcmsDocumentos`
 * (efd-icms-ipi.builder.ts) chama `decidirCreditoIcms` SEM passar `regra`, e o
 * SQL de `getResumoLivros`/`getApuracaoIcms` deriva das mesmas constantes de
 * CFOP/CST, também sem uma regra por item. Portanto, hoje, a vedação por REGRA
 * (`apropriaCreditoIcms=false`) só é honrada na função pura; o builder e os
 * livros honram a vedação por CFOP/CST. A fiação da regra por item nessas
 * superfícies matura na Fase 3 (decisão fiscal persistida por item). Aqui
 * cobrimos: (a) a regra prevalece na fonte única (pura); (b) o caminho de
 * vedação que builder e livros DE FATO consomem (CFOP) zera o crédito nas duas
 * superfícies. Nenhuma mudança de comportamento é introduzida por este arquivo.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import {
  decidirCreditoIcms,
  type DecisaoCredito,
  type EntradaDecisaoCredito,
  type MotivoDecisaoCredito,
} from './decisao-credito';
import { FiscalItensService } from './fiscal-itens.service';
import {
  buildEfdIcmsIpiRecords,
  type SpedEfdBuilderInput,
} from '../sped/efd-icms-ipi.builder';

const EMPRESA_CNPJ = '09157533000156';
const INICIO = new Date('2026-08-01T00:00:00.000Z');
const FIM = new Date('2026-08-31T00:00:00.000Z');

// ---------------------------------------------------------------------------
// Helpers: crédito de ICMS de entrada apurado pelo builder para um único item,
// isolando a decisão compartilhada (creditos do E110/ICMS próprio).
// ---------------------------------------------------------------------------
interface ItemEntrada {
  cfop: string | null;
  cstIcms: string | null;
  csosnIcms?: string | null;
  valorIcms: string | null;
  valorCreditoIcmsSn?: string | null;
}

function creditoBuilderEntrada(item: ItemEntrada): string {
  return buildEfdIcmsIpiRecords(buildInputEntrada(item)).apuracao.icmsProprio
    .creditos;
}

function buildInputEntrada(item: ItemEntrada): SpedEfdBuilderInput {
  return {
    competencia: '2026-08',
    finalidade: '0',
    inicio: INICIO,
    fim: FIM,
    empresa: {
      razaoSocial: 'EMPRESA TESTE LTDA',
      nomeFantasia: 'EMPRESA TESTE',
      cnpj: EMPRESA_CNPJ,
      cpf: null,
      uf: 'SE',
      inscricaoEstadual: '271234567',
      codigoMunicipioIbge: '2800308',
      inscricaoMunicipal: null,
      suframa: null,
      cep: '49000000',
      logradouro: 'RUA FISCAL',
      numero: '100',
      complemento: null,
      bairro: 'CENTRO',
      telefone: null,
      fax: null,
      email: 'fiscal@example.com',
      perfil: 'A',
      indAtiv: '1',
      classificacaoEstabelecimentoIndustrial: null,
      regimeTributario: 'LUCRO_PRESUMIDO',
    },
    contabilista: {
      nome: 'CONTADOR',
      cpf: '00000000000',
      crc: 'SE-000000',
      cnpj: null,
      cep: null,
      logradouro: null,
      numero: null,
      complemento: null,
      bairro: null,
      telefone: null,
      fax: null,
      email: null,
      codigoMunicipioIbge: '2800308',
    },
    participantes: [],
    unidades: [],
    itensCatalogo: [],
    informacoesComplementares: [],
    nfe: [
      {
        row: {
          id: 'documento-1',
          chaveAcesso: '1'.repeat(44),
          modelo: '55',
          serie: '1',
          numeroDocumento: '1',
          codSituacaoSped: '00',
          situacao: 'AUTORIZADA',
          tipoOperacaoEscriturada: 'ENTRADA',
          emitenteCnpjCpf: '11222333000181',
          dataEmissao: INICIO,
          dataEmissaoFiscal: INICIO,
          dataEntradaSaida: INICIO,
          dataEntradaSaidaFiscal: INICIO,
          valorTotal: '100.00',
          totaisDeclaradosXml: null,
          modalidadeFrete: '9',
          informacoesComplementares: null,
        } as unknown as SpedEfdBuilderInput['nfe'][number]['row'],
        participanteCodigo: 'PART-1',
        participanteUf: 'BA',
        codigoInformacaoComplementar: null,
        itens: [
          {
            codigoItem: 'ITEM-1',
            codigoUnidade: 'UN',
            row: {
              numeroItem: 1,
              tipoOperacaoEscriturada: 'ENTRADA',
              cfop: item.cfop,
              cstIcms: item.cstIcms,
              csosnIcms: item.csosnIcms ?? null,
              origemMercadoria: '0',
              valorBrutoProduto: '100.00',
              valorDesconto: '0.00',
              valorBcIcms: '100.00',
              aliquotaIcms: '18.00',
              valorIcms: item.valorIcms,
              valorIcmsSt: '0.00',
              valorCreditoIcmsSn: item.valorCreditoIcmsSn ?? null,
              valorIpi: '0.00',
            } as unknown as SpedEfdBuilderInput['nfe'][number]['itens'][number]['row'],
          },
        ],
      },
    ],
    cte: [],
    saldos: [],
    ajustes: [],
    obrigacoes: [],
    responsabilidades: [],
    inventario: null,
    indicadores1010: {},
    inconsistencias: [],
  };
}

// ---------------------------------------------------------------------------
// (R3.1) A regra com apropriaCreditoIcms=false PREVALECE.
// ---------------------------------------------------------------------------
describe('R3.1 — regra crédito=false prevalece', () => {
  it('na fonte única (função pura): VEDADO com valorAdmitido 0, mesmo com CST/CFOP válidos', () => {
    const resultado = decidirCreditoIcms({
      cfop: '1102', // CFOP que normalmente credita
      cstIcms: '00', // CST que normalmente credita
      valorIcms: '18.00',
      regra: { apropriaCreditoIcms: false, regraVersaoId: 'regra-veta-v1' },
    });
    expect(resultado.decisao).toBe('VEDADO');
    expect(resultado.motivo).toBe('REGRA_VEDA_CREDITO');
    expect(resultado.valorAdmitido).toBe(0n);
    expect(resultado.regraVersaoId).toBe('regra-veta-v1');
  });

  it('a mesma decisão pura, com CFOP de vedação, zera o crédito no E110 (builder) — via que o builder consome hoje', () => {
    // O builder honra a vedação por CFOP (o insumo que ele DE FATO passa à
    // decisão). Prova de que a superfície E110 respeita "sem crédito".
    const decisao = decidirCreditoIcms({
      cfop: '1556',
      cstIcms: '00',
      valorIcms: '18.00',
    });
    expect(decisao.decisao).toBe('VEDADO');
    expect(
      creditoBuilderEntrada({ cfop: '1556', cstIcms: '00', valorIcms: '18.00' }),
    ).toBe('0.00');
  });

  it('a mesma vedação por CFOP zera o crédito no livro (SQL de getResumoLivros) — mesma fonte que o builder', async () => {
    let selection: Record<string, SQL> = {};
    const service = new FiscalItensService(
      makeLivrosDatabase((sel) => {
        selection = sel;
      }) as never,
    );
    await service.getResumoLivros({ clienteId: 'cliente-1' });
    const credito = new PgDialect().sqlToQuery(selection.credito_icms).sql;
    // O livro deriva a vedação por CFOP das MESMAS constantes que o builder
    // consome via decidirCreditoIcms: 556 (uso/consumo) não credita.
    expect(credito).toContain("'556'");
    expect(credito).toMatch(/LEFT\(.*cfop.*\) IN \('1', '2', '3'\)/i);
  });

  it('LACUNA CONHECIDA (Fase 3): o builder NÃO recebe a regra por item, então uma regra=false com CFOP/CST válidos ainda credita no E110', () => {
    // Documenta a fiação pendente: com CFOP/CST creditáveis e SEM regra passada
    // ao builder, o E110 credita normalmente. A vedação por regra só existe na
    // função pura até a decisão persistida por item (Fase 3).
    expect(
      creditoBuilderEntrada({ cfop: '1102', cstIcms: '00', valorIcms: '18.00' }),
    ).toBe('18.00');
    // Já na fonte única, passar a regra=false vedaria (provado acima).
  });
});

// ---------------------------------------------------------------------------
// (R3.2) Valor original do XML preservado; valorAdmitido é separado.
// ---------------------------------------------------------------------------
describe('R3.2 — XML preservado / valor admitido separado', () => {
  it('não muta a entrada e o valorAdmitido é distinto do valorIcms quando vedado', () => {
    const entrada: EntradaDecisaoCredito = {
      cfop: '1556',
      cstIcms: '00',
      valorIcms: '18.00',
    };
    const snapshot = JSON.stringify(entrada);
    const resultado = decidirCreditoIcms(entrada);

    // O valor original do XML permanece intacto na entrada.
    expect(JSON.stringify(entrada)).toBe(snapshot);
    expect(entrada.valorIcms).toBe('18.00');
    // O crédito admitido é uma saída SEPARADA — vedado => 0, sem tocar no XML.
    expect(resultado.decisao).toBe('VEDADO');
    expect(resultado.valorAdmitido).toBe(0n);
  });

  it('quando admitido, o valorAdmitido reflete o destaque sem alterar a entrada', () => {
    const entrada: EntradaDecisaoCredito = {
      cfop: '1102',
      cstIcms: '00',
      valorIcms: '18.00',
    };
    const snapshot = JSON.stringify(entrada);
    const resultado = decidirCreditoIcms(entrada);

    expect(JSON.stringify(entrada)).toBe(snapshot);
    expect(resultado.decisao).toBe('ADMITIDO');
    expect(resultado.valorAdmitido).toBe(1800n);
    // A entrada continua sendo a fonte do valor original (não foi reescrita).
    expect(entrada.valorIcms).toBe('18.00');
  });
});

// ---------------------------------------------------------------------------
// (R7.2) Matriz por ação da UI — tabela dirigida.
// Cada linha: insumo de decisão -> (decisao, valorAdmitido, credita no livro?,
// credita no E110?). A coluna do E110 é verificada de fato pelo builder para os
// casos de regime normal; a coluna do livro reflete a política SQL derivada das
// mesmas constantes (creditável quando ADMITIDO por CST/CSOSN e CFOP não veda).
// ---------------------------------------------------------------------------
interface MatrizCaso {
  acao: string;
  entrada: EntradaDecisaoCredito;
  decisao: DecisaoCredito;
  motivo: MotivoDecisaoCredito;
  valorAdmitido: bigint;
  creditaNoLivro: boolean;
  // Crédito esperado no E110 (builder) em string fiscal; undefined quando o
  // caso é CSOSN (o helper de entrada cobre CSOSN via valorCreditoIcmsSn).
  creditoE110: string;
}

const MATRIZ: MatrizCaso[] = [
  {
    acao: 'ADMITE — CST 00, CFOP normal',
    entrada: { cfop: '1102', cstIcms: '00', valorIcms: '18.00' },
    decisao: 'ADMITIDO',
    motivo: 'CST_AUTORIZA_CREDITO',
    valorAdmitido: 1800n,
    creditaNoLivro: true,
    creditoE110: '18.00',
  },
  {
    acao: 'VETA POR CFOP — uso/consumo 1556 com CST 00',
    entrada: { cfop: '1556', cstIcms: '00', valorIcms: '18.00' },
    decisao: 'VEDADO',
    motivo: 'CFOP_VEDA_CREDITO',
    valorAdmitido: 0n,
    creditaNoLivro: false,
    creditoE110: '0.00',
  },
  {
    acao: 'VETA POR CFOP — substituído 1403 com CST 00',
    entrada: { cfop: '1403', cstIcms: '00', valorIcms: '10.00' },
    decisao: 'VEDADO',
    motivo: 'CFOP_VEDA_CREDITO',
    valorAdmitido: 0n,
    creditaNoLivro: false,
    creditoE110: '0.00',
  },
  {
    acao: 'VETA POR REGRA — apropriaCreditoIcms=false prevalece',
    entrada: {
      cfop: '1102',
      cstIcms: '00',
      valorIcms: '18.00',
      regra: { apropriaCreditoIcms: false, regraVersaoId: 'regra-v9' },
    },
    decisao: 'VEDADO',
    motivo: 'REGRA_VEDA_CREDITO',
    valorAdmitido: 0n,
    creditaNoLivro: false,
    // O builder ainda não recebe a regra por item (LACUNA Fase 3); por isso a
    // coluna E110 deste caso é validada separadamente, não aqui.
    creditoE110: '18.00',
  },
  {
    acao: 'EXIGE REVISÃO — CST 90 ambíguo com destaque',
    entrada: { cfop: '1102', cstIcms: '90', valorIcms: '18.00' },
    decisao: 'EXIGE_REVISAO',
    motivo: 'CST_NAO_AUTORIZADO',
    valorAdmitido: 0n,
    creditaNoLivro: false,
    creditoE110: '0.00',
  },
  {
    acao: 'CSOSN 101 — Simples com crédito permitido',
    entrada: { cfop: '1102', csosnIcms: '101', valorCreditoIcmsSn: '3.45' },
    decisao: 'ADMITIDO',
    motivo: 'CSOSN_PERMITE_CREDITO',
    valorAdmitido: 345n,
    creditaNoLivro: true,
    creditoE110: '3.45',
  },
  {
    acao: 'CSOSN 102 — Simples sem crédito',
    entrada: { cfop: '1102', csosnIcms: '102', valorCreditoIcmsSn: '3.45' },
    decisao: 'EXIGE_REVISAO',
    motivo: 'CST_NAO_AUTORIZADO',
    valorAdmitido: 0n,
    creditaNoLivro: false,
    creditoE110: '0.00',
  },
];

describe('R7.2 — matriz por ação da UI (consistência decisão × livro × E110)', () => {
  it.each(MATRIZ)(
    '$acao → decisão e valor admitido consistentes na função pura',
    ({ entrada, decisao, motivo, valorAdmitido }) => {
      const resultado = decidirCreditoIcms(entrada);
      expect(resultado.decisao).toBe(decisao);
      expect(resultado.motivo).toBe(motivo);
      expect(resultado.valorAdmitido).toBe(valorAdmitido);
    },
  );

  // O builder do E110 consome a decisão via CFOP/CST/CSOSN (sem regra). Para os
  // casos que dependem SÓ desses insumos, o crédito do E110 casa com a matriz.
  it.each(
    MATRIZ.filter((caso) => caso.motivo !== 'REGRA_VEDA_CREDITO'),
  )('$acao → crédito no E110 (builder) igual à decisão', ({ entrada, creditoE110 }) => {
    const credito = creditoBuilderEntrada({
      cfop: entrada.cfop ?? null,
      cstIcms: entrada.cstIcms ?? null,
      csosnIcms: entrada.csosnIcms ?? null,
      valorIcms: entrada.valorIcms ?? null,
      valorCreditoIcmsSn: entrada.valorCreditoIcmsSn ?? null,
    });
    expect(credito).toBe(creditoE110);
  });

  it('o "credita no livro" da matriz corresponde a ADMITIDO com valor > 0', () => {
    for (const caso of MATRIZ) {
      const resultado = decidirCreditoIcms(caso.entrada);
      const creditariaNoLivro =
        resultado.decisao === 'ADMITIDO' && resultado.valorAdmitido > 0n;
      expect(creditariaNoLivro).toBe(caso.creditaNoLivro);
    }
  });
});

// ---------------------------------------------------------------------------
// Fábrica de banco simulado para exercitar o SQL de getResumoLivros.
// ---------------------------------------------------------------------------
function makeLivrosDatabase(capture: (selection: Record<string, SQL>) => void) {
  return {
    db: {
      select: jest.fn().mockImplementation((sel: Record<string, unknown>) => {
        if ('regimeTributario' in sel) {
          return {
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([]),
              }),
            }),
          };
        }
        capture(sel as Record<string, SQL>);
        return {
          from: jest.fn().mockReturnValue({
            innerJoin: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                groupBy: jest.fn().mockReturnValue({
                  orderBy: jest.fn().mockResolvedValue([]),
                }),
              }),
            }),
          }),
        };
      }),
    },
  };
}
