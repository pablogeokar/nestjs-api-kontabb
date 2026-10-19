import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service';
import {
  certificadosDigitais,
  clientes,
  documentosFiscais,
  eventosAuditoria,
} from '../../database/schema';
import { AppLogger } from '../../common/logger.service';
import type { RegimeTributario } from '../../clientes/clientes.types';
import { DistribuicaoDfeService } from './distribuicao-dfe.service';
import {
  extractDfeDocZips,
  extractDfeResponseMetadata,
  parseDfeDocZip,
  parseNfeResumoDocZip,
} from './dfe-document.parser';
import {
  parseChavesFromBuffer,
  parseChavesFromText,
  type ParsedChavesExtractionResult,
  type ParsedFiscalAccessKey,
} from './listagem-chaves.parser';
import { NfeWizardService } from './nfewizard.service';
import { CertificateAccessError } from './certificado.service';
import { SefazConsultaAdiadaError } from './sefaz-consulta-control.service';

const MAX_KEYS = 500;
const MIN_SEFAZ_INTERVAL_MS = 1_200;

// A chave só informa mês/ano. Identificar meses fora da distribuição automática,
// sem concluir que o XML esteja indisponível nos demais canais oficiais.
export function foraDaJanelaSefaz(chave: string, now = new Date()): boolean {
  const ano = 2000 + Number(chave.slice(2, 4));
  const mes = Number(chave.slice(4, 6));
  const fimMes = Date.UTC(ano, mes, 1, 3) - 1;
  return fimMes < now.getTime() - 90 * 24 * 60 * 60 * 1000;
}

const FORA_JANELA_MESSAGE =
  'Esta chave precisa de recuperação por outro canal: sua competência está fora dos 90 dias da distribuição automática. Consulte o Portal Nacional da NF-e com o certificado do participante; se o XML original estiver disponível, baixe e importe no sistema. A disponibilidade no portal ainda não foi verificada.';

type DocumentoExistente = {
  id: string;
  chaveAcesso: string;
  situacao: string;
  manifestacaoStatus: string;
};

export type ImportacaoChaveStatus =
  | 'IMPORTADO'
  | 'JA_EXISTENTE'
  | 'RESUMO_COM_CIENCIA'
  | 'RESUMO_PENDENTE'
  | 'NAO_LOCALIZADO'
  | 'NAO_SUPORTADO'
  | 'INVALIDA'
  | 'FALHA'
  | 'RECUPERACAO_PORTAL_NECESSARIA'
  | 'ADIADO_LIMITE_CONSULTAS'
  | 'ABORTADO_CONSUMO_INDEVIDO'
  | 'ABORTADO_CERTIFICADO_INDISPONIVEL';

export interface ImportacaoChaveItem {
  chave_acesso: string;
  status: ImportacaoChaveStatus;
  mensagem: string;
  documento_id: string | null;
  modelo: string | null;
  competencia: string | null;
  emitente: string | null;
  valor_total: string | null;
}

@Injectable()
export class ImportacaoChavesFiscalService {
  private readonly queueByClient = new Map<string, Promise<void>>();
  private readonly lastCallByClient = new Map<string, number>();

  constructor(
    private readonly database: DatabaseService,
    private readonly nfeWizard: NfeWizardService,
    private readonly distribuicao: DistribuicaoDfeService,
    private readonly logger: AppLogger,
  ) {}

