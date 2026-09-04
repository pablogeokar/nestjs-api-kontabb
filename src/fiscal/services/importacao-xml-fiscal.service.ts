import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { AppLogger } from '../../common/logger.service';
import { DatabaseService } from '../../database/database.service';
import {
  clientes,
  documentosFiscais,
  documentosFiscaisCteEscrituracao,
  documentosFiscaisItens,
  eventosAuditoria,
} from '../../database/schema';
import { StorageService } from '../../storage/storage.service';
import {
  parseManualFiscalXml,
  type ParsedDocumentoFiscal,
} from './dfe-document.parser';
import { CfopService } from './cfop.service';
import {
  FiscalCteService,
  type CteEscrituracaoPreparada,
} from './fiscal-cte.service';
import type { RegimeTributario } from '../../clientes/clientes.types';
import {
  buildDocumentoFiscalSpedMetadata,
  documentoNfePrecisaRevisao,
} from './documento-fiscal-sped-metadata';
import type { CfopItemRevisao } from './cfop.service';

const MAX_XML_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_XML_MIMES = new Set([
  'application/xml',
  'text/xml',
  'application/x-xml',
  'application/octet-stream',
  'text/plain',
]);

type ImportStatus = 'IMPORTADO' | 'DUPLICADO' | 'IGNORADO' | 'ERRO';
type TargetStatus = 'IMPORTADO' | 'DUPLICADO' | 'ERRO';

interface ImportTarget {
  id: string;
  cnpj: string;
  razaoSocial: string;
  regimeTributario?: string | null;
  apuraIcms?: boolean;
}

interface TargetResult {
  cliente_id: string;
  razao_social: string;
  status: TargetStatus;
  pendente_revisao: boolean;
}

export interface FiscalXmlReviewItem {
  numero_item: number;
  descricao: string | null;
  cfop_xml: string;
  cfop_aplicado: string;
  cfop_sugerido: string;
}

export interface FiscalXmlReviewIssue {
  codigo:
    | 'CFOP_NAO_CADASTRADO'
    | 'CFOP_DESTINO_NAO_CADASTRADO'
    | 'INTEGRIDADE_XML_DIVERGENTE'
    | 'CTE_PENDENTE_REVISAO';
  mensagem: string;
  acao_recomendada: string;
  cliente_id: string;
  razao_social: string;
  numero_documento: string;
  chave_acesso: string;
  itens: FiscalXmlReviewItem[];
}

export interface FiscalXmlFileResult {
  arquivo: string;
  status: ImportStatus;
  mensagem: string;
  tipo_documento?: ParsedDocumentoFiscal['tipoDocumento'];
  chave_acesso?: string;
  importados: number;
  duplicados: number;
  erros: number;
  clientes: TargetResult[];
  revisoes: FiscalXmlReviewIssue[];
}

export interface FiscalXmlImportResult {
  total_arquivos: number;
  importados: number;
  duplicados: number;
  ignorados: number;
  erros: number;
  pendentes_revisao: number;
  resultados: FiscalXmlFileResult[];
}

interface PersistDocumentResult {
  status: 'IMPORTADO' | 'DUPLICADO';
  revisoes: FiscalXmlReviewIssue[];
}

@Injectable()
export class ImportacaoXmlFiscalService {
  constructor(
    private readonly database: DatabaseService,
    private readonly storage: StorageService,
    private readonly logger: AppLogger,
    private readonly cfopService: CfopService,
    private readonly fiscalCteService: FiscalCteService,
  ) {}

