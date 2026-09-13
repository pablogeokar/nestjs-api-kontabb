import { eq } from 'drizzle-orm';
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
 * A identidade estável do item dentro do documento é o par
 * `numeroItem` + `codigoProduto`. O `numeroItem` sozinho é a posição na nota
 * (uniqueIndex `uidx_item_doc_num`), mas usar também o `codigoProduto` evita
 * que uma reemissão que reordene/insira itens faça um item herdar a decisão
 * humana de outro produto que passou a ocupar a mesma posição.
 *
 * Regras de preservação (mantém / insere / marca-ausente; NUNCA deleta):
 *  - Itens existentes (mesma identidade) são ATUALIZADOS in-place, mantendo o
 *    `id` e as colunas de decisão humana.
 *  - Itens novos são INSERIDOS.
 *  - Itens que sumiram do XML são MARCADOS como ausentes (retornados em
 *    `ausentes`), nunca deletados fisicamente, para não acionar o cascade
 *    sobre as decisões humanas nem quebrar o vínculo com o CIAP.
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
// os canais). Só exige a identidade estável `numeroItem` + `codigoProduto`.
type ItemInsert = { numeroItem?: number; codigoProduto?: string };

interface ExistingItem {
  id: string;
  numeroItem: number;
  codigoProduto: string;
  cfopManual: boolean;
}

export interface ReconciliacaoResultado {
  atualizados: number;
  inseridos: number;
  ausentes: number;
}

/**
 * Deriva a chave de identidade estável de um item dentro do documento a partir
 * do par `numeroItem` + `codigoProduto`. Exportada para teste unitário.
 */
export function chaveIdentidadeItem(item: {
  numeroItem?: number;
  codigoProduto?: string;
}): string | null {
  if (typeof item.numeroItem !== 'number') return null;
  if (typeof item.codigoProduto !== 'string' || item.codigoProduto === '') {
    return null;
  }
  return `${item.numeroItem}::${item.codigoProduto}`;
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
 * Calcula o plano de reconciliação (quais itens atualizar, inserir e marcar
 * como ausentes) sem executar I/O. Função pura, exportada para teste unitário.
 *
 * NUNCA produz uma instrução de exclusão: itens existentes que não aparecem no
 * conjunto novo são devolvidos em `ausentes` para tratamento não destrutivo.
 */
export function planejarReconciliacao<T extends ItemInsert>(
  novos: T[],
  existentes: ExistingItem[],
): {
  atualizar: Array<{ existente: ExistingItem; item: T }>;
  inserir: T[];
  ausentes: ExistingItem[];
} {
  const existentesPorChave = new Map<string, ExistingItem>();
  for (const e of existentes) {
    const chave = chaveIdentidadeItem(e);
    if (chave !== null) existentesPorChave.set(chave, e);
  }

  const chavesNovas = new Set<string>();
  const atualizar: Array<{ existente: ExistingItem; item: T }> = [];
  const inserir: T[] = [];

  for (const item of novos) {
    const chave = chaveIdentidadeItem(item);
    if (chave === null) {
      // Sem identidade estável: trata como inserção (não deveria ocorrer para
      // NF-e, cujo numeroItem/codigoProduto são obrigatórios).
      inserir.push(item);
      continue;
    }
    chavesNovas.add(chave);
    const existente = existentesPorChave.get(chave);
    if (existente) {
      atualizar.push({ existente, item });
    } else {
      inserir.push(item);
    }
  }

  const ausentes = existentes.filter((e) => {
    const chave = chaveIdentidadeItem(e);
    return chave === null || !chavesNovas.has(chave);
  });

  return { atualizar, inserir, ausentes };
}

/**
 * Executa a reconciliação idempotente dos itens de um documento fiscal dentro
 * de uma transação. Preserva ids e decisões humanas e NUNCA deleta itens: os
 * que sumiram do XML permanecem intactos (marcados como ausentes no resultado)
 * para não acionar o cascade sobre as decisões humanas.
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
      codigoProduto: documentosFiscaisItens.codigoProduto,
      cfopManual: documentosFiscaisItens.cfopManual,
    })
    .from(documentosFiscaisItens)
    .where(
      eq(documentosFiscaisItens.documentoFiscalId, params.documentoFiscalId),
    );

  const { atualizar, inserir, ausentes } = planejarReconciliacao(
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

  // Itens ausentes NUNCA são deletados nesta fase (F01): mantê-los preserva as
  // decisões humanas e o vínculo com o CIAP. A marcação persistente é tratada
  // em uma etapa aditiva posterior.

  return {
    atualizados: atualizar.length,
    inseridos: inserir.length,
    ausentes: ausentes.length,
  };
}