  async analisar(input: {
    clienteId: string;
    chavesTexto?: string;
    arquivo?: Express.Multer.File;
  }) {
    await this.getCliente(input.clienteId, false);
    if (!input.arquivo && !input.chavesTexto?.trim()) {
      throw new BadRequestException(
        'Cole uma lista de chaves ou selecione um arquivo .txt, .csv ou .xlsx.',
      );
    }
    if (input.arquivo && input.chavesTexto?.trim()) {
      throw new BadRequestException(
        'Envie apenas uma origem por vez: texto colado ou arquivo.',
      );
    }

    let parsed: ParsedChavesExtractionResult;
    try {
      parsed = input.arquivo
        ? await parseChavesFromBuffer(
            input.arquivo.buffer,
            input.arquivo.originalname,
            input.arquivo.mimetype,
          )
        : parseChavesFromText(input.chavesTexto ?? '');
    } catch (error: unknown) {
      throw new BadRequestException(this.publicError(error));
    }
    if (parsed.totalRegistros === 0) {
      throw new BadRequestException('Nenhuma chave fiscal foi encontrada.');
    }
    if (parsed.totalRegistros > MAX_KEYS) {
      throw new BadRequestException(
        `A lista possui ${parsed.totalRegistros} registros. O limite por lote é ${MAX_KEYS}.`,
      );
    }

    const normalized = parsed.itens
      .filter((item) => item.valida)
      .map((item) => item.chaveAcesso);
    const existing = await this.getDocumentosExistentes(
      input.clienteId,
      normalized,
    );
    const existingByKey = new Map(
      existing.map((item) => [item.chaveAcesso, item]),
    );
    const itens = parsed.itens.map((item) =>
      this.toPreviewItem(item, existingByKey.get(item.chaveAcesso)),
    );

    return {
      resumo: {
        total_registros: parsed.totalRegistros,
        chaves_unicas: parsed.itens.length,
        validas: parsed.validas,
        aptas_para_busca: parsed.aptasParaBusca,
        invalidas: parsed.invalidas,
        duplicadas: parsed.duplicadas,
        ja_existentes: itens.filter(
          (item) => item.status_local === 'JA_IMPORTADA',
        ).length,
        resumos_pendentes: itens.filter(
          (item) => item.status_local === 'RESUMIDA',
        ).length,
      },
      itens,
      avisos: [
        ...parsed.avisos,
        'O serviço de distribuição automática da SEFAZ permite até 20 consultas por chave por hora por CNPJ e disponibiliza documentos dos últimos 90 dias. A chave, por si só, não garante acesso ao XML completo.',
        ...(itens.some((item) => item.status_local !== 'JA_IMPORTADA' && item.apta_para_busca && foraDaJanelaSefaz(item.chave_acesso))
          ? [FORA_JANELA_MESSAGE]
          : []),
      ],
    };
  }

