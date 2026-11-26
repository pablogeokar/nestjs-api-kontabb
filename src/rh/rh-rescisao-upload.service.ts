import { Injectable } from '@nestjs/common';
import { ClientesService } from '../clientes/clientes.service';
import { StorageService } from '../storage/storage.service';
import { AppLogger } from '../common/logger.service';
import { normalizeCnpjIdentifier } from '../common/cnpj-identifier';
import { sanitizeFileName } from '../common/file-validation';
import {
  RESCISAO_DOCUMENTO_LABELS,
  extractCnpjCandidates,
  extractDadosTrct,
  type RescisaoDocumentoTipo,
} from '../common/pdf-extraction-rescisao';
import { RhRescisaoService } from './rh-rescisao.service';

export interface RhFileResult {
  fileName: string;
  success: boolean;
  message: string;
  cnpj?: string;
  competencia?: string;
  totalFuncionarios?: number;
  tipo?: 'FOLHA_MENSAL' | 'FERIAS' | 'ADIANTAMENTO_13' | 'RESCISAO';
  funcionarioNome?: string;
  documentoTipo?: RescisaoDocumentoTipo;
}

interface UploadContext {
  requestId: string;
  actorUserId: string;
}

/**
 * Processa os PDFs de rescisão enviados no upload do RH. O TRCT cria a
 * rescisão (e a linha da listagem); os demais documentos são anexados à
 * rescisão do trabalhador citado no próprio PDF.
 */
@Injectable()
export class RhRescisaoUploadService {
  constructor(
    private readonly rescisaoService: RhRescisaoService,
    private readonly clientesService: ClientesService,
    private readonly storage: StorageService,
    private readonly logger: AppLogger,
  ) {}

  async processFile(
    file: Express.Multer.File,
    text: string,
    tipo: RescisaoDocumentoTipo,
    ctx: UploadContext,
  ): Promise<RhFileResult> {
    return tipo === 'TRCT'
      ? this.processTrct(file, text, ctx)
      : this.processAnexo(file, text, tipo, ctx);
  }

  private async processTrct(
    file: Express.Multer.File,
    text: string,
    ctx: UploadContext,
  ): Promise<RhFileResult> {
    const base = {
      fileName: file.originalname,
      tipo: 'RESCISAO' as const,
      documentoTipo: 'TRCT' as const,
    };
    const dados = extractDadosTrct(text);
    if (!dados) {
      return {
        ...base,
        success: false,
        message:
          'O arquivo foi identificado como TRCT, mas não foi possível extrair os dados necessários.',
      };
    }

    const cnpj = normalizeCnpjIdentifier(dados.cnpj);
    const client = await this.clientesService.findClientForUpload(cnpj);
    if (!client) {
      return {
        ...base,
        success: false,
        message: `Cliente com CNPJ ${dados.cnpj} não encontrado.`,
        cnpj: dados.cnpj,
        funcionarioNome: dados.funcionarioNome,
      };
    }

    const existing = await this.rescisaoService.checkDuplicate(
      client.id,
      dados.funcionarioCpf,
      dados.dataDesligamento,
    );
    if (existing) {
      return {
        ...base,
        success: false,
        message: `Rescisão duplicada: já existe um TRCT de ${dados.funcionarioNome} com desligamento em ${dados.competencia}.`,
        cnpj: dados.cnpj,
        competencia: dados.competencia,
        funcionarioNome: dados.funcionarioNome,
      };
    }

    const [month, year] = dados.competencia.split('/');
    const r2Key = `rh/${cnpj}/${year}/${month}/rescisao-${crypto.randomUUID()}-trct.pdf`;
    try {
      await this.storage.upload(
        r2Key,
        Buffer.from(file.buffer),
        'application/pdf',
      );
    } catch (error) {
      this.logger.error('rh_rescisao_upload_storage_failed', error, {
        requestId: ctx.requestId,
      });
      return {
        ...base,
        success: false,
        message: 'Falha ao armazenar o arquivo. Tente novamente.',
      };
    }

    const result = await this.rescisaoService.processarTrct({
      dados,
      clienteId: client.id,
      r2Key,
      fileName: sanitizeFileName(file.originalname),
      actorUserId: ctx.actorUserId,
      requestId: ctx.requestId,
    });
    if (!result.ok) {
      await this.storage.delete(r2Key).catch(() => {});
      return {
        ...base,
        success: false,
        message:
          result.code === 'RESCISAO_DUPLICADA'
            ? `Rescisão duplicada para ${dados.funcionarioNome}.`
            : 'Falha ao processar a rescisão. Tente novamente.',
        cnpj: dados.cnpj,
        funcionarioNome: dados.funcionarioNome,
      };
    }

    return {
      ...base,
      success: true,
      message: `Rescisão de ${dados.funcionarioNome} criada com o TRCT.`,
      cnpj: dados.cnpj,
      competencia: dados.competencia,
      totalFuncionarios: 1,
      funcionarioNome: dados.funcionarioNome,
    };
  }

