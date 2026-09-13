import { and, eq, inArray } from 'drizzle-orm';
import type { DatabaseService } from '../../database/database.service';
import { documentosFiscaisItens } from '../../database/schema';

type DatabaseExecutor =
  | DatabaseService['db']
  | Parameters<Parameters<DatabaseService['db']['transaction']>[0]>[0];

/**
 * Reconciliação idempotente de itens de documento fiscal (achado F01).
 *
 * Substitui o padrão destrutivo `delete + reinsert`, que apagava as identidades
 * dos itens (ids) e, por cascata, as decisões humanas de classificação
 * (`classificacao_destinacao_aprendizado.itemId ON DELETE CASCADE`) e o vínculo
 * com o ativo permanente (`ciap_ativo_permanente.documentoFiscalItemId`).
 *
 * A identidade estável do item dentro do documento é o `numeroItem`
 * (uniqueIndex `uidx_item_doc_num` em documentoFiscalId + numeroItem).
 *
 * Regras de preservação:
 *  - Itens existentes (mesmo numeroItem) são ATUALIZADOS in-place, mantendo o
 *    `id` e as colunas de decisão humana.
 *  - Itens novos são INSERIDOS.
 *  - Itens que sumiram do XML são removidos (delete residual). Esse caso é raro
 *    numa reimportação do mesmo documento; quando ocorre, é uma mudança real de
 *    conteúdo, não uma reimportação idêntica.
 *
 * Colunas NUNCA sobrescritas (decisão humana / identidade):
 *  - id, criadoEm (identidade e origem)
 *  - cfopManual, destinacaoMercadoria, destinacaoOrigem (override humano)
 *  - quando cfopManual é true: cfop, cfopOrigemResolucao, cfopMotivoResolucao,
 *    destinacaoInferida, destinacaoConfianca, destinacaoJustificativa,
 *    cstIcms, csosnIcms, cstPis, cstCofins (a decisão manual prevalece).
 */

// Colunas que representam a decisão humana derivada de uma classificação/CFOP
// manual: quando o item foi marcado como manual, nenhuma delas é sobrescrita.
const CAMPOS_DECISAO_MANUAL = [
  'cfop',
  'cfopOrigemResolucao',
  'cfopMotivoResolucao',
  'destinacaoInferida',
  'destinacaoConfianca',
  'destinacaoJustificativa',
  'cstIcms',
  'csosnIcms',
  'cstPis',
  'cstCofins',
] as const;

// Colunas que nunca vêm do XML reimportado e representam decisão/identidade;
// removidas do patch de atualização em qualquer caso.
const CAMPOS_PROTEGIDOS = new Set<string>([
  'id',
  'documentoFiscalId',
  'clienteId',
  'criadoEm',
  'cfopManual',
  'destinacaoMercadoria',
  'destinacaoOrigem',
]);

// Aceita qualquer objeto de item de escrituração (o shape concreto varia entre
// os canais). Só exige a identidade estável `numeroItem`.
type ItemInsert = { numeroItem?: number };

interface ExistingItem {
  id: string;
  numeroItem: number;
  cfopManual: boolean;
}

export interface ReconciliacaoResultado {
  atualizados: number;
  inseridos: number;
  removidos: number;
}

/**
 * Monta o patch de atualização de um item existente, removendo as colunas de
 * decisão humana. Exportada para teste unitário.
 */
export function montarPatchAtualizacao(
  item: ItemInsert,
  existente: Pick<ExistingItem, 'cfopManual'>,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [chave, valor] of Object.entries(
    item as Record<string, unknown>,
  )) {
    if (CAMPOS_PROTEGIDOS.has(chave)) continue;
    if (
      existente.cfopManual &&
      (CAMPOS_DECISAO_MANUAL as readonly string[]).includes(chave)
    ) {
      continue;
    }
    patch[chave] = valor;
  }
  return patch;
}

/**
 * Calcula o plano de reconciliação (quais numeroItem atualizar, inserir e
 * remover) sem executar I/O. Função pura, exportada para teste unitário.
 */
export function planejarReconciliacao<T extends ItemInsert>(
  novos: T[],
  existentes: ExistingItem[],
): {
  atualizar: Array<{ existente: ExistingItem; item: T }>;
  inserir: T[];
  removerNumeros: number[];
} {
  const existentesPorNumero = new Map<number, ExistingItem>();
  for (const e of existentes) existentesPorNumero.set(e.numeroItem, e);

  const numerosNovos = new Set<number>();
  const atualizar: Array<{ existente: ExistingItem; item: T }> = [];
  const inserir: T[] = [];

  for (const item of novos) {
    const numero = item.numeroItem;
    if (typeof numero !== 'number') {
      // Sem identidade estável: trata como inserção (não deveria ocorrer para
      // NF-e, cujo numeroItem é obrigatório).
      inserir.push(item);
      continue;
    }
    numerosNovos.add(numero);
    const existente = existentesPorNumero.get(numero);
    if (existente) {
      atualizar.push({ existente, item });
    } else {
      inserir.push(item);
    }
  }

  const removerNumeros = existentes
    .map((e) => e.numeroItem)
    .filter((numero) => !numerosNovos.has(numero));

  return { atualizar, inserir, removerNumeros };
}

/**
 * Executa a reconciliação idempotente dos itens de um documento fiscal dentro
 * de uma transação. Preserva ids e decisões humanas.
 */
export async function reconciliarItensDocumento<T extends ItemInsert>(
  tx: DatabaseExecutor,
  params: {
    documentoFiscalId: string;
    clienteId: string;
    itens: T[];
  },
): Promise<ReconciliacaoResultado> {
  const existentes: ExistingItem[] = await tx
    .select({
      id: documentosFiscaisItens.id,
      numeroItem: documentosFiscaisItens.numeroItem,
      cfopManual: documentosFiscaisItens.cfopManual,
    })
    .from(documentosFiscaisItens)
    .where(
      eq(documentosFiscaisItens.documentoFiscalId, params.documentoFiscalId),
    );

  const { atualizar, inserir, removerNumeros } = planejarReconciliacao(
    params.itens,
    existentes,
  );

  for (const { existente, item } of atualizar) {
    const patch = montarPatchAtualizacao(item, existente);
    patch.atualizadoEm = new Date();
    await tx
      .update(documentosFiscaisItens)
      .set(patch)
      .where(eq(documentosFiscaisItens.id, existente.id));
  }

  for (let offset = 0; offset < inserir.length; offset += 300) {
    const lote = inserir.slice(offset, offset + 300).map((item) => ({
      ...(item as object),
      documentoFiscalId: params.documentoFiscalId,
      clienteId: params.clienteId,
    })) as (typeof documentosFiscaisItens.$inferInsert)[];
    await tx.insert(documentosFiscaisItens).values(lote);
  }

  if (removerNumeros.length > 0) {
    await tx
      .delete(documentosFiscaisItens)
      .where(
        and(
          eq(
            documentosFiscaisItens.documentoFiscalId,
            params.documentoFiscalId,
          ),
          inArray(documentosFiscaisItens.numeroItem, removerNumeros),
        ),
      );
  }

  return {
    atualizados: atualizar.length,
    inseridos: inserir.length,
    removidos: removerNumeros.length,
  };
}
