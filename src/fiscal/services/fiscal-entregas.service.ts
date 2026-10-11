import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service';
import {
  clientes,
  eventosAuditoria,
  fiscalEntregas,
  fiscalFechamentos,
  storageCleanupJobs,
} from '../../database/schema';
import { StorageService } from '../../storage/storage.service';
import { StorageCleanupService } from '../../storage/storage-cleanup.service';
import { AppLogger } from '../../common/logger.service';
import { parseCompetenciaMensal } from '../fiscal-date.util';
import { fromScaledInteger, toScaledInteger } from '../sped/sped-decimal';
import {
  confirmarVersaoPva,
  LeiauteVigenciaError,
  resolverLeiautePorVigencia,
} from './fiscal-leiaute-vigencia';

/**
 * Obrigação acessória entregue. Mesmo domínio restrito por CHECK em
 * `fiscal_entregas.obrigacao` (schema) e em `fiscal_fechamentos.obrigacao`.
 */
export type ObrigacaoEntrega =
  'EFD_ICMS_IPI' | 'EFD_CONTRIBUICOES' | 'GIA' | 'DAS' | 'DAPI';

const OBRIGACOES_ENTREGA: ReadonlySet<ObrigacaoEntrega> =
  new Set<ObrigacaoEntrega>([
    'EFD_ICMS_IPI',
    'EFD_CONTRIBUICOES',
    'GIA',
    'DAS',
    'DAPI',
  ]);

// Hash SHA-256 em hexadecimal minúsculo (mesmo formato dos arquivos SPED e do
// `hash_entradas` do fechamento). Reforço fora do HTTP do CHECK do banco.
const HASH_SHA256_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Incremento ATÔMICO de `tentativas_storage` no próprio UPDATE (não lê-então-
 * escreve): `tentativas_storage = tentativas_storage + 1`. Mantém a contagem
 * fiel sob retries concorrentes.
 */
function sqlTentativaIncremento() {
  return sql`${fiscalEntregas.tentativasStorage} + 1`;
}

/**
 * Entrada para REGISTRAR UMA ENTREGA ORIGINAL de uma obrigação acessória
 * (R2.1/R2.4). A entrega persiste APENAS keys do storage (`arquivoKey`,
 * `reciboKey`), nunca URLs (SKILL). O recibo/comprovante do PVA fica amarrado
 * ao hash do fechamento (R2.4): quando a entrega referencia uma versão de
 * apuração (`fechamentoId`), o `hashArquivo` informado DEVE ser o
 * `hash_entradas` daquele fechamento — assim o comprovante nunca sela um
 * arquivo divergente da apuração que ele declara.
 */
export interface RegistrarEntregaInput {
  clienteId: string;
  competencia: string; // 'YYYY-MM'
  obrigacao: ObrigacaoEntrega;
  /** Key do arquivo entregue no storage (nunca URL — SKILL). */
  arquivoKey: string;
  /** SHA-256 do conteúdo entregue (hex minúsculo). Sela o que foi transmitido. */
  hashArquivo: string;
  /** Programa validador (PVA) e sua versão operacional confirmada (N05). */
  pvaPrograma: string;
  pvaVersao: string;
  /**
   * Confirmação EXPLÍCITA da versão do PVA usada na homologação (N05). DEVE
   * casar `pvaVersao` — a versão nunca é presumida como "a última"; a
   * homologação registra a versão que de fato foi usada. Sem a confirmação, a
   * entrega é rejeitada (tarefa 2.4).
   */
  pvaVersaoConfirmada: string;
  /**
   * Versão do leiaute aplicada (ex.: '3.2.2'/'3.2.3' — N03/N04). OPCIONAL: se
   * omitida, é DERIVADA da vigência da competência; se informada, DEVE casar o
   * leiaute esperado para a vigência (sem reutilização silenciosa — R2.5).
   */
  leiauteVersao?: string;
  /**
   * Versão de apuração (fechamento da Fase 3) que originou a entrega. Quando
   * informado, DEVE existir e pertencer ao mesmo cliente, e o `hashArquivo`
   * DEVE casar com o `hash_entradas` do fechamento — é o vínculo recibo ↔ hash
   * do fechamento (R2.4).
   */
  fechamentoId?: string;
  statusValidacao?: StatusValidacaoEntrega;
  validacaoResultado?: Record<string, unknown>;
  assinaturaTitular?: string;
  assinaturaEm?: Date;
  protocoloNumero?: string;
  /** Key do comprovante/recibo do PVA no storage (nunca URL — SKILL). */
  reciboKey?: string;
  transmitidaEm?: Date;
}

export type StatusValidacaoEntrega =
  'PENDENTE' | 'VALIDADA' | 'REJEITADA' | 'TRANSMITIDA' | 'FALHA_STORAGE';