  private async processAnexo(
    file: Express.Multer.File,
    text: string,
    tipo: RescisaoDocumentoTipo,
    ctx: UploadContext,
  ): Promise<RhFileResult> {
    const label = RESCISAO_DOCUMENTO_LABELS[tipo];
    const base = {
      fileName: file.originalname,
      tipo: 'RESCISAO' as const,
      documentoTipo: tipo,
    };

    // Localiza o cliente pelos CNPJs do documento e a rescisão pelo nome/CPF.
    let clienteEncontrado = false;
    let ambiguo = false;
    let alvo: { clienteId: string; rescisaoId: string; nome: string } | null =
      null;
    let cnpjAlvo: string | undefined;

    for (const cnpj of extractCnpjCandidates(text)) {
      const client = await this.clientesService.findClientForUpload(
        normalizeCnpjIdentifier(cnpj),
      );
      if (!client) continue;
      clienteEncontrado = true;
      const matches = await this.rescisaoService.findByDocumentText(
        client.id,
        text,
      );
      if (matches.length > 1) {
        ambiguo = true;
        break;
      }
      if (matches.length === 1) {
        alvo = {
          clienteId: client.id,
          rescisaoId: matches[0].id,
          nome: matches[0].funcionarioNome,
        };
        cnpjAlvo = cnpj;
        break;
      }
    }

    if (ambiguo) {
      return {
        ...base,
        success: false,
        message: `${label}: mais de uma rescisão corresponde a este documento. Anexe-o manualmente no detalhe da rescisão.`,
      };
    }
    if (!alvo) {
      return {
        ...base,
        success: false,
        message: clienteEncontrado
          ? `${label}: nenhuma rescisão encontrada para o trabalhador do documento. Envie o TRCT primeiro (pode ser no mesmo envio).`
          : `${label}: cliente não encontrado a partir do CNPJ do documento.`,
      };
    }

    const r2Key = `rh/rescisoes/${alvo.clienteId}/${alvo.rescisaoId}/${tipo.toLowerCase()}-${crypto.randomUUID()}.pdf`;
    try {
      await this.storage.upload(
        r2Key,
        Buffer.from(file.buffer),
        'application/pdf',
      );
    } catch (error) {
      this.logger.error('rh_rescisao_documento_storage_failed', error, {
        requestId: ctx.requestId,
      });
      return {
        ...base,
        success: false,
        message: 'Falha ao armazenar o arquivo. Tente novamente.',
      };
    }

    const result = await this.rescisaoService.anexarDocumento({
      rescisaoId: alvo.rescisaoId,
      tipo,
      r2Key,
      fileName: sanitizeFileName(file.originalname),
      actorUserId: ctx.actorUserId,
      requestId: ctx.requestId,
    });
    if (!result.ok) {
      await this.storage.delete(r2Key).catch(() => {});
      return {
        ...base,
        success: false,
        message:
          result.code === 'DOCUMENTO_DUPLICADO'
            ? `${label} já foi anexado à rescisão de ${alvo.nome}.`
            : `Falha ao anexar ${label}. Tente novamente.`,
        cnpj: cnpjAlvo,
        funcionarioNome: alvo.nome,
      };
    }

    return {
      ...base,
      success: true,
      message: `${label} anexado à rescisão de ${alvo.nome}.`,
      cnpj: cnpjAlvo,
      funcionarioNome: alvo.nome,
    };
  }
}
