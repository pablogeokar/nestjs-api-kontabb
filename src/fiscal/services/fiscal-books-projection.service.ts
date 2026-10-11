import { Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service';
import { fiscalFechamentos } from '../../database/schema';
import type {
  EstadoFechamento,
  FechamentoRegistro,
  ObrigacaoFechamento,
} from './fiscal-closing.service';
import type { FechamentoSnapshots } from './resultado-apuracao.projector';
import {
  projetarLivros,
  type LivroApuracao,
  type LivroDetalhado,
  type LivroResumo,
  type LivrosProjecao,
  type LivrosProjecaoOptions,
} from './fiscal-books-projection';

/**
 * Livros como PROJEÇÃO do fechamento (F15 / R4.1, R4.3) — Tarefa 5.1.
 *
 * As três visões do livro — DETALHADO (cronológico), RESUMO (CFOP/CST/alíquota
 * com drill-down) e APURAÇÃO (parcelas/ajustes/saldos) — são projeções dos
 * snapshots CONGELADOS de uma versão de fechamento, SEM um segundo motor de
 * cálculo (design §9.2). O serviço apenas CARREGA a versão do banco e delega ao
 * núcleo PURO `projetarLivros`, que reaproveita o projetor do contrato
 * `ResultadoApuracao` (DETALHADO/APURAÇÃO) e o agregador analítico comum do
 * C190 (RESUMO, o MESMO de UI e TXT — R5.4). Nada é recomputado aqui nem no
 * navegador (R4.3): a mesma versão sempre projeta o mesmo livro, e cada visão
 * carrega o número/versão e o estado (parcial/revisado/fechado) do fechamento
 * (R4.1).
 *
 * Espelha o padrão de `FiscalClosingService.projetarApuracao`/`conciliarPonte`:
 * uma leitura simples da linha de `fiscal_fechamentos` seguida da projeção pura
 * dos JSONB congelados.
 */
@Injectable()
export class FiscalBooksProjectionService {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Projeta as TRÊS visões do livro (DETALHADO, RESUMO, APURAÇÃO) de uma versão
   * de fechamento, com o detalhamento PAGINADO a partir do snapshot congelado.
   * Lança 404 quando o fechamento não existe.
   */
  async projetarLivros(
    fechamentoId: string,
    options?: LivrosProjecaoOptions,
  ): Promise<LivrosProjecao> {
    const { registro, snapshots } = await this.carregar(fechamentoId);
    return projetarLivros(registro, snapshots, options);
  }

  /** Projeta apenas a visão DETALHADA (cronológica) do livro. */
  async projetarDetalhado(
    fechamentoId: string,
    options?: LivrosProjecaoOptions,
  ): Promise<LivroDetalhado> {
    const { registro, snapshots } = await this.carregar(fechamentoId);
    return projetarLivros(registro, snapshots, options).detalhado;
  }

  /** Projeta apenas a visão RESUMO (CFOP/CST/alíquota com drill-down). */
  async projetarResumo(
    fechamentoId: string,
    options?: LivrosProjecaoOptions,
  ): Promise<LivroResumo> {
    const { registro, snapshots } = await this.carregar(fechamentoId);
    return projetarLivros(registro, snapshots, options).resumo;
  }

  /** Projeta apenas a visão APURAÇÃO (parcelas/ajustes/saldos). */
  async projetarApuracao(
    fechamentoId: string,
    options?: LivrosProjecaoOptions,
  ): Promise<LivroApuracao> {
    const { registro, snapshots } = await this.carregar(fechamentoId);
    return projetarLivros(registro, snapshots, options).apuracao;
  }

  /**
   * Carrega a linha de fechamento e extrai o registro + os snapshots congelados.
   * Projeta a linha no MESMO `FechamentoRegistro` que `FiscalClosingService`
   * expõe (espelha o seu `toRegistro`), de modo que o livro e os demais
   * consumidores vejam a MESMA identificação de versão.
   */
  private async carregar(
    fechamentoId: string,
  ): Promise<{ registro: FechamentoRegistro; snapshots: FechamentoSnapshots }> {
    const [row] = await this.database.db
      .select()
      .from(fiscalFechamentos)
      .where(eq(fiscalFechamentos.id, fechamentoId))
      .limit(1);
    if (!row) {
      throw new NotFoundException('Fechamento não encontrado.');
    }
    return {
      registro: {
        id: row.id,
        clienteId: row.clienteId,
        obrigacao: row.obrigacao as ObrigacaoFechamento,
        competencia: row.competencia,
        versao: row.versao,
        estado: row.estado as EstadoFechamento,
        corrente: row.corrente,
        motorVersao: row.motorVersao,
        hashEntradas: row.hashEntradas,
        aprovadoPor: row.aprovadoPor,
        fechadoEm: row.fechadoEm,
      },
      snapshots: {
        documentos: row.documentos,
        saldos: row.saldos,
        parametros: row.parametros,
      },
    };
  }
}
