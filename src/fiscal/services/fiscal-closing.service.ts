import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service';
import { fiscalFechamentos } from '../../database/schema';
import {
  FiscalPeriodSelectionService,
  type FinalidadeSelecao,
} from './fiscal-period-selection.service';
import {
  projetarResultadoApuracao,
  type FechamentoSnapshots,
} from './resultado-apuracao.projector';
import type {
  ResultadoApuracao,
  ResultadoApuracaoProjecaoOptions,
} from './resultado-apuracao.contract';
import {
  montarPonteConciliacao,
  type PonteConciliacao,
} from './conciliacao-ponte';
import {
  comReferenciaRetificacao,
  lerReferenciaRetificacao,
  montarDiferencaRetificacao,
  type DiferencaRetificacao,
  type RetificacaoReferencia,
} from './retificacao-fechamento';

// Handle de transação do drizzle, derivado do callback de `db.transaction`.
// Usado pelos helpers que operam dentro de uma transação (versionamento/lock).
type FechamentoTx = Parameters<
  Parameters<DatabaseService['db']['transaction']>[0]
>[0];

/**
 * Resultado de {@link FiscalClosingService.sinalizarRevisaoSeFechado}.
 *
 * Diz ao ESCRITOR (importação, baixa de bem, edição de regra) se o escopo que
 * ele está prestes a alterar já tem uma versão CORRENTE FECHADA. Quando tem, a
 * escrita NÃO pode mutar a entrega congelada em lugar: a competência passa a
 * precisar de revisão/nova versão (R1.3/R1.4) — a criação da nova versão é
 * responsabilidade da tarefa 3.5, que se pluga neste mesmo ponto. Para 3.4, o
 * contrato garante que o escritor participa do lock e nunca sobrescreve o
 * fechamento congelado silenciosamente.
 */
export interface SinalRevisaoFechamento {
  /** Há uma versão CORRENTE FECHADA no escopo? */
  fechado: boolean;
  /** Id do fechamento corrente fechado, quando existe (para a tarefa 3.5). */
  fechamentoCorrenteId: string | null;
}

/**
 * Resultado de {@link FiscalClosingService.sinalizarRevisaoPosFechamento}
 * (tarefa 3.5).
 *
 * Além de dizer se o escopo tinha uma entrega FECHADA (`fechado`), informa a
 * versão de REVISÃO aberta para a competência: quando já havia uma entrega
 * congelada, a escrita (importação, baixa de bem, edição de regra) abre — ou
 * reutiliza — uma nova versão RASCUNHO que carrega os snapshots da corrente
 * fechada adiante. A entrega anterior (a corrente FECHADA) permanece intacta e
 * continua sendo a projetada por livros/SPED até que a revisão seja fechada e
 * promovida (R1.3/R1.4). A presença de uma revisão aberta sobre a corrente é,
 * ela própria, o SINAL de "precisa de revisão".
 */
export interface RevisaoPosFechamento extends SinalRevisaoFechamento {
  /**
   * Houve necessidade de sinalizar revisão? `true` sempre que havia uma entrega
   * FECHADA no escopo (equivale a `fechado`). Quando `false`, não há entrega
   * congelada e a escrita segue sem abrir versão de revisão.
   */
  revisaoNecessaria: boolean;
  /** Id da versão de revisão (RASCUNHO) aberta/reutilizada, quando houve. */
  revisaoId: string | null;
  /** Número da versão de revisão aberta/reutilizada, quando houve. */
  revisaoVersao: number | null;
  /** A revisão foi ABERTA agora (true) ou já existia e foi reutilizada (false)? */
  revisaoAberta: boolean;
}

/**
 * Versão do motor de apuração que produziu o fechamento. É gravada em
 * `motorVersao` e participa do hash — qualquer mudança de regra de composição
 * que altere o resultado DEVE incrementar esta versão, de modo que fechamentos
 * antigos permaneçam reproduzíveis com a sua versão de origem (R1.2).
 */
export const FISCAL_CLOSING_MOTOR_VERSAO = 'fase3-fechamento@1';

/**
 * Obrigações acessórias para as quais existe um fechamento (domínio do CHECK
 * `chk_fiscal_fechamento_obrigacao` do schema).
 */
export type ObrigacaoFechamento =
  | 'EFD_ICMS_IPI'
  | 'EFD_CONTRIBUICOES'
  | 'GIA'
  | 'DAS'
  | 'DAPI';

const OBRIGACOES_VALIDAS: ReadonlySet<ObrigacaoFechamento> = new Set([
  'EFD_ICMS_IPI',
  'EFD_CONTRIBUICOES',
  'GIA',
  'DAS',
  'DAPI',
]);

/** Estados do ciclo de vida de um fechamento (contrato ResultadoApuracao). */
export type EstadoFechamento =
  | 'RASCUNHO'
  | 'PENDENTE'
  | 'REVISADO'
  | 'FECHADO';

/**
 * Máquina de estados do fechamento: `RASCUNHO → PENDENTE → REVISADO → FECHADO`.
 *
 * Só avança uma casa por vez e nunca retrocede — uma versão fechada é imutável
 * (R1.2/R1.4); a correção se dá criando uma NOVA versão (tarefa 3.5), não
 * voltando o estado da anterior. O mapa é explícito para que uma transição
 * inválida seja um erro de domínio, não um efeito silencioso.
 */
const TRANSICOES_VALIDAS: Record<EstadoFechamento, readonly EstadoFechamento[]> =
{
  RASCUNHO: ['PENDENTE'],
  PENDENTE: ['REVISADO'],
  REVISADO: ['FECHADO'],
  FECHADO: [],
};