  async executar(input: {
    clienteId: string;
    chaves: string[];
    forcarReimportacao?: boolean;
    manifestarAutomaticamente?: boolean;
    actorUserId: string;
    requestId: string;
  }) {
    const parsed = parseChavesFromText(input.chaves.join('\n'));
    if (parsed.totalRegistros > MAX_KEYS) {
      throw new BadRequestException(`O limite por lote é ${MAX_KEYS} chaves.`);
    }
    if (parsed.itens.length === 0) {
      throw new BadRequestException(
        'Nenhuma chave fiscal válida foi informada.',
      );
    }

    const cliente = await this.getCliente(input.clienteId, true);
    await this.assertCertificadoDisponivel(input.clienteId);
    const existing = await this.getDocumentosExistentes(
      input.clienteId,
      parsed.itens.map((item) => item.chaveAcesso).filter(Boolean),
    );
    const existingByKey = new Map(
      existing.map((item) => [item.chaveAcesso, item]),
    );
    const resultados: ImportacaoChaveItem[] = [];
    let consumoIndevido = false;
    let certificadoIndisponivel = false;
    let adiamento: SefazConsultaAdiadaError | null = null;
    let falhaConsulta: string | null = null;

    for (const item of parsed.itens) {
      if (!item.valida) {
        resultados.push(
          this.result(item, 'INVALIDA', item.motivo ?? 'Chave inválida.'),
        );
        continue;
      }
      if (!item.aptaParaBusca) {
        resultados.push(
          this.result(
            item,
            'NAO_SUPORTADO',
            item.motivo ?? 'Modelo não suportado.',
          ),
        );
        continue;
      }

      const local = existingByKey.get(item.chaveAcesso);
      if (local && local.situacao !== 'RESUMIDA' && !input.forcarReimportacao) {
        resultados.push(
          this.result(
            item,
            'JA_EXISTENTE',
            'O documento completo já está importado.',
            local,
          ),
        );
        continue;
      }

      if (foraDaJanelaSefaz(item.chaveAcesso)) {
        resultados.push(
          this.result(
            item,
            'RECUPERACAO_PORTAL_NECESSARIA',
            FORA_JANELA_MESSAGE,
          ),
        );
        continue;
      }
      if (certificadoIndisponivel) {
        resultados.push(
          this.result(
            item,
            'ABORTADO_CERTIFICADO_INDISPONIVEL',
            'Lote interrompido: o certificado digital não pôde ser utilizado.',
          ),
        );
        continue;
      }
      if (consumoIndevido) {
        resultados.push(
          this.result(
            item,
            'ABORTADO_CONSUMO_INDEVIDO',
            'Lote interrompido para respeitar o bloqueio temporário da SEFAZ.',
          ),
        );
        continue;
      }
      if (adiamento) {
        resultados.push(
          this.result(
            item,
            adiamento.motivo === 'LIMITE_LOCAL'
              ? 'ADIADO_LIMITE_CONSULTAS'
              : 'ABORTADO_CONSUMO_INDEVIDO',
            adiamento.message,
          ),
        );
        continue;
      }
      if (falhaConsulta) {
        resultados.push(
          this.result(item, 'FALHA', `Lote interrompido. ${falhaConsulta}`),
        );
        continue;
      }

      try {
        const resposta = await this.withSefazRateLimit(input.clienteId, () =>
          this.nfeWizard.consultarPorChave({
            clienteId: input.clienteId,
            cnpj: cliente.cnpj,
            uf: cliente.uf,
            chaveAcesso: item.chaveAcesso,
          }),
        );
        const metadata = extractDfeResponseMetadata(resposta);
        if (
          metadata.cStat === 656 ||
          /consumo indevido/i.test(metadata.motivo)
        ) {
          consumoIndevido = true;
          resultados.push(
            this.result(
              item,
              'ABORTADO_CONSUMO_INDEVIDO',
              'A SEFAZ bloqueou temporariamente novas consultas (cStat 656). Tente novamente mais tarde.',
            ),
          );
          continue;
        }
        if (metadata.cStat === 137) {
          resultados.push(
            this.result(
              item,
              'NAO_LOCALIZADO',
              'Documento não localizado pela SEFAZ.',
            ),
          );
          continue;
        }
        if (metadata.cStat !== 138) {
          throw new Error(
            metadata.cStat
              ? `Rejeição SEFAZ (${metadata.cStat}): ${metadata.motivo || 'Consulta não autorizada.'}`
              : 'Resposta inválida da SEFAZ.',
          );
        }

        const docZips = extractDfeDocZips(resposta);
        const documento = docZips
          .map((docZip) => parseDfeDocZip(docZip, 'NFE'))
          .find((candidate) => candidate?.chaveAcesso === item.chaveAcesso);
        if (documento) {
          await this.distribuicao.salvarDocumentoConsultado({
            clienteId: input.clienteId,
            cnpj: cliente.cnpj,
            documento,
            regimeTributario: cliente.regimeTributario,
            apuraIcms: cliente.apuraIcms,
          });
          const saved = await this.getDocumento(
            input.clienteId,
            item.chaveAcesso,
          );
          resultados.push(
            this.result(
              item,
              local && local.situacao !== 'RESUMIDA'
                ? 'JA_EXISTENTE'
                : 'IMPORTADO',
              local && local.situacao !== 'RESUMIDA'
                ? 'Documento conferido novamente e mantido.'
                : 'XML completo importado.',
              saved,
              documento.emitenteRazaoSocial,
              documento.valorTotal,
            ),
          );
          continue;
        }

        const resumo = docZips
          .map((docZip) => parseNfeResumoDocZip(docZip))
          .find((candidate) => candidate?.chaveAcesso === item.chaveAcesso);
        if (!resumo) {
          resultados.push(
            this.result(
              item,
              'NAO_LOCALIZADO',
              metadata.motivo ||
                'A SEFAZ não retornou XML ou resumo para a chave.',
            ),
          );
          continue;
        }

        await this.distribuicao.salvarResumoConsultado({
          clienteId: input.clienteId,
          cnpj: cliente.cnpj,
          resumo,
        });
        let saved = await this.getDocumento(input.clienteId, item.chaveAcesso);
        if (
          input.manifestarAutomaticamente &&
          saved &&
          saved.manifestacaoStatus === 'SEM_MANIFESTACAO'
        ) {
          const manifestacao = await this.withSefazRateLimit(
            input.clienteId,
            () =>
              this.nfeWizard.enviarManifestacao({
                clienteId: input.clienteId,
                cnpj: cliente.cnpj,
                uf: cliente.uf,
                chaveAcesso: item.chaveAcesso,
                tipoEvento: '210210',
              }),
          );
          await this.distribuicao.registrarManifestacao({
            documentoId: saved.id,
            tipoEvento: 'MANIFESTACAO_CIENCIA',
            codigoEvento: '210210',
            protocolo: manifestacao.protocolo,
            statusSefaz: manifestacao.status,
            motivoSefaz: manifestacao.motivo,
          });
          await this.sleep(2_500);
          try {
            await this.withSefazRateLimit(input.clienteId, () =>
              this.distribuicao.buscarXmlCompletoAposManifestacao({
                documentoId: saved.id,
                clienteId: input.clienteId,
                cnpj: cliente.cnpj,
                uf: cliente.uf,
                chaveAcesso: item.chaveAcesso,
              }),
            );
          } catch (error: unknown) {
            if (error instanceof SefazConsultaAdiadaError) {
              adiamento = error;
            } else if (
              /consumo indevido|\b656\b/i.test(this.rootCause(error))
            ) {
              consumoIndevido = true;
            }
            // A Ciência já foi autorizada. A propagação do XML completo é
            // eventual e não deve converter a manifestação em falha.
            this.logger.warn(
              'fiscal_key_import_xml_pending_after_manifestation',
              {
                requestId: input.requestId,
                userId: input.actorUserId,
                entityId: saved.id,
                operation: 'buscar_xml_apos_ciencia',
              },
            );
          }
          saved = await this.getDocumento(input.clienteId, item.chaveAcesso);
        }
        const xmlCompleto = Boolean(saved && saved.situacao !== 'RESUMIDA');
        resultados.push(
          this.result(
            item,
            xmlCompleto
              ? 'IMPORTADO'
              : input.manifestarAutomaticamente
                ? 'RESUMO_COM_CIENCIA'
                : 'RESUMO_PENDENTE',
            xmlCompleto
              ? 'Ciência registrada e XML completo importado.'
              : input.manifestarAutomaticamente
                ? 'Ciência da Operação registrada; o XML pode levar alguns minutos para ficar disponível.'
                : 'Resumo salvo. Autorize a Ciência da Operação para solicitar o XML completo.',
            saved,
            resumo.emitenteRazaoSocial,
            resumo.valorTotal,
          ),
        );
      } catch (error: unknown) {
        if (error instanceof SefazConsultaAdiadaError) {
          adiamento = error;
          resultados.push(
            this.result(
              item,
              error.motivo === 'LIMITE_LOCAL'
                ? 'ADIADO_LIMITE_CONSULTAS'
                : 'ABORTADO_CONSUMO_INDEVIDO',
              error.message,
            ),
          );
          continue;
        }
        const certError = this.findCertificateAccessError(error);
        if (certError) {
          certificadoIndisponivel = true;
          const mensagem =
            certError.code === 'CERTIFICATE_OBJECT_NOT_FOUND' ||
            certError.code === 'CERTIFICATE_STORAGE_UNAVAILABLE'
              ? 'O certificado está cadastrado, mas o arquivo não pôde ser lido do armazenamento. Verifique a configuração de storage ou contate o suporte.'
              : certError.code === 'CERTIFICATE_INITIALIZATION_FAILED'
                ? 'Não foi possível inicializar o certificado e a biblioteca de consulta. Verifique a validade, a senha do A1 e a configuração da integração.'
                : certError.code === 'CERTIFICATE_UNAVAILABLE'
                  ? 'Nenhum certificado A1 ativo está disponível para esta empresa.'
                  : 'Não foi possível decifrar o certificado armazenado. Verifique a configuração de criptografia e o cadastro do A1.';
          this.logger.error('fiscal_key_import_item_failed', error, {
            requestId: input.requestId,
            userId: input.actorUserId,
            entityId: input.clienteId,
            operation: 'importar_dfe_por_chave',
            result: 'CERTIFICATE_UNAVAILABLE',
          });
          resultados.push(
            this.result(item, 'ABORTADO_CERTIFICADO_INDISPONIVEL', mensagem),
          );
          continue;
        }
        const message = this.rootCause(error);
        if (/consumo indevido|\b656\b/i.test(message)) consumoIndevido = true;
        // A biblioteca encapsula rejeições em Error e remove o cStat.
        // Exibir somente o motivo fiscal reconhecido, nunca erros brutos de storage/SQL.
        const rejeicao = message.match(/Rejei[çc][ãa]o[^\r\n]*/i)?.[0];
        falhaConsulta = rejeicao
          ? `A SEFAZ recusou a consulta: ${rejeicao.slice(0, 400)}`
          : /timeout|timed out|ETIMEDOUT|ECONN|ENOTFOUND|socket|network|TLS|SSL|unable to verify|self.signed|certificate/i.test(
                message,
              )
            ? 'Falha de comunicação segura com a SEFAZ. Tente mais tarde; isso não confirma que o certificado A1 seja inválido.'
            : 'Não foi possível concluir a consulta ou salvar o documento. O lote foi interrompido; consulte o suporte com o identificador da requisição.';
        this.logger.error('fiscal_key_import_item_failed', error, {
          requestId: input.requestId,
          userId: input.actorUserId,
          entityId: input.clienteId,
          operation: 'importar_dfe_por_chave',
          result: consumoIndevido ? 'CONSUMO_INDEVIDO' : 'FAILED',
        });
        resultados.push(
          this.result(
            item,
            consumoIndevido ? 'ABORTADO_CONSUMO_INDEVIDO' : 'FALHA',
            consumoIndevido
              ? 'A SEFAZ bloqueou temporariamente novas consultas (cStat 656).'
              : `${falhaConsulta} Referência: ${input.requestId}.`,
          ),
        );
      }
    }

    const resumo = this.summarize(resultados);
    await this.registrarAuditoria({ ...input, resumo });
    this.logger.info('fiscal_key_import_completed', {
      requestId: input.requestId,
      userId: input.actorUserId,
      entityId: input.clienteId,
      operation: 'importar_dfe_por_chave',
      result: resumo.falhas > 0 ? 'PARTIAL_OR_FAILED' : 'SUCCESS',
      total: resumo.total,
      importados: resumo.importados,
      falhas: resumo.falhas,
    });

    return {
      resumo,
      itens: resultados,
      proxima_tentativa_em: adiamento?.retryAt.toISOString() ?? null,
    };
  }

