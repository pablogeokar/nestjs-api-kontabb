import { Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, gte, inArray, lte, type SQL } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service';
import {
  clientes,
  documentosFiscais,
  documentosFiscaisItens,
} from '../../database/schema';
import { StorageService } from '../../storage/storage.service';
import {
  parseManualFiscalXml,
  type ParsedDocumentoFiscal,
} from './dfe-document.parser';
import {
  CfopService,
  type CfopResolvido,
  type TipoOperacaoEscriturada,
} from './cfop.service';
import { FiscalCteService } from './fiscal-cte.service';
import type { RegimeTributario } from '../../clientes/clientes.types';
import {
  buildDocumentoFiscalSpedMetadata,
  documentoNfePrecisaRevisao,
} from './documento-fiscal-sped-metadata';

interface DocumentoReprocessado {
  id: string;
  chaveAcesso: string;
  emitenteCnpjCpf: string;
  emitenteDados: Record<string, unknown> | null;
  modelo: string;
  situacao: string;
  tpNfXml: string | null;
  xmlKey: string;
}

@Injectable()
export class EscrituracaoFiscalService {
  constructor(
    private readonly database: DatabaseService,
    private readonly storage: StorageService,
    private readonly cfopService: CfopService,
    private readonly fiscalCteService: FiscalCteService,
  ) {}