/**
 * Entradas CONGELADAS que compõem um fechamento (a fotografia das entradas).
 *
 * O chamador (importação, geração EFD, projeção de livros — tarefas 3.3+)
 * monta estes conjuntos a partir das fontes vigentes: documentos elegíveis via
 * `FiscalPeriodSelectionService`, decisões de crédito, regras aplicadas,
 * parâmetros e saldos anteriores. Valores monetários DEVEM vir como strings
 * decimais (nunca `Number`) — o hash depende da serialização estável desses
 * valores (R1.2).
 */
export interface FechamentoEntradas {
  /** Documentos elegíveis congelados (projeção estável, não o estado atual). */
  documentos: ReadonlyArray<Record<string, unknown>>;
  /** Decisões de crédito/natureza aplicadas na competência. */
  decisoes: ReadonlyArray<Record<string, unknown>>;
  /** Regras fiscais vigentes consideradas no fechamento. */
  regras: ReadonlyArray<Record<string, unknown>>;
  /** Parâmetros da apuração (perfil, finalidade, flags de regime etc.). */
  parametros: Record<string, unknown>;
  /** Saldos anteriores confiáveis utilizados como ponto de partida. */
  saldos: Record<string, unknown>;
}

/** Identificação do escopo de um fechamento (estabelecimento/competência). */
export interface FechamentoEscopo {
  clienteId: string;
  obrigacao: ObrigacaoFechamento;
  /** Competência mensal explícita 'AAAA-MM'. */
  competencia: string;
}

export interface AbrirFechamentoInput extends FechamentoEscopo {
  entradas: FechamentoEntradas;
}

/**
 * Entrada de {@link FiscalClosingService.retificar} (tarefa 3.6 / R1.5).
 *
 * Diferente de `abrir`/`editar`, a retificação exige o id da versão ORIGINAL
 * que está sendo corrigida (`originalFechamentoId`) — é o "aponta o original".
 * O escopo (cliente/obrigação/competência) é derivado da versão original, de
 * modo que a retificação more sempre no MESMO escopo que corrige; o chamador
 * fornece apenas as novas `entradas` da versão corrigida.
 */
export interface RetificarFechamentoInput {
  /** Id da versão original (a entrega FECHADA a ser retificada). */
  originalFechamentoId: string;
  /** Entradas corrigidas que compõem a versão retificadora. */
  entradas: FechamentoEntradas;
}

/** Projeção de um fechamento persistido. */
export interface FechamentoRegistro {
  id: string;
  clienteId: string;
  obrigacao: ObrigacaoFechamento;
  competencia: string;
  versao: number;
  estado: EstadoFechamento;
  corrente: boolean;
  motorVersao: string;
  hashEntradas: string;
  aprovadoPor: string | null;
  fechadoEm: Date | null;
}

/**
 * Finalidade de seleção de documentos por obrigação. O fechamento reusa a
 * `FiscalPeriodSelectionService` (F14) para o universo elegível, sem copiar
 * cegamente uma única data para todas as obrigações (R3.5).
 */
const FINALIDADE_POR_OBRIGACAO: Record<ObrigacaoFechamento, FinalidadeSelecao> =
{
  EFD_ICMS_IPI: 'EMISSAO',
  EFD_CONTRIBUICOES: 'EMISSAO',
  GIA: 'EMISSAO',
  DAS: 'EMISSAO',
  DAPI: 'EMISSAO',
};

/**
 * Fechamento versionado (F20 / plano §7).
 *
 * Congela documentos, decisões, regras, parâmetros e saldos numa MEMÓRIA DE
 * CÁLCULO imutável, sela as entradas com `motorVersao` + `hashEntradas` e
 * governa o ciclo `RASCUNHO → PENDENTE → REVISADO → FECHADO`. É a fonte comum
 * de que livros, painéis e SPED passam a projetar — por construção, livro e TXT
 * de uma versão fechada são reproduzíveis (mesmas entradas → mesmo hash, R1.2).
 *
 * O serviço separa deliberadamente a parte PURA (composição + canonicalização +
 * hash + validação de transição, abaixo expostas como funções/estáticos) da
 * parte com efeito (persistência/lock/corrente), para que a determinismo do
 * hash seja testável sem banco e as tarefas 3.3–3.7 (contrato ResultadoApuracao,
 * participação no lock, revisão pós-fechamento, retificação) estendam o mesmo
 * núcleo sem recomputar nada por caminhos divergentes.
 */
@Injectable()
export class FiscalClosingService {
  constructor(
    private readonly database: DatabaseService,
    private readonly periodSelection: FiscalPeriodSelectionService,
  ) { }

  /**
   * Finalidade de seleção de período apropriada a uma obrigação — exposto para
   * que o chamador monte o universo de documentos elegíveis pela MESMA política
   * (F14) que o fechamento usará, sem reimplementar o recorte.
   */
  finalidadeSelecao(obrigacao: ObrigacaoFechamento): FinalidadeSelecao {
    return FINALIDADE_POR_OBRIGACAO[this.assertObrigacao(obrigacao)];
  }

  /**
   * Abre uma NOVA versão de fechamento em RASCUNHO, congelando as entradas e
   * selando-as com `motorVersao` + `hashEntradas` (R1.1). A versão é a próxima
   * sequencial do escopo (cliente/obrigação/competência) — versões anteriores
   * permanecem intactas (R1.4). Serializa com escritas concorrentes do mesmo
   * escopo via advisory lock, no mesmo padrão da geração EFD.
   */
  async abrir(input: AbrirFechamentoInput): Promise<FechamentoRegistro> {
    this.assertObrigacao(input.obrigacao);
    // Normaliza a competência para 'AAAA-MM-01' pela MESMA política de período.
    const competenciaDate = this.resolverCompetenciaDate(
      input.competencia,
      input.obrigacao,
    );
    return this.database.db.transaction(
      async (tx) => {
        await this.lockEscopo(tx, {
          clienteId: input.clienteId,
          obrigacao: input.obrigacao,
          competencia: competenciaDate,
        });
        return this.inserirNovaVersao(tx, {
          clienteId: input.clienteId,
          obrigacao: input.obrigacao,
          competenciaDate,
          entradas: input.entradas,
        });
      },
      { isolationLevel: 'repeatable read' },
    );
  }