  private async getCliente(
    clienteId: string,
    validateOperationalData: boolean,
  ) {
    const rows = await this.database.db
      .select({
        id: clientes.id,
        cnpj: clientes.cnpj,
        uf: clientes.uf,
        regimeTributario: clientes.regimeTributario,
        apuraIcms: clientes.apuraIcms,
      })
      .from(clientes)
      .where(eq(clientes.id, clienteId))
      .limit(1);
    const cliente = rows[0];
    if (!cliente) throw new NotFoundException('Empresa não encontrada.');
    if (
      validateOperationalData &&
      (!cliente.uf || !/^[A-Z]{2}$/.test(cliente.uf))
    ) {
      throw new BadRequestException(
        'Informe uma UF válida no cadastro da empresa antes de consultar a SEFAZ.',
      );
    }
    return {
      ...cliente,
      uf: cliente.uf ?? '',
      regimeTributario: this.asRegimeTributario(cliente.regimeTributario),
    };
  }

  private async assertCertificadoDisponivel(clienteId: string) {
    const rows = await this.database.db
      .select({
        id: certificadosDigitais.id,
        validadeFim: certificadosDigitais.validadeFim,
      })
      .from(certificadosDigitais)
      .where(
        and(
          eq(certificadosDigitais.clienteId, clienteId),
          inArray(certificadosDigitais.status, ['ATIVO', 'PRESTES_A_EXPIRAR']),
        ),
      )
      .limit(1);
    if (!rows[0] || rows[0].validadeFim <= new Date()) {
      throw new BadRequestException(
        'Cadastre um certificado digital A1 válido antes de consultar as chaves.',
      );
    }
  }

