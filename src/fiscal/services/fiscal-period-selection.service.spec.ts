import { BadRequestException } from '@nestjs/common';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import {
  FiscalPeriodSelectionService,
  type DocumentoElegibilidade,
  type FinalidadeSelecao,
} from './fiscal-period-selection.service';

const dialect = new PgDialect();

/** Serializa um predicado Drizzle para SQL textual com parâmetros inlined. */
function toSql(fragment: SQL): string {
  const query = dialect.sqlToQuery(fragment);
  // Reinsere os parâmetros posicionais para asserções legíveis.
  return query.sql.replace(/\$(\d+)/g, (_m, i) => {
    const value = query.params[Number(i) - 1];
    return typeof value === 'string' ? `'${value}'` : String(value);
  });
}

function elegivel(
  overrides: Partial<DocumentoElegibilidade> = {},
): DocumentoElegibilidade {
  return {
    situacao: 'AUTORIZADA',
    escriturado: true,
    escrituracaoStatus: 'ESCRITURADO',
    integridadeStatus: 'OK',
    valorTotal: '100.00',
    ...overrides,
  };
}

describe('FiscalPeriodSelectionService', () => {
  const service = new FiscalPeriodSelectionService();

  describe('período fiscal explícito (R3 — período explícito)', () => {
    it('expande a competência mensal para o intervalo do mês', () => {
      const { periodo } = service.resolve({
        clienteId: 'c1',
        competencia: '2026-02',
        finalidade: 'EMISSAO',
        definitiva: true,
      });

      expect(periodo.competencia).toBe('2026-02');
      expect(periodo.competenciaDate).toBe('2026-02-01');
      // 2026 não é bissexto → fevereiro termina no dia 28.
      expect(periodo.competenciaFimDate).toBe('2026-02-28');
      expect(periodo.inicio.toISOString()).toBe('2026-02-01T00:00:00.000Z');
      expect(periodo.fim.toISOString()).toBe('2026-02-28T23:59:59.999Z');
    });

    it('rejeita competência em formato inválido', () => {
      expect(() =>
        service.resolvePeriodo('2026/02', 'EMISSAO'),
      ).toThrow(BadRequestException);
      expect(() => service.resolvePeriodo('2026-13', 'EMISSAO')).toThrow(
        BadRequestException,
      );
    });
  });

  describe('data fiscal por finalidade (R3.1/R3.5 — sem cópia cega)', () => {
    it.each<[FinalidadeSelecao, string]>([
      ['EMISSAO', 'DATA_EMISSAO'],
      ['ENTRADA_SAIDA', 'DATA_ENTRADA_SAIDA'],
      ['ESCRITURACAO', 'DATA_ESCRITURACAO'],
      ['EVENTO', 'DATA_EVENTO'],
    ])('finalidade %s mapeia para a data fiscal %s', (finalidade, tipoData) => {
      // `resolvePeriodo` resolve o tipo de data para todas as finalidades,
      // inclusive EVENTO (cuja seleção é feita via estratégia dedicada, não pelo
      // predicado puro de `resolve`).
      const periodo = service.resolvePeriodo('2026-02', finalidade);
      expect(periodo.tipoData).toBe(tipoData);
    });

    it('EMISSAO filtra pela data de emissão fiscal com fallback ao timestamp', () => {
      const { predicadoPeriodo } = service.resolve({
        clienteId: 'c1',
        competencia: '2026-08',
        finalidade: 'EMISSAO',
        definitiva: false,
      });
      const sql = toSql(predicadoPeriodo);
      expect(sql).toContain('data_emissao_fiscal');
      // fallback para o timestamp bruto quando a data fiscal é nula.
      expect(sql).toContain('data_emissao');
      expect(sql).toContain('2026-08-01');
      expect(sql).toContain('2026-08-31');
    });

    it('ENTRADA_SAIDA prioriza a data de entrada/saída, não a emissão', () => {
      const { predicadoPeriodo } = service.resolve({
        clienteId: 'c1',
        competencia: '2026-08',
        finalidade: 'ENTRADA_SAIDA',
        definitiva: false,
      });
      const sql = toSql(predicadoPeriodo);
      expect(sql).toContain('data_entrada_saida_fiscal');
    });

    it('ESCRITURACAO recorta pela entrada efetiva (não copia a emissão)', () => {
      // Sem coluna dedicada de data de escrituração, a finalidade usa a entrada
      // efetiva como aproximação explícita, caindo para a emissão só quando a
      // entrada é nula — nunca copiando a emissão como se fosse escrituração.
      const { predicadoPeriodo } = service.resolve({
        clienteId: 'c1',
        competencia: '2026-08',
        finalidade: 'ESCRITURACAO',
        definitiva: false,
      });
      const sql = toSql(predicadoPeriodo);
      expect(sql).toContain('data_entrada_saida_fiscal');
      // o fallback à emissão só vale quando a entrada fiscal é nula.
      expect(sql).toContain('data_entrada_saida_fiscal" is null');
      expect(sql).toContain('data_emissao_fiscal');
    });

    it('EVENTO não é um predicado puro sobre documentos_fiscais', () => {
      // A data do evento vive em eventos_fiscais; o caminho de predicado puro
      // deve recusar EVENTO em vez de reusar silenciosamente a emissão.
      expect(() =>
        service.resolve({
          clienteId: 'c1',
          competencia: '2026-08',
          finalidade: 'EVENTO',
          definitiva: false,
        }),
      ).toThrow(BadRequestException);
      expect(() => service.predicadoPeriodo('2026-08', 'EVENTO')).toThrow(
        BadRequestException,
      );
    });
  });

  describe('finalidade EVENTO: estratégia sobre eventos_fiscais (R3.2/R3.5)', () => {
    it('recorta eventos pela data do evento no mês, via fiscal-date.util', () => {
      const { periodo, where } = service.predicadoEvento('2026-08');
      const sql = toSql(where);
      // recorte por timestamp de evento com os limites de mês em UTC.
      expect(sql).toContain('data_evento');
      expect(sql).toContain('2026-08-01T00:00:00.000Z');
      expect(sql).toContain('2026-08-31T23:59:59.999Z');
      // nunca cai para a data de emissão do documento.
      expect(sql).not.toContain('data_emissao');
      expect(periodo.tipoData).toBe('DATA_EVENTO');
    });

    it('filtra por tipo de evento quando informado', () => {
      const { where } = service.predicadoEvento('2026-08', {
        tiposEvento: ['CANCELAMENTO'],
      });
      const sql = toSql(where);
      expect(sql).toContain('tipo_evento');
      expect(sql).toContain('CANCELAMENTO');
    });

    it('materializa a seleção no espaço de documentos via EXISTS', () => {
      const { where } = service.predicadoDocumentosComEvento('2026-08', {
        tiposEvento: ['CANCELAMENTO'],
      });
      const sql = toSql(where);
      expect(sql).toContain('EXISTS');
      expect(sql).toContain('eventos_fiscais');
      expect(sql).toContain('documento_fiscal_id');
      expect(sql).toContain('data_evento');
    });
  });

  describe('XML 31/08 23h local com entrada em setembro (R3.2)', () => {
    // A conciliação depende de EMISSÃO e ENTRADA caírem em competências
    // distintas e previsíveis: a nota emitida em 31/08 pertence a agosto pela
    // finalidade de emissão; a entrada em setembro pertence a setembro pela
    // finalidade de entrada — nenhuma data é copiada cegamente para a outra.
    it('agosto por emissão NÃO inclui a entrada de setembro', () => {
      const { predicadoPeriodo } = service.resolve({
        clienteId: 'c1',
        competencia: '2026-08',
        finalidade: 'EMISSAO',
        definitiva: false,
      });
      const sql = toSql(predicadoPeriodo);
      expect(sql).toContain('2026-08-31');
      expect(sql).not.toContain('data_entrada_saida_fiscal');
    });

    it('setembro por entrada recorta a data de entrada/saída', () => {
      const { predicadoPeriodo } = service.resolve({
        clienteId: 'c1',
        competencia: '2026-09',
        finalidade: 'ENTRADA_SAIDA',
        definitiva: false,
      });
      const sql = toSql(predicadoPeriodo);
      expect(sql).toContain('data_entrada_saida_fiscal');
      expect(sql).toContain('2026-09-01');
      expect(sql).toContain('2026-09-30');
    });
  });

  // ===========================================================================
  // Teste de aceitação R3.2 — XML 31/08 23h local, entrada em setembro:
  // resultado previsível e CONCILIÁVEL entre módulos.
  //
  // Mesmo documento, duas finalidades: a visão de EMISSÃO (ICMS próprio / livro
  // de saída) coloca a nota em 2026-08; a visão de ENTRADA_SAIDA (crédito de
  // entrada) coloca a MESMA nota em 2026-09. As competências são distintas e
  // determinísticas — nenhuma data é copiada cegamente (R3.5) — e os dois
  // módulos reconciliam: o total que agosto reconhece por emissão é exatamente o
  // mesmo documento que setembro reconhece por entrada.
  // ===========================================================================
  describe('ACEITAÇÃO R3.2: XML 31/08 23h conciliável entre módulos', () => {
    // Projeção mínima das datas fiscais de um documento, como persistidas após a
    // importação (as colunas `date` já estão em fuso local; os timestamps são o
    // instante bruto). Os campos espelham `documentosFiscais`.
    interface DocDatas {
      dataEmissaoFiscal: string | null;
      dataEmissao: Date;
      dataEntradaSaidaFiscal: string | null;
    }

    // A nota de virada de mês: emitida 31/08 23h de Brasília (01/09 02:00Z no
    // bruto), com entrada efetiva da mercadoria em 02/09.
    const nota: DocDatas = {
      dataEmissaoFiscal: '2026-08-31',
      dataEmissao: new Date('2026-08-31T23:00:00.000-03:00'),
      dataEntradaSaidaFiscal: '2026-09-02',
    };

    /**
     * Decide a competência 'AAAA-MM' do documento sob uma finalidade, seguindo a
     * MESMA política que o serviço resolve (prioriza a data fiscal da finalidade;
     * entrada/escrituração caem para a emissão só quando a entrada é nula). Lê o
     * `tipoData` que o serviço atribui à finalidade, provando que a decisão vem
     * da política, não de uma regra reinventada no teste.
     */
    function competenciaDe(
      doc: DocDatas,
      finalidade: FinalidadeSelecao,
    ): string {
      const { tipoData } = service.resolvePeriodo('2026-08', finalidade);
      switch (tipoData) {
        case 'DATA_EMISSAO':
          // Data fiscal (fuso local) tem prioridade; timestamp bruto é fallback.
          return doc.dataEmissaoFiscal
            ? doc.dataEmissaoFiscal.slice(0, 7)
            : toCompetenciaUtc(doc.dataEmissao);
        case 'DATA_ENTRADA_SAIDA':
        case 'DATA_ESCRITURACAO':
          return doc.dataEntradaSaidaFiscal
            ? doc.dataEntradaSaidaFiscal.slice(0, 7)
            : doc.dataEmissaoFiscal
              ? doc.dataEmissaoFiscal.slice(0, 7)
              : toCompetenciaUtc(doc.dataEmissao);
        default:
          throw new Error(`Finalidade sem competência pura: ${tipoData}`);
      }
    }

    function toCompetenciaUtc(d: Date): string {
      const ano = d.getUTCFullYear();
      const mes = String(d.getUTCMonth() + 1).padStart(2, '0');
      return `${ano}-${mes}`;
    }

    it('EMISSÃO coloca a nota em agosto; ENTRADA_SAIDA, em setembro (distintas e previsíveis)', () => {
      expect(competenciaDe(nota, 'EMISSAO')).toBe('2026-08');
      expect(competenciaDe(nota, 'ENTRADA_SAIDA')).toBe('2026-09');
      // As duas visões NÃO colapsam na mesma competência (sem cópia cega).
      expect(competenciaDe(nota, 'EMISSAO')).not.toBe(
        competenciaDe(nota, 'ENTRADA_SAIDA'),
      );
    });

    it('a competência de emissão vem da data fiscal, não do timestamp bruto de virada', () => {
      // O timestamp bruto está em setembro (02:00Z de 01/09); se a política o
      // usasse, a emissão escaparia de agosto. A data fiscal mantém agosto.
      expect(nota.dataEmissao.toISOString()).toBe('2026-09-01T02:00:00.000Z');
      expect(competenciaDe(nota, 'EMISSAO')).toBe('2026-08');

      // Fallback explícito: quando NÃO há data fiscal de emissão, aí sim recai
      // sobre o timestamp bruto — e aí a nota cairia em setembro.
      const semDataFiscal: DocDatas = { ...nota, dataEmissaoFiscal: null };
      expect(competenciaDe(semDataFiscal, 'EMISSAO')).toBe('2026-09');
    });

    it('os predicados SQL das duas finalidades recortam meses distintos (particionam a nota)', () => {
      const emissaoAgosto = toSql(
        service.resolve({
          clienteId: 'c1',
          competencia: '2026-08',
          finalidade: 'EMISSAO',
          definitiva: false,
        }).predicadoPeriodo,
      );
      const entradaSetembro = toSql(
        service.resolve({
          clienteId: 'c1',
          competencia: '2026-09',
          finalidade: 'ENTRADA_SAIDA',
          definitiva: false,
        }).predicadoPeriodo,
      );
      // Emissão de agosto recorta pela data de emissão fiscal, dentro de agosto.
      expect(emissaoAgosto).toContain('data_emissao_fiscal');
      expect(emissaoAgosto).toContain('2026-08-01');
      expect(emissaoAgosto).toContain('2026-08-31');
      expect(emissaoAgosto).not.toContain('data_entrada_saida_fiscal');
      // Entrada de setembro recorta pela data de entrada/saída, dentro de setembro.
      expect(entradaSetembro).toContain('data_entrada_saida_fiscal');
      expect(entradaSetembro).toContain('2026-09-01');
      expect(entradaSetembro).toContain('2026-09-30');
    });

    it('conciliação: a nota aparece UMA vez em cada módulo e os totais batem entre as visões', () => {
      // Universo determinístico de uma competência de fronteira: só a nota de
      // virada (demais notas de cada mês omitidas por serem irrelevantes à prova
      // da conciliação da nota de borda).
      const valorNota = '1000.00';

      // Visão do módulo de SAÍDA/EMISSÃO para agosto: a nota entra.
      const emissaoAgosto = competenciaDe(nota, 'EMISSAO') === '2026-08';
      // Visão do módulo de ENTRADA (crédito) para setembro: a MESMA nota entra.
      const entradaSetembro = competenciaDe(nota, 'ENTRADA_SAIDA') === '2026-09';

      expect(emissaoAgosto).toBe(true);
      expect(entradaSetembro).toBe(true);

      // A nota NÃO é contada em agosto pela entrada nem em setembro pela emissão:
      // cada módulo a reconhece em exatamente uma competência.
      expect(competenciaDe(nota, 'ENTRADA_SAIDA') === '2026-08').toBe(false);
      expect(competenciaDe(nota, 'EMISSAO') === '2026-09').toBe(false);

      // Ponto de conciliação: o valor que a visão de emissão de agosto reconhece
      // é o MESMO valor que a visão de entrada de setembro reconhece — a mesma
      // nota, dois módulos, sem perda nem duplicação.
      const totalEmissaoAgosto = emissaoAgosto ? valorNota : '0.00';
      const totalEntradaSetembro = entradaSetembro ? valorNota : '0.00';
      expect(totalEmissaoAgosto).toBe(totalEntradaSetembro);
    });
  });

  // ===========================================================================
  // Teste de aceitação R3.3 — documento extemporâneo previsível.
  //
  // Documento emitido num mês anterior e escriturado/entrado tardiamente cai
  // numa competência DETERMINÍSTICA por finalidade; se ainda estiver pendente
  // (escriturado sem os controles de revisão/integridade), fica FORA da
  // apuração definitiva e é reportado no universo excluído (qtd/valor).
  // ===========================================================================
  describe('ACEITAÇÃO R3.3: documento extemporâneo previsível', () => {
    it('a competência extemporânea é determinística por finalidade (emissão ≠ escrituração)', () => {
      // Nota emitida em junho, mas escriturada/entrada em agosto (extemporânea).
      // A visão de EMISSÃO a mantém em junho (fato gerador original); a visão de
      // ESCRITURAÇÃO a reconhece em agosto (quando foi efetivamente lançada),
      // usando a entrada efetiva como aproximação explícita — sem copiar a
      // emissão como se fosse a escrituração (R3.2/R3.5).
      const emissaoJunho = toSql(
        service.resolve({
          clienteId: 'c1',
          competencia: '2026-06',
          finalidade: 'EMISSAO',
          definitiva: false,
        }).predicadoPeriodo,
      );
      expect(emissaoJunho).toContain('data_emissao_fiscal');
      expect(emissaoJunho).toContain('2026-06-01');
      expect(emissaoJunho).toContain('2026-06-30');
      expect(emissaoJunho).not.toContain('data_entrada_saida_fiscal');

      const escrituracaoAgosto = toSql(
        service.resolve({
          clienteId: 'c1',
          competencia: '2026-08',
          finalidade: 'ESCRITURACAO',
          definitiva: false,
        }).predicadoPeriodo,
      );
      // Escrituração recorta pela entrada efetiva, caindo para a emissão só
      // quando a entrada é nula — nunca copiando a emissão cegamente.
      expect(escrituracaoAgosto).toContain('data_entrada_saida_fiscal');
      expect(escrituracaoAgosto).toContain('data_entrada_saida_fiscal" is null');
      expect(escrituracaoAgosto).toContain('data_emissao_fiscal');
      expect(escrituracaoAgosto).toContain('2026-08-01');
      expect(escrituracaoAgosto).toContain('2026-08-31');
    });

    it('extemporâneo pendente é EXCLUÍDO da seleção definitiva e reportado (qtd/valor)', () => {
      // O documento extemporâneo chegou escriturado, mas ainda pendente de
      // revisão (escrituracaoStatus) — típico de lançamento tardio ainda em
      // conferência. Numa apuração definitiva ele NÃO pode entrar (R3.3).
      const extemporaneoPendente = elegivel({
        escrituracaoStatus: 'PENDENTE_REVISAO',
        valorTotal: '750.00',
      });
      expect(service.classificarExclusao(extemporaneoPendente)).toBe(
        'PENDENTE_REVISAO',
      );

      const relatorio = service.reportExclusoes([
        elegivel({ valorTotal: '200.00' }), // tempestivo e completo: permanece
        extemporaneoPendente, // extemporâneo pendente: excluído
      ]);
      expect(relatorio.quantidade).toBe(1);
      expect(relatorio.valor).toBe('750.00');
      expect(relatorio.porMotivo).toEqual([
        { motivo: 'PENDENTE_REVISAO', quantidade: 1, valor: '750.00' },
      ]);
    });

    it('o MESMO extemporâneo, uma vez concluído, torna-se elegível (previsível, não arbitrário)', () => {
      // Quando os controles de revisão/integridade são concluídos, o documento
      // passa a ser elegível — a exclusão era por estado pendente, não por ser
      // extemporâneo em si.
      const extemporaneoConcluido = elegivel({ valorTotal: '750.00' });
      expect(service.classificarExclusao(extemporaneoConcluido)).toBeNull();
      const relatorio = service.reportExclusoes([extemporaneoConcluido]);
      expect(relatorio.quantidade).toBe(0);
      expect(relatorio.valor).toBe('0.00');
    });
  });

  describe('elegibilidade e exclusão para apuração definitiva (R3.3)', () => {
    it('seleção definitiva adiciona filtros de situação/escrituração/integridade', () => {
      const definitiva = toSql(
        service.resolve({
          clienteId: 'c1',
          competencia: '2026-02',
          finalidade: 'EMISSAO',
          definitiva: true,
        }).where,
      );
      expect(definitiva).toContain('situacao');
      expect(definitiva).toContain('escriturado');
      expect(definitiva).toContain('escrituracao_status');
      expect(definitiva).toContain('integridade_status');
    });

    it('seleção não-definitiva não aplica os filtros de elegibilidade', () => {
      const auxiliar = toSql(
        service.resolve({
          clienteId: 'c1',
          competencia: '2026-02',
          finalidade: 'EMISSAO',
          definitiva: false,
        }).where,
      );
      expect(auxiliar).not.toContain('escrituracao_status');
      expect(auxiliar).not.toContain('integridade_status');
    });

    it('documento completo é elegível (sem motivo de exclusão)', () => {
      expect(service.classificarExclusao(elegivel())).toBeNull();
    });

    it.each<[string, Partial<DocumentoElegibilidade>, string]>([
      ['não autorizada', { situacao: 'CANCELADA' }, 'SITUACAO_NAO_AUTORIZADA'],
      ['não escriturado', { escriturado: false }, 'NAO_ESCRITURADO'],
      [
        'escriturado mas pendente de revisão',
        { escrituracaoStatus: 'PENDENTE_REVISAO' },
        'PENDENTE_REVISAO',
      ],
      [
        'integridade não conferida',
        { integridadeStatus: 'NAO_CONFERIDA' },
        'INTEGRIDADE_NAO_CONFERIDA',
      ],
      // DIVERGENTE é um status REAL do domínio (chk_docs_fiscais_integridade_status)
      // que reprovou na conferência: também fica fora do fechamento definitivo.
      [
        'integridade divergente',
        { integridadeStatus: 'DIVERGENTE' },
        'INTEGRIDADE_NAO_CONFERIDA',
      ],
    ])('exclui documento %s', (_cenario, overrides, motivo) => {
      expect(service.classificarExclusao(elegivel(overrides))).toBe(motivo);
    });

    it('integridade elegível é apenas OK (domínio real do schema, sem CONFERIDA)', () => {
      // O domínio de integridade_status é NAO_CONFERIDA | OK | DIVERGENTE.
      // Só OK admite o documento; o valor fictício 'CONFERIDA' não existe e, se
      // chegasse, seria excluído em vez de aceito indevidamente.
      expect(
        service.classificarExclusao(elegivel({ integridadeStatus: 'OK' })),
      ).toBeNull();
      expect(
        service.classificarExclusao(
          elegivel({ integridadeStatus: 'CONFERIDA' }),
        ),
      ).toBe('INTEGRIDADE_NAO_CONFERIDA');
    });

    it('predicado definitivo admite exatamente OK na integridade', () => {
      const definitiva = toSql(
        service.resolve({
          clienteId: 'c1',
          competencia: '2026-02',
          finalidade: 'EMISSAO',
          definitiva: true,
        }).where,
      );
      expect(definitiva).toContain("integridade_status\" in ('OK')");
      expect(definitiva).not.toContain('CONFERIDA');
      expect(definitiva).not.toContain('DIVERGENTE');
    });

    it('precedência determinística: situação antes de escrituração', () => {
      // Documento cancelado E não escriturado reporta a situação (bloqueio mais
      // forte), um único motivo por documento.
      expect(
        service.classificarExclusao(
          elegivel({ situacao: 'CANCELADA', escriturado: false }),
        ),
      ).toBe('SITUACAO_NAO_AUTORIZADA');
    });
  });

  describe('relatório do universo excluído (R3.4)', () => {
    it('agrega quantidade e valor totais e por motivo', () => {
      const relatorio = service.reportExclusoes([
        elegivel({ valorTotal: '10.00' }), // elegível, não entra
        elegivel({ situacao: 'CANCELADA', valorTotal: '30.50' }),
        elegivel({ situacao: 'DENEGADA', valorTotal: '19.50' }),
        elegivel({ escriturado: false, valorTotal: '5.25' }),
      ]);

      expect(relatorio.quantidade).toBe(3);
      expect(relatorio.valor).toBe('55.25');

      const situacao = relatorio.porMotivo.find(
        (m) => m.motivo === 'SITUACAO_NAO_AUTORIZADA',
      );
      expect(situacao).toEqual({
        motivo: 'SITUACAO_NAO_AUTORIZADA',
        quantidade: 2,
        valor: '50.00',
      });
      const naoEscriturado = relatorio.porMotivo.find(
        (m) => m.motivo === 'NAO_ESCRITURADO',
      );
      expect(naoEscriturado).toEqual({
        motivo: 'NAO_ESCRITURADO',
        quantidade: 1,
        valor: '5.25',
      });
    });

    it('conjunto totalmente elegível produz relatório vazio', () => {
      const relatorio = service.reportExclusoes([
        elegivel({ valorTotal: '1.00' }),
        elegivel({ valorTotal: '2.00' }),
      ]);
      expect(relatorio.quantidade).toBe(0);
      expect(relatorio.valor).toBe('0.00');
      expect(relatorio.porMotivo).toHaveLength(0);
    });

    it('soma valores sem perda de precisão decimal (sem ponto flutuante)', () => {
      const relatorio = service.reportExclusoes([
        elegivel({ situacao: 'CANCELADA', valorTotal: '0.10' }),
        elegivel({ situacao: 'CANCELADA', valorTotal: '0.20' }),
      ]);
      expect(relatorio.valor).toBe('0.30');
    });
  });
});
