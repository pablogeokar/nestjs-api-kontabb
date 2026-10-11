import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Suíte de verificação em CAMADAS — consolidação do §11.1 (F22, tarefa 3.1,
 * requisito R3.1).
 *
 * O plano (§11.1) exige que a conformidade fiscal seja comprovada por SETE
 * camadas de verificação independentes, não por uma só. As camadas já existem,
 * dispersas pela suíte; o que faltava era um ARTEFATO AUDITÁVEL que amarre cada
 * camada aos testes que a cobrem e que FALHE se uma camada perder sua cobertura
 * representativa (um arquivo renomeado/removido derruba este spec, sinalizando
 * a regressão de cobertura — não um "verde" silencioso).
 *
 * Este spec NÃO reimplementa as camadas: ele as MAPEIA e verifica a presença da
 * cobertura. A verificação de comportamento de cada camada é feita pelos
 * próprios specs referenciados, que rodam na mesma execução de `jest`.
 *
 * Mapeamento §11.1 (as 7 camadas) → testes que as cobrem
 * ---------------------------------------------------------------------------
 *  1. Funções puras            — regras/cálculos sem I/O, por tabela/caso.
 *  2. Integração PostgreSQL    — constraints/locks/concorrência/trilha sobre o
 *                                store com a superfície drizzle real.
 *  3. Contrato HTTP            — auth/escopo/DTO/envelope/mensagens/arquivo.
 *  4. UI                       — componente real + CSS compilado (web/e2e).
 *  5. Arquivo                  — fixtures normativas escritas à mão + mutação
 *                                deliberada de posição.
 *  6. PVA                      — preflight que antecipa as rejeições do PVA.
 *  7. Conciliação fiscal       — ponte apuração → livro → arquivo (amostra).
 *
 * Cada entrada abaixo lista arquivos REPRESENTATIVOS (não exaustivos) da camada.
 * Caminhos `web/` apontam para a suíte Playwright do app, fora do `rootDir` do
 * jest da API (a camada de UI roda no `web`, por `pnpm exec playwright test`).
 */

const API_FISCAL = __dirname;
const WEB_ROOT = join(API_FISCAL, '..', '..', '..', 'web');

interface Camada {
  /** 1..7, na ordem do §11.1. */
  numero: number;
  nome: string;
  /** Arquivos representativos relativos a `base`. */
  representantes: string[];
  /** Raiz dos caminhos: API fiscal (padrão) ou o app web (camada de UI). */
  base?: 'api' | 'web';
}

const CAMADAS_11_1: Camada[] = [
  {
    numero: 1,
    nome: 'Funções puras',
    representantes: [
      'services/cfop.service.spec.ts',
      'services/cst-catalogo.spec.ts',
      'services/difal-calculador.spec.ts',
      'services/pis-cofins-saldo.spec.ts',
      'services/fiscal-leiaute-vigencia.spec.ts',
    ],
  },
  {
    numero: 2,
    nome: 'Integração PostgreSQL (constraints/locks/concorrência/trilha)',
    representantes: [
      'services/fiscal-guias-conciliacao.integration.spec.ts',
      'services/fiscal-entregas.integration.spec.ts',
      'services/fiscal-item-reconciliation.integration.spec.ts',
    ],
  },
  {
    numero: 3,
    nome: 'Contrato HTTP (auth/escopo/DTO/envelope/mensagens/arquivo)',
    representantes: [
      'controllers/fiscal-apuracao.controller.spec.ts',
      'sped/sped-efd.controller.spec.ts',
    ],
  },
  {
    numero: 4,
    nome: 'UI (fluxo real, componente + CSS compilado)',
    base: 'web',
    representantes: ['tests/e2e/fiscal-classificacao.spec.ts'],
  },
  {
    numero: 5,
    nome: 'Arquivo (fixtures normativas + mutação de posição)',
    representantes: [
      'sped/efd-icms-ipi.fixtures-normativas.spec.ts',
      'sped/efd-icms-ipi.bloco-g.fixtures-normativas.spec.ts',
      'sped/efd-icms-ipi.bloco-g.mutacao-posicao.spec.ts',
      'sped/efd-icms-ipi.cfop-dominio.fixtures-normativas.spec.ts',
      'sped/efd-icms-ipi.c190.mutacao-posicao.spec.ts',
    ],
  },
  {
    numero: 6,
    nome: 'PVA (preflight por UF/perfil/regime)',
    representantes: ['sped/sped-preflight-pva.spec.ts'],
  },
  {
    numero: 7,
    nome: 'Conciliação fiscal (apuração → livro → arquivo)',
    representantes: [
      'services/conciliacao-ponte.spec.ts',
      'services/fiscal-item-reconciliation.spec.ts',
    ],
  },
];

function caminhoAbsoluto(camada: Camada, representante: string): string {
  return camada.base === 'web'
    ? join(WEB_ROOT, representante)
    : join(API_FISCAL, representante);
}

describe('§11.1 — suíte de verificação em 7 camadas (R3.1)', () => {
  it('declara exatamente as 7 camadas do §11.1, numeradas 1..7 sem lacunas', () => {
    expect(CAMADAS_11_1).toHaveLength(7);
    expect(CAMADAS_11_1.map((c) => c.numero)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it.each(CAMADAS_11_1)(
    'camada $numero ($nome) tem cobertura representativa presente',
    (camada: Camada) => {
      expect(camada.representantes.length).toBeGreaterThan(0);
      const ausentes = camada.representantes.filter(
        (rep) => !existsSync(caminhoAbsoluto(camada, rep)),
      );
      // Lista os ausentes na mensagem para apontar a regressão de cobertura.
      expect(ausentes).toEqual([]);
    },
  );

  it('cada camada tem ao menos um representante — nenhuma camada vazia', () => {
    for (const camada of CAMADAS_11_1) {
      expect(camada.representantes.length).toBeGreaterThanOrEqual(1);
    }
  });
});