  /**
   * Avança o estado de uma versão de fechamento respeitando a máquina de estados
   * (`RASCUNHO → PENDENTE → REVISADO`). Para `FECHADO` use `fechar`, que também
   * registra aprovação/corrente. Lança `ConflictException` para transições
   * inválidas (não há retrocesso nem salto de etapas).
   */
  async transicionar(
    fechamentoId: string,
    destino: Exclude<EstadoFechamento, 'FECHADO'>,
  ): Promise<FechamentoRegistro> {
    return this.database.db.transaction(
      async (tx) => {
        const atual = await this.carregarParaAtualizacao(tx, fechamentoId);
        FiscalClosingService.assertTransicao(atual.estado, destino);
        const [row] = await tx
          .update(fiscalFechamentos)
          .set({ estado: destino, atualizadoEm: new Date() })
          .where(eq(fiscalFechamentos.id, fechamentoId))
          .returning();
        return this.toRegistro(row);
      },
      { isolationLevel: 'repeatable read' },
    );
  }

  /**
   * Fecha e aprova a versão (REVISADO → FECHADO): registra `aprovadoPor` e
   * `fechadoEm`, e torna esta versão a CORRENTE do escopo — desmarcando a
   * corrente anterior na mesma transação, de modo que exista no máximo uma
   * corrente por (cliente, obrigação, competência) (R1.1). O índice único
   * parcial do schema é a garantia final; o desmarque explícito evita a
   * violação em vez de depender do erro do banco.
   */
  async fechar(input: {
    fechamentoId: string;
    aprovadoPor: string;
  }): Promise<FechamentoRegistro> {
    return this.database.db.transaction(
      async (tx) => {
        const atual = await this.carregarParaAtualizacao(tx, input.fechamentoId);
        FiscalClosingService.assertTransicao(atual.estado, 'FECHADO');
        await this.lockEscopo(tx, {
          clienteId: atual.clienteId,
          obrigacao: atual.obrigacao,
          competencia: atual.competencia,
        });
        // Desmarca a corrente vigente do escopo (exceto a própria linha) antes
        // de promover esta — garante a invariante de corrente única.
        await tx
          .update(fiscalFechamentos)
          .set({ corrente: false, atualizadoEm: new Date() })
          .where(
            and(
              eq(fiscalFechamentos.clienteId, atual.clienteId),
              eq(fiscalFechamentos.obrigacao, atual.obrigacao),
              eq(fiscalFechamentos.competencia, atual.competencia),
              eq(fiscalFechamentos.corrente, true),
            ),
          );
        const [row] = await tx
          .update(fiscalFechamentos)
          .set({
            estado: 'FECHADO',
            corrente: true,
            aprovadoPor: input.aprovadoPor,
            fechadoEm: new Date(),
            atualizadoEm: new Date(),
          })
          .where(eq(fiscalFechamentos.id, input.fechamentoId))
          .returning();
        return this.toRegistro(row);
      },
      { isolationLevel: 'repeatable read' },
    );
  }

  /** Carrega um fechamento por id (projeção), ou lança 404. */
  async obter(fechamentoId: string): Promise<FechamentoRegistro> {
    const [row] = await this.database.db
      .select()
      .from(fiscalFechamentos)
      .where(eq(fiscalFechamentos.id, fechamentoId))
      .limit(1);
    if (!row) {
      throw new NotFoundException('Fechamento não encontrado.');
    }
    return this.toRegistro(row);
  }

  /** A versão corrente (FECHADO) de um escopo, ou `null` se ainda não há. */
  async obterCorrente(
    escopo: FechamentoEscopo,
  ): Promise<FechamentoRegistro | null> {
    this.assertObrigacao(escopo.obrigacao);
    const competenciaDate = this.resolverCompetenciaDate(
      escopo.competencia,
      escopo.obrigacao,
    );
    const [row] = await this.database.db
      .select()
      .from(fiscalFechamentos)
      .where(
        and(
          eq(fiscalFechamentos.clienteId, escopo.clienteId),
          eq(fiscalFechamentos.obrigacao, escopo.obrigacao),
          eq(fiscalFechamentos.competencia, competenciaDate),
          eq(fiscalFechamentos.corrente, true),
        ),
      )
      .limit(1);
    return row ? this.toRegistro(row) : null;
  }

  /**
   * Projeta o contrato `ResultadoApuracao` (plano §6.3 / Tarefa 3.3) de uma
   * versão de fechamento, com o detalhamento PAGINADO a partir do snapshot
   * congelado (ponte documentos→lançamentos→apuração, R2.2). NÃO recomputa nada:
   * totais, memórias, inconsistências e detalhamento saem exclusivamente dos
   * `jsonb` congelados — a mesma versão sempre projeta o mesmo resultado
   * (R1.1/R1.2). Lança 404 quando o fechamento não existe.
   */
  async projetarApuracao(
    fechamentoId: string,
    options?: ResultadoApuracaoProjecaoOptions,
  ): Promise<ResultadoApuracao> {
    const [row] = await this.database.db
      .select()
      .from(fiscalFechamentos)
      .where(eq(fiscalFechamentos.id, fechamentoId))
      .limit(1);
    if (!row) {
      throw new NotFoundException('Fechamento não encontrado.');
    }
    const snapshots: FechamentoSnapshots = {
      documentos: row.documentos,
      saldos: row.saldos,
      parametros: row.parametros,
    };
    return projetarResultadoApuracao(this.toRegistro(row), snapshots, options);
  }

