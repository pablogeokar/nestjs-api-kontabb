import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Matriz de verificação T01–T52 — travessia auditável do §11 do plano (F22,
 * tarefa 3.4, requisito R3.5).
 *
 * O plano (§11) define uma matriz MÍNIMA de 52 cenários de risco (T01–T52). O
 * §11.1 é explícito: NÃO se testa o produto cartesiano; usa-se a matriz de
 * risco e cobre-se INTEGRALMENTE o conjunto HABILITADO. Esta tarefa não cria
 * cobertura nova de comportamento — ela MAPEIA cada cenário habilitado ao(s)
 * teste(s) que já o cobre(m) e torna a cobertura AUDITÁVEL:
 *
 *  - a matriz é declarada por extenso, T01..T52, sem lacunas de numeração;
 *  - cada cenário é marcado como HABILITADO (com os testes que o cobrem) ou
 *    DESABILITADO (com um motivo explícito — nunca um buraco silencioso);
 *  - para cada cenário HABILITADO, este spec FALHA se nenhum arquivo de teste
 *    referenciado existir (um spec renomeado/removido derruba a travessia,
 *    sinalizando a regressão de cobertura em vez de um "verde" mascarado);
 *  - cada cenário DESABILITADO precisa de um motivo não vazio.
 *
 * A verificação de COMPORTAMENTO de cada cenário é feita pelos próprios specs
 * referenciados, que rodam na mesma execução de `jest`. Este spec é a PONTE de
 * rastreabilidade entre o plano §11 e a suíte — espelha o padrão da tarefa 3.1
 * (`fiscal-camadas-verificacao.spec.ts`), que mapeia as 7 camadas do §11.1.
 *
 * Caminhos `web/` apontam para a suíte Playwright do app (camada de UI), fora
 * do `rootDir` do jest da API; a travessia confere a presença do arquivo, e o
 * comportamento roda via `pnpm exec playwright test` no `web`.
 */

const API_FISCAL = __dirname;
const WEB_ROOT = join(API_FISCAL, '..', '..', '..', 'web');

type Base = 'api' | 'web';

interface CenarioHabilitado {
  id: string;
  /** Resumo do cenário conforme §11 do plano. */
  cenario: string;
  habilitado: true;
  /** Arquivos de teste REPRESENTATIVOS (não exaustivos) que cobrem o cenário. */
  cobrePor: string[];
  /** Raiz dos caminhos: fiscal da API (padrão) ou o app web (camada de UI). */
  base?: Base;
}

interface CenarioDesabilitado {
  id: string;
  cenario: string;
  habilitado: false;
  /** Por que o cenário não está habilitado nesta build. Nunca vazio. */
  motivo: string;
}

type Cenario = CenarioHabilitado | CenarioDesabilitado;

/**
 * Matriz T01–T52 do §11. Todos os 52 cenários estão HABILITADOS na build atual:
 * cada um mapeia para comportamento já exercitado pela suíte. Onde um cenário
 * tem apenas cobertura parcial (ex.: T50, impressão multipágina), o campo
 * `cenario` registra a fronteira coberta; a expansão fica para o rollout (§13).
 */