  async importar(input: {
    files: Express.Multer.File[];
    actorUserId: string;
    requestId: string;
    clienteId?: string;
  }): Promise<FiscalXmlImportResult> {
    const fixedTarget = input.clienteId
      ? await this.findClienteById(input.clienteId)
      : null;
    if (input.clienteId && !fixedTarget) {
      throw new NotFoundException('Empresa não encontrada.');
    }

    const resultados: FiscalXmlFileResult[] = [];
    for (const file of input.files) {
      resultados.push(
        await this.processFile(file, {
          actorUserId: input.actorUserId,
          requestId: input.requestId,
          fixedTarget,
        }),
      );
    }

    return {
      total_arquivos: resultados.length,
      importados: resultados.reduce((sum, item) => sum + item.importados, 0),
      duplicados: resultados.reduce((sum, item) => sum + item.duplicados, 0),
      ignorados: resultados.filter((item) => item.status === 'IGNORADO').length,
      erros: resultados.reduce((sum, item) => sum + item.erros, 0),
      pendentes_revisao: resultados.reduce(
        (sum, item) =>
          sum +
          item.clientes.filter((cliente) => cliente.pendente_revisao).length,
        0,
      ),
      resultados,
    };
  }

  private async processFile(
    file: Express.Multer.File,
    context: {
      actorUserId: string;
      requestId: string;
      fixedTarget: ImportTarget | null;
    },
  ): Promise<FiscalXmlFileResult> {
    const arquivo = this.publicFileName(file.originalname);
    const fileError = this.validateFile(file);
    if (fileError) return this.errorResult(arquivo, fileError);

    const xml = this.normalizeXmlEncoding(this.decodeXml(file.buffer));
    if (!xml.trimStart().startsWith('<')) {
      return this.errorResult(
        arquivo,
        'O conteúdo do arquivo não corresponde a um XML válido.',
      );
    }

    const parsed = parseManualFiscalXml(xml);
    if (parsed.status === 'IGNORADO') {
      return {
        arquivo,
        status: 'IGNORADO',
        mensagem: parsed.motivo,
        importados: 0,
        duplicados: 0,
        erros: 0,
        clientes: [],
        revisoes: [],
      };
    }
    if (parsed.status === 'INVALIDO') {
      return this.errorResult(arquivo, parsed.motivo);
    }

    const documento = parsed.documento;
    let targets: ImportTarget[];
    if (context.fixedTarget) {
      const targetTaxId = context.fixedTarget.cnpj
        .replace(/[^0-9A-Za-z]/g, '')
        .toUpperCase();
      if (!documento.participantesCnpjCpf.includes(targetTaxId)) {
        return this.errorResult(
          arquivo,
          'O CNPJ/CPF da empresa não consta entre os participantes do documento fiscal.',
          documento,
        );
      }
      targets = [context.fixedTarget];
    } else {
      targets = await this.findClientesForDocument(
        documento.participantesCnpjCpf,
      );
      if (targets.length === 0) {
        return {
          arquivo,
          status: 'IGNORADO',
          mensagem:
            'Nenhum participante do XML corresponde a uma empresa cadastrada.',
          tipo_documento: documento.tipoDocumento,
          chave_acesso: documento.chaveAcesso,
          importados: 0,
          duplicados: 0,
          erros: 0,
          clientes: [],
          revisoes: [],
        };
      }
    }

    const clientesResult: TargetResult[] = [];
    const revisoes: FiscalXmlReviewIssue[] = [];
    for (const target of targets) {
      try {
        const result = await this.persistirDocumento({
          target,
          documento,
          actorUserId: context.actorUserId,
          requestId: context.requestId,
        });
        revisoes.push(...result.revisoes);
        clientesResult.push({
          cliente_id: target.id,
          razao_social: target.razaoSocial,
          status: result.status,
          pendente_revisao: result.revisoes.length > 0,
        });
      } catch (error: unknown) {
        this.logger.error('fiscal_xml_import_failed', error, {
          requestId: context.requestId,
          userId: context.actorUserId,
          entityType: 'DOCUMENTO_FISCAL',
          entityId: documento.chaveAcesso,
          clienteId: target.id,
          operation: 'importar_xml_fiscal',
        });
        clientesResult.push({
          cliente_id: target.id,
          razao_social: target.razaoSocial,
          status: 'ERRO',
          pendente_revisao: false,
        });
      }
    }

    const importados = clientesResult.filter(
      (item) => item.status === 'IMPORTADO',
    ).length;
    const duplicados = clientesResult.filter(
      (item) => item.status === 'DUPLICADO',
    ).length;
    const erros = clientesResult.filter(
      (item) => item.status === 'ERRO',
    ).length;
    const status: ImportStatus =
      erros > 0 ? 'ERRO' : importados > 0 ? 'IMPORTADO' : 'DUPLICADO';

    return {
      arquivo,
      status,
      mensagem: this.buildResultMessage({ importados, duplicados, erros }),
      tipo_documento: documento.tipoDocumento,
      chave_acesso: documento.chaveAcesso,
      importados,
      duplicados,
      erros,
      clientes: clientesResult,
      revisoes,
    };
  }

