import {
  analisarBloqueioCenarioSt,
  guardarFcpNaoGenerico,
  aplicarBloqueioSt,
  ST_BLOQUEIO_CODIGOS,
  type StBloqueioCenarioInput,
  type FcpGuardaInput,
} from './st-bloqueio';
import type { SpedInconsistencia } from './sped-efd.types';
import type { StVerificacaoStatus } from '../services/st-verificacao';
import type { StEnquadramentoStatus } from '../services/st-enquadramento';
import type { StCalculoStatus } from '../services/st-calculador';

const contexto = {
  uf: 'sp',
  competencia: '2026-09',
  documentoId: 'doc-1',
  numeroDocumento: '123',
  chaveAcesso: '3526...',
};

function cenario(
  overrides: Partial<StBloqueioCenarioInput> = {},
): StBloqueioCenarioInput {
  return {
    contexto,
    verificacao: 'VERIFICADO',
    enquadramento: 'SUJEITO',
    calculo: 'CALCULADO',
    ...overrides,
  };
}

describe('analisarBloqueioCenarioSt (Fase 4 / tarefa 4.5 — R3.4)', () => {
  describe('fonte não verificada (portão 4.1) bloqueia a entrega', () => {
    const naoVerificados: StVerificacaoStatus[] = [
      'PENDENTE_NACIONAL',
      'PENDENTE_ESTADUAL',
    ];
    it.each(naoVerificados)(
      'verificacao %s → inconsistência ERRO FONTE_NAO_VERIFICADA',
      (verificacao) => {
        const r = analisarBloqueioCenarioSt(cenario({ verificacao }));
        expect(r.bloqueado).toBe(true);
        expect(r.inconsistencia).not.toBeNull();
        expect(r.inconsistencia!.severidade).toBe('ERRO');
        expect(r.inconsistencia!.codigo).toBe(
          ST_BLOQUEIO_CODIGOS.FONTE_NAO_VERIFICADA,
        );
        // Mensagem explicável, com UF normalizada e competência.
        expect(r.inconsistencia!.mensagem).toMatch(/ST SP \(2026-09\)/);
        expect(r.inconsistencia!.mensagem).toMatch(/BLOQUEAD/);
        // Rastreadores de documento carregados.
        expect(r.inconsistencia!.documentoId).toBe('doc-1');
        expect(r.inconsistencia!.numeroDocumento).toBe('123');
      },
    );

    it('para na verificação mesmo que enquadramento/cálculo "estariam" ok', () => {
      const r = analisarBloqueioCenarioSt(
        cenario({
          verificacao: 'PENDENTE_NACIONAL',
          enquadramento: 'SUJEITO',
          calculo: 'CALCULADO',
        }),
      );
      expect(r.inconsistencia!.codigo).toBe(
        ST_BLOQUEIO_CODIGOS.FONTE_NAO_VERIFICADA,
      );
    });
  });

  describe('enquadramento não habilita (portão 4.2) bloqueia a entrega', () => {
    const naoHabilita: StEnquadramentoStatus[] = [
      'NAO_SUJEITO',
      'PENDENCIA',
      'BLOQUEADO',
    ];
    it.each(naoHabilita)(
      'enquadramento %s → ERRO ENQUADRAMENTO_NAO_SUPORTADO',
      (enquadramento) => {
        const r = analisarBloqueioCenarioSt(
          cenario({ verificacao: 'VERIFICADO', enquadramento }),
        );
        expect(r.bloqueado).toBe(true);
        expect(r.inconsistencia!.severidade).toBe('ERRO');
        expect(r.inconsistencia!.codigo).toBe(
          ST_BLOQUEIO_CODIGOS.ENQUADRAMENTO_NAO_SUPORTADO,
        );
      },
    );
  });

  describe('cálculo não gera guia (portão 4.3) bloqueia a entrega', () => {
    const semGuia: StCalculoStatus[] = ['SIMULACAO', 'PENDENTE', 'BLOQUEADO'];
    it.each(semGuia)(
      'calculo %s → ERRO CALCULO_NAO_SUPORTADO',
      (calculo) => {
        const r = analisarBloqueioCenarioSt(
          cenario({
            verificacao: 'VERIFICADO',
            enquadramento: 'SUJEITO',
            calculo,
          }),
        );
        expect(r.bloqueado).toBe(true);
        expect(r.inconsistencia!.severidade).toBe('ERRO');
        expect(r.inconsistencia!.codigo).toBe(
          ST_BLOQUEIO_CODIGOS.CALCULO_NAO_SUPORTADO,
        );
      },
    );
  });

  it('cenário suportado em todas as camadas → não bloqueia, sem inconsistência', () => {
    const r = analisarBloqueioCenarioSt(cenario());
    expect(r.bloqueado).toBe(false);
    expect(r.inconsistencia).toBeNull();
    expect(r.motivo).toBeNull();
  });

  it('avalia só as camadas resolvidas (enquadramento/cálculo opcionais)', () => {
    // Só a verificação informada e verificada → não bloqueia.
    const r = analisarBloqueioCenarioSt({
      contexto,
      verificacao: 'VERIFICADO',
    });
    expect(r.bloqueado).toBe(false);
  });
});