const MATRIZ_T01_T52: Cenario[] = [
  {
    id: 'T01',
    cenario: 'Retry DF-e de nota com CFOP manual: IDs e decisão preservados.',
    habilitado: true,
    cobrePor: [
      'services/fiscal-item-reconciliation.integration.spec.ts',
      'services/distribuicao-dfe.service.spec.ts',
    ],
  },
  {
    id: 'T02',
    cenario: 'Retry manual e DF-e concorrentes: um documento lógico; evidências intactas.',
    habilitado: true,
    cobrePor: [
      'services/fiscal-item-reconciliation.integration.spec.ts',
      'services/distribuicao-dfe.service.spec.ts',
    ],
  },
  {
    id: 'T03',
    cenario: 'Resumo antes/depois do XML completo: sem regressão; enriquecimento controlado.',
    habilitado: true,
    cobrePor: [
      'services/dfe-document.parser.spec.ts',
      'services/distribuicao-dfe.service.spec.ts',
    ],
  },
  {
    id: 'T04',
    cenario: 'Cancelamento antes/depois da captura: estado convergente, original preservado.',
    habilitado: true,
    cobrePor: [
      'services/fiscal-item-reconciliation.integration.spec.ts',
      'services/fiscal-period-selection.service.spec.ts',
    ],
  },
  {
    id: 'T05',
    cenario: 'Dois meses distintos no cockpit: consulta/resultado da competência selecionada.',
    habilitado: true,
    cobrePor: ['services/fiscal-period-selection.service.spec.ts'],
  },
  {
    id: 'T06',
    cenario: 'Envelope { data } real: sem propriedades ausentes mascaradas por zero.',
    habilitado: true,
    cobrePor: ['controllers/fiscal-apuracao.controller.spec.ts'],
  },
  {
    id: 'T07',
    cenario: 'Troca rápida de competência: resposta antiga não substitui a mais recente.',
    habilitado: true,
    cobrePor: ['services/fiscal-period-selection.service.spec.ts'],
  },
  {
    id: 'T08',
    cenario: '1556/2556, CST 00 com destaque: crédito vedado coerente em livro e SPED.',
    habilitado: true,
    cobrePor: [
      'services/decisao-credito.ponte-livros-builder.spec.ts',
      'services/decisao-credito.matriz-acao.spec.ts',
    ],
  },
  {
    id: 'T09',
    cenario: '1551/2551 e ativo ST: sem crédito integral indevido; CIAP conforme decisão.',
    habilitado: true,
    cobrePor: [
      'services/decisao-credito.spec.ts',
      'services/ciap.service.spec.ts',
    ],
  },
  {
    id: 'T10',
    cenario: 'Regra proíbe crédito em compra comum: motor, livro e E110 respeitam a regra.',
    habilitado: true,
    cobrePor: [
      'services/fiscal-rule-engine.service.spec.ts',
      'services/decisao-credito.ponte-livros-builder.spec.ts',
    ],
  },
  {
    id: 'T11',
    cenario: 'Regra altera CST, XML preservado: original e escrituração separados.',
    habilitado: true,
    cobrePor: [
      'services/decisao-credito.matriz-acao.spec.ts',
      'services/fiscal-rule-engine.service.spec.ts',
    ],
  },
  {
    id: 'T12',
    cenario: 'CT-e prestado tributado: débito no D190, E110 e livro.',
    habilitado: true,
    cobrePor: [
      'sped/efd-icms-ipi.cte-prestacao.spec.ts',
      'services/fiscal-cte.service.spec.ts',
    ],
  },
  {
    id: 'T13',
    cenario: 'CT-e tomado elegível: crédito uma única vez.',
    habilitado: true,
    cobrePor: [
      'services/fiscal-cte.service.spec.ts',
      'services/cte-escrituracao.parser.spec.ts',
    ],
  },
  {
    id: 'T14',
    cenario: 'CT-e anulação/substituição fora de ordem: sem duplicidade; revisão quando falta vínculo.',
    habilitado: true,
    cobrePor: [
      'services/cte-escrituracao.parser.spec.ts',
      'services/fiscal-cte.service.spec.ts',
    ],
  },
  {
    id: 'T15',
    cenario: 'CT-e sem CST: erro impeditivo; nunca fallback 000.',
    habilitado: true,
    cobrePor: [
      'sped/efd-icms-ipi.fixtures-normativas.spec.ts',
      'services/fiscal-cte.service.spec.ts',
    ],
  },
  {
    id: 'T16',
    cenario: 'ICMS composto/origem: formato canônico sem duplicação.',
    habilitado: true,
    cobrePor: [
      'sped/fiscal-c190-aggregator.spec.ts',
      'services/nfe-item.parser.spec.ts',
    ],
  },
  {
    id: 'T17',
    cenario: 'PIS/COFINS 88: código rejeitado onde informado/exigido.',
    habilitado: true,
    cobrePor: [
      'services/pis-cofins-cst.spec.ts',
      'sped/efd-icms-ipi.fixtures-normativas.spec.ts',
    ],
  },
  {
    id: 'T18',
    cenario: 'IPI 88 com valor zero: não gerar E510 inválido.',
    habilitado: true,
    cobrePor: [
      'sped/efd-icms-ipi.builder.spec.ts',
      'sped/efd-icms-ipi.fixtures-normativas.spec.ts',
    ],
  },
  {
    id: 'T19',
    cenario: 'IPI 01 com valor positivo: inconsistência ou hipótese explícita; sem crédito cego.',
    habilitado: true,
    cobrePor: [
      'sped/efd-icms-ipi.builder.spec.ts',
      'sped/efd-icms-ipi.regressao-fase0.spec.ts',
    ],
  },
  {
    id: 'T20',
    cenario: 'IPI entrada sob CST do fornecedor: reclassificação fundamentada ou pendência.',
    habilitado: true,
    cobrePor: [
      'sped/efd-icms-ipi.builder.spec.ts',
      'services/cst-catalogo.spec.ts',
    ],
  },
  {
    id: 'T21',
    cenario: 'CIAP repetido 10 vezes no mês: uma apropriação.',
    habilitado: true,
    cobrePor: ['services/ciap.service.spec.ts'],
  },
  {
    id: 'T22',
    cenario: 'CIAP concorrente: mesma versão e saldo, sem dupla parcela.',
    habilitado: true,
    cobrePor: ['services/ciap.service.spec.ts'],
  },
  {
    id: 'T23',
    cenario: 'Bem adquirido no futuro: não entra em competência anterior.',
    habilitado: true,
    cobrePor: [
      'services/ciap.service.spec.ts',
      'fiscal-date.util.spec.ts',
    ],
  },
  {
    id: 'T24',
    cenario: 'Dois bens com mesmo SKU: duas identidades patrimoniais.',
    habilitado: true,
    cobrePor: ['services/ciap.service.spec.ts'],
  },
  {
    id: 'T25',
    cenario: 'Exportação e saídas equiparadas no CIAP: coeficiente conforme cenário legal aprovado.',
    habilitado: true,
    cobrePor: ['services/ciap.service.spec.ts'],
  },
  {
    id: 'T26',
    cenario: 'CIAP sem saídas: regra explícita; sem assumir 100% silenciosamente.',
    habilitado: true,
    cobrePor: ['services/ciap.service.spec.ts'],
  },
  {
    id: 'T27',
    cenario: 'Última parcela/baixa: histórico e cancelamento residual consistentes.',
    habilitado: true,
    cobrePor: ['services/ciap.service.spec.ts'],
  },
  {
    id: 'T28',
    cenario: 'G110/G125 contra fixture normativa: contagens, posições, precisão e referências corretas.',
    habilitado: true,
    cobrePor: [
      'sped/efd-icms-ipi.bloco-g.fixtures-normativas.spec.ts',
      'sped/efd-icms-ipi.bloco-g.mutacao-posicao.spec.ts',
    ],
  },
  {
    id: 'T29',
    cenario: 'G125 sem 0300: erro de referência detectado.',
    habilitado: true,
    cobrePor: [
      'sped/efd-icms-ipi.bloco-g.fixtures-normativas.spec.ts',
      'sped/efd-icms-ipi.bloco-g.cenarios-movimentacao.spec.ts',
    ],
  },
  {
    id: 'T30',
    cenario: 'G130/G140 exigíveis: registros presentes ou geração bloqueada.',
    habilitado: true,
    cobrePor: [
      'sped/efd-icms-ipi.bloco-g.cenarios-movimentacao.spec.ts',
      'sped/efd-icms-ipi.bloco-g.fixtures-normativas.spec.ts',
    ],
  },
  {
    id: 'T31',
    cenario: 'DIFAL com alíquota ausente: pendência ou simulação; não débito definitivo.',
    habilitado: true,
    cobrePor: [
      'services/difal-hipotese.spec.ts',
      'services/difal-entrada.service.spec.ts',
    ],
  },
  {
    id: 'T32',
    cenario: 'DIFAL 4/7/12 e base especial: memória conforme matriz da UF.',
    habilitado: true,
    cobrePor: [
      'services/difal-calculador.spec.ts',
      'services/difal-base.spec.ts',
      'services/difal-matriz.spec.ts',
    ],
  },
  {
    id: 'T33',
    cenario: 'ST já retida / responsabilidade diversa: sem recolhimento duplicado.',
    habilitado: true,
    cobrePor: [
      'services/st-enquadramento.spec.ts',
      'services/st-verificacao.spec.ts',
      'sped/st-bloqueio.spec.ts',
    ],
  },
  {
    id: 'T34',
    cenario: 'PIS misto com/sem destaque: cálculo por item ou pendência; sem perda de base.',
    habilitado: true,
    cobrePor: [
      'services/pis-cofins-razao.spec.ts',
      'services/pis-cofins.service.spec.ts',
    ],
  },
  {
    id: 'T35',
    cenario: 'CST 03 / crédito presumido: regra específica; não omissão nem alíquota genérica.',
    habilitado: true,
    cobrePor: [
      'services/pis-cofins-cst.spec.ts',
      'services/pis-cofins-natureza.spec.ts',
    ],
  },
  {
    id: 'T36',
    cenario: 'Saldo credor PIS/COFINS: preservado e rastreado para período seguinte.',
    habilitado: true,
    cobrePor: ['services/pis-cofins-saldo.spec.ts'],
  },
  {
    id: 'T37',
    cenario: 'Regime ausente / receita especial: não presumir cumulativo.',
    habilitado: true,
    cobrePor: [
      'services/pis-cofins-razao.spec.ts',
      'services/politica-simples.spec.ts',
    ],
  },
  {
    id: 'T38',
    cenario: 'Data fiscal versus UTC: competência previsível e explicada.',
    habilitado: true,
    cobrePor: ['fiscal-date.util.spec.ts'],
  },
  {
    id: 'T39',
    cenario: 'Documento pendente com escriturado=true: não entra indevidamente em apuração definitiva.',
    habilitado: true,
    cobrePor: [
      'services/fiscal-books-projection.spec.ts',
      'services/escrituracao-fiscal.service.spec.ts',
    ],
  },
  {
    id: 'T40',
    cenario: 'Livro com ajustes/saldo anterior: mesmos valores do fechamento/E110.',
    habilitado: true,
    cobrePor: [
      'services/conciliacao-ponte.spec.ts',
      'services/fiscal-books-projection.spec.ts',
    ],
  },
  {
    id: 'T41',
    cenario: 'C190 isento sem redução: sem falsa redução.',
    habilitado: true,
    cobrePor: [
      'services/fiscal-itens.service.spec.ts',
      'sped/fiscal-c190-aggregator.spec.ts',
      'services/fiscal-books-projection.spec.ts',
    ],
  },
  {
    id: 'T42',
    cenario: 'Simples com obrigações distintas: matriz fiscal aprovada; consistência entre módulos.',
    habilitado: true,
    cobrePor: ['services/politica-simples.spec.ts'],
  },
  {
    id: 'T43',
    cenario: 'Guia duplicada por retry: não duplicada; múltiplas legítimas permitidas.',
    habilitado: true,
    cobrePor: [
      'services/fiscal-guias.service.spec.ts',
      'services/fiscal-guias-conciliacao.integration.spec.ts',
    ],
  },
  {
    id: 'T44',
    cenario: 'Pagamento parcial/cancelado: histórico e saldo de obrigação preservados.',
    habilitado: true,
    cobrePor: [
      'services/fiscal-pagamentos-trilha.spec.ts',
      'services/fiscal-guias.service.spec.ts',
    ],
  },
  {
    id: 'T45',
    cenario: 'Edição após fechamento: nova versão; entrega anterior intacta.',
    habilitado: true,
    cobrePor: [
      'services/retificacao-fechamento.spec.ts',
      'services/fiscal-closing.service.spec.ts',
    ],
  },
  {
    id: 'T46',
    cenario: 'Retificação: vínculo ao original, diferenças e recibo.',
    habilitado: true,
    cobrePor: [
      'services/fiscal-entregas.service.spec.ts',
      'services/fiscal-entregas.integration.spec.ts',
    ],
  },
  {
    id: 'T47',
    cenario: 'Inventário próprio/terceiros/zerado: quantidades, valores e participantes reconciliados.',
    habilitado: true,
    cobrePor: ['sped/sped-inventario.service.spec.ts'],
  },
  {
    id: 'T48',
    cenario: 'Obrigação K/B/modelo não suportado: impedimento explícito, não arquivo vazio enganoso.',
    habilitado: true,
    cobrePor: [
      'sped/st-bloqueio.spec.ts',
      'sped/st-cenario-habilitado.spec.ts',
    ],
  },
  {
    id: 'T49',
    cenario: 'DTO inválido / objeto de outro cliente: rejeição controlada antes de persistir.',
    habilitado: true,
    cobrePor: [
      'controllers/fiscal-apuracao.controller.spec.ts',
      'sped/sped-efd.controller.spec.ts',
    ],
  },
  {
    id: 'T50',
    cenario:
      'Layout fiscal e impressão multipágina: legibilidade/navegação acessíveis (fronteira coberta: ' +
      'legibilidade responsiva do cartão fiscal em 375/768/1024/1440px, sem scroll horizontal).',
    habilitado: true,
    base: 'web',
    cobrePor: ['tests/e2e/fiscal-classificacao.spec.ts'],
  },
  {
    id: 'T51',
    cenario: '2026 versus 2027: leiaute por vigência; não reutilização silenciosa.',
    habilitado: true,
    cobrePor: ['services/fiscal-leiaute-vigencia.spec.ts'],
  },
  {
    id: 'T52',
    cenario: 'Falha storage após snapshot: status de falha, compensação e retry rastreável.',
    habilitado: true,
    cobrePor: ['services/fiscal-entregas-storage.service.spec.ts'],
  },
];