/**
 * Entrada para RETIFICAR uma entrega (R2.2). Cria uma entrega NOVA que
 * referencia a original (`entregaOriginalId`), carrega a diferença
 * (`valorDiferenca`) e seu PRÓPRIO recibo — SEM sobrescrever a entrega anterior,
 * que permanece imutável na trilha. O novo arquivo/recibo são sempre keys do
 * storage (SKILL). A obrigação e a competência da retificadora são herdadas da
 * original (uma retificação é da MESMA obrigação/competência).
 */
export interface RetificarEntregaInput {
  clienteId: string;
  /** Entrega original a retificar (deve ser do mesmo cliente e não retificada). */
  entregaOriginalId: string;
  /** Key do novo arquivo entregue (nunca URL — SKILL). */
  arquivoKey: string;
  /** SHA-256 do novo arquivo entregue (hex minúsculo). */
  hashArquivo: string;
  /** Diferença da retificação (decimal, nunca `Number`). Pode ser negativa. */
  valorDiferenca: string;
  pvaPrograma: string;
  pvaVersao: string;
  /**
   * Confirmação EXPLÍCITA da versão do PVA usada na homologação da retificadora
   * (N05). DEVE casar `pvaVersao`; sem ela a retificação é rejeitada (tarefa 2.4).
   */
  pvaVersaoConfirmada: string;
  /**
   * Versão do leiaute aplicada. OPCIONAL: se omitida, é DERIVADA da vigência da
   * competência (herdada da original); se informada, DEVE casar o leiaute
   * esperado para a vigência (R2.5).
   */
  leiauteVersao?: string;
  /**
   * Versão de apuração da retificadora. Default: herda o `fechamentoId` da
   * original. Quando informado, DEVE existir e ser do mesmo cliente, e o
   * `hashArquivo` DEVE casar com o `hash_entradas` desse fechamento (R2.4).
   */
  fechamentoId?: string;
  statusValidacao?: StatusValidacaoEntrega;
  validacaoResultado?: Record<string, unknown>;
  assinaturaTitular?: string;
  assinaturaEm?: Date;
  protocoloNumero?: string;
  /** Key do recibo/comprovante PRÓPRIO da retificadora (nunca URL — SKILL). */
  reciboKey?: string;
  transmitidaEm?: Date;
}

/**
 * Entrada do upload do arquivo da entrega para o storage externo (R2). O
 * conteúdo (`conteudo`) é entregue como bytes e NUNCA é persistido no banco —
 * só a `arquivoKey` (SKILL). O upload acontece FORA da transação do snapshot: o
 * snapshot da entrega commita primeiro; o upload externo é o passo que pode
 * falhar e ser retentado.
 */
export interface EntregaUploadInput {
  /** Key de destino no storage (nunca URL — SKILL). */
  arquivoKey: string;
  /** Bytes do arquivo entregue. */
  conteudo: Buffer | Uint8Array;
  /** Content-type do objeto (ex.: TXT SPED em ISO-8859-1). */
  contentType: string;
}

/**
 * Entrada para registrar uma entrega COM o upload externo do arquivo (R2.3). O
 * snapshot da entrega é gravado numa transação de banco; o upload do arquivo ao
 * storage externo NÃO participa dela. É o caminho que exercita a falha de
 * storage pós-snapshot: compensação (fila de limpeza do R2) + status
 * FALHA_STORAGE + retry rastreável.
 */
export interface RegistrarEntregaComUploadInput extends RegistrarEntregaInput {
  upload: EntregaUploadInput;
  /** Ator (usuário) para a trilha de auditoria do upload/retry. */
  actorUserId?: string;
  requestId?: string;
}

/**
 * Entrada para RETENTAR o upload de uma entrega que ficou em FALHA_STORAGE
 * (R2.3). O retry é AMARRADO ao MESMO snapshot (`entregaId`) — nunca cria uma
 * entrega nova. Reusa a `arquivo_key` já selada no snapshot; só reenvia os bytes
 * ao storage externo. Em sucesso, o status volta a um estado de sucesso
 * (default PENDENTE — o ciclo de validação do PVA segue dali).
 */
export interface RetentarUploadEntregaInput {
  clienteId: string;
  /** Entrega em FALHA_STORAGE cujo upload será reenviado (mesmo snapshot). */
  entregaId: string;
  /** Bytes do arquivo a reenviar. */
  conteudo: Buffer | Uint8Array;
  contentType: string;
  /** Status de sucesso para o qual transicionar após o retry (default PENDENTE). */
  statusSucesso?: Exclude<StatusValidacaoEntrega, 'FALHA_STORAGE'>;
  actorUserId?: string;
  requestId?: string;
}