describe('guardarFcpNaoGenerico (Fase 4 / tarefa 4.5 — R3.6)', () => {
  function fcp(overrides: Partial<FcpGuardaInput> = {}): FcpGuardaInput {
    return {
      contexto,
      aliquotaFcp: '2.0000',
      fcpStComponente: '20.00',
      tentandoAjusteGenerico: false,
      ...overrides,
    };
  }

  it('FCP homologado como componente próprio é válido (sem recusa)', () => {
    const r = guardarFcpNaoGenerico(fcp());
    expect(r.fcpComponenteValido).toBe(true);
    expect(r.ajusteGenericoRecusado).toBe(false);
    expect(r.inconsistencia).toBeNull();
  });

  it('componente inválido quando não há alíquota homologada', () => {
    const r = guardarFcpNaoGenerico(
      fcp({ aliquotaFcp: null, fcpStComponente: '20.00' }),
    );
    expect(r.fcpComponenteValido).toBe(false);
    expect(r.ajusteGenericoRecusado).toBe(false);
  });

  it('componente inválido quando o valor de FCP-ST é zero', () => {
    const r = guardarFcpNaoGenerico(fcp({ fcpStComponente: '0.00' }));
    expect(r.fcpComponenteValido).toBe(false);
  });

  it('RECUSA ajuste genérico quando NÃO há regra de FCP homologada (R3.6)', () => {
    const r = guardarFcpNaoGenerico(
      fcp({
        aliquotaFcp: null,
        fcpStComponente: '0.00',
        tentandoAjusteGenerico: true,
      }),
    );
    expect(r.ajusteGenericoRecusado).toBe(true);
    expect(r.inconsistencia!.severidade).toBe('ERRO');
    expect(r.inconsistencia!.codigo).toBe(
      ST_BLOQUEIO_CODIGOS.FCP_AJUSTE_GENERICO_RECUSADO,
    );
    expect(r.inconsistencia!.mensagem).toMatch(/não há regra de FCP/);
    expect(r.inconsistencia!.mensagem).toMatch(/R3\.6/);
  });

  it('RECUSA ajuste genérico mesmo com FCP homologado — FCP é componente, não ajuste', () => {
    const r = guardarFcpNaoGenerico(
      fcp({ tentandoAjusteGenerico: true }),
    );
    expect(r.ajusteGenericoRecusado).toBe(true);
    expect(r.inconsistencia!.codigo).toBe(
      ST_BLOQUEIO_CODIGOS.FCP_AJUSTE_GENERICO_RECUSADO,
    );
    expect(r.inconsistencia!.mensagem).toMatch(/componente próprio/);
  });
});

describe('aplicarBloqueioSt (Fase 4 / tarefa 4.5): costura o padrão da Fase 0', () => {
  it('empurra a inconsistência de cenário e marca bloqueado', () => {
    const inconsistencias: SpedInconsistencia[] = [];
    const r = aplicarBloqueioSt(
      cenario({ verificacao: 'PENDENTE_ESTADUAL' }),
      inconsistencias,
    );
    expect(r.bloqueado).toBe(true);
    expect(inconsistencias).toHaveLength(1);
    expect(inconsistencias[0].severidade).toBe('ERRO');
    expect(inconsistencias[0].codigo).toBe(
      ST_BLOQUEIO_CODIGOS.FONTE_NAO_VERIFICADA,
    );
  });

  it('empurra tanto o bloqueio do cenário quanto a recusa de FCP', () => {
    const inconsistencias: SpedInconsistencia[] = [];
    const r = aplicarBloqueioSt(
      {
        ...cenario({ calculo: 'PENDENTE' }),
        fcp: {
          aliquotaFcp: null,
          fcpStComponente: '0.00',
          tentandoAjusteGenerico: true,
        },
      },
      inconsistencias,
    );
    expect(r.bloqueado).toBe(true);
    const codigos = inconsistencias.map((i) => i.codigo);
    expect(codigos).toContain(ST_BLOQUEIO_CODIGOS.CALCULO_NAO_SUPORTADO);
    expect(codigos).toContain(
      ST_BLOQUEIO_CODIGOS.FCP_AJUSTE_GENERICO_RECUSADO,
    );
    expect(inconsistencias.every((i) => i.severidade === 'ERRO')).toBe(true);
  });

  it('cenário suportado e sem tentativa de ajuste genérico → nada empurrado', () => {
    const inconsistencias: SpedInconsistencia[] = [];
    const r = aplicarBloqueioSt(
      {
        ...cenario(),
        fcp: {
          aliquotaFcp: '2.0000',
          fcpStComponente: '20.00',
          tentandoAjusteGenerico: false,
        },
      },
      inconsistencias,
    );
    expect(r.bloqueado).toBe(false);
    expect(inconsistencias).toHaveLength(0);
  });
});