  private async getDocumentosExistentes(clienteId: string, chaves: string[]) {
    if (chaves.length === 0) return [] as DocumentoExistente[];
    return this.database.db
      .select({
        id: documentosFiscais.id,
        chaveAcesso: documentosFiscais.chaveAcesso,
        situacao: documentosFiscais.situacao,
        manifestacaoStatus: documentosFiscais.manifestacaoStatus,
      })
      .from(documentosFiscais)
      .where(
        and(
          eq(documentosFiscais.clienteId, clienteId),
          inArray(documentosFiscais.chaveAcesso, [...new Set(chaves)]),
        ),
      );
  }

  private async getDocumento(clienteId: string, chaveAcesso: string) {
    const rows = await this.getDocumentosExistentes(clienteId, [chaveAcesso]);
    return rows[0];
  }

  private toPreviewItem(
    item: ParsedFiscalAccessKey,
    existing?: DocumentoExistente,
  ) {
    const statusLocal = !item.valida
      ? 'INVALIDA'
      : !item.aptaParaBusca
        ? 'NAO_SUPORTADA'
        : existing?.situacao === 'RESUMIDA'
          ? 'RESUMIDA'
          : existing
            ? 'JA_IMPORTADA'
            : 'NOVA';
    return {
      entrada: item.entrada,
      chave_acesso: item.chaveAcesso,
      valida: item.valida,
      apta_para_busca: item.aptaParaBusca,
      motivo:
        statusLocal !== 'JA_IMPORTADA' && item.aptaParaBusca && foraDaJanelaSefaz(item.chaveAcesso)
          ? FORA_JANELA_MESSAGE
          : item.motivo,
      ocorrencias: item.ocorrencias,
      modelo: item.metadata?.modelo ?? null,
      uf: item.metadata?.uf ?? null,
      competencia: item.metadata?.competencia ?? null,
      cnpj_emitente: item.metadata?.cnpjEmitente ?? null,
      numero_documento: item.metadata?.numeroDocumento ?? null,
      serie: item.metadata?.serie ?? null,
      status_local: statusLocal,
      documento_id: existing?.id ?? null,
    };
  }