@Injectable()
export class FiscalEntregasService {
  constructor(
    private readonly database: DatabaseService,
    private readonly storage: StorageService,
    private readonly storageCleanup: StorageCleanupService,
    private readonly logger: AppLogger,
  ) {}

  /**
   * R2.1/R2.4 (Fase 5, tarefa 2.2): registra uma ENTREGA ORIGINAL de uma
   * obrigação acessória. Persiste arquivo (key), hash, PVA/versão, validação,
   * assinatura, protocolo/recibo (key) e a vigência do leiaute. É sempre uma
   * entrega original — não carrega vínculo de retificação nem diferença (a
   * retificação é um caminho separado e deliberado, `retificarEntrega`).
   *
   * Quando a entrega referencia uma versão de apuração (`fechamentoId`), o
   * vínculo recibo ↔ hash do fechamento (R2.4) é verificado: o fechamento DEVE
   * existir e ser do cliente, e o `hashArquivo` DEVE ser o `hash_entradas`
   * daquele fechamento — fecha o caminho que selaria um recibo sobre um arquivo
   * divergente da apuração declarada.
   */
  async registrarEntrega(input: RegistrarEntregaInput) {
    await this.assertCliente(input.clienteId);
    const competencia = this.competenciaCompeta(input.competencia);
    this.assertObrigacao(input.obrigacao);
    const hashArquivo = this.normalizarHash(input.hashArquivo);

    // R2.5 (N03/N04): o leiaute segue a VIGÊNCIA da competência — derivado
    // quando omitido, validado quando informado. Nunca reutiliza o leiaute de
    // outra vigência silenciosamente.
    const leiauteVersao = this.resolverLeiaute(
      competencia,
      input.leiauteVersao,
    );
    // N05: a versão do PVA usada na homologação é a CONFIRMADA, nunca presumida.
    const pvaVersao = this.confirmarPva(
      input.pvaVersao,
      input.pvaVersaoConfirmada,
    );

    // R2.4: amarra o recibo/comprovante ao hash do fechamento. Quando há vínculo
    // de apuração, o hash do arquivo entregue tem de ser o das entradas
    // congeladas do fechamento — não um hash qualquer.
    const fechamentoId = await this.resolverFechamento(
      input.clienteId,
      input.fechamentoId,
      hashArquivo,
    );

    const rows = await this.database.db
      .insert(fiscalEntregas)
      .values({
        clienteId: input.clienteId,
        fechamentoId,
        obrigacao: input.obrigacao,
        competencia,
        arquivoKey: input.arquivoKey,
        hashArquivo,
        pvaPrograma: input.pvaPrograma,
        pvaVersao,
        statusValidacao: input.statusValidacao ?? 'PENDENTE',
        validacaoResultado: input.validacaoResultado ?? {},
        assinaturaTitular: input.assinaturaTitular ?? null,
        assinaturaEm: input.assinaturaEm ?? null,
        protocoloNumero: input.protocoloNumero ?? null,
        reciboKey: input.reciboKey ?? null,
        // Entrega ORIGINAL: nunca referencia outra entrega nem carrega diferença.
        entregaOriginalId: null,
        valorDiferenca: null,
        leiauteVersao,
        transmitidaEm: input.transmitidaEm ?? null,
      })
      .returning();
    return this.toEntregaResponse(rows[0]);
  }

