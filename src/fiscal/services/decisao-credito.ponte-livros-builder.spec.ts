/**
 * Ponte de crédito livros ↔ SPED (F03 / R7.1, R7.2).
 *
 * Prova que a política de vedação de crédito por CFOP e a admissibilidade de
 * crédito de ICMS têm UMA fonte única (decisao-credito.ts), consumida tanto
 * pelo builder SPED (efd-icms-ipi.builder.ts, via `decidirCreditoIcms`) quanto
 * pelo relatório de livros/apuração (fiscal-itens.service.ts, via SQL derivado
 * das mesmas constantes). Sem duplicação, o crédito documental coincide.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import {
  CFOP_FINAIS_VEDA_CREDITO,
  CFOP_PREFIXOS_ENTRADA,
  CSOSN_ICMS_PERMITE_CREDITO,
  CST_ICMS_ENTRADA_CREDITO,
  cfopVedaCreditoIcms,
  decidirCreditoIcms,
} from './decisao-credito';
import { FiscalItensService } from './fiscal-itens.service';
import {
  buildEfdIcmsIpiRecords,
  type SpedEfdBuilderInput,
} from '../sped/efd-icms-ipi.builder';

const EMPRESA_CNPJ = '09157533000156';
const INICIO = new Date('2026-08-01T00:00:00.000Z');
const FIM = new Date('2026-08-31T00:00:00.000Z');

// Credito de ICMS de entrada apurado pelo builder para um único item, isolando
// a decisão compartilhada (creditosMercadorias do E110).
function creditoBuilderEntrada(item: {
  cfop: string | null;
  cstIcms: string | null;
  csosnIcms?: string | null;
  valorIcms: string | null;
  valorCreditoIcmsSn?: string | null;
}): string {
  const input = buildInputEntrada(item);
  return buildEfdIcmsIpiRecords(input).apuracao.icmsProprio.creditos;
}

function buildInputEntrada(item: {
  cfop: string | null;
  cstIcms: string | null;
  csosnIcms?: string | null;
  valorIcms: string | null;
  valorCreditoIcmsSn?: string | null;
}): SpedEfdBuilderInput {
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

describe('ponte de crédito livros ↔ builder (R7.1, R7.2)', () => {
  describe('vedação de crédito por CFOP é a mesma no builder e na decisão pura', () => {
    it.each(CFOP_FINAIS_VEDA_CREDITO.map((final) => `1${final}`))(
      'CFOP de entrada %s com CST 00 e ICMS destacado não gera crédito no builder',
      (cfop) => {
        // Decisão pura: VEDADO por CFOP.
        const decisao = decidirCreditoIcms({
          cfop,
          cstIcms: '00',
          valorIcms: '18.00',
        });
        expect(decisao.decisao).toBe('VEDADO');
        expect(decisao.motivo).toBe('CFOP_VEDA_CREDITO');
        // Builder consome a MESMA decisão: crédito documental 0,00.
        expect(creditoBuilderEntrada({ cfop, cstIcms: '00', valorIcms: '18.00' })).toBe(
          '0.00',
        );
      },
    );

    it('CFOP normal (1102) com CST autorizado credita igualmente na decisão e no builder', () => {
      expect(cfopVedaCreditoIcms('1102')).toBe(false);
      const decisao = decidirCreditoIcms({
        cfop: '1102',
        cstIcms: '00',
        valorIcms: '18.00',
      });
      expect(decisao.decisao).toBe('ADMITIDO');
      expect(creditoBuilderEntrada({ cfop: '1102', cstIcms: '00', valorIcms: '18.00' })).toBe(
        '18.00',
      );
    });

    it('CSOSN 101 credita mesmo com CFOP que vedaria o regime normal (paridade builder×decisão)', () => {
      const decisao = decidirCreditoIcms({
        cfop: '1556',
        csosnIcms: '101',
        valorCreditoIcmsSn: '5.00',
      });
      expect(decisao.decisao).toBe('ADMITIDO');
      expect(decisao.motivo).toBe('CSOSN_PERMITE_CREDITO');
      expect(
        creditoBuilderEntrada({
          cfop: '1556',
          cstIcms: null,
          csosnIcms: '101',
          valorIcms: null,
          valorCreditoIcmsSn: '5.00',
        }),
      ).toBe('5.00');
    });
  });

  describe('o SQL dos livros/apuração deriva das mesmas constantes compartilhadas', () => {
    it('referencia exatamente as terminações de CFOP vedadas e a allow-list de CST', async () => {
      let selection: Record<string, SQL> = {};
      const database = {
        db: {
          select: jest
            .fn()
            .mockImplementation((sel: Record<string, unknown>) => {
              if ('regimeTributario' in sel) {
                return {
                  from: jest.fn().mockReturnValue({
                    where: jest.fn().mockReturnValue({
                      limit: jest.fn().mockResolvedValue([]),
                    }),
                  }),
                };
              }
              selection = sel as Record<string, SQL>;
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
      const service = new FiscalItensService(database as never);
      await service.getResumoLivros({ clienteId: 'cliente-1' });
      const credito = new PgDialect().sqlToQuery(selection.credito_icms).sql;

      for (const final of CFOP_FINAIS_VEDA_CREDITO) {
        expect(credito).toContain(`'${final}'`);
      }
      for (const prefixo of CFOP_PREFIXOS_ENTRADA) {
        expect(credito).toContain(`'${prefixo}'`);
      }
      for (const cst of CST_ICMS_ENTRADA_CREDITO) {
        expect(credito).toContain(`'${cst}'`);
      }
      for (const csosn of CSOSN_ICMS_PERMITE_CREDITO) {
        expect(credito).toContain(`'${csosn}'`);
      }
    });
  });
});
