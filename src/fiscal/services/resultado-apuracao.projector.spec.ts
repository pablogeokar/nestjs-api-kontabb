import {
  projetarDetalhamento,
  projetarResultadoApuracao,
  projetarSaldoDevedorApurado,
  type FechamentoSnapshots,
} from './resultado-apuracao.projector';
import type { FechamentoRegistro } from './fiscal-closing.service';
import type { TipoGuia } from './fiscal-guias.service';
import type { ResultadoApuracaoTotais } from './resultado-apuracao.contract';

function registro(
  overrides: Partial<FechamentoRegistro> = {},
): FechamentoRegistro {
  return {
    id: 'f1',
    clienteId: 'c1',
    obrigacao: 'EFD_ICMS_IPI',
    competencia: '2026-09-01',
    versao: 2,
    estado: 'FECHADO',
    corrente: true,
    motorVersao: 'fase3-fechamento@1',
    hashEntradas: 'a'.repeat(64),
    aprovadoPor: 'u1',
    fechadoEm: new Date('2026-10-01T00:00:00Z'),
    ...overrides,
  };
}

/** Snapshots de exemplo com valores monetários sempre como STRINGS decimais. */
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
      },
      {
        chave: 'B',
        numeroDocumento: '2',
        participante: 'Cliente Y',
        cfop: '5102',
        cst: '00',
        valorContabil: '250.50',
        baseIcms: '250.50',
        valorIcms: '45.09',
      },
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
    parametros: { perfil: 'A', finalidade: '0' },
    ...overrides,
  };
}