  /**
   * Monta a PONTE DE CONCILIAÇÃO por tributo (F03 / R2.2, R2.4 — Tarefa 4.1) de
   * uma versão de fechamento: a trilha auditável documentos → lançamentos →
   * apuração → livro → E110, com cada ajuste entre etapas EXPLICADO (R2.2) e a
   * verificação de que livro e E110 batem para a mesma versão (R2.4).
   *
   * Reusa o MESMO projetor do contrato `ResultadoApuracao` (sem segundo motor):
   * lê os snapshots CONGELADOS da versão e delega ao núcleo puro
   * `montarPonteConciliacao`. Lança 404 quando o fechamento não existe.
   */
  async conciliarPonte(fechamentoId: string): Promise<PonteConciliacao> {
    const [row] = await this.database.db
      .select()
      .from(fiscalFechamentos)
      .where(eq(fiscalFechamentos.id, fechamentoId))
      .limit(1);
    if (!row) {
      throw new NotFoundException('Fechamento não encontrado.');
    }
    const snapshots: FechamentoSnapshots = {
      documentos: row.documentos,
      saldos: row.saldos,
      parametros: row.parametros,
    };
    return montarPonteConciliacao(this.toRegistro(row), snapshots);
  }

  // ------------------------------------------------------------------
  // Núcleo PURO (sem banco): composição, canonicalização, hash, estados.
  // Estático para ser testável de forma determinística e reusável pelas
  // tarefas 3.3–3.7 sem recomputar por caminhos divergentes.
  // ------------------------------------------------------------------

  /**
   * Congela as entradas numa cópia profunda imutável — a fotografia estável que
   * será persistida nos snapshots JSONB. Normaliza as coleções para arrays
   * materializados, de modo que o que entra no hash seja exatamente o que é
   * gravado.
   */
  static congelarEntradas(entradas: FechamentoEntradas): {
    documentos: Array<Record<string, unknown>>;
    decisoes: Array<Record<string, unknown>>;
    regras: Array<Record<string, unknown>>;
    parametros: Record<string, unknown>;
    saldos: Record<string, unknown>;
  } {
    return {
      documentos: entradas.documentos.map((d) => ({ ...d })),
      decisoes: entradas.decisoes.map((d) => ({ ...d })),
      regras: entradas.regras.map((r) => ({ ...r })),
      parametros: { ...entradas.parametros },
      saldos: { ...entradas.saldos },
    };
  }

  /**
   * Calcula o `hashEntradas` SHA-256 (hex minúsculo, 64 chars — mesmo formato
   * dos arquivos SPED) sobre a serialização CANÔNICA das entradas congeladas,
   * do escopo (obrigação/competência) e da versão do motor. Mesmas entradas →
   * mesmo hash (R1.2); mudar o motor muda o hash (reprodutibilidade versionada).
   *
   * A canonicalização ordena chaves de objeto e serializa valores de forma
   * estável (ver `canonicalize`), de modo que a ORDEM de inserção das chaves ou
   * um reencode do JSON não alterem o resultado.
   */
  static calcularHashEntradas(
    obrigacao: ObrigacaoFechamento,
    competenciaDate: string,
    entradas: FechamentoEntradas,
  ): string {
    const payload = {
      motorVersao: FISCAL_CLOSING_MOTOR_VERSAO,
      obrigacao,
      competencia: competenciaDate,
      documentos: entradas.documentos,
      decisoes: entradas.decisoes,
      regras: entradas.regras,
      parametros: entradas.parametros,
      saldos: entradas.saldos,
    };
    const canonical = canonicalJsonStringify(payload);
    return createHash('sha256').update(canonical, 'utf8').digest('hex');
  }

  /**
   * Valida uma transição de estado contra a máquina `RASCUNHO → PENDENTE →
   * REVISADO → FECHADO`. Lança `ConflictException` quando a transição não é
   * permitida (uma versão fechada é imutável; não há retrocesso nem salto).
   */
  static assertTransicao(
    origem: EstadoFechamento,
    destino: EstadoFechamento,
  ): void {
    const permitidas = TRANSICOES_VALIDAS[origem];
    if (!permitidas.includes(destino)) {
      throw new ConflictException(
        `Transição de fechamento inválida: ${origem} → ${destino}.`,
      );
    }
  }

  // ------------------------------------------------------------------
  // Helpers com efeito (dentro de transação).
  // ------------------------------------------------------------------

  /**
   * Monta a CHAVE do advisory lock de um escopo de fechamento. É a MESMA chave
   * usada pela abertura/fechamento (EFD) — expor a montagem num só lugar garante
   * que todos os caminhos (geração, importação, baixa de bem, edição de regra)
   * derivem exatamente o mesmo texto e, portanto, SERIALIZEM entre si (R1.6).
   */
  static chaveLockEscopo(escopo: {
    clienteId: string;
    obrigacao: string;
    competencia: string;
  }): string {
    return `fiscal-fechamento:${escopo.clienteId}:${escopo.obrigacao}:${escopo.competencia}`;
  }