  /**
   * R2.2 (Fase 5, tarefa 2.2): RETIFICA uma entrega criando uma entrega NOVA que
   * aponta a original (`entregaOriginalId`), carrega a DIFERENÇA
   * (`valorDiferenca`) e tem o SEU PRÓPRIO recibo — SEM sobrescrever a entrega
   * anterior. A original permanece imutável: este método nunca a atualiza nem a
   * apaga; apenas lê para validar o vínculo e herdar obrigação/competência.
   *
   * Rejeita (antes de qualquer escrita):
   * - original inexistente ou de OUTRO cliente → NotFound (escopo por cliente,
   *   indistinguível de inexistente);
   * - original que JÁ FOI RETIFICADA (já é a origem de outra retificadora) →
   *   BadRequest: retifica-se a entrega vigente, não uma já superada;
   * - original que é ela mesma uma retificadora de uma terceira entrega →
   *   BadRequest: a trilha de retificação referencia sempre a entrega-base;
   * - auto-retificação (uma entrega retificar a si mesma) é impossível por
   *   construção aqui (a nova entrega tem id próprio) e barrada no banco.
   */
  async retificarEntrega(input: RetificarEntregaInput) {
    await this.assertCliente(input.clienteId);
    const hashArquivo = this.normalizarHash(input.hashArquivo);

    // A original DEVE existir e ser do cliente (escopo). Carregamos para validar
    // o vínculo e herdar obrigação/competência — nunca para alterá-la.
    const original = await this.carregarEntregaDoCliente(
      input.clienteId,
      input.entregaOriginalId,
    );

    // A trilha de retificação referencia sempre a entrega-base: uma retificadora
    // não pode ser o alvo de outra retificação (encadeamento), para manter o par
    // original/retificação explícito e a original-base imutável.
    if (original.entregaOriginalId != null) {
      throw new BadRequestException(
        'A entrega indicada já é uma retificação. Retifique a entrega original ' +
          '(a entrega-base), não uma retificadora, para preservar a trilha (R2.2).',
      );
    }

    // Uma entrega já superada (que já é a origem de outra retificadora) não pode
    // ser retificada de novo: retifica-se a entrega vigente, não uma anterior.
    await this.assertEntregaNaoRetificada(input.clienteId, original.id);

    // A diferença é obrigatória e decimal na retificação (pode ser negativa — a
    // retificação pode reduzir o valor). Reforço fora do HTTP.
    const valorDiferenca = this.normalizarDiferenca(input.valorDiferenca);

    // R2.5 (N03/N04): o leiaute da retificadora segue a VIGÊNCIA da competência
    // da original (uma retificação é da MESMA competência). Derivado quando
    // omitido; validado quando informado — sem reutilização silenciosa.
    const leiauteVersao = this.resolverLeiaute(
      original.competencia,
      input.leiauteVersao,
    );
    // N05: versão do PVA da retificadora também é CONFIRMADA, nunca presumida.
    const pvaVersao = this.confirmarPva(
      input.pvaVersao,
      input.pvaVersaoConfirmada,
    );

    // R2.4: a retificadora também amarra o recibo ao hash do fechamento. Herda o
    // fechamento da original por padrão; se um novo for informado, valida escopo
    // e o casamento hash ↔ hash_entradas.
    const fechamentoId = await this.resolverFechamento(
      input.clienteId,
      input.fechamentoId ?? original.fechamentoId ?? undefined,
      hashArquivo,
    );

    const rows = await this.database.db
      .insert(fiscalEntregas)
      .values({
        clienteId: input.clienteId,
        fechamentoId,
        // Obrigação/competência herdadas da original: a retificação é da MESMA
        // obrigação/competência da entrega que corrige.
        obrigacao: original.obrigacao,
        competencia: original.competencia,
        arquivoKey: input.arquivoKey,
        hashArquivo,
        pvaPrograma: input.pvaPrograma,
        pvaVersao,
        statusValidacao: input.statusValidacao ?? 'PENDENTE',
        validacaoResultado: input.validacaoResultado ?? {},
        assinaturaTitular: input.assinaturaTitular ?? null,
        assinaturaEm: input.assinaturaEm ?? null,
        protocoloNumero: input.protocoloNumero ?? null,
        // Recibo PRÓPRIO da retificadora (R2.2): não reaproveita o da original.
        reciboKey: input.reciboKey ?? null,
        // Vínculo de retificação + diferença: o par original/retificação.
        entregaOriginalId: original.id,
        valorDiferenca,
        leiauteVersao,
        transmitidaEm: input.transmitidaEm ?? null,
      })
      .returning();
    return this.toEntregaResponse(rows[0]);
  }