  private result(
    item: ParsedFiscalAccessKey,
    status: ImportacaoChaveStatus,
    mensagem: string,
    documento?: DocumentoExistente,
    emitente: string | null = null,
    valorTotal: string | null = null,
  ): ImportacaoChaveItem {
    return {
      chave_acesso: item.chaveAcesso,
      status,
      mensagem,
      documento_id: documento?.id ?? null,
      modelo: item.metadata?.modelo ?? null,
      competencia: item.metadata?.competencia ?? null,
      emitente,
      valor_total: valorTotal,
    };
  }

  private summarize(itens: ImportacaoChaveItem[]) {
    const count = (...statuses: ImportacaoChaveStatus[]) =>
      itens.filter((item) => statuses.includes(item.status)).length;
    return {
      total: itens.length,
      importados: count('IMPORTADO'),
      ja_existentes: count('JA_EXISTENTE'),
      resumos: count('RESUMO_COM_CIENCIA', 'RESUMO_PENDENTE'),
      nao_localizados: count('NAO_LOCALIZADO'),
      recuperacao_portal: count('RECUPERACAO_PORTAL_NECESSARIA'),
      adiados: count('ADIADO_LIMITE_CONSULTAS'),
      nao_suportados: count('NAO_SUPORTADO'),
      invalidas: count('INVALIDA'),
      falhas: count(
        'FALHA',
        'ADIADO_LIMITE_CONSULTAS',
        'ABORTADO_CONSUMO_INDEVIDO',
        'ABORTADO_CERTIFICADO_INDISPONIVEL',
      ),
      consumo_indevido: count('ABORTADO_CONSUMO_INDEVIDO') > 0,
      certificado_indisponivel: count('ABORTADO_CERTIFICADO_INDISPONIVEL') > 0,
    };
  }