describe('resultado-apuracao.projector', () => {
  describe('projetarResultadoApuracao (R1.1 — projeção do fechamento)', () => {
    it('carrega a identificação do FechamentoRegistro sem recomputar', () => {
      const r = projetarResultadoApuracao(registro(), snapshots());
      expect(r).toMatchObject({
        clienteId: 'c1',
        obrigacao: 'EFD_ICMS_IPI',
        competencia: '2026-09-01',
        versao: 2,
        estado: 'FECHADO',
        corrente: true,
        motorVersao: 'fase3-fechamento@1',
        hashEntradas: 'a'.repeat(64),
      });
    });

    it('projeta totais informados do snapshot saldos como strings decimais', () => {
      const r = projetarResultadoApuracao(registro(), snapshots());
      expect(r.totais.debitos).toBe('45.09');
      expect(r.totais.creditos).toBe('18.00');
      expect(r.totais.saldoApurado).toBe('27.09');
      expect(r.totais.icmsRecolher).toBe('27.09');
    });

    it('distingue zero de não informado: ausente vira PADRAO_ZERO (R4.2)', () => {
      const r = projetarResultadoApuracao(registro(), snapshots());
      // `ajustesDebitos` não está no snapshot → zero por padrão, origem marcada.
      expect(r.totais.ajustesDebitos).toBe('0.00');
      const memAjuste = r.memorias.find((m) => m.codigo === 'ajustesDebitos');
      expect(memAjuste?.origem).toBe('PADRAO_ZERO');
      // `debitos` está no snapshot → origem INFORMADO.
      const memDebitos = r.memorias.find((m) => m.codigo === 'debitos');
      expect(memDebitos?.origem).toBe('INFORMADO');
      expect(memDebitos?.valor).toBe('45.09');
    });

    it('produz uma linha de memória por total (ponte auditável R2.2)', () => {
      const r = projetarResultadoApuracao(registro(), snapshots());
      expect(r.memorias).toHaveLength(12);
      expect(r.memorias.map((m) => m.codigo)).toContain(
        'saldoCredorTransportar',
      );
    });

    it('projeta inconsistências do snapshot parametros quando presentes', () => {
      const r = projetarResultadoApuracao(
        registro(),
        snapshots({
          parametros: {
            inconsistencias: [
              { codigo: 'E100', severidade: 'ERRO', mensagem: 'Falta algo' },
              { codigo: 'A200', severidade: 'AVISO', mensagem: 'Atenção' },
            ],
          },
        }),
      );
      expect(r.inconsistencias).toHaveLength(2);
      expect(r.inconsistencias[0]).toMatchObject({
        codigo: 'E100',
        severidade: 'ERRO',
      });
    });

    it('inconsistências ausentes viram lista vazia', () => {
      const r = projetarResultadoApuracao(registro(), snapshots());
      expect(r.inconsistencias).toEqual([]);
    });

    it('rejeita valor monetário Number no snapshot (decimais são strings)', () => {
      expect(() =>
        projetarResultadoApuracao(
          registro(),
          snapshots({ saldos: { debitos: 45.09 } }),
        ),
      ).toThrow(/deve ser string decimal/i);
    });
  });

  describe('saldo devedor documental não é guia automática (R2.5)', () => {
    function totais(
      overrides: Partial<ResultadoApuracaoTotais> = {},
    ): ResultadoApuracaoTotais {
      return {
        debitos: '45.09',
        creditos: '18.00',
        saldoCredorAnterior: '0.00',
        ajustesDebitos: '0.00',
        ajustesCreditos: '0.00',
        estornosCreditos: '0.00',
        estornosDebitos: '0.00',
        deducoes: '0.00',
        debitosEspeciais: '0.00',
        saldoApurado: '27.09',
        icmsRecolher: '27.09',
        saldoCredorTransportar: '0.00',
        ...overrides,
      };
    }

    it('expõe o saldo devedor como informação de APURAÇÃO, nunca como guia', () => {
      const saldo = projetarSaldoDevedorApurado(totais());
      expect(saldo.natureza).toBe('APURACAO');
      expect(saldo.valor).toBe('27.09');
      expect(saldo.possuiSaldoDevedor).toBe(true);
      // O cerne de R2.5: NÃO é uma guia automática e exige emissão deliberada.
      expect(saldo.guiaAutomatica).toBe(false);
      expect(saldo.exigeEmissaoDeliberada).toBe(true);
    });

    it('a natureza do saldo NÃO é um TipoGuia (DAE/GNRE/DARF/DAS)', () => {
      const saldo = projetarSaldoDevedorApurado(totais());
      // Um saldo apurado jamais deve ser tipado/rotulado como uma guia pagável.
      const tiposGuia: TipoGuia[] = ['DAE', 'GNRE', 'DARF', 'DAS'];
      expect(tiposGuia).not.toContain(saldo.natureza as unknown as TipoGuia);
      expect(saldo.natureza).toBe('APURACAO');
    });

    it('o rótulo deixa explícito que gerar a guia é um passo separado', () => {
      const saldo = projetarSaldoDevedorApurado(totais());
      // Não insinua "esta é a guia a pagar"; aponta a emissão como passo à parte.
      expect(saldo.rotulo).toMatch(/não é guia/i);
      expect(saldo.rotulo).toMatch(/separad|deliberad/i);
    });

    it('prioriza icmsRecolher como o valor documental a recolher', () => {
      // saldoApurado e icmsRecolher divergem: o recolher manda (é o marcado).
      const saldo = projetarSaldoDevedorApurado(
        totais({ saldoApurado: '30.00', icmsRecolher: '27.09' }),
      );
      expect(saldo.valor).toBe('27.09');
      expect(saldo.possuiSaldoDevedor).toBe(true);
    });

    it('saldo credor não é saldo devedor (possuiSaldoDevedor=false, 0.00)', () => {
      const saldo = projetarSaldoDevedorApurado(
        totais({
          debitos: '10.00',
          creditos: '50.00',
          saldoApurado: '-40.00',
          icmsRecolher: '0.00',
          saldoCredorTransportar: '40.00',
        }),
      );
      expect(saldo.possuiSaldoDevedor).toBe(false);
      expect(saldo.valor).toBe('0.00');
      // Mesmo sem saldo devedor, nunca é guia automática.
      expect(saldo.guiaAutomatica).toBe(false);
      expect(saldo.exigeEmissaoDeliberada).toBe(true);
      expect(saldo.rotulo).toMatch(/sem saldo devedor/i);
    });

    it('zero não é saldo devedor', () => {
      const saldo = projetarSaldoDevedorApurado(
        totais({ saldoApurado: '0.00', icmsRecolher: '0.00' }),
      );
      expect(saldo.possuiSaldoDevedor).toBe(false);
      expect(saldo.valor).toBe('0.00');
    });

    it('a ResultadoApuracao completa carrega o saldo devedor como apuração (R2.5)', () => {
      const r = projetarResultadoApuracao(registro(), snapshots());
      expect(r.saldoDevedorApurado).toEqual({
        natureza: 'APURACAO',
        valor: '27.09',
        possuiSaldoDevedor: true,
        guiaAutomatica: false,
        exigeEmissaoDeliberada: true,
        rotulo: expect.stringMatching(/não é guia/i),
      });
    });
  });

  describe('projetarDetalhamento (ponte paginada R2.2)', () => {
    it('pagina pelo offset/limit e reporta o total completo do snapshot', () => {
      const det = projetarDetalhamento(snapshots().documentos, {
        pagination: { offset: 0, limit: 2 },
      });
      expect(det.items).toHaveLength(2);
      expect(det.pagination).toEqual({ total: 3, limit: 2, offset: 0 });
      expect(det.items[0].chave).toBe('A');
      expect(det.items[1].chave).toBe('B');
    });

    it('a segunda página respeita o offset e mantém a ordem do snapshot', () => {
      const det = projetarDetalhamento(snapshots().documentos, {
        pagination: { offset: 2, limit: 2 },
      });
      expect(det.items).toHaveLength(1);
      expect(det.items[0].chave).toBe('C');
      expect(det.pagination).toEqual({ total: 3, limit: 2, offset: 2 });
    });

    it('offset além do fim devolve página vazia com total preservado', () => {
      const det = projetarDetalhamento(snapshots().documentos, {
        pagination: { offset: 10, limit: 5 },
      });
      expect(det.items).toEqual([]);
      expect(det.pagination).toEqual({ total: 3, limit: 5, offset: 10 });
    });

    it('normaliza janela inválida (offset negativo, limit < 1)', () => {
      const det = projetarDetalhamento(snapshots().documentos, {
        pagination: { offset: -5, limit: 0 },
      });
      expect(det.pagination.offset).toBe(0);
      expect(det.pagination.limit).toBe(1);
      expect(det.items).toHaveLength(1);
    });

    it('projeta campos conhecidos e preserva o restante em extras', () => {
      const det = projetarDetalhamento([
        {
          chave: 'A',
          numeroDocumento: '1',
          valorContabil: '100.00',
          origem: 'XML',
          observacao: 'extemporâneo',
        },
      ]);
      const item = det.items[0];
      expect(item.chave).toBe('A');
      expect(item.numeroDocumento).toBe('1');
      expect(item.valorContabil).toBe('100.00');
      expect(item.extras).toEqual({
        origem: 'XML',
        observacao: 'extemporâneo',
      });
    });

    it('aceita chaveAcesso/numero/valorTotal como aliases dos campos conhecidos', () => {
      const det = projetarDetalhamento([
        { chaveAcesso: 'ABC', numero: '9', valorTotal: '12.34' },
      ]);
      const item = det.items[0];
      expect(item.chave).toBe('ABC');
      expect(item.numeroDocumento).toBe('9');
      expect(item.valorContabil).toBe('12.34');
      // aliases consumidos não vazam para extras
      expect(item.extras).toEqual({});
    });

    it('campos não informados ficam null (zero ≠ não informado)', () => {
      const det = projetarDetalhamento([{ chave: 'A' }]);
      const item = det.items[0];
      expect(item.valorContabil).toBeNull();
      expect(item.baseIcms).toBeNull();
      expect(item.valorIcms).toBeNull();
      expect(item.cfop).toBeNull();
    });

    it('sem options usa página default (limit 15, offset 0)', () => {
      const det = projetarDetalhamento(snapshots().documentos);
      expect(det.pagination).toEqual({ total: 3, limit: 15, offset: 0 });
      expect(det.items).toHaveLength(3);
    });
  });
});