  /**
   * R2.3 (Fase 5, tarefa 2.3): registra a entrega E tenta o upload do arquivo
   * ao storage externo. O SNAPSHOT da entrega é gravado primeiro (via
   * `registrarEntrega`, que usa o banco) e COMMITA; o upload externo (R2) NÃO
   * participa dessa transação. Esse descasamento é deliberado — é o cenário da
   * tarefa: o snapshot sobrevive mesmo quando o storage falha.
   *
   * Quando o upload FALHA após o snapshot:
   *  - o status do snapshot vai a FALHA_STORAGE e o erro fica rastreado
   *    (`ultimo_erro_storage`, `tentativas_storage`), com evento de auditoria;
   *  - a COMPENSAÇÃO enfileira a limpeza do objeto parcial/órfão na fila do R2
   *    (`storage_cleanup_jobs`) — o mesmo padrão de outras entregas de arquivo
   *    (ex.: substituição de certificado);
   *  - lança `ServiceUnavailableException`: o snapshot existe e é RETENTÁVEL por
   *    `retentarUpload`, amarrado a este mesmo id (sem duplicar snapshot).
   *
   * Quando o upload tem SUCESSO, a entrega fica no `statusValidacao` informado
   * (default PENDENTE) e `tentativas_storage` registra que houve 1 tentativa.
   */
  async registrarEntregaComUpload(input: RegistrarEntregaComUploadInput) {
    if (input.upload.arquivoKey !== input.arquivoKey) {
      throw new BadRequestException(
        'A key do upload deve ser a mesma `arquivoKey` do snapshot da entrega — ' +
          'o arquivo entregue é selado no snapshot (R2.3).',
      );
    }

    // 1) SNAPSHOT no banco (transação do próprio `registrarEntrega`). COMMITA
    //    antes do upload externo: o snapshot nunca depende do storage.
    const entrega = await this.registrarEntrega(input);

    // 2) UPLOAD externo (R2), FORA da transação do snapshot.
    try {
      await this.storage.upload(
        input.upload.arquivoKey,
        input.upload.conteudo,
        input.upload.contentType,
      );
    } catch (error: unknown) {
      // Falha pós-snapshot: marca FALHA_STORAGE + compensa + deixa retentável.
      await this.marcarFalhaStorageEcompensar({
        entregaId: entrega.id,
        clienteId: input.clienteId,
        arquivoKey: input.upload.arquivoKey,
        error,
        actorUserId: input.actorUserId,
        requestId: input.requestId,
      });
      throw new ServiceUnavailableException(
        'A entrega foi registrada, mas o arquivo não pôde ser armazenado. O ' +
          'registro ficou com status de falha de storage e pode ser retentado ' +
          '(o objeto parcial foi enfileirado para limpeza).',
      );
    }

    // Sucesso de primeira: registra que houve 1 tentativa de upload (trilha).
    const atualizada = await this.registrarTentativaUpload(entrega.id);
    await this.registrarEventoStorage({
      entregaId: entrega.id,
      clienteId: input.clienteId,
      acao: 'FISCAL_ENTREGA_STORAGE_OK',
      actorUserId: input.actorUserId,
      dados: { arquivoKey: input.upload.arquivoKey, tentativa: 1 },
    });
    return atualizada ?? entrega;
  }

  /**
   * R2.3 (Fase 5, tarefa 2.3): RETRY RASTREÁVEL do upload de uma entrega em
   * FALHA_STORAGE. É amarrado ao MESMO snapshot (`entregaId`): nunca cria uma
   * entrega nova nem toca `arquivo_key`/`hash_arquivo` (o conteúdo selado é
   * imutável). Reenvia os bytes à `arquivo_key` já persistida e, em sucesso,
   * transiciona o status de volta a um estado de sucesso (default PENDENTE),
   * incrementando `tentativas_storage` e registrando a trilha em auditoria.
   *
   * Rejeita:
   *  - entrega inexistente/de outro cliente → NotFound (escopo por cliente);
   *  - entrega que NÃO está em FALHA_STORAGE → BadRequest: só se retenta um
   *    upload que falhou; um snapshot já íntegro não é retentável.
   */
  async retentarUpload(input: RetentarUploadEntregaInput) {
    await this.assertCliente(input.clienteId);
    const entrega = await this.carregarEntregaDoCliente(
      input.clienteId,
      input.entregaId,
    );

    if (entrega.statusValidacao !== 'FALHA_STORAGE') {
      throw new BadRequestException(
        'Só é possível retentar o upload de uma entrega em FALHA_STORAGE. O ' +
          'retry é amarrado ao snapshot que falhou, não a uma entrega íntegra ' +
          '(R2.3).',
      );
    }

    const statusSucesso = input.statusSucesso ?? 'PENDENTE';
    const tentativa = entrega.tentativasStorage + 1;

    // Reenvia os bytes à MESMA key já selada no snapshot (sem duplicar snapshot).
    try {
      await this.storage.upload(
        entrega.arquivoKey,
        input.conteudo,
        input.contentType,
      );
    } catch (error: unknown) {
      // Retry também falhou: mantém FALHA_STORAGE, atualiza o rastro e re-compensa
      // (o objeto pode ter sido parcialmente gravado de novo).
      await this.marcarFalhaStorageEcompensar({
        entregaId: entrega.id,
        clienteId: input.clienteId,
        arquivoKey: entrega.arquivoKey,
        error,
        actorUserId: input.actorUserId,
        requestId: input.requestId,
        tentativa,
      });
      throw new ServiceUnavailableException(
        'O reenvio do arquivo ao storage falhou novamente. O registro ' +
          'permanece em falha de storage e pode ser retentado.',
      );
    }

    // Sucesso: transição de volta a estado de sucesso, no MESMO snapshot.
    const rows = await this.database.db
      .update(fiscalEntregas)
      .set({
        statusValidacao: statusSucesso,
        tentativasStorage: tentativa,
        ultimoErroStorage: null,
        atualizadoEm: new Date(),
      })
      .where(
        and(
          eq(fiscalEntregas.id, entrega.id),
          eq(fiscalEntregas.clienteId, input.clienteId),
        ),
      )
      .returning();

    await this.registrarEventoStorage({
      entregaId: entrega.id,
      clienteId: input.clienteId,
      acao: 'FISCAL_ENTREGA_STORAGE_RETRY_OK',
      actorUserId: input.actorUserId,
      dados: {
        arquivoKey: entrega.arquivoKey,
        tentativa,
        statusAnterior: 'FALHA_STORAGE',
        statusNovo: statusSucesso,
      },
    });

    return this.toEntregaResponse(rows[0]);
  }