  /**
   * Primitiva de LOCK REUSÁVEL (R1.6, tarefa 3.4).
   *
   * Permite que QUALQUER escritor que altere as entradas de um fechamento
   * (importação de documento, baixa/apropriação de bem CIAP, edição de regra
   * fiscal) participe do MESMO advisory lock transacional por escopo
   * (cliente/obrigação/competência) usado pela geração EFD e pela abertura/
   * fechamento. O escritor adquire o lock DENTRO da sua própria transação
   * `repeatable read` e executa a mutação em `fn` — assim escritas que afetam
   * a mesma competência se serializam, em vez de correr em paralelo e produzir
   * um fechamento irreproduzível.
   *
   * A `competencia` é normalizada para 'AAAA-MM-01' pela MESMA política de
   * período (F14), de modo que 'AAAA-MM' e 'AAAA-MM-01' colidam na mesma chave.
   */
  async withEscopoLock<T>(
    tx: FechamentoTx,
    escopo: FechamentoEscopo,
    fn: () => Promise<T>,
  ): Promise<T> {
    this.assertObrigacao(escopo.obrigacao);
    const competenciaDate = this.resolverCompetenciaDate(
      escopo.competencia,
      escopo.obrigacao,
    );
    await this.lockEscopo(tx, {
      clienteId: escopo.clienteId,
      obrigacao: escopo.obrigacao,
      competencia: competenciaDate,
    });
    return fn();
  }

  /**
   * HOOK de sinalização de revisão para escritores (R1.3/R1.4, tarefa 3.4).
   *
   * Deve ser chamado por um escritor DEPOIS de adquirir o lock do escopo (via
   * {@link withEscopoLock}) e ANTES de mutar dados que mudariam o fechamento da
   * competência. Informa se já existe uma versão CORRENTE FECHADA: nesse caso o
   * escritor NÃO pode sobrescrever a entrega congelada — a competência passa a
   * precisar de revisão/nova versão.
   *
   * Primitiva de SOMENTE DETECÇÃO (não escreve nada): é uma leitura dentro da
   * transação do escritor, consistente com o lock já adquirido. Para o fluxo
   * completo — detectar E abrir/reutilizar a versão de revisão — os escritores
   * usam {@link sinalizarRevisaoPosFechamento} (tarefa 3.5), que compartilha
   * esta mesma consulta de corrente fechada. Mantida como primitiva pública para
   * chamadores que só precisam saber se a competência está fechada.
   */
  async sinalizarRevisaoSeFechado(
    tx: FechamentoTx,
    escopo: FechamentoEscopo,
  ): Promise<SinalRevisaoFechamento> {
    this.assertObrigacao(escopo.obrigacao);
    const competenciaDate = this.resolverCompetenciaDate(
      escopo.competencia,
      escopo.obrigacao,
    );
    const [row] = await tx
      .select({ id: fiscalFechamentos.id })
      .from(fiscalFechamentos)
      .where(
        and(
          eq(fiscalFechamentos.clienteId, escopo.clienteId),
          eq(fiscalFechamentos.obrigacao, escopo.obrigacao),
          eq(fiscalFechamentos.competencia, competenciaDate),
          eq(fiscalFechamentos.estado, 'FECHADO'),
          eq(fiscalFechamentos.corrente, true),
        ),
      )
      .limit(1);
    return {
      fechado: Boolean(row),
      fechamentoCorrenteId: row?.id ?? null,
    };
  }

  /**
   * Sinaliza revisão de uma competência JÁ FECHADA quando uma escrita a afeta
   * (importação, baixa de bem, edição de regra) — tarefa 3.5 (R1.3/R1.4).
   *
   * Deve ser chamado por um escritor DEPOIS de adquirir o lock do escopo (via
   * {@link withEscopoLock}), no lugar do mero {@link sinalizarRevisaoSeFechado}:
   * não só detecta a entrega congelada como também ABRE a versão de revisão.
   *
   * Comportamento:
   * - Sem corrente FECHADA no escopo → nada a sinalizar; a escrita segue normal
   *   (ainda não há entrega a preservar) e nenhuma versão é aberta.
   * - Com corrente FECHADA → a entrega NÃO é tocada (R1.3): abre uma NOVA versão
   *   RASCUNHO (a próxima sequencial) que CARREGA ADIANTE os snapshots da
   *   corrente fechada, de modo que a competência passe a ter uma revisão em
   *   aberto. A existência dessa revisão sobre a corrente é o SINAL de "precisa
   *   de revisão". É IDEMPOTENTE: se já existe uma revisão aberta (versão
   *   não-FECHADA mais nova que a corrente), reutiliza-a em vez de abrir outra —
   *   várias escritas na mesma competência fechada convergem para a mesma versão
   *   de revisão, não multiplicam rascunhos.
   *
   * NÃO recomputa saldos nem reescreve a entrega: apenas garante que exista um
   * ponto de trabalho (a revisão) separado da versão congelada. Fechar e promover
   * a revisão é o fluxo normal `transicionar`/`fechar` (que a torna a nova
   * corrente, deixando a anterior como histórico intacto — R1.4).
   */
  async sinalizarRevisaoPosFechamento(
    tx: FechamentoTx,
    escopo: FechamentoEscopo,
  ): Promise<RevisaoPosFechamento> {
    this.assertObrigacao(escopo.obrigacao);
    const competenciaDate = this.resolverCompetenciaDate(
      escopo.competencia,
      escopo.obrigacao,
    );
    const semRevisao = (
      sinal: SinalRevisaoFechamento,
    ): RevisaoPosFechamento => ({
      ...sinal,
      revisaoNecessaria: false,
      revisaoId: null,
      revisaoVersao: null,
      revisaoAberta: false,
    });

    const corrente = await this.carregarCorrenteFechada(tx, {
      clienteId: escopo.clienteId,
      obrigacao: escopo.obrigacao,
      competenciaDate,
    });
    // Sem entrega congelada: não há o que revisar — a escrita apenas participou
    // do lock e segue o fluxo normal de fechamento.
    if (!corrente) {
      return semRevisao({ fechado: false, fechamentoCorrenteId: null });
    }

    const sinal: SinalRevisaoFechamento = {
      fechado: true,
      fechamentoCorrenteId: corrente.id,
    };

    // Idempotência: se já há uma revisão em aberto (versão não-FECHADA mais nova
    // que a corrente), reutiliza-a — não abre um segundo rascunho.
    const revisaoAbertaExistente = await this.carregarRevisaoAberta(tx, {
      clienteId: escopo.clienteId,
      obrigacao: escopo.obrigacao,
      competenciaDate,
      versaoCorrente: corrente.versao,
    });
    if (revisaoAbertaExistente) {
      return {
        ...sinal,
        revisaoNecessaria: true,
        revisaoId: revisaoAbertaExistente.id,
        revisaoVersao: revisaoAbertaExistente.versao,
        revisaoAberta: false,
      };
    }

    // Abre a NOVA versão de revisão em RASCUNHO carregando adiante os snapshots
    // da corrente fechada (a entrega congelada permanece intacta — R1.3/R1.4).
    const revisao = await this.inserirNovaVersao(tx, {
      clienteId: escopo.clienteId,
      obrigacao: escopo.obrigacao,
      competenciaDate,
      entradas: {
        documentos: corrente.documentos,
        decisoes: corrente.decisoes,
        regras: corrente.regras,
        parametros: corrente.parametros,
        saldos: corrente.saldos,
      },
    });
    return {
      ...sinal,
      revisaoNecessaria: true,
      revisaoId: revisao.id,
      revisaoVersao: revisao.versao,
      revisaoAberta: true,
    };
  }