  async reprocessar(input: {
    clienteId: string;
    dataInicio?: Date;
    dataFim?: Date;
  }) {
    const clienteRows = await this.database.db
      .select({
        id: clientes.id,
        cnpj: clientes.cnpj,
        regimeTributario: clientes.regimeTributario,
        apuraIcms: clientes.apuraIcms,
      })
      .from(clientes)
      .where(eq(clientes.id, input.clienteId))
      .limit(1);
    const cliente = clienteRows[0];
    if (!cliente) throw new NotFoundException('Empresa não encontrada.');

    const conditions: SQL[] = [
      eq(documentosFiscais.clienteId, input.clienteId),
    ];
    if (input.dataInicio) {
      conditions.push(gte(documentosFiscais.dataEmissao, input.dataInicio));
    }
    if (input.dataFim) {
      conditions.push(lte(documentosFiscais.dataEmissao, input.dataFim));
    }
    const documentos = await this.database.db
      .select({
        id: documentosFiscais.id,
        chaveAcesso: documentosFiscais.chaveAcesso,
        emitenteCnpjCpf: documentosFiscais.emitenteCnpjCpf,
        emitenteDados: documentosFiscais.emitenteDados,
        modelo: documentosFiscais.modelo,
        situacao: documentosFiscais.situacao,
        tpNfXml: documentosFiscais.tpNfXml,
        xmlKey: documentosFiscais.xmlKey,
      })
      .from(documentosFiscais)
      .where(and(...conditions));

    if (documentos.length === 0) {
      return {
        documentosProcessados: 0,
        itensAtualizados: 0,
        itensParaRevisao: 0,
        documentosComTpNfInferido: 0,
        documentosComFalhaIntegridade: 0,
        ctesAtualizados: 0,
        ctesComFalha: 0,
        sucesso: true as const,
      };
    }

    const itens = await this.database.db
      .select({
        id: documentosFiscaisItens.id,
        documentoFiscalId: documentosFiscaisItens.documentoFiscalId,
        numeroItem: documentosFiscaisItens.numeroItem,
        cfop: documentosFiscaisItens.cfop,
        cfopXml: documentosFiscaisItens.cfopXml,
        ncm: documentosFiscaisItens.ncm,
        cstIcms: documentosFiscaisItens.cstIcms,
        csosnIcms: documentosFiscaisItens.csosnIcms,
        cstPis: documentosFiscaisItens.cstPis,
        cstCofins: documentosFiscaisItens.cstCofins,
      })
      .from(documentosFiscaisItens)
      .where(
        inArray(
          documentosFiscaisItens.documentoFiscalId,
          documentos.map((documento) => documento.id),
        ),
      );
    const itensPorDocumento = new Map<string, typeof itens>();
    for (const item of itens) {
      const current = itensPorDocumento.get(item.documentoFiscalId) ?? [];
      current.push(item);
      itensPorDocumento.set(item.documentoFiscalId, current);
    }
    const resolucaoCache = new Map<string, CfopResolvido>();
    const documentosPreparados: Array<{
      documento: DocumentoReprocessado;
      tpNfXml: '0' | '1';
      tipoOperacao: TipoOperacaoEscriturada;
      tpNfInferido: boolean;
      itens: Array<{
        id: string;
        cfopXml: string;
        resolvido: CfopResolvido;
        cstIcms: string | null;
        csosnIcms: string | null;
        cstPis: string | null;
        cstCofins: string | null;
      }>;
      parsed: ParsedDocumentoFiscal | null;
    }> = [];
    const ctesPreparadas: Array<{
      documento: DocumentoReprocessado;
      parsed: ParsedDocumentoFiscal;
      preparada: Awaited<ReturnType<FiscalCteService['prepararEscrituracao']>>;
    }> = [];
    let ctesComFalha = 0;

    for (const documento of documentos) {
      if (documento.modelo === '57') {
        const parsed = await this.parseStoredCte(documento);
        if (!parsed?.cteEscrituracao) {
          ctesComFalha += 1;
          continue;
        }
        ctesPreparadas.push({
          documento,
          parsed,
          preparada: await this.fiscalCteService.prepararEscrituracao({
            clienteId: input.clienteId,
            clienteCnpjCpf: cliente.cnpj,
            regimeTributario:
              (cliente.regimeTributario as RegimeTributario | null) ?? null,
            apuraIcms: cliente.apuraIcms ?? false,
            situacao: documento.situacao as
              'AUTORIZADA' | 'CANCELADA' | 'DENEGADA' | 'RESUMIDA',
            cte: parsed.cteEscrituracao,
            emitenteUf: parsed.emitente.uf || null,
          }),
        });
        continue;
      }
      const parsed = await this.parseStoredDocument(documento);
      const tpNfXml = isTpNf(documento.tpNfXml)
        ? documento.tpNfXml
        : (parsed?.tpNfXml ?? '1');
      const tipoOperacao = this.cfopService.determinarTipoOperacaoEscriturada(
        cliente.cnpj,
        documento.emitenteCnpjCpf,
        tpNfXml,
      );
      const parsedCfops = new Map(
        (parsed?.itens ?? []).map((item) => [item.numeroItem, item.cfop]),
      );
      const parsedItens = new Map(
        (parsed?.itens ?? []).map((item) => [item.numeroItem, item]),
      );
      const emitenteUf =
        parsed?.emitente.uf || readUf(documento.emitenteDados);
      const itensPreparados: (typeof documentosPreparados)[number]['itens'] =
        [];
      for (const item of itensPorDocumento.get(documento.id) ?? []) {
        const parsedItem = parsedItens.get(item.numeroItem);
        const cfopXml =
          item.cfopXml ?? parsedCfops.get(item.numeroItem) ?? item.cfop;
        const cstIcmsXml = parsedItem?.cstIcms ?? item.cstIcms;
        const csosnXml = parsedItem?.csosnIcms ?? item.csosnIcms;
        const cacheKey = [
          input.clienteId,
          tipoOperacao,
          cfopXml,
          item.ncm ?? '',
          cstIcmsXml ?? '',
          csosnXml ?? '',
          emitenteUf ?? '',
        ].join(':');
        let resolvido = resolucaoCache.get(cacheKey);
        if (!resolvido) {
          resolvido = await this.cfopService.resolverCfopEquivalenteDetalhado({
            clienteId: input.clienteId,
            cfopXml,
            tipoOperacaoEscriturada: tipoOperacao,
            ncm: parsedItem?.ncm ?? item.ncm,
            emitenteCnpjCpf: documento.emitenteCnpjCpf,
            emitenteUf,
            cstIcmsXml,
            csosnXml,
          });
          resolucaoCache.set(cacheKey, resolvido);
        }
        itensPreparados.push({
          id: item.id,
          cfopXml,
          resolvido,
          cstIcms: parsedItem?.cstIcms ?? item.cstIcms,
          csosnIcms: parsedItem?.csosnIcms ?? item.csosnIcms,
          cstPis: parsedItem?.cstPis ?? item.cstPis,
          cstCofins: parsedItem?.cstCofins ?? item.cstCofins,
        });
      }
      documentosPreparados.push({
        documento,
        tpNfXml,
        tipoOperacao,
        tpNfInferido: !isTpNf(documento.tpNfXml) && !parsed,
        itens: itensPreparados,
        parsed,
      });
    }

    let itensParaRevisao = 0;
    await this.database.db.transaction(async (tx) => {
      for (const preparado of documentosPreparados) {
        const pendingReview =
          !preparado.parsed ||
          preparado.itens.some((item) => item.resolvido.revisaoNecessaria) ||
          documentoNfePrecisaRevisao(
            preparado.parsed,
            preparado.itens.map((item) => ({
              cfopRevisaoNecessaria: item.resolvido.revisaoNecessaria,
            })),
          );
        await tx
          .update(documentosFiscais)
          .set({
            tpNfXml: preparado.tpNfXml,
            tipoOperacaoEscriturada: preparado.tipoOperacao,
            escriturado: true,
            escrituracaoStatus: pendingReview
              ? 'PENDENTE_REVISAO'
              : 'ESCRITURADO',
            ...(preparado.parsed
              ? buildDocumentoFiscalSpedMetadata(preparado.parsed)
              : {
                  integridadeConferida: false,
                  integridadeStatus: 'NAO_CONFERIDA' as const,
                }),
            atualizadoEm: new Date(),
          })
          .where(eq(documentosFiscais.id, preparado.documento.id));
        for (const item of preparado.itens) {
          if (item.resolvido.revisaoNecessaria) itensParaRevisao += 1;
          await tx
            .update(documentosFiscaisItens)
            .set({
              cfopXml: item.cfopXml,
              cfop: item.resolvido.cfop,
              cstIcms: item.resolvido.cstIcmsEscriturado
                ? item.resolvido.cstIcmsEscriturado
                : item.resolvido.csosnEscriturado
                  ? null
                  : item.cstIcms,
              csosnIcms: item.resolvido.csosnEscriturado
                ? item.resolvido.csosnEscriturado
                : item.resolvido.cstIcmsEscriturado
                  ? null
                  : item.csosnIcms,
              cstPis:
                item.resolvido.cstPisEscriturado ?? item.cstPis,
              cstCofins:
                item.resolvido.cstCofinsEscriturado ?? item.cstCofins,
              tipoOperacaoEscriturada: preparado.tipoOperacao,
              cfopRevisaoNecessaria: item.resolvido.revisaoNecessaria,
              atualizadoEm: new Date(),
            })
            .where(eq(documentosFiscaisItens.id, item.id));
        }
      }
      for (const cte of ctesPreparadas) {
        await tx
          .update(documentosFiscais)
          .set({
            tpNfXml: '1',
            ...buildDocumentoFiscalSpedMetadata(cte.parsed),
            atualizadoEm: new Date(),
          })
          .where(eq(documentosFiscais.id, cte.documento.id));
        await this.fiscalCteService.persistirEscrituracao(tx, {
          documentoFiscalId: cte.documento.id,
          clienteId: input.clienteId,
          chaveAcesso: cte.documento.chaveAcesso,
          preparada: cte.preparada,
        });
      }
    });

    return {
      documentosProcessados:
        documentosPreparados.length + ctesPreparadas.length,
      itensAtualizados: itens.length,
      itensParaRevisao,
      documentosComTpNfInferido: documentosPreparados.filter(
        (item) => item.tpNfInferido,
      ).length,
      documentosComFalhaIntegridade: documentosPreparados.filter(
        (item) => !item.parsed,
      ).length,
      ctesAtualizados: ctesPreparadas.length,
      ctesComFalha,
      sucesso: true as const,
    };
  }

  private async parseStoredDocument(documento: DocumentoReprocessado) {
    try {
      const xml = await this.storage.download(documento.xmlKey);
      const parsed = parseManualFiscalXml(xml.toString('utf8'));
      return parsed.status === 'DOCUMENTO' ? parsed.documento : null;
    } catch {
      return null;
    }
  }

  private async parseStoredCte(documento: DocumentoReprocessado) {
    try {
      const xml = await this.storage.download(documento.xmlKey);
      const parsed = parseManualFiscalXml(xml.toString('utf8'));
      return parsed.status === 'DOCUMENTO' &&
        parsed.documento.tipoDocumento === 'CTE'
        ? parsed.documento
        : null;
    } catch {
      return null;
    }
  }
}

function readUf(value: Record<string, unknown> | null) {
  const uf = value?.uf;
  return typeof uf === 'string' && uf.trim() ? uf.trim().toUpperCase() : null;
}

function isTpNf(value: string | null): value is '0' | '1' {
  return value === '0' || value === '1';
}