  /**
   * Transição do snapshot para FALHA_STORAGE + COMPENSAÇÃO do objeto órfão.
   *
   * A compensação segue a fila de limpeza do R2 (`storage_cleanup_jobs`), o
   * mesmo padrão da substituição de certificado: tentamos a limpeza na própria
   * requisição e, se falhar de forma transitória, o job persistido deixa a
   * rotina de limpeza concluir depois. `onConflictDoNothing` em `object_key`
   * torna o enfileiramento idempotente entre retries da mesma key.
   */
  private async marcarFalhaStorageEcompensar(input: {
    entregaId: string;
    clienteId: string;
    arquivoKey: string;
    error: unknown;
    actorUserId?: string;
    requestId?: string;
    tentativa?: number;
  }) {
    const errorCode =
      input.error instanceof Error ? input.error.name : 'UNKNOWN_ERROR';

    // 1) Status FALHA_STORAGE + rastro do erro no MESMO snapshot.
    await this.database.db
      .update(fiscalEntregas)
      .set({
        statusValidacao: 'FALHA_STORAGE',
        tentativasStorage: sqlTentativaIncremento(),
        ultimoErroStorage: errorCode.slice(0, 160),
        atualizadoEm: new Date(),
      })
      .where(
        and(
          eq(fiscalEntregas.id, input.entregaId),
          eq(fiscalEntregas.clienteId, input.clienteId),
        ),
      );

    // 2) COMPENSAÇÃO: enfileira a limpeza do objeto parcial/órfão (fila do R2).
    let cleanupJobIds: string[] = [];
    try {
      const jobs = await this.database.db
        .insert(storageCleanupJobs)
        .values({
          objectKey: input.arquivoKey,
          entidadeTipo: 'FISCAL_ENTREGA',
          entidadeId: input.entregaId,
        })
        .onConflictDoNothing()
        .returning({ id: storageCleanupJobs.id });
      cleanupJobIds = jobs.map((job) => job.id);
    } catch (enqueueError) {
      this.logger.error('fiscal_entrega_cleanup_enqueue_failed', enqueueError, {
        requestId: input.requestId,
        userId: input.actorUserId,
        entityType: 'FISCAL_ENTREGA',
        entityId: input.entregaId,
        clienteId: input.clienteId,
        operation: 'registrar_entrega_storage',
      });
    }

    // 3) Trilha de auditoria da falha + compensação.
    await this.registrarEventoStorage({
      entregaId: input.entregaId,
      clienteId: input.clienteId,
      acao: 'FISCAL_ENTREGA_STORAGE_FALHA',
      actorUserId: input.actorUserId,
      dados: {
        arquivoKey: input.arquivoKey,
        erro: errorCode,
        tentativa: input.tentativa,
        compensacaoEnfileirada: cleanupJobIds.length > 0,
      },
    });

    this.logger.error('fiscal_entrega_storage_failed', input.error, {
      requestId: input.requestId,
      userId: input.actorUserId,
      entityType: 'FISCAL_ENTREGA',
      entityId: input.entregaId,
      clienteId: input.clienteId,
      operation: 'registrar_entrega_storage',
      result: 'failed',
    });

    // 4) Melhor-esforço: tenta concluir a limpeza já na requisição; o job
    //    persistido cobre falhas transitórias (rotina de limpeza conclui depois).
    if (cleanupJobIds.length) {
      try {
        await this.storageCleanup.processJobs(cleanupJobIds, {
          requestId: input.requestId,
          userId: input.actorUserId,
          trigger: 'fiscal_entrega_storage_failure',
        });
      } catch (cleanupError) {
        this.logger.warn('fiscal_entrega_cleanup_pending', {
          requestId: input.requestId,
          userId: input.actorUserId,
          entityType: 'FISCAL_ENTREGA',
          entityId: input.entregaId,
          clienteId: input.clienteId,
          operation: 'registrar_entrega_storage',
          result: 'partial',
          erro: cleanupError instanceof Error ? cleanupError.name : 'UNKNOWN',
        });
      }
    }
  }

  /**
   * Incrementa `tentativas_storage` no MESMO snapshot após um upload bem-sucedido
   * de primeira (sem falha), para que a trilha mostre que houve 1 tentativa.
   */
  private async registrarTentativaUpload(entregaId: string) {
    const rows = await this.database.db
      .update(fiscalEntregas)
      .set({
        tentativasStorage: sqlTentativaIncremento(),
        atualizadoEm: new Date(),
      })
      .where(eq(fiscalEntregas.id, entregaId))
      .returning();
    return rows[0] ? this.toEntregaResponse(rows[0]) : null;
  }

