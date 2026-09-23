import { Injectable } from '@nestjs/common';
import { and, countDistinct, eq, ne } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service';
import {
  clientes,
  documentosFiscais,
  documentosFiscaisItens,
  classificacaoDestinacaoAprendizado as aprendizado,
} from '../../database/schema';
import type { DestinacaoMercadoria } from './fiscal-rule-engine.service';

export interface DestinacaoInferida {
  destinacao: DestinacaoMercadoria | null;
  confianca: number;
  origem:
    'MANUAL' | 'HISTORICO' | 'NCM_PERFIL' | 'HEURISTICA' | 'INDETERMINADO';
  justificativa: string;
  requerConfirmacao: boolean;
}
type PerfilClassificacao = {
  principal: string | null;
  secundarios: Array<{ code: string; description: string }>;
};
export type PerfilClassificacaoCache = Map<
  string,
  Promise<PerfilClassificacao | undefined>
>;
export interface ContextoClassificacao {
  perfilCache?: PerfilClassificacaoCache;
  clienteId: string;
  itemId?: string;
  ncm?: string | null;
  codigoProduto?: string | null;
  descricao?: string | null;
  emitenteCnpjCpf?: string | null;
}

// CNAE/CONCLA: B/C = divisões 05–33; G = 45–47. Demais atividades
// não demonstram, por si só, finalidade fiscal ou direito a crédito.
export function vocacaoCnae(codigo?: string | null) {
  if (!/^\d{7}$/.test(codigo ?? '')) return 'DESCONHECIDA';
  const divisao = Number(codigo!.slice(0, 2));
  if (divisao >= 5 && divisao <= 33) return 'INDUSTRIA';
  if (divisao >= 45 && divisao <= 47) return 'COMERCIO';
  return 'OUTRAS';
}

export function inferirPorPerfil(
  input: ContextoClassificacao,
  principal?: string | null,
  secundarios: Array<{ code: string }> = [],
): DestinacaoInferida {
  const perfil = vocacaoCnae(principal);
  const misto = secundarios.some((c) => vocacaoCnae(c.code) !== perfil);
  const ncm = input.ncm ?? '';
  const descricao = (input.descricao ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  let destinacao: DestinacaoMercadoria | null = null;
  if (/^\d{8}$/.test(ncm) && perfil === 'COMERCIO') destinacao = 'REVENDA';
  if (
    /^(25|26|28|29|39|40|44|47|48|50|51|52|54|55|72|74|76)\d{6}$/.test(ncm) &&
    perfil === 'INDUSTRIA'
  )
    destinacao = 'INDUSTRIALIZACAO';
  if (
    perfil === 'OUTRAS' &&
    /\b(limpeza|papel higienico|detergente)\b/.test(descricao)
  )
    destinacao = 'USO_CONSUMO';
  // Máquinas/veículos também podem ser mercadoria ou componentes. Nunca
  // inferir ativo automaticamente apenas pelos capítulos 84/85/87.
  return {
    destinacao,
    confianca: destinacao ? (misto ? 0.45 : 0.65) : 0,
    origem: destinacao ? 'NCM_PERFIL' : 'INDETERMINADO',
    justificativa: destinacao
      ? `Sugestão ${destinacao} pelo CNAE principal ${principal} e natureza do produto${misto ? '; atividades secundárias divergentes' : ''}. Confirme a utilização efetiva. CNAE e regime não autorizam crédito.`
      : 'Sem evidência suficiente da utilização econômica. Confirme a destinação; NCM e descrição isolados não determinam uso, ativo ou direito a crédito.',
    requerConfirmacao: true,
  };
}

@Injectable()
export class ClassificacaoDestinacaoService {
  constructor(private readonly database: DatabaseService) {}

  async classificar(input: ContextoClassificacao): Promise<DestinacaoInferida> {
    const fornecedor = normalizarFornecedor(input.emitenteCnpjCpf);
    if (fornecedor && input.codigoProduto && /^\d{8}$/.test(input.ncm ?? '')) {
      const rows = await this.database.db
        .select({
          destinacao: aprendizado.destinacao,
          total: countDistinct(documentosFiscaisItens.documentoFiscalId),
        })
        .from(aprendizado)
        .innerJoin(
          documentosFiscaisItens,
          and(
            eq(documentosFiscaisItens.id, aprendizado.itemId),
            eq(documentosFiscaisItens.clienteId, aprendizado.clienteId),
          ),
        )
        .innerJoin(
          documentosFiscais,
          eq(documentosFiscais.id, documentosFiscaisItens.documentoFiscalId),
        )
        .where(
          and(
            eq(documentosFiscais.situacao, 'AUTORIZADA'),
            eq(documentosFiscaisItens.cfopManual, false),
            eq(
              documentosFiscaisItens.destinacaoMercadoria,
              aprendizado.destinacao,
            ),
            eq(aprendizado.clienteId, input.clienteId),
            eq(aprendizado.fornecedor, fornecedor),
            eq(aprendizado.codigoProduto, input.codigoProduto),
            eq(aprendizado.ncm, input.ncm!),
            input.itemId ? ne(aprendizado.itemId, input.itemId) : undefined,
          ),
        )
        .groupBy(aprendizado.destinacao);
      if (rows.length === 1 && Number(rows[0].total) >= 3)
        return {
          destinacao: rows[0].destinacao as DestinacaoMercadoria,
          confianca: 0.95,
          origem: 'HISTORICO',
          requerConfirmacao: false,
          justificativa: `${rows[0].total} documentos distintos com confirmações concordantes deste cliente, fornecedor, produto e NCM. Modelo determinístico v1.`,
        };
      if (rows.length > 1)
        return {
          destinacao: null,
          confianca: 0,
          origem: 'INDETERMINADO',
          requerConfirmacao: true,
          justificativa:
            'Histórico de confirmações conflitante para este fornecedor, produto e NCM. Revisão obrigatória.',
        };
    }
    let perfil = input.perfilCache?.get(input.clienteId);
    if (!perfil) {
      perfil = this.carregarPerfil(input.clienteId);
      input.perfilCache?.set(input.clienteId, perfil);
    }
    const cliente = await perfil;
    return inferirPorPerfil(
      input,
      cliente?.principal,
      cliente?.secundarios ?? [],
    );
  }
  private async carregarPerfil(
    clienteId: string,
  ): Promise<PerfilClassificacao | undefined> {
    const [cliente] = await this.database.db
      .select({
        principal: clientes.cnaePrincipalCodigo,
        secundarios: clientes.cnaesSecundarios,
      })
      .from(clientes)
      .where(eq(clientes.id, clienteId))
      .limit(1);
    return cliente;
  }
}

export function normalizarFornecedor(value?: string | null) {
  return (value ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
}

export function camposClassificacao(classificacao?: DestinacaoInferida | null) {
  return {
    destinacaoInferida:
      classificacao?.origem === 'MANUAL'
        ? null
        : (classificacao?.destinacao ?? null),
    destinacaoOrigem: classificacao?.origem ?? null,
    destinacaoConfianca: classificacao
      ? classificacao.confianca.toFixed(3)
      : null,
    destinacaoJustificativa: classificacao?.justificativa ?? null,
  };
}