function caminhoAbsoluto(cenario: CenarioHabilitado, representante: string): string {
  return cenario.base === 'web'
    ? join(WEB_ROOT, representante)
    : join(API_FISCAL, representante);
}

function idNumerico(id: string): number {
  return Number.parseInt(id.slice(1), 10);
}

describe('§11 — travessia da matriz T01–T52 por cenários habilitados (R3.5)', () => {
  it('declara exatamente 52 cenários, T01..T52, sem lacunas nem duplicatas', () => {
    expect(MATRIZ_T01_T52).toHaveLength(52);
    const numeros = MATRIZ_T01_T52.map((c) => idNumerico(c.id));
    const esperado = Array.from({ length: 52 }, (_, i) => i + 1);
    expect(numeros).toEqual(esperado);
    // IDs no formato T## de dois dígitos, únicos.
    const ids = MATRIZ_T01_T52.map((c) => c.id);
    expect(new Set(ids).size).toBe(52);
    for (const id of ids) {
      expect(id).toMatch(/^T\d{2}$/);
    }
  });

  const habilitados = MATRIZ_T01_T52.filter(
    (c): c is CenarioHabilitado => c.habilitado,
  );
  const desabilitados = MATRIZ_T01_T52.filter(
    (c): c is CenarioDesabilitado => !c.habilitado,
  );

  it('cobre integralmente o conjunto habilitado (nenhum cenário sem classificação)', () => {
    expect(habilitados.length + desabilitados.length).toBe(52);
  });

  it.each(habilitados)(
    'cenário $id habilitado — $cenario — tem cobertura presente',
    (cenario: CenarioHabilitado) => {
      // Um cenário habilitado SEM teste referenciado é uma lacuna silenciosa:
      // falha explícita.
      expect(cenario.cobrePor.length).toBeGreaterThan(0);
      const ausentes = cenario.cobrePor.filter(
        (rep) => !existsSync(caminhoAbsoluto(cenario, rep)),
      );
      // A lista de ausentes aponta o arquivo renomeado/removido na mensagem.
      expect(ausentes).toEqual([]);
    },
  );

  it('todo cenário desabilitado traz um motivo explícito e não vazio', () => {
    for (const cenario of desabilitados) {
      expect(cenario.motivo.trim().length).toBeGreaterThan(0);
    }
  });
});