  private async registrarAuditoria(input: {
    clienteId: string;
    actorUserId: string;
    requestId: string;
    manifestarAutomaticamente?: boolean;
    forcarReimportacao?: boolean;
    resumo: ReturnType<ImportacaoChavesFiscalService['summarize']>;
  }) {
    try {
      await this.database.db.insert(eventosAuditoria).values({
        atorUserId: input.actorUserId,
        acao: 'DOCUMENTOS_FISCAIS_IMPORTADOS_POR_CHAVE',
        entidadeTipo: 'CLIENTE',
        entidadeId: input.clienteId,
        dados: {
          origem: 'LISTAGEM_CHAVES',
          requestId: input.requestId,
          manifestacaoAutomatica: Boolean(input.manifestarAutomaticamente),
          reimportacaoForcada: Boolean(input.forcarReimportacao),
          ...input.resumo,
        },
      });
    } catch (error: unknown) {
      this.logger.error('fiscal_key_import_audit_failed', error, {
        requestId: input.requestId,
        userId: input.actorUserId,
        entityId: input.clienteId,
        operation: 'auditar_importacao_dfe_por_chave',
      });
    }
  }

  private async withSefazRateLimit<T>(
    clienteId: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const previous = this.queueByClient.get(clienteId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.queueByClient.set(clienteId, tail);
    await previous;
    try {
      const elapsed = Date.now() - (this.lastCallByClient.get(clienteId) ?? 0);
      if (elapsed < MIN_SEFAZ_INTERVAL_MS) {
        await this.sleep(MIN_SEFAZ_INTERVAL_MS - elapsed);
      }
      this.lastCallByClient.set(clienteId, Date.now());
      return await action();
    } finally {
      release();
      if (this.queueByClient.get(clienteId) === tail) {
        this.queueByClient.delete(clienteId);
      }
    }
  }

  private sleep(milliseconds: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
  }

  private asRegimeTributario(value: string | null): RegimeTributario | null {
    return value === 'SIMPLES_NACIONAL' ||
      value === 'LUCRO_PRESUMIDO' ||
      value === 'LUCRO_REAL'
      ? value
      : null;
  }

  private publicError(error: unknown) {
    return error instanceof Error
      ? error.message
      : 'Não foi possível ler a lista.';
  }

  private rootCause(error: unknown): string {
    let current: unknown = error;
    const seen = new Set<unknown>();
    let message = this.publicError(error);
    while (current && typeof current === 'object' && !seen.has(current)) {
      seen.add(current);
      const candidate = current as { message?: unknown; cause?: unknown };
      if (typeof candidate.message === 'string') message = candidate.message;
      current = candidate.cause;
    }
    return message;
  }

  private findCertificateAccessError(
    error: unknown,
  ): CertificateAccessError | null {
    let current: unknown = error;
    const seen = new Set<unknown>();
    while (current && typeof current === 'object' && !seen.has(current)) {
      seen.add(current);
      if (current instanceof CertificateAccessError) return current;
      current = (current as { cause?: unknown }).cause;
    }
    return null;
  }
}