  /**
   * Edita uma competência criando uma NOVA versão (R1.4): nunca muta uma versão
   * existente. As `entradas` fornecidas substituem o snapshot da nova versão
   * (tipicamente a corrente fechada ajustada); a entrega anterior permanece
   * intacta e segue sendo a corrente projetada até que esta nova versão seja
   * fechada/promovida pelo fluxo normal. É `abrir` com o rótulo semântico de
   * "edição" — serializa pelo mesmo lock de escopo e sela as novas entradas com
   * `motorVersao` + `hashEntradas`.
   */
  async editar(input: AbrirFechamentoInput): Promise<FechamentoRegistro> {
    return this.abrir(input);
  }

  /**
   * RETIFICA uma entrega criando uma NOVA versão que APONTA O ORIGINAL (R1.5,
   * tarefa 3.6).
   *
   * É uma edição com duas obrigações próprias: (1) a versão original a ser
   * corrigida deve estar FECHADA (não se retifica um rascunho — isso seria
   * `editar`); (2) a nova versão grava, de forma ADITIVA no snapshot
   * `parametros`, a referência à versão original (id/versão/hash) — o
   * "aponta o original" selado no `hashEntradas`. O escopo é herdado da versão
   * original (mesma competência/obrigação que se corrige). A entrega original
   * permanece INTACTA e corrente até que a retificação seja fechada/promovida
   * pelo fluxo normal (R1.4). A diferença entre as duas versões é obtida depois
   * via {@link diferencaRetificacao}; o vínculo do recibo do PVA ao hash é da
   * Fase 5 (seam em `retificacao-fechamento.ts`).
   *
   * Serializa pelo MESMO advisory lock de escopo das demais escritas (R1.6).
   */
  async retificar(
    input: RetificarFechamentoInput,
  ): Promise<FechamentoRegistro> {
    return this.database.db.transaction(
      async (tx) => {
        const original = await this.carregarParaAtualizacao(
          tx,
          input.originalFechamentoId,
        );
        // Só uma entrega FECHADA é retificável — corrigir um rascunho/pendente
        // é edição (R1.4), não retificação.
        if (original.estado !== 'FECHADO') {
          throw new ConflictException(
            'Só é possível retificar um fechamento FECHADO; use editar para ' +
            'versões ainda não entregues.',
          );
        }
        // A competência da linha original já está normalizada ('AAAA-MM-01');
        // reusa-se diretamente (mesmo padrão de `fechar`), sem re-resolver.
        const competenciaDate = original.competencia;
        await this.lockEscopo(tx, {
          clienteId: original.clienteId,
          obrigacao: original.obrigacao,
          competencia: competenciaDate,
        });
        const referencia: RetificacaoReferencia = {
          originalFechamentoId: original.id,
          originalVersao: original.versao,
          originalHashEntradas: original.hashEntradas,
        };
        // Grava o "aponta o original" de forma ADITIVA nos parâmetros, sem
        // perder os demais parâmetros fornecidos pelo chamador.
        const entradasRetificadoras: FechamentoEntradas = {
          ...input.entradas,
          parametros: comReferenciaRetificacao(
            input.entradas.parametros,
            referencia,
          ),
        };
        return this.inserirNovaVersao(tx, {
          clienteId: original.clienteId,
          obrigacao: original.obrigacao,
          competenciaDate,
          entradas: entradasRetificadoras,
        });
      },
      { isolationLevel: 'repeatable read' },
    );
  }

