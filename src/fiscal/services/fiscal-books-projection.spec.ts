import {
  projetarLivros,
  projetarResumoLivro,
  type LivrosProjecao,
} from './fiscal-books-projection';
import type { FechamentoRegistro } from './fiscal-closing.service';
import {
  projetarResultadoApuracao,
  type FechamentoSnapshots,
} from './resultado-apuracao.projector';

function registro(
  overrides: Partial<FechamentoRegistro> = {},
): FechamentoRegistro {
  return {
    id: 'f1',
    clienteId: 'c1',
    obrigacao: 'EFD_ICMS_IPI',
    competencia: '2026-09-01',
    versao: 3,
    estado: 'FECHADO',
    corrente: true,
    motorVersao: 'fase3-fechamento@1',
    hashEntradas: 'a'.repeat(64),
    aprovadoPor: 'u1',
    fechadoEm: new Date('2026-10-01T00:00:00Z'),
    ...overrides,
  };
}

/**
 * Snapshots de exemplo. Dois documentos de entrada (uma linha C190 tributada
 * 18% e um item de uso/consumo), um de saída. Valores monetários SEMPRE como
 * strings decimais. Os documentos carregam `itens` (caso rico, por item do
 * C170) para exercitar o agregador do RESUMO por documento.
 */
function snapshots(
  overrides: Partial<FechamentoSnapshots> = {},
): FechamentoSnapshots {
  return {
    documentos: [
      {
        chave: 'A',
        numeroDocumento: '1',
        participante: 'Fornecedor X',
        cfop: '1102',
        cst: '00',
        valorContabil: '100.00',
        baseIcms: '100.00',
        valorIcms: '18.00',
        itens: [
          {
            cstIcms: '00',
            origemMercadoria: '0',
            cfop: '1102',
            aliquotaIcms: '18.00',
            valorBrutoProduto: '100.00',
            valorBcIcms: '100.00',
            valorIcms: '18.00',
          },
        ],
      },
      {
        chave: 'B',
        numeroDocumento: '2',
        participante: 'Fornecedor Y',
        cfop: '5102',
        cst: '00',
        valorContabil: '250.50',
        baseIcms: '250.50',
        valorIcms: '45.09',
        itens: [
          {
            cstIcms: '00',
            origemMercadoria: '0',
            cfop: '5102',
            aliquotaIcms: '18.00',
            valorBrutoProduto: '250.50',
            valorBcIcms: '250.50',
            valorIcms: '45.09',
          },
        ],
      },
      // Documento sem CFOP: não é agregável no RESUMO, mas aparece no DETALHADO.
      {
        chave: 'C',
        numeroDocumento: '3',
        valorContabil: '10.00',
      },
    ],
    saldos: {
      debitos: '45.09',
      creditos: '18.00',
      saldoApurado: '27.09',
      icmsRecolher: '27.09',
    },
    parametros: { perfil: 'A' },
    ...overrides,
  };
}