  /**
   * Registra um evento na trilha de auditoria (`eventos_auditoria`) do ciclo de
   * storage da entrega. Best-effort: a trilha nunca derruba a operação principal.
   */
  private async registrarEventoStorage(input: {
    entregaId: string;
    clienteId: string;
    acao: string;
    actorUserId?: string;
    dados: Record<string, unknown>;
  }) {
    try {
      await this.database.db.insert(eventosAuditoria).values({
        atorUserId: input.actorUserId ?? null,
        acao: input.acao,
        entidadeTipo: 'FISCAL_ENTREGA',
        entidadeId: input.entregaId,
        dados: { clienteId: input.clienteId, ...input.dados },
      });
    } catch (error: unknown) {
      this.logger.error('fiscal_entrega_storage_audit_failed', error, {
        entityType: 'FISCAL_ENTREGA',
        entityId: input.entregaId,
        clienteId: input.clienteId,
        operation: 'registrar_entrega_storage',
      });
    }
  }

  /**
   * Lista as entregas do cliente, opcionalmente filtradas por competência e
   * obrigação, em ordem cronológica. Expõe a trilha original → retificações.
   */
  async listarEntregas(input: {
    clienteId: string;
    competencia?: string;
    obrigacao?: ObrigacaoEntrega;
  }) {
    const conditions = [eq(fiscalEntregas.clienteId, input.clienteId)];
    if (input.competencia) {
      conditions.push(
        eq(
          fiscalEntregas.competencia,
          this.competenciaCompeta(input.competencia),
        ),
      );
    }
    if (input.obrigacao) {
      this.assertObrigacao(input.obrigacao);
      conditions.push(eq(fiscalEntregas.obrigacao, input.obrigacao));
    }
    const rows = await this.database.db
      .select()
      .from(fiscalEntregas)
      .where(and(...conditions))
      .orderBy(asc(fiscalEntregas.competencia), asc(fiscalEntregas.criadoEm));
    return { data: rows.map((row) => this.toEntregaResponse(row)) };
  }

  /**
   * Carrega uma entrega escopada por (id, clienteId). Entrega de outro cliente
   * ou inexistente é indistinguível — ambas resultam em NotFound.
   */
  private async carregarEntregaDoCliente(clienteId: string, entregaId: string) {
    const rows = await this.database.db
      .select()
      .from(fiscalEntregas)
      .where(
        and(
          eq(fiscalEntregas.id, entregaId),
          eq(fiscalEntregas.clienteId, clienteId),
        ),
      )
      .limit(1);
    if (!rows[0]) {
      throw new NotFoundException('Entrega não encontrada.');
    }
    return rows[0];
  }

  /**
   * R2.2: garante que a entrega-base ainda não foi retificada. Se já existe uma
   * entrega apontando-a como original, ela está superada e não pode ser
   * retificada de novo — retifica-se a entrega vigente.
   */
  private async assertEntregaNaoRetificada(
    clienteId: string,
    entregaOriginalId: string,
  ) {
    const rows = await this.database.db
      .select({ id: fiscalEntregas.id })
      .from(fiscalEntregas)
      .where(
        and(
          eq(fiscalEntregas.clienteId, clienteId),
          eq(fiscalEntregas.entregaOriginalId, entregaOriginalId),
        ),
      )
      .limit(1);
    if (rows[0]) {
      throw new BadRequestException(
        'A entrega indicada já foi retificada. Retifique a última entrega ' +
          'vigente da trilha, não uma já superada (R2.2).',
      );
    }
  }

  /**
   * R2.4: resolve e valida o vínculo com a versão de apuração (fechamento). Sem
   * `fechamentoId`, não há vínculo (retorna `null`). Com `fechamentoId`, o
   * fechamento DEVE existir e ser do cliente, e o `hashArquivo` entregue DEVE
   * ser o `hash_entradas` daquele fechamento — amarra o recibo/comprovante ao
   * hash do fechamento, impedindo selar um arquivo divergente da apuração.
   */
  private async resolverFechamento(
    clienteId: string,
    fechamentoId: string | undefined,
    hashArquivo: string,
  ): Promise<string | null> {
    if (fechamentoId == null) return null;
    const rows = await this.database.db
      .select()
      .from(fiscalFechamentos)
      .where(
        and(
          eq(fiscalFechamentos.id, fechamentoId),
          eq(fiscalFechamentos.clienteId, clienteId),
        ),
      )
      .limit(1);
    const fechamento = rows[0];
    if (!fechamento) {
      throw new NotFoundException(
        'Versão de apuração (fechamento) não encontrada para esta empresa. A ' +
          'entrega só pode vincular-se a um fechamento do próprio cliente (R2.4).',
      );
    }
    if (fechamento.hashEntradas !== hashArquivo) {
      throw new BadRequestException(
        'O hash do arquivo entregue não corresponde ao hash do fechamento ' +
          'vinculado. O comprovante/recibo deve ficar amarrado ao hash do ' +
          'fechamento (R2.4), nunca a um arquivo divergente da apuração.',
      );
    }
    return fechamento.id;
  }