  /**
   * Projeta a DIFERENÇA de uma retificação (R1.5, tarefa 3.6): aponta o original
   * e expõe a diferença total a total entre a versão retificadora e a que ela
   * corrige. Lê a referência ao original gravada no snapshot `parametros` da
   * versão retificadora (não adivinha por sequência) e computa a diferença pelo
   * MESMO projetor do contrato `ResultadoApuracao` — sem segundo motor nem
   * recomputo. O vínculo do recibo do PVA ao hash fica como seam da Fase 5.
   *
   * Lança 404 quando a versão retificadora não existe e 400 quando ela não é
   * uma retificação (não aponta nenhum original).
   */
  async diferencaRetificacao(
    retificadoraId: string,
  ): Promise<DiferencaRetificacao> {
    const retificadoraRow = await this.carregarLinha(retificadoraId);
    if (!retificadoraRow) {
      throw new NotFoundException('Fechamento retificador não encontrado.');
    }
    const referencia = lerReferenciaRetificacao(retificadoraRow.parametros);
    if (!referencia) {
      throw new BadRequestException(
        'O fechamento informado não é uma retificação (não aponta um original).',
      );
    }
    const originalRow = await this.carregarLinha(
      referencia.originalFechamentoId,
    );
    if (!originalRow) {
      throw new NotFoundException(
        'Fechamento original da retificação não encontrado.',
      );
    }
    return montarDiferencaRetificacao({
      original: this.toRegistro(originalRow),
      originalSnapshots: this.snapshotsDaLinha(originalRow),
      retificadora: this.toRegistro(retificadoraRow),
      retificadoraSnapshots: this.snapshotsDaLinha(retificadoraRow),
    });
  }