describe('fiscal-books-projection (livros como projeção do fechamento)', () => {
  describe('cabeçalho comum (R4.1 — estado + número/versão)', () => {
    it('as três visões carregam o mesmo cabeçalho de versão/estado', () => {
      const livros = projetarLivros(registro(), snapshots());
      const esperado = {
        clienteId: 'c1',
        obrigacao: 'EFD_ICMS_IPI',
        competencia: '2026-09-01',
        versao: 3,
        corrente: true,
        estado: 'FECHADO',
        estadoFechamento: 'FECHADO',
        parcial: false,
        filtros: [],
        avisoParcial: null,
        avisoAuxiliar: {
          auxiliar: true,
          mensagem: expect.stringContaining('Relatório auxiliar') as unknown,
        },
        motorVersao: 'fase3-fechamento@1',
        hashEntradas: 'a'.repeat(64),
      };
      expect(livros.cabecalho).toEqual(esperado);
      expect(livros.detalhado.cabecalho).toEqual(esperado);
      expect(livros.resumo.cabecalho).toEqual(esperado);
      expect(livros.apuracao.cabecalho).toEqual(esperado);
    });

    it('estado RASCUNHO/PENDENTE do fechamento vira PARCIAL no livro', () => {
      expect(
        projetarLivros(registro({ estado: 'RASCUNHO' }), snapshots()).cabecalho
          .estado,
      ).toBe('PARCIAL');
      expect(
        projetarLivros(registro({ estado: 'PENDENTE' }), snapshots()).cabecalho
          .estado,
      ).toBe('PARCIAL');
    });

    it('estado REVISADO do fechamento é REVISADO no livro', () => {
      const livros = projetarLivros(
        registro({ estado: 'REVISADO', corrente: false }),
        snapshots(),
      );
      expect(livros.cabecalho.estado).toBe('REVISADO');
      expect(livros.cabecalho.estadoFechamento).toBe('REVISADO');
      // Uma versão parcial/revisada nunca se apresenta como corrente fechada.
      expect(livros.cabecalho.corrente).toBe(false);
    });
  });

  describe('filtros invalidam aparência de completo (R4.4)', () => {
    it('sem filtros, o fechamento FECHADO não é parcial e não traz aviso parcial', () => {
      const { cabecalho } = projetarLivros(registro(), snapshots());
      expect(cabecalho.filtros).toEqual([]);
      expect(cabecalho.parcial).toBe(false);
      expect(cabecalho.estado).toBe('FECHADO');
      expect(cabecalho.avisoParcial).toBeNull();
    });

    it('um filtro ativo FORÇA PARCIAL mesmo sobre fechamento FECHADO', () => {
      const { cabecalho } = projetarLivros(registro(), snapshots(), {
        filtros: [{ campo: 'cfop', descricao: 'CFOP 1102' }],
      });
      // R4.4: o recorte não pode se apresentar como o livro completo/oficial.
      expect(cabecalho.estado).toBe('PARCIAL');
      expect(cabecalho.estadoFechamento).toBe('FECHADO');
      expect(cabecalho.parcial).toBe(true);
      expect(cabecalho.filtros).toEqual([
        { campo: 'cfop', descricao: 'CFOP 1102' },
      ]);
      expect(cabecalho.avisoParcial).toMatch(/parcial/i);
    });

    it('o estado forçado PARCIAL por filtro vale para as três visões', () => {
      const livros = projetarLivros(registro(), snapshots(), {
        filtros: [{ campo: 'participante', descricao: 'Fornecedor X' }],
      });
      expect(livros.detalhado.cabecalho.estado).toBe('PARCIAL');
      expect(livros.resumo.cabecalho.estado).toBe('PARCIAL');
      expect(livros.apuracao.cabecalho.estado).toBe('PARCIAL');
      expect(livros.detalhado.cabecalho.parcial).toBe(true);
      expect(livros.resumo.cabecalho.parcial).toBe(true);
      expect(livros.apuracao.cabecalho.parcial).toBe(true);
    });

    it('fechamento parcial (RASCUNHO) é parcial mesmo sem filtros', () => {
      const { cabecalho } = projetarLivros(
        registro({ estado: 'RASCUNHO' }),
        snapshots(),
      );
      expect(cabecalho.parcial).toBe(true);
      expect(cabecalho.estado).toBe('PARCIAL');
      // Sem filtros não há aviso de recorte — a parcialidade vem do fechamento.
      expect(cabecalho.filtros).toEqual([]);
      expect(cabecalho.avisoParcial).toBeNull();
    });

    it('preserva vários filtros na ordem informada', () => {
      const { cabecalho } = projetarLivros(registro(), snapshots(), {
        filtros: [
          { campo: 'cfop', descricao: 'CFOP 1102' },
          { campo: 'periodo', descricao: '01/09 a 15/09' },
        ],
      });
      expect(cabecalho.filtros).toEqual([
        { campo: 'cfop', descricao: 'CFOP 1102' },
        { campo: 'periodo', descricao: '01/09 a 15/09' },
      ]);
    });

    it('descarta filtros sem campo/descrição (não viram recorte apresentável)', () => {
      const { cabecalho } = projetarLivros(registro(), snapshots(), {
        filtros: [
          { campo: '', descricao: 'x' },
          { campo: 'cfop', descricao: '' },
          { campo: 'cfop', descricao: 'CFOP 1102' },
        ] as never,
      });
      expect(cabecalho.filtros).toEqual([
        { campo: 'cfop', descricao: 'CFOP 1102' },
      ]);
      expect(cabecalho.parcial).toBe(true);
    });

    it('array de filtros vazio não torna o livro parcial', () => {
      const { cabecalho } = projetarLivros(registro(), snapshots(), {
        filtros: [],
      });
      expect(cabecalho.parcial).toBe(false);
      expect(cabecalho.estado).toBe('FECHADO');
    });
  });

  describe('aviso de livro auxiliar sempre presente (R4.5)', () => {
    it('o aviso auxiliar é anexado em todas as visões e configurações', () => {
      const casos = [
        projetarLivros(registro(), snapshots()),
        projetarLivros(registro({ estado: 'RASCUNHO' }), snapshots()),
        projetarLivros(registro(), snapshots(), {
          filtros: [{ campo: 'cfop', descricao: 'CFOP 1102' }],
        }),
      ];
      for (const livros of casos) {
        for (const cabecalho of [
          livros.cabecalho,
          livros.detalhado.cabecalho,
          livros.resumo.cabecalho,
          livros.apuracao.cabecalho,
        ]) {
          expect(cabecalho.avisoAuxiliar.auxiliar).toBe(true);
          expect(cabecalho.avisoAuxiliar.mensagem).toMatch(
            /relatório auxiliar/i,
          );
          expect(cabecalho.avisoAuxiliar.mensagem).toMatch(/não substitui/i);
        }
      }
    });
  });

  describe('DETALHADO (cronológico) reusa a ponte do contrato (R4.1/R4.3)', () => {
    it('o detalhamento é idêntico ao do projetor (sem segundo motor)', () => {
      const livros = projetarLivros(registro(), snapshots(), {
        pagination: { offset: 0, limit: 2 },
      });
      const apuracao = projetarResultadoApuracao(registro(), snapshots(), {
        pagination: { offset: 0, limit: 2 },
      });
      expect(livros.detalhado.detalhamento).toEqual(apuracao.detalhamento);
    });

    it('a paginação do DETALHADO respeita offset/limit e reporta o total', () => {
      const livros = projetarLivros(registro(), snapshots(), {
        pagination: { offset: 2, limit: 2 },
      });
      expect(livros.detalhado.detalhamento.items).toHaveLength(1);
      expect(livros.detalhado.detalhamento.items[0].chave).toBe('C');
      expect(livros.detalhado.detalhamento.pagination).toEqual({
        total: 3,
        limit: 2,
        offset: 2,
      });
    });

    it('campos ausentes ficam null, não zero (R4.2)', () => {
      const livros = projetarLivros(registro(), snapshots());
      const docC = livros.detalhado.detalhamento.items.find(
        (i) => i.chave === 'C',
      );
      expect(docC?.valorIcms).toBeNull();
      expect(docC?.baseIcms).toBeNull();
      expect(docC?.cfop).toBeNull();
    });
  });

  describe('RESUMO (CFOP/CST/alíquota com drill-down, R4.1/R5.4)', () => {
    it('agrupa por CST/CFOP/alíquota e expõe o drill-down de documentos', () => {
      const linhas = projetarResumoLivro(snapshots().documentos);
      // Dois CFOP distintos (1102 entrada, 5102 saída) → duas linhas.
      expect(linhas).toHaveLength(2);
      const l1102 = linhas.find((l) => l.cfop === '1102');
      expect(l1102).toMatchObject({
        cst: '000',
        cfop: '1102',
        aliquota: '18.00',
        valorBcIcms: { estado: 'INFORMADO', valor: '100.00' },
        valorIcms: { estado: 'INFORMADO', valor: '18.00' },
        documentos: ['A'],
      });
      const l5102 = linhas.find((l) => l.cfop === '5102');
      expect(l5102).toMatchObject({
        cfop: '5102',
        valorIcms: { estado: 'INFORMADO', valor: '45.09' },
        documentos: ['B'],
      });
    });

    it('consolida itens de MESMA chave de documentos diferentes no drill-down', () => {
      const docs = [
        {
          chave: 'A',
          itens: [
            {
              cstIcms: '00',
              origemMercadoria: '0',
              cfop: '1102',
              aliquotaIcms: '18.00',
              valorBcIcms: '100.00',
              valorIcms: '18.00',
            },
          ],
        },
        {
          chave: 'D',
          itens: [
            {
              cstIcms: '00',
              origemMercadoria: '0',
              cfop: '1102',
              aliquotaIcms: '18.00',
              valorBcIcms: '50.00',
              valorIcms: '9.00',
            },
          ],
        },
      ];
      const linhas = projetarResumoLivro(docs);
      expect(linhas).toHaveLength(1);
      expect(linhas[0]).toMatchObject({
        cfop: '1102',
        valorBcIcms: { estado: 'INFORMADO', valor: '150.00' },
        valorIcms: { estado: 'INFORMADO', valor: '27.00' },
        documentos: ['A', 'D'],
      });
    });

    it('aceita documento flat (sem array itens) como item único', () => {
      const linhas = projetarResumoLivro([
        {
          chave: 'A',
          cstIcms: '00',
          origemMercadoria: '0',
          cfop: '1102',
          aliquotaIcms: '18.00',
          valorBcIcms: '100.00',
          valorIcms: '18.00',
        },
      ]);
      expect(linhas).toHaveLength(1);
      expect(linhas[0]).toMatchObject({
        cfop: '1102',
        valorIcms: { estado: 'INFORMADO', valor: '18.00' },
        documentos: ['A'],
      });
    });

    it('documento sem CFOP não entra no resumo (não se inventa chave)', () => {
      const linhas = projetarResumoLivro([
        { chave: 'C', valorContabil: '10.00' },
      ]);
      expect(linhas).toEqual([]);
    });

    it('CST 40 sem redução não classifica diferença de base como redução (R5.1)', () => {
      const linhas = projetarResumoLivro([
        {
          chave: 'E',
          itens: [
            {
              cstIcms: '40',
              origemMercadoria: '0',
              cfop: '5102',
              aliquotaIcms: '0.00',
              valorBrutoProduto: '100.00',
            },
          ],
        },
      ]);
      expect(linhas).toHaveLength(1);
      // R5.1 + R4.2: sem percentual de redução, a redução não é "zero" — é NÃO
      // APLICÁVEL (a diferença base×líquido não vira redução).
      expect(linhas[0].valorReducaoBc).toEqual({
        estado: 'NAO_APLICAVEL',
        valor: null,
      });
      expect(linhas[0].cst).toBe('040');
    });

    it('o navegador só formata: valores INFORMADOS do RESUMO são strings decimais', () => {
      const linhas = projetarResumoLivro(snapshots().documentos);
      for (const linha of linhas) {
        if (linha.valorIcms.estado === 'INFORMADO') {
          expect(typeof linha.valorIcms.valor).toBe('string');
          expect(linha.valorIcms.valor).toMatch(/^-?\d+\.\d{2}$/);
        }
      }
    });

    it('rejeita valor Number no documento do resumo (decimais são strings)', () => {
      expect(() =>
        projetarResumoLivro([
          {
            chave: 'A',
            cfop: '1102',
            valorIcms: 18,
          },
        ]),
      ).toThrow(/string decimal/i);
    });

    describe('tri-estado zero ≠ não informado ≠ não aplicável (R4.2)', () => {
      it('um ZERO legítimo (ICMS 0.00 informado) é INFORMADO, não "não informado"', () => {
        // CST 00 tributada com base e ICMS informados como 0.00 — um zero
        // DESTACADO (informado), distinto de ausência.
        const linhas = projetarResumoLivro([
          {
            chave: 'Z',
            itens: [
              {
                cstIcms: '00',
                origemMercadoria: '0',
                cfop: '1102',
                aliquotaIcms: '0.00',
                valorBrutoProduto: '100.00',
                valorBcIcms: '0.00',
                valorIcms: '0.00',
              },
            ],
          },
        ]);
        expect(linhas[0].valorIcms).toEqual({
          estado: 'INFORMADO',
          valor: '0.00',
        });
        expect(linhas[0].valorBcIcms).toEqual({
          estado: 'INFORMADO',
          valor: '0.00',
        });
      });

      it('ICMS/BC aplicáveis mas ausentes ficam NÃO INFORMADO (nunca 0.00)', () => {
        // CST 00 tributada, mas a origem só trouxe o valor da operação — ICMS e
        // BC são aplicáveis porém NÃO informados. Jamais imprimir 0.00.
        const linhas = projetarResumoLivro([
          {
            chave: 'N',
            itens: [
              {
                cstIcms: '00',
                origemMercadoria: '0',
                cfop: '1102',
                aliquotaIcms: '18.00',
                valorBrutoProduto: '100.00',
              },
            ],
          },
        ]);
        expect(linhas[0].valorIcms).toEqual({
          estado: 'NAO_INFORMADO',
          valor: null,
        });
        expect(linhas[0].valorBcIcms).toEqual({
          estado: 'NAO_INFORMADO',
          valor: null,
        });
      });

      it('ICMS próprio é NÃO APLICÁVEL numa operação isenta (CST 40)', () => {
        const linhas = projetarResumoLivro([
          {
            chave: 'I',
            itens: [
              {
                cstIcms: '40',
                origemMercadoria: '0',
                cfop: '5102',
                aliquotaIcms: '0.00',
                valorBrutoProduto: '100.00',
              },
            ],
          },
        ]);
        expect(linhas[0].valorIcms).toEqual({
          estado: 'NAO_APLICAVEL',
          valor: null,
        });
        expect(linhas[0].valorBcIcms).toEqual({
          estado: 'NAO_APLICAVEL',
          valor: null,
        });
      });

      it('colunas de ST são NÃO APLICÁVEIS numa operação sem ST', () => {
        const linhas = projetarResumoLivro([
          {
            chave: 'S',
            itens: [
              {
                cstIcms: '00',
                origemMercadoria: '0',
                cfop: '1102',
                aliquotaIcms: '18.00',
                valorBrutoProduto: '100.00',
                valorBcIcms: '100.00',
                valorIcms: '18.00',
              },
            ],
          },
        ]);
        expect(linhas[0].valorBcIcmsSt).toEqual({
          estado: 'NAO_APLICAVEL',
          valor: null,
        });
        expect(linhas[0].valorIcmsSt).toEqual({
          estado: 'NAO_APLICAVEL',
          valor: null,
        });
      });

      it('ST informada numa operação com ST é INFORMADO (inclusive 0.00)', () => {
        const linhas = projetarResumoLivro([
          {
            chave: 'T',
            itens: [
              {
                cstIcms: '10',
                origemMercadoria: '0',
                cfop: '1403',
                aliquotaIcms: '18.00',
                valorBrutoProduto: '100.00',
                valorBcIcms: '100.00',
                valorIcms: '18.00',
                valorBcIcmsSt: '120.00',
                valorIcmsSt: '3.60',
              },
            ],
          },
        ]);
        expect(linhas[0].valorIcmsSt).toEqual({
          estado: 'INFORMADO',
          valor: '3.60',
        });
      });

      it('os três estados NUNCA são impressos como 0.00 implícito: null quando não INFORMADO', () => {
        // Varre todas as linhas do snapshot e garante que o invariante vale: um
        // valor só é string decimal quando INFORMADO; caso contrário é null.
        const linhas = projetarResumoLivro(snapshots().documentos);
        const colunas = [
          'valorOperacao',
          'valorBcIcms',
          'valorIcms',
          'valorBcIcmsSt',
          'valorIcmsSt',
          'valorReducaoBc',
          'valorIpi',
        ] as const;
        for (const linha of linhas) {
          for (const coluna of colunas) {
            const campo = linha[coluna];
            if (campo.estado === 'INFORMADO') {
              expect(typeof campo.valor).toBe('string');
            } else {
              // NÃO INFORMADO / NÃO APLICÁVEL: nunca um 0.00 (sempre null).
              expect(campo.valor).toBeNull();
            }
          }
        }
      });
    });
  });

  describe('APURAÇÃO (parcelas/ajustes/saldos, R4.1) reusa o contrato', () => {
    it('totais/memorias/saldoDevedor são os do projetor (sem recálculo)', () => {
      const livros = projetarLivros(registro(), snapshots());
      const apuracao = projetarResultadoApuracao(registro(), snapshots());
      expect(livros.apuracao.totais).toEqual(apuracao.totais);
      expect(livros.apuracao.memorias).toEqual(apuracao.memorias);
      expect(livros.apuracao.saldoDevedorApurado).toEqual(
        apuracao.saldoDevedorApurado,
      );
    });

    it('o saldo devedor é informação de apuração, nunca guia automática (R2.5)', () => {
      const livros = projetarLivros(registro(), snapshots());
      expect(livros.apuracao.saldoDevedorApurado.natureza).toBe('APURACAO');
      expect(livros.apuracao.saldoDevedorApurado.guiaAutomatica).toBe(false);
      expect(livros.apuracao.saldoDevedorApurado.exigeEmissaoDeliberada).toBe(
        true,
      );
    });

    it('distingue zero de não informado nas memórias (R4.2)', () => {
      const livros = projetarLivros(registro(), snapshots());
      const ajuste = livros.apuracao.memorias.find(
        (m) => m.codigo === 'ajustesDebitos',
      );
      expect(ajuste?.origem).toBe('PADRAO_ZERO');
      const debitos = livros.apuracao.memorias.find(
        (m) => m.codigo === 'debitos',
      );
      expect(debitos?.origem).toBe('INFORMADO');
    });

    describe('tri-estado nas linhas de apuração (R4.2)', () => {
      it('total informado vira INFORMADO com o valor (zero legítimo incluso)', () => {
        const livros = projetarLivros(registro(), snapshots());
        const debitos = livros.apuracao.linhas.find(
          (l) => l.codigo === 'debitos',
        );
        expect(debitos?.valor).toEqual({ estado: 'INFORMADO', valor: '45.09' });
      });

      it('total ausente (PADRAO_ZERO) vira NÃO INFORMADO, nunca 0.00', () => {
        const livros = projetarLivros(registro(), snapshots());
        const ajuste = livros.apuracao.linhas.find(
          (l) => l.codigo === 'ajustesDebitos',
        );
        expect(ajuste?.valor).toEqual({ estado: 'NAO_INFORMADO', valor: null });
      });

      it('um zero INFORMADO no snapshot é distinto de um ausente', () => {
        // `deducoes` informado explicitamente como 0.00 → ZERO legítimo
        // (INFORMADO), enquanto `ajustesCreditos` ausente → NÃO INFORMADO.
        const livros = projetarLivros(
          registro(),
          snapshots({
            saldos: {
              debitos: '45.09',
              creditos: '18.00',
              saldoApurado: '27.09',
              icmsRecolher: '27.09',
              deducoes: '0.00',
            },
          }),
        );
        const deducoes = livros.apuracao.linhas.find(
          (l) => l.codigo === 'deducoes',
        );
        expect(deducoes?.valor).toEqual({ estado: 'INFORMADO', valor: '0.00' });
        const ajustesCreditos = livros.apuracao.linhas.find(
          (l) => l.codigo === 'ajustesCreditos',
        );
        expect(ajustesCreditos?.valor).toEqual({
          estado: 'NAO_INFORMADO',
          valor: null,
        });
      });

      it('toda linha NÃO INFORMADA tem valor null (nunca um 0.00 implícito)', () => {
        const livros = projetarLivros(registro(), snapshots());
        for (const linha of livros.apuracao.linhas) {
          if (linha.valor.estado === 'INFORMADO') {
            expect(typeof linha.valor.valor).toBe('string');
          } else {
            expect(linha.valor.valor).toBeNull();
          }
        }
      });
    });
  });

  describe('reprodutibilidade (F20)', () => {
    it('os mesmos snapshots produzem o mesmo livro', () => {
      const a: LivrosProjecao = projetarLivros(registro(), snapshots());
      const b: LivrosProjecao = projetarLivros(registro(), snapshots());
      expect(a).toEqual(b);
    });
  });
});