  private validateFile(file: Express.Multer.File): string | null {
    if (!file.originalname.toLowerCase().endsWith('.xml')) {
      return 'Apenas arquivos com extensão .xml são aceitos.';
    }
    const mime = file.mimetype.toLowerCase().split(';')[0].trim();
    if (mime && !ALLOWED_XML_MIMES.has(mime)) {
      return 'O tipo declarado do arquivo não é compatível com XML.';
    }
    if (!file.buffer.length) return 'O arquivo está vazio.';
    if (
      file.size > MAX_XML_FILE_SIZE ||
      file.buffer.length > MAX_XML_FILE_SIZE
    ) {
      return 'O arquivo excede o limite de 10 MB.';
    }
    return null;
  }

  private decodeXml(buffer: Buffer): string {
    if (buffer[0] === 0xff && buffer[1] === 0xfe) {
      return new TextDecoder('utf-16le').decode(buffer.subarray(2));
    }
    if (buffer[0] === 0xfe && buffer[1] === 0xff) {
      const swapped = Buffer.allocUnsafe(buffer.length - 2);
      for (let index = 2; index + 1 < buffer.length; index += 2) {
        swapped[index - 2] = buffer[index + 1];
        swapped[index - 1] = buffer[index];
      }
      return new TextDecoder('utf-16le').decode(swapped);
    }

    const declaration = buffer.subarray(0, 256).toString('latin1');
    if (
      /encoding\s*=\s*["'](?:iso-8859-1|windows-1252)["']/i.test(declaration)
    ) {
      return new TextDecoder('windows-1252').decode(buffer);
    }
    return buffer.toString('utf8').replace(/^\uFEFF/, '');
  }

  private normalizeXmlEncoding(xml: string) {
    return xml.replace(
      /^(\s*<\?xml\b[^>]*\bencoding\s*=\s*)(["'])[^"']+\2/i,
      '$1"UTF-8"',
    );
  }

  private async findClienteById(clienteId: string) {
    const rows = await this.database.db
      .select({
        id: clientes.id,
        cnpj: clientes.cnpj,
        razaoSocial: clientes.razaoSocial,
        regimeTributario: clientes.regimeTributario,
        apuraIcms: clientes.apuraIcms,
      })
      .from(clientes)
      .where(eq(clientes.id, clienteId))
      .limit(1);
    return rows[0] ?? null;
  }

  private async findClientesForDocument(participantIds: string[]) {
    if (participantIds.length === 0) return [];
    return this.database.db
      .select({
        id: clientes.id,
        cnpj: clientes.cnpj,
        razaoSocial: clientes.razaoSocial,
        regimeTributario: clientes.regimeTributario,
        apuraIcms: clientes.apuraIcms,
      })
      .from(clientes)
      .where(inArray(clientes.cnpj, participantIds));
  }

  private async persistirDocumento(input: {
    target: ImportTarget;
    documento: ParsedDocumentoFiscal;
    actorUserId: string;
    requestId: string;
  }): Promise<PersistDocumentResult> {
    const { target, documento } = input;
    const ctePreparada = documento.cteEscrituracao
      ? await this.fiscalCteService.prepararEscrituracao({
          clienteId: target.id,
          clienteCnpjCpf: target.cnpj,
          regimeTributario:
            (target.regimeTributario as RegimeTributario | null) ?? null,
          apuraIcms: target.apuraIcms ?? false,
          situacao: documento.situacao,
          cte: documento.cteEscrituracao,
          emitenteUf: documento.emitente.uf || null,
        })
      : null;
    if (documento.tipoDocumento === 'CTE' && !ctePreparada) {
      throw new Error('Dados de escrituração do CT-e não foram extraídos.');
    }
    const escrituracao =
      documento.tipoDocumento === 'CTE'
        ? {
            tipoOperacaoEscriturada: 'ENTRADA' as const,
            itens: [],
            revisoes: [] as CfopItemRevisao[],
          }
        : await this.cfopService.prepararItensEscrituracao({
            clienteId: target.id,
            clienteCnpjCpf: target.cnpj,
            emitenteCnpjCpf: documento.emitenteCnpjCpf,
            emitenteUf: documento.emitente.uf || null,
            tpNfXml: documento.tpNfXml,
            itens: documento.itens,
          });
    const spedMetadata = buildDocumentoFiscalSpedMetadata(documento);
    const nfePendenteRevisao =
      documento.tipoDocumento !== 'CTE' &&
      documentoNfePrecisaRevisao(documento, escrituracao.itens);
    const revisoes = this.buildReviewIssues({
      target,
      documento,
      cfopRevisoes: escrituracao.revisoes,
      ctePreparada,
    });
    const existingRows = await this.database.db
      .select({
        id: documentosFiscais.id,
        situacao: documentosFiscais.situacao,
        xmlKey: documentosFiscais.xmlKey,
        danfeKey: documentosFiscais.danfeKey,
      })
      .from(documentosFiscais)
      .where(
        and(
          eq(documentosFiscais.clienteId, target.id),
          eq(documentosFiscais.chaveAcesso, documento.chaveAcesso),
        ),
      )
      .limit(1);
    const existing = existingRows[0];
    if (existing && existing.situacao !== 'RESUMIDA') {
      await this.database.db.transaction(async (tx) => {
        await tx
          .update(documentosFiscais)
          .set({
            tipoOperacaoEscriturada: escrituracao.tipoOperacaoEscriturada,
            tpNfXml: documento.tpNfXml,
            ...spedMetadata,
            ...(documento.tipoDocumento !== 'CTE' && {
              escriturado: true,
              escrituracaoStatus: nfePendenteRevisao
                ? ('PENDENTE_REVISAO' as const)
                : ('ESCRITURADO' as const),
            }),
            atualizadoEm: new Date(),
          })
          .where(eq(documentosFiscais.id, existing.id));
        await tx
          .delete(documentosFiscaisItens)
          .where(eq(documentosFiscaisItens.documentoFiscalId, existing.id));
        for (
          let offset = 0;
          offset < escrituracao.itens.length;
          offset += 300
        ) {
          await tx.insert(documentosFiscaisItens).values(
            escrituracao.itens.slice(offset, offset + 300).map((item) => ({
              ...item,
              documentoFiscalId: existing.id,
              clienteId: target.id,
            })),
          );
        }
        if (ctePreparada) {
          await this.fiscalCteService.persistirEscrituracao(tx, {
            documentoFiscalId: existing.id,
            clienteId: target.id,
            chaveAcesso: documento.chaveAcesso,
            preparada: ctePreparada,
          });
        } else {
          await tx
            .delete(documentosFiscaisCteEscrituracao)
            .where(
              eq(
                documentosFiscaisCteEscrituracao.documentoFiscalId,
                existing.id,
              ),
            );
        }
      });
      return { status: 'DUPLICADO', revisoes };
    }

    const year = String(documento.dataEmissao.getUTCFullYear());
    const month = String(documento.dataEmissao.getUTCMonth() + 1).padStart(
      2,
      '0',
    );
    const xmlKey = [
      'clientes',
      target.cnpj,
      'fiscais',
      year,
      month,
      documento.tipoDocumento.toLowerCase(),
      documento.chaveAcesso,
      `${randomUUID()}.xml`,
    ].join('/');

    await this.storage.upload(
      xmlKey,
      Buffer.from(documento.xmlContent, 'utf8'),
      'application/xml',
    );

    const values = {
      clienteId: target.id,
      chaveAcesso: documento.chaveAcesso,
      nsu: 0,
      tipoDocumento: documento.tipoDocumento,
      modelo: documento.modelo,
      serie: documento.serie,
      numeroDocumento: documento.numeroDocumento,
      emitenteCnpjCpf: documento.emitenteCnpjCpf,
      emitenteRazaoSocial: documento.emitenteRazaoSocial,
      destinatarioCnpjCpf: documento.destinatarioCnpjCpf,
      destinatarioRazaoSocial: documento.destinatarioRazaoSocial,
      dataEmissao: documento.dataEmissao,
      valorTotal: documento.valorTotal,
      ...spedMetadata,
      situacao: documento.situacao,
      tipoOperacaoEscriturada: escrituracao.tipoOperacaoEscriturada,
      tpNfXml: documento.tpNfXml,
      escriturado: documento.tipoDocumento !== 'CTE',
      escrituracaoStatus:
        documento.tipoDocumento === 'CTE'
          ? ('NAO_ESCRITURAVEL' as const)
          : nfePendenteRevisao
            ? ('PENDENTE_REVISAO' as const)
            : ('ESCRITURADO' as const),
      xmlKey,
      danfeKey: null,
      atualizadoEm: new Date(),
    };

    try {
      let persisted: Array<{ id: string }> = [];
      let ctePersistedStatus: CteEscrituracaoPreparadaStatus | undefined;
      await this.database.db.transaction(async (tx) => {
        if (existing) {
          persisted = await tx
            .update(documentosFiscais)
            .set(values)
            .where(
              and(
                eq(documentosFiscais.id, existing.id),
                eq(documentosFiscais.situacao, 'RESUMIDA'),
              ),
            )
            .returning({ id: documentosFiscais.id });
        }

        if (persisted.length === 0) {
          persisted = await tx
            .insert(documentosFiscais)
            .values(values)
            .onConflictDoNothing({
              target: [
                documentosFiscais.clienteId,
                documentosFiscais.chaveAcesso,
              ],
            })
            .returning({ id: documentosFiscais.id });
        }

        if (persisted.length > 0) {
          const documentoFiscalId = persisted[0].id;
          await tx
            .delete(documentosFiscaisItens)
            .where(
              eq(documentosFiscaisItens.documentoFiscalId, documentoFiscalId),
            );
          for (
            let offset = 0;
            offset < escrituracao.itens.length;
            offset += 300
          ) {
            await tx.insert(documentosFiscaisItens).values(
              escrituracao.itens.slice(offset, offset + 300).map((item) => ({
                ...item,
                documentoFiscalId,
                clienteId: target.id,
              })),
            );
          }
          if (ctePreparada) {
            const ctePersistida =
              await this.fiscalCteService.persistirEscrituracao(tx, {
                documentoFiscalId,
                clienteId: target.id,
                chaveAcesso: documento.chaveAcesso,
                preparada: ctePreparada,
              });
            ctePersistedStatus = ctePersistida.status;
          }
        }
      });

      if (persisted.length === 0) {
        await this.deleteUploadedXml(xmlKey, input);
        return { status: 'DUPLICADO', revisoes };
      }

      await this.registrarAuditoria({
        documentoId: persisted[0].id,
        actorUserId: input.actorUserId,
        requestId: input.requestId,
        chaveAcesso: documento.chaveAcesso,
        tipoDocumento: documento.tipoDocumento,
        clienteId: target.id,
        cteEscrituracaoStatus:
          ctePersistedStatus ?? ctePreparada?.escrituracaoStatus,
      });

      if (existing) {
        await this.deletePreviousObjects(
          [existing.xmlKey, existing.danfeKey].filter(
            (key): key is string => Boolean(key) && key !== xmlKey,
          ),
          input,
        );
      }
      return { status: 'IMPORTADO', revisoes };
    } catch (error: unknown) {
      await this.deleteUploadedXml(xmlKey, input);
      throw error;
    }
  }

  private async registrarAuditoria(input: {
    documentoId: string;
    actorUserId: string;
    requestId: string;
    chaveAcesso: string;
    tipoDocumento: string;
    clienteId: string;
    cteEscrituracaoStatus?: CteEscrituracaoPreparadaStatus;
  }) {
    try {
      await this.database.db.insert(eventosAuditoria).values([
        {
          atorUserId: input.actorUserId,
          acao: 'DOCUMENTO_FISCAL_XML_IMPORTADO',
          entidadeTipo: 'DOCUMENTO_FISCAL',
          entidadeId: input.documentoId,
          dados: {
            origem: 'UPLOAD_MANUAL',
            tipoDocumento: input.tipoDocumento,
            chaveAcesso: input.chaveAcesso,
            clienteId: input.clienteId,
          },
        },
        ...(input.cteEscrituracaoStatus
          ? [
              {
                atorUserId: input.actorUserId,
                acao:
                  input.cteEscrituracaoStatus === 'NAO_ESCRITURAVEL'
                    ? 'CTE_NAO_ESCRITURAVEL'
                    : 'CTE_ESCRITURADO',
                entidadeTipo: 'DOCUMENTO_FISCAL',
                entidadeId: input.documentoId,
                dados: {
                  origem: 'UPLOAD_MANUAL',
                  clienteId: input.clienteId,
                  escrituracaoStatus: input.cteEscrituracaoStatus,
                },
              },
            ]
          : []),
      ]);
    } catch (error: unknown) {
      this.logger.error('fiscal_xml_import_audit_failed', error, {
        requestId: input.requestId,
        userId: input.actorUserId,
        entityType: 'DOCUMENTO_FISCAL',
        entityId: input.documentoId,
        operation: 'registrar_auditoria_importacao_xml',
      });
    }
  }

  private async deleteUploadedXml(
    xmlKey: string,
    context: {
      actorUserId: string;
      requestId: string;
      documento: ParsedDocumentoFiscal;
    },
  ) {
    await this.deletePreviousObjects([xmlKey], context);
  }

  private async deletePreviousObjects(
    keys: string[],
    context: {
      actorUserId: string;
      requestId: string;
      documento: ParsedDocumentoFiscal;
    },
  ) {
    for (const key of keys) {
      try {
        await this.storage.delete(key);
      } catch (error: unknown) {
        this.logger.error('fiscal_xml_import_cleanup_failed', error, {
          requestId: context.requestId,
          userId: context.actorUserId,
          entityType: 'DOCUMENTO_FISCAL',
          entityId: context.documento.chaveAcesso,
          operation: 'limpar_objeto_fiscal',
        });
      }
    }
  }

  private buildReviewIssues(input: {
    target: ImportTarget;
    documento: ParsedDocumentoFiscal;
    cfopRevisoes: CfopItemRevisao[];
    ctePreparada: CteEscrituracaoPreparada | null;
  }): FiscalXmlReviewIssue[] {
    const common = {
      cliente_id: input.target.id,
      razao_social: input.target.razaoSocial,
      numero_documento: input.documento.numeroDocumento,
      chave_acesso: input.documento.chaveAcesso,
    };
    const issues: FiscalXmlReviewIssue[] = [];
    const groupedCfops = new Map<
      CfopItemRevisao['motivo'],
      CfopItemRevisao[]
    >();

    for (const revisao of input.cfopRevisoes) {
      const current = groupedCfops.get(revisao.motivo) ?? [];
      current.push(revisao);
      groupedCfops.set(revisao.motivo, current);
    }

    for (const [codigo, revisoes] of groupedCfops) {
      const mappings = Array.from(
        new Set(
          revisoes.map((item) => `${item.cfopXml} → ${item.cfopSugerido}`),
        ),
      ).join(', ');
      const missingCfops = Array.from(
        new Set(revisoes.map((item) => item.cfopSugerido)),
      ).join(', ');
      issues.push({
        codigo,
        mensagem:
          codigo === 'CFOP_DESTINO_NAO_CADASTRADO'
            ? `A conversão de CFOP necessária para a entrada (${mappings}) não encontrou um destino ativo no catálogo. Um CFOP genérico foi aplicado temporariamente.`
            : `O CFOP ${missingCfops} não está ativo no catálogo da escrituração. Um CFOP genérico foi aplicado temporariamente.`,
        acao_recomendada:
          'Cadastre ou ative o CFOP sugerido em Fiscal > Regras CFOP e reprocese o período antes de gerar o SPED.',
        ...common,
        itens: revisoes.map((item) => ({
          numero_item: item.numeroItem,
          descricao: item.descricao,
          cfop_xml: item.cfopXml,
          cfop_aplicado: item.cfopAplicado,
          cfop_sugerido: item.cfopSugerido,
        })),
      });
    }

    if (input.documento.integridade.status === 'DIVERGENTE') {
      issues.push({
        codigo: 'INTEGRIDADE_XML_DIVERGENTE',
        mensagem:
          'Os totais ou a quantidade de itens calculados não conferem com os valores declarados no XML.',
        acao_recomendada:
          'Revise as divergências do documento antes de incluí-lo na escrituração e no SPED.',
        ...common,
        itens: [],
      });
    }

    if (input.ctePreparada?.escrituracaoStatus === 'PENDENTE_REVISAO') {
      const values = input.ctePreparada.values;
      issues.push({
        codigo: 'CTE_PENDENTE_REVISAO',
        mensagem:
          'O CT-e foi importado, mas sua classificação fiscal exige revisão antes de compor o SPED.',
        acao_recomendada:
          'Revise o tipo de serviço e o CFOP do CT-e e reprocese o período.',
        ...common,
        itens: values.cfopRevisaoNecessaria
          ? [
              {
                numero_item: 1,
                descricao: 'Prestação de serviço de transporte',
                cfop_xml: values.cfopXml,
                cfop_aplicado: values.cfop,
                cfop_sugerido: values.cfop,
              },
            ]
          : [],
      });
    }

    return issues;
  }

  private errorResult(
    arquivo: string,
    mensagem: string,
    documento?: ParsedDocumentoFiscal,
  ): FiscalXmlFileResult {
    return {
      arquivo,
      status: 'ERRO',
      mensagem,
      ...(documento && {
        tipo_documento: documento.tipoDocumento,
        chave_acesso: documento.chaveAcesso,
      }),
      importados: 0,
      duplicados: 0,
      erros: 1,
      clientes: [],
      revisoes: [],
    };
  }

  private publicFileName(value: string) {
    return value.replace(/[\r\n\0]/g, '').slice(0, 180) || 'arquivo.xml';
  }

  private buildResultMessage(input: {
    importados: number;
    duplicados: number;
    erros: number;
  }) {
    const parts: string[] = [];
    if (input.importados) parts.push(`${input.importados} importado(s)`);
    if (input.duplicados) parts.push(`${input.duplicados} já existente(s)`);
    if (input.erros) parts.push(`${input.erros} com falha`);
    return parts.join(', ') || 'Nenhum registro processado.';
  }
}

type CteEscrituracaoPreparadaStatus =
  'ESCRITURADO' | 'NAO_ESCRITURAVEL' | 'PENDENTE_REVISAO';