  /**
   * Serializa escritas concorrentes do mesmo escopo (cliente/obrigação/
   * competência) por advisory lock transacional, no mesmo padrão da geração EFD
   * — base para que TODA escrita que altera o fechamento participe do
   * versionamento (R1.6, estendido nas tarefas 3.4+).
   */
  private async lockEscopo(
    tx: FechamentoTx,
    escopo: { clienteId: string; obrigacao: string; competencia: string },
  ): Promise<void> {
    const chave = FiscalClosingService.chaveLockEscopo(escopo);
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${chave}, 0))`,
    );
  }

  /**
   * Insere uma NOVA versão RASCUNHO do escopo congelando as `entradas` e selando
   * com `motorVersao` + `hashEntradas`. É o ÚNICO caminho de criação de versão —
   * compartilhado por `abrir`/`editar` (nova versão explícita) e por
   * `sinalizarRevisaoPosFechamento` (revisão de competência fechada) — para que
   * toda versão nasça pelas mesmas regras de congelamento/selo. PRESSUPÕE que o
   * chamador já adquiriu o lock de escopo (serialização da sequência de versão).
   */
  private async inserirNovaVersao(
    tx: FechamentoTx,
    input: {
      clienteId: string;
      obrigacao: ObrigacaoFechamento;
      competenciaDate: string;
      entradas: FechamentoEntradas;
    },
  ): Promise<FechamentoRegistro> {
    const congeladas = FiscalClosingService.congelarEntradas(input.entradas);
    const hashEntradas = FiscalClosingService.calcularHashEntradas(
      input.obrigacao,
      input.competenciaDate,
      congeladas,
    );
    const proximaVersao = await this.proximaVersao(tx, {
      clienteId: input.clienteId,
      obrigacao: input.obrigacao,
      competenciaDate: input.competenciaDate,
    });
    const [row] = await tx
      .insert(fiscalFechamentos)
      .values({
        clienteId: input.clienteId,
        obrigacao: input.obrigacao,
        competencia: input.competenciaDate,
        versao: proximaVersao,
        estado: 'RASCUNHO',
        corrente: false,
        motorVersao: FISCAL_CLOSING_MOTOR_VERSAO,
        hashEntradas,
        documentos: congeladas.documentos as Array<Record<string, unknown>>,
        decisoes: congeladas.decisoes as Array<Record<string, unknown>>,
        regras: congeladas.regras as Array<Record<string, unknown>>,
        parametros: congeladas.parametros,
        saldos: congeladas.saldos,
      })
      .returning();
    return this.toRegistro(row);
  }

  /**
   * Carrega a versão CORRENTE FECHADA do escopo com seus snapshots congelados
   * (ou `null`), para que `sinalizarRevisaoPosFechamento` carregue as entradas
   * adiante na revisão sem recomputar. É a leitura DENTRO da transação do
   * escritor, consistente com o lock de escopo já adquirido.
   */
  private async carregarCorrenteFechada(
    tx: FechamentoTx,
    escopo: {
      clienteId: string;
      obrigacao: ObrigacaoFechamento;
      competenciaDate: string;
    },
  ): Promise<typeof fiscalFechamentos.$inferSelect | null> {
    const [row] = await tx
      .select()
      .from(fiscalFechamentos)
      .where(
        and(
          eq(fiscalFechamentos.clienteId, escopo.clienteId),
          eq(fiscalFechamentos.obrigacao, escopo.obrigacao),
          eq(fiscalFechamentos.competencia, escopo.competenciaDate),
          eq(fiscalFechamentos.estado, 'FECHADO'),
          eq(fiscalFechamentos.corrente, true),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /**
   * Carrega a revisão JÁ ABERTA do escopo — uma versão não-FECHADA mais nova que
   * a corrente — se existir. Garante a idempotência de
   * `sinalizarRevisaoPosFechamento`: várias escritas na mesma competência fechada
   * convergem para a mesma versão de revisão, em vez de abrir rascunhos repetidos.
   */
  private async carregarRevisaoAberta(
    tx: FechamentoTx,
    escopo: {
      clienteId: string;
      obrigacao: ObrigacaoFechamento;
      competenciaDate: string;
      versaoCorrente: number;
    },
  ): Promise<{ id: string; versao: number } | null> {
    const [row] = await tx
      .select({ id: fiscalFechamentos.id, versao: fiscalFechamentos.versao })
      .from(fiscalFechamentos)
      .where(
        and(
          eq(fiscalFechamentos.clienteId, escopo.clienteId),
          eq(fiscalFechamentos.obrigacao, escopo.obrigacao),
          eq(fiscalFechamentos.competencia, escopo.competenciaDate),
          sql`${fiscalFechamentos.estado} <> 'FECHADO'`,
          sql`${fiscalFechamentos.versao} > ${escopo.versaoCorrente}`,
        ),
      )
      .orderBy(desc(fiscalFechamentos.versao))
      .limit(1);
    return row ?? null;
  }

  /** Próxima versão sequencial do escopo (1 quando ainda não há nenhuma). */
  private async proximaVersao(
    tx: FechamentoTx,
    escopo: {
      clienteId: string;
      obrigacao: ObrigacaoFechamento;
      competenciaDate: string;
    },
  ): Promise<number> {
    const [ultima] = await tx
      .select({ versao: fiscalFechamentos.versao })
      .from(fiscalFechamentos)
      .where(
        and(
          eq(fiscalFechamentos.clienteId, escopo.clienteId),
          eq(fiscalFechamentos.obrigacao, escopo.obrigacao),
          eq(fiscalFechamentos.competencia, escopo.competenciaDate),
        ),
      )
      .orderBy(desc(fiscalFechamentos.versao))
      .limit(1);
    return (ultima?.versao ?? 0) + 1;
  }

  /**
   * Carrega a LINHA bruta de um fechamento (com snapshots), ou `null`. Usado
   * pela diferença da retificação, que precisa dos snapshots congelados das
   * duas versões (original e retificadora) para projetar e subtrair os totais.
   */
  private async carregarLinha(
    fechamentoId: string,
  ): Promise<typeof fiscalFechamentos.$inferSelect | null> {
    const [row] = await this.database.db
      .select()
      .from(fiscalFechamentos)
      .where(eq(fiscalFechamentos.id, fechamentoId))
      .limit(1);
    return row ?? null;
  }

  /** Extrai os snapshots congelados de uma linha para projeção/diferença. */
  private snapshotsDaLinha(
    row: typeof fiscalFechamentos.$inferSelect,
  ): FechamentoSnapshots {
    return {
      documentos: row.documentos,
      saldos: row.saldos,
      parametros: row.parametros,
    };
  }

  /** Carrega um fechamento (projeção) dentro de uma transação, ou lança 404. */
  private async carregarParaAtualizacao(
    tx: FechamentoTx,
    fechamentoId: string,
  ): Promise<FechamentoRegistro> {
    const [row] = await tx
      .select()
      .from(fiscalFechamentos)
      .where(eq(fiscalFechamentos.id, fechamentoId))
      .limit(1);
    if (!row) {
      throw new NotFoundException('Fechamento não encontrado.');
    }
    return this.toRegistro(row);
  }

  /**
   * Resolve a competência mensal 'AAAA-MM' para a data 'AAAA-MM-01' usada na
   * coluna `competencia`, pela MESMA política de período (F14) — o
   * `BadRequestException` de formato vem de `resolvePeriodo`.
   */
  private resolverCompetenciaDate(
    competencia: string,
    obrigacao: ObrigacaoFechamento,
  ): string {
    const { periodo } = this.periodSelection.predicadoPeriodo(
      competencia,
      FINALIDADE_POR_OBRIGACAO[obrigacao],
    );
    return periodo.competenciaDate;
  }

  private assertObrigacao(obrigacao: ObrigacaoFechamento): ObrigacaoFechamento {
    if (!OBRIGACOES_VALIDAS.has(obrigacao)) {
      throw new BadRequestException(
        `Obrigação de fechamento inválida: "${obrigacao}".`,
      );
    }
    return obrigacao;
  }

  /** Converte a linha do banco na projeção pública `FechamentoRegistro`. */
  private toRegistro(
    row: typeof fiscalFechamentos.$inferSelect,
  ): FechamentoRegistro {
    return {
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
    };
  }
}

/**
 * Serialização JSON CANÔNICA e estável, base da reprodutibilidade do hash
 * (R1.2). Diferente de `JSON.stringify`, garante:
 *
 * - chaves de objeto em ordem lexicográfica (a ordem de inserção não importa);
 * - `undefined`/funções/símbolos descartados (chaves com `undefined` somem);
 * - `null` preservado;
 * - NENHUM valor monetário é tratado como `Number`: números JS são serializados
 *   só quando são inteiros seguros (contadores, versões); qualquer valor
 *   decimal DEVE chegar como string (restrição da fase) e é serializado como
 *   string. Um `number` não-inteiro é um erro de uso (impediria o determinismo
 *   do ponto flutuante) e é rejeitado explicitamente.
 *
 * É exportada para ser testada isoladamente (determinismo do hash).
 */
export function canonicalJsonStringify(value: unknown): string {
  return canonicalize(value);
}

function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  const tipo = typeof value;
  if (tipo === 'string') return JSON.stringify(value);
  if (tipo === 'boolean') return value ? 'true' : 'false';
  if (tipo === 'number') {
    const n = value as number;
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      throw new BadRequestException(
        'Valor numérico não-inteiro em entrada de fechamento: valores decimais ' +
        'DEVEM ser strings (nunca Number) para o hash ser reproduzível.',
      );
    }
    return String(n);
  }
  if (tipo === 'bigint') return (value as bigint).toString();
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  }
  if (tipo === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((key) => obj[key] !== undefined && typeof obj[key] !== 'function')
      .sort();
    const entries = keys.map(
      (key) => `${JSON.stringify(key)}:${canonicalize(obj[key])}`,
    );
    return `{${entries.join(',')}}`;
  }
  // undefined / function / symbol fora de objeto/array: sem representação.
  throw new BadRequestException(
    `Valor não serializável em entrada de fechamento: ${tipo}.`,
  );
}