  private competenciaCompeta(competencia: string): string {
    try {
      return parseCompetenciaMensal(competencia).competencia;
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Competência inválida.',
      );
    }
  }

  private assertObrigacao(obrigacao: ObrigacaoEntrega) {
    if (!OBRIGACOES_ENTREGA.has(obrigacao)) {
      throw new BadRequestException(`Obrigação inválida: "${obrigacao}".`);
    }
  }

  /**
   * R2.5 (N03/N04): resolve o leiaute pela VIGÊNCIA da competência via o núcleo
   * puro `resolverLeiautePorVigencia` — derivando quando omitido, validando
   * quando informado. Converte o erro de domínio em BadRequest fora do HTTP.
   */
  private resolverLeiaute(
    competencia: string,
    leiauteInformado?: string | null,
  ): string {
    try {
      return resolverLeiautePorVigencia(competencia, leiauteInformado);
    } catch (error) {
      if (error instanceof LeiauteVigenciaError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  /**
   * N05: confirma a versão operacional do PVA usada na homologação via o núcleo
   * puro `confirmarVersaoPva` — a versão nunca é presumida como "a última";
   * exige confirmação explícita que case a versão informada. Converte o erro de
   * domínio em BadRequest fora do HTTP.
   */
  private confirmarPva(
    pvaVersao: string,
    pvaVersaoConfirmada?: string | null,
  ): string {
    try {
      return confirmarVersaoPva({ pvaVersao, pvaVersaoConfirmada });
    } catch (error) {
      if (error instanceof LeiauteVigenciaError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  /**
   * Normaliza e valida o hash SHA-256 (hex minúsculo, 64 chars) — reforço fora
   * do HTTP do CHECK `chk_fiscal_entrega_hash` do banco.
   */
  private normalizarHash(hash: string): string {
    const normalizado = (hash ?? '').trim().toLowerCase();
    if (!HASH_SHA256_PATTERN.test(normalizado)) {
      throw new BadRequestException(
        'Hash do arquivo inválido: deve ser SHA-256 em hexadecimal (64 ' +
          'caracteres 0-9a-f).',
      );
    }
    return normalizado;
  }

  /**
   * Valida a diferença da retificação como decimal (pode ser negativa — uma
   * retificação pode reduzir o valor apurado) e a devolve normalizada. Reforço
   * fora do HTTP do tipo `numeric` da coluna.
   */
  private normalizarDiferenca(valor: string): string {
    let escalado: bigint;
    try {
      escalado = toScaledInteger(valor);
    } catch {
      throw new BadRequestException(`Valor da diferença inválido: "${valor}".`);
    }
    return fromScaledInteger(escalado);
  }

  private async assertCliente(clienteId: string) {
    const rows = await this.database.db
      .select({ id: clientes.id })
      .from(clientes)
      .where(eq(clientes.id, clienteId))
      .limit(1);
    if (!rows[0]) throw new NotFoundException('Empresa não encontrada.');
  }

  private toEntregaResponse(row: typeof fiscalEntregas.$inferSelect) {
    return {
      id: row.id,
      cliente_id: row.clienteId,
      fechamento_id: row.fechamentoId,
      obrigacao: row.obrigacao,
      competencia: row.competencia,
      arquivo_key: row.arquivoKey,
      hash_arquivo: row.hashArquivo,
      pva_programa: row.pvaPrograma,
      pva_versao: row.pvaVersao,
      status_validacao: row.statusValidacao,
      validacao_resultado: row.validacaoResultado,
      assinatura_titular: row.assinaturaTitular,
      assinatura_em: row.assinaturaEm ? row.assinaturaEm.toISOString() : null,
      protocolo_numero: row.protocoloNumero,
      recibo_key: row.reciboKey,
      entrega_original_id: row.entregaOriginalId,
      valor_diferenca: row.valorDiferenca,
      leiaute_versao: row.leiauteVersao,
      transmitida_em: row.transmitidaEm
        ? row.transmitidaEm.toISOString()
        : null,
      tentativas_storage: row.tentativasStorage,
      ultimo_erro_storage: row.ultimoErroStorage,
      criado_em: row.criadoEm.toISOString(),
      atualizado_em: row.atualizadoEm.toISOString(),
    };
  }
}
