import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import { AppLogger } from '../../common/logger.service';
import { DatabaseService } from '../../database/database.service';
import {
  clientes,
  documentosFiscais,
  documentosFiscaisCteEscrituracao,
  documentosFiscaisItens,
  spedAjustesApuracao,
  spedArquivosGerados,
  spedConfiguracoes,
  spedContabilistas,
  spedInventarioItens,
  spedInventarios,
  spedItens,
  spedObrigacoesRecolhimento,
  spedParticipantes,
  spedResponsabilidadesTributarias,
  spedSaldosApuracao,
  spedUnidades,
} from '../../database/schema';
import { StorageService } from '../../storage/storage.service';
import { buildSpedFile, validateSpedFile } from './core';
import {
  buildEfdIcmsIpiRecords,
  type SpedContabilistaBuilderData,
  type SpedDocumentoCteBuilderData,
  type SpedDocumentoNfeBuilderData,
  type SpedEfdBuilderInput,
  type SpedEmpresaBuilderData,
  type SpedItemCatalogoBuilderData,
  type SpedItemDocumentoBuilderData,
  type SpedParticipanteBuilderData,
  type SpedUnidadeBuilderData,
} from './efd-icms-ipi.builder';
import {
  differenceWithinTolerance,
  fromScaledInteger,
  toScaledInteger,
} from './sped-decimal';
import type {
  GeneratedSpedFile,
  SpedInconsistencia,
  SpedPreparedGeneration,
  SpedPreview,
} from './sped-efd.types';

type DatabaseExecutor =
  | DatabaseService['db']
  | Parameters<Parameters<DatabaseService['db']['transaction']>[0]>[0];

interface FiscalPartyData {
  cnpjCpf?: string;
  cnpj?: string;
  cpf?: string;
  nome?: string;
  ie?: string;
  uf?: string;
  codMun?: string;
  endereco?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cep?: string;
  suframa?: string;
  codPais?: string;
}

interface CatalogParticipant extends SpedParticipanteBuilderData {
  fonteDocumentoId: string | null;
}

interface CatalogItem extends SpedItemCatalogoBuilderData {
  identity: string;
}

interface PreparedInternal extends SpedPreparedGeneration {
  participantes: CatalogParticipant[];
  unidades: SpedUnidadeBuilderData[];
  itensCatalogo: CatalogItem[];
}

const EMPTY_APURACAO: SpedPreview['apuracao'] = {
  icmsProprio: {
    debitos: '0.00',
    creditos: '0.00',
    saldoCredorAnterior: '0.00',
    ajustesDebitos: '0.00',
    ajustesCreditos: '0.00',
    estornosCreditos: '0.00',
    estornosDebitos: '0.00',
    deducoes: '0.00',
    saldoApurado: '0.00',
    icmsRecolher: '0.00',
    saldoCredorTransportar: '0.00',
  },
  icmsStPorUf: [],
  difalFcpPorUf: [],
  ipi: null,
};

@Injectable()
export class EfdIcmsIpiService {
  constructor(
    private readonly database: DatabaseService,
    private readonly storage: StorageService,
    private readonly logger: AppLogger,
  ) {}

  async preview(input: {
    clienteId: string;
    competencia: string;
    finalidade: '0' | '1';
  }): Promise<SpedPreview> {
    return (
      await this.preparar(
        this.database.db,
        input.clienteId,
        input.competencia,
        input.finalidade,
      )
    ).preview;
  }

  async gerar(input: {
    clienteId: string;
    competencia: string;
    finalidade: '0' | '1';
    actorUserId: string;
    requestId?: string;
  }): Promise<GeneratedSpedFile> {
    const generationId = randomUUID();
    const prepared = await this.database.db.transaction(
      async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.clienteId}:${input.competencia}`}, 0))`,
        );
        const snapshot = await this.preparar(
          tx,
          input.clienteId,
          input.competencia,
          input.finalidade,
        );
        if (!snapshot.preview.podeGerar) {
          throw new UnprocessableEntityException({
            code: 'SPED_INCONSISTENTE',
            message:
              'A EFD ICMS/IPI possui inconsistências impeditivas. Revise a prévia antes de gerar.',
            inconsistencias: snapshot.preview.inconsistencias,
          });
        }

        await this.persistirCatalogos(tx, input.clienteId, snapshot);
        await tx.insert(spedArquivosGerados).values({
          id: generationId,
          clienteId: input.clienteId,
          competencia: `${input.competencia}-01`,
          finalidade: input.finalidade,
          codVersao: '020',
          perfil: snapshot.preview.perfil!,
          status: 'PROCESSANDO',
          contadores: { ...snapshot.preview.contadores },
          inconsistencias: snapshot.preview.inconsistencias.map((item) => ({
            ...item,
          })),
          geradoPor: input.actorUserId,
        });
        return snapshot;
      },
      { isolationLevel: 'repeatable read' },
    );

    let built: ReturnType<typeof buildSpedFile>;
    try {
      built = buildSpedFile({ records: prepared.records });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Falha ao montar o arquivo.';
      await this.marcarFalha(generationId, message);
      throw new UnprocessableEntityException({
        code: 'SPED_MONTAGEM_INVALIDA',
        message: 'O arquivo não pôde ser montado com segurança.',
      });
    }
    const structuralValidation = validateSpedFile(built.bytes, {
      strictFieldCounts: true,
    });
    if (!structuralValidation.valid) {
      const message = structuralValidation.issues
        .map((issue) => `${issue.code}: ${issue.message}`)
        .join('; ');
      await this.marcarFalha(generationId, message);
      throw new UnprocessableEntityException({
        code: 'SPED_ESTRUTURA_INVALIDA',
        message: 'A validação estrutural interna do arquivo falhou.',
        inconsistencias: structuralValidation.issues,
      });
    }

    const normalizedDocument = normalizeIdentifier(prepared.clientDocument);
    const filename = `SPED_EFD_ICMS_IPI_${normalizedDocument}_${input.competencia.replace('-', '')}.txt`;
    const [, month] = input.competencia.split('-');
    const [year] = input.competencia.split('-');
    const objectKey = [
      'clientes',
      normalizedDocument,
      'fiscais',
      'sped',
      year,
      month,
      `${generationId}.txt`,
    ].join('/');
    const hashSha256 = createHash('sha256').update(built.bytes).digest('hex');

    try {
      await this.storage.upload(
        objectKey,
        built.bytes,
        'text/plain; charset=ISO-8859-1',
      );
      await this.database.db
        .update(spedArquivosGerados)
        .set({
          status: 'GERADO',
          hashSha256,
          arquivoKey: objectKey,
          arquivoNome: filename,
          tamanhoBytes: built.bytes.length,
          concluidoEm: new Date(),
        })
        .where(eq(spedArquivosGerados.id, generationId));
    } catch (error: unknown) {
      await this.marcarFalha(generationId, 'Falha ao armazenar o arquivo.');
      this.logger.error('sped_efd_generation_storage_failed', error, {
        requestId: input.requestId,
        userId: input.actorUserId,
        entityType: 'SPED_ARQUIVO',
        entityId: generationId,
        clienteId: input.clienteId,
        operation: 'gerar_efd_icms_ipi',
      });
      throw new ServiceUnavailableException(
        'O arquivo foi montado, mas não pôde ser armazenado com segurança. Tente novamente.',
      );
    }

    return {
      id: generationId,
      buffer: built.bytes,
      filename,
      hashSha256,
    };
  }

  private async preparar(
    db: DatabaseExecutor,
    clienteId: string,
    competencia: string,
    finalidade: '0' | '1',
  ): Promise<PreparedInternal> {
    const inconsistencias: SpedInconsistencia[] = [];
    const period = this.parseCompetencia(competencia, inconsistencias);
    const empty = this.emptyPrepared(competencia, finalidade, inconsistencias);
    if (!period) return empty;

    const companyRows = await db
      .select({
        clienteId: clientes.id,
        tipoPessoa: clientes.tipoPessoa,
        cnpj: clientes.cnpj,
        cpf: clientes.cpf,
        razaoSocial: clientes.razaoSocial,
        emails: clientes.emails,
        cep: clientes.cep,
        logradouro: clientes.logradouro,
        numero: clientes.numero,
        complemento: clientes.complemento,
        bairro: clientes.bairro,
        municipio: clientes.municipio,
        uf: clientes.uf,
        regimeTributario: clientes.regimeTributario,
        inscricaoEstadual: clientes.inscricaoEstadual,
        configuracaoId: spedConfiguracoes.id,
        obrigadoEfdIcmsIpi: spedConfiguracoes.obrigadoEfdIcmsIpi,
        perfilEfd: spedConfiguracoes.perfilEfd,
        indAtiv: spedConfiguracoes.indAtiv,
        classificacaoEstabelecimentoIndustrial:
          spedConfiguracoes.classificacaoEstabelecimentoIndustrial,
        codigoMunicipioIbge: spedConfiguracoes.codigoMunicipioIbge,
        nomeFantasia: spedConfiguracoes.nomeFantasia,
        inscricaoMunicipal: spedConfiguracoes.inscricaoMunicipal,
        suframa: spedConfiguracoes.suframa,
        telefone: spedConfiguracoes.telefone,
        fax: spedConfiguracoes.fax,
        inventarioObrigatorio: spedConfiguracoes.inventarioObrigatorio,
        blocoKComMovimento: spedConfiguracoes.blocoKComMovimento,
        tipoItemPadrao: spedConfiguracoes.tipoItemPadrao,
        indicadores1010: spedConfiguracoes.indicadores1010,
        contabilistaId: spedContabilistas.id,
        contabilistaNome: spedContabilistas.nome,
        contabilistaCpf: spedContabilistas.cpf,
        contabilistaCrc: spedContabilistas.crc,
        contabilistaCnpj: spedContabilistas.cnpj,
        contabilistaCep: spedContabilistas.cep,
        contabilistaLogradouro: spedContabilistas.logradouro,
        contabilistaNumero: spedContabilistas.numero,
        contabilistaComplemento: spedContabilistas.complemento,
        contabilistaBairro: spedContabilistas.bairro,
        contabilistaTelefone: spedContabilistas.telefone,
        contabilistaFax: spedContabilistas.fax,
        contabilistaEmail: spedContabilistas.email,
        contabilistaCodigoMunicipioIbge: spedContabilistas.codigoMunicipioIbge,
      })
      .from(clientes)
      .leftJoin(spedConfiguracoes, eq(spedConfiguracoes.clienteId, clientes.id))
      .leftJoin(spedContabilistas, eq(spedContabilistas.clienteId, clientes.id))
      .where(eq(clientes.id, clienteId))
      .limit(1);
    const company = companyRows[0];
    if (!company) throw new NotFoundException('Empresa não encontrada.');

    this.validarConfiguracao(company, inconsistencias);
    const profile = isSpedProfile(company.perfilEfd) ? company.perfilEfd : null;
    const indAtiv =
      company.indAtiv === '0' || company.indAtiv === '1'
        ? company.indAtiv
        : null;
    if (!profile || !indAtiv || !company.contabilistaId) {
      return {
        ...empty,
        clientDocument: company.cnpj,
        preview: {
          ...empty.preview,
          perfil: profile,
          inconsistencias,
          podeGerar: false,
        },
      };
    }

    const [documents, saldos, ajustes, obrigacoes, responsabilidades] =
      await Promise.all([
        db
          .select()
          .from(documentosFiscais)
          .where(
            and(
              eq(documentosFiscais.clienteId, clienteId),
              or(
                and(
                  isNotNull(documentosFiscais.dataEmissaoFiscal),
                  gte(documentosFiscais.dataEmissaoFiscal, period.startDate),
                  lte(documentosFiscais.dataEmissaoFiscal, period.endDate),
                ),
                and(
                  isNull(documentosFiscais.dataEmissaoFiscal),
                  gte(documentosFiscais.dataEmissao, period.start),
                  lte(documentosFiscais.dataEmissao, period.end),
                ),
              ),
            ),
          )
          .orderBy(
            asc(documentosFiscais.dataEmissaoFiscal),
            asc(documentosFiscais.dataEmissao),
            asc(documentosFiscais.modelo),
            asc(documentosFiscais.serie),
            asc(documentosFiscais.numeroDocumento),
            asc(documentosFiscais.id),
          ),
        db
          .select()
          .from(spedSaldosApuracao)
          .where(
            and(
              eq(spedSaldosApuracao.clienteId, clienteId),
              eq(spedSaldosApuracao.competencia, period.competenciaDate),
            ),
          ),
        db
          .select()
          .from(spedAjustesApuracao)
          .where(
            and(
              eq(spedAjustesApuracao.clienteId, clienteId),
              eq(spedAjustesApuracao.competencia, period.competenciaDate),
            ),
          )
          .orderBy(
            asc(spedAjustesApuracao.registro),
            asc(spedAjustesApuracao.id),
          ),
        db
          .select()
          .from(spedObrigacoesRecolhimento)
          .where(
            and(
              eq(spedObrigacoesRecolhimento.clienteId, clienteId),
              eq(
                spedObrigacoesRecolhimento.competencia,
                period.competenciaDate,
              ),
            ),
          ),
        db
          .select({
            tipo: spedResponsabilidadesTributarias.tipo,
            uf: spedResponsabilidadesTributarias.uf,
          })
          .from(spedResponsabilidadesTributarias)
          .where(
            and(
              eq(spedResponsabilidadesTributarias.clienteId, clienteId),
              eq(spedResponsabilidadesTributarias.ativo, true),
              lte(
                spedResponsabilidadesTributarias.vigenciaInicio,
                period.endDate,
              ),
              or(
                isNull(spedResponsabilidadesTributarias.vigenciaFim),
                gte(
                  spedResponsabilidadesTributarias.vigenciaFim,
                  period.startDate,
                ),
              ),
            ),
          ),
      ]);

    const documentIds = documents.map((document) => document.id);
    const [items, ctes] = documentIds.length
      ? await Promise.all([
          db
            .select()
            .from(documentosFiscaisItens)
            .where(
              inArray(documentosFiscaisItens.documentoFiscalId, documentIds),
            )
            .orderBy(
              asc(documentosFiscaisItens.documentoFiscalId),
              asc(documentosFiscaisItens.numeroItem),
            ),
          db
            .select()
            .from(documentosFiscaisCteEscrituracao)
            .where(
              inArray(
                documentosFiscaisCteEscrituracao.documentoFiscalId,
                documentIds,
              ),
            ),
        ])
      : [[], []];

    const itemsByDocument = new Map<string, typeof items>();
    for (const item of items) {
      const list = itemsByDocument.get(item.documentoFiscalId) ?? [];
      list.push(item);
      itemsByDocument.set(item.documentoFiscalId, list);
    }
    const cteByDocument = new Map(
      ctes.map((cte) => [cte.documentoFiscalId, cte]),
    );

    const participantes = new Map<string, CatalogParticipant>();
    const unidades = new Map<string, SpedUnidadeBuilderData>();
    const itensCatalogo = new Map<string, CatalogItem>();
    const information = new Map<string, { codigo: string; texto: string }>();
    const nfe: SpedDocumentoNfeBuilderData[] = [];
    const cteDocuments: SpedDocumentoCteBuilderData[] = [];
    let excluded = 0;
    let pending = 0;

    for (const document of documents) {
      if (document.situacao === 'DENEGADA') {
        excluded += 1;
        inconsistencias.push({
          codigo: 'DOCUMENTO_DENEGADO_NAO_EMITIDO',
          severidade: 'AVISO',
          mensagem:
            'Documento denegado não foi emitido porque COD_SIT 04/05 está descontinuado no leiaute 2026.',
          documentoId: document.id,
          chaveAcesso: document.chaveAcesso,
        });
        continue;
      }
      if (document.situacao === 'RESUMIDA') {
        excluded += 1;
        pending += 1;
        inconsistencias.push(
          this.documentIssue(
            document,
            'DOCUMENTO_XML_COMPLETO_AUSENTE',
            'ERRO',
            'O XML completo do documento ainda não foi obtido.',
          ),
        );
        continue;
      }
      const canceled = document.situacao === 'CANCELADA';
      if (!canceled && document.escrituracaoStatus !== 'ESCRITURADO') {
        excluded += 1;
        pending += 1;
        inconsistencias.push(
          this.documentIssue(
            document,
            'DOCUMENTO_PENDENTE_ESCRITURACAO',
            'ERRO',
            'Documento pendente de revisão fiscal não pode compor a EFD.',
          ),
        );
        continue;
      }

      if (document.tipoDocumento === 'CTE') {
        const cte = cteByDocument.get(document.id);
        if (
          !canceled &&
          (!cte ||
            !cte.escrituravel ||
            cte.revisaoNecessaria ||
            cte.cfopRevisaoNecessaria)
        ) {
          excluded += 1;
          pending += 1;
          inconsistencias.push(
            this.documentIssue(
              document,
              'CTE_PENDENTE_REVISAO',
              'ERRO',
              'CT-e não escriturável ou pendente de revisão foi excluído.',
            ),
          );
          continue;
        }
        if (!cte) continue;
        const participant = this.resolveParticipant(
          document,
          company.cnpj,
          participantes,
          inconsistencias,
        );
        if (!participant) {
          excluded += 1;
          pending += 1;
          continue;
        }
        cteDocuments.push({
          row: {
            ...document,
            codSituacaoSped: canceled
              ? '02'
              : (document.codSituacaoSped ?? '00'),
          },
          cte,
          participanteCodigo: participant.codigo,
          participanteUf: participant.uf,
        });
        continue;
      }

      if (!canceled && document.integridadeStatus !== 'OK') {
        excluded += 1;
        pending += 1;
        inconsistencias.push(
          this.documentIssue(
            document,
            document.integridadeStatus === 'DIVERGENTE'
              ? 'DOCUMENTO_INTEGRIDADE_DIVERGENTE'
              : 'DOCUMENTO_INTEGRIDADE_NAO_CONFERIDA',
            'ERRO',
            document.integridadeStatus === 'DIVERGENTE'
              ? 'Os totais do XML divergem dos itens persistidos.'
              : 'Reprocesse o XML para conferir os totais antes de gerar a EFD.',
          ),
        );
        continue;
      }

      const documentItems = itemsByDocument.get(document.id) ?? [];
      if (
        !canceled &&
        (documentItems.length === 0 ||
          documentItems.some((item) => item.cfopRevisaoNecessaria))
      ) {
        excluded += 1;
        pending += 1;
        inconsistencias.push(
          this.documentIssue(
            document,
            'ITENS_FISCAIS_PENDENTES',
            'ERRO',
            'Documento sem itens fiscais válidos ou com CFOP pendente de revisão.',
          ),
        );
        continue;
      }

      const participant = this.resolveParticipant(
        document,
        company.cnpj,
        participantes,
        inconsistencias,
        document.modelo === '65',
      );
      if (document.modelo === '55' && !participant) {
        excluded += 1;
        pending += 1;
        continue;
      }
      const preparedItems: SpedItemDocumentoBuilderData[] = canceled
        ? []
        : documentItems.map((item) =>
            this.prepareItem(
              item,
              document,
              participant,
              company.cnpj,
              company.tipoItemPadrao ?? '00',
              unidades,
              itensCatalogo,
              document.modelo === '55' &&
                normalizeIdentifier(document.emitenteCnpjCpf) !==
                  normalizeIdentifier(company.cnpj) &&
                profile !== 'C',
              inconsistencias,
            ),
          );
      let informationCode: string | null = null;
      if (document.informacoesComplementares?.trim()) {
        const text = document.informacoesComplementares.trim();
        informationCode = stableCode('I', text, 6);
        information.set(informationCode, {
          codigo: informationCode,
          texto: text,
        });
      }
      nfe.push({
        row: {
          ...document,
          codSituacaoSped: canceled ? '02' : (document.codSituacaoSped ?? '00'),
        },
        participanteCodigo: participant?.codigo ?? null,
        participanteUf: participant?.uf ?? null,
        itens: preparedItems,
        codigoInformacaoComplementar: informationCode,
      });
    }

    const inventario = company.inventarioObrigatorio
      ? await this.loadInventario(
          db,
          clienteId,
          period.endDate,
          participantes,
          unidades,
          itensCatalogo,
          inconsistencias,
        )
      : null;
    if (company.inventarioObrigatorio && !inventario) {
      inconsistencias.push({
        codigo: 'INVENTARIO_OBRIGATORIO_AUSENTE',
        severidade: 'ERRO',
        mensagem:
          'A empresa exige Bloco H com movimento, mas não há inventário fechado disponível.',
        campo: 'inventarioObrigatorio',
      });
    }
    if (company.blocoKComMovimento) {
      inconsistencias.push({
        codigo: 'BLOCO_K_MOVIMENTO_NAO_CONFIGURADO',
        severidade: 'ERRO',
        mensagem:
          'O estabelecimento exige Bloco K com movimento e os dados de produção/estoque ainda não foram informados.',
        campo: 'blocoKComMovimento',
      });
    }
    if (company.uf === 'DF') {
      inconsistencias.push({
        codigo: 'BLOCO_B_DF_NAO_SUPORTADO',
        severidade: 'ERRO',
        mensagem:
          'Estabelecimentos do Distrito Federal exigem avaliação e escrituração do Bloco B; conclua essa configuração antes de gerar.',
        campo: 'uf',
      });
    }

    const empresa: SpedEmpresaBuilderData = {
      razaoSocial: company.razaoSocial,
      nomeFantasia: company.nomeFantasia || company.razaoSocial,
      cnpj: company.cnpj,
      cpf: company.cpf,
      uf: company.uf ?? '',
      inscricaoEstadual: company.inscricaoEstadual ?? '',
      codigoMunicipioIbge: company.codigoMunicipioIbge ?? '',
      inscricaoMunicipal: company.inscricaoMunicipal,
      suframa: company.suframa,
      cep: company.cep,
      logradouro: company.logradouro,
      numero: company.numero,
      complemento: company.complemento,
      bairro: company.bairro,
      telefone: company.telefone,
      fax: company.fax,
      email: company.emails[0] ?? null,
      perfil: profile,
      indAtiv,
      classificacaoEstabelecimentoIndustrial:
        company.classificacaoEstabelecimentoIndustrial,
      regimeTributario: company.regimeTributario,
    };
    const contabilista: SpedContabilistaBuilderData = {
      nome: company.contabilistaNome!,
      cpf: company.contabilistaCpf,
      crc: company.contabilistaCrc!,
      cnpj: company.contabilistaCnpj,
      cep: company.contabilistaCep,
      logradouro: company.contabilistaLogradouro,
      numero: company.contabilistaNumero,
      complemento: company.contabilistaComplemento,
      bairro: company.contabilistaBairro,
      telefone: company.contabilistaTelefone,
      fax: company.contabilistaFax,
      email: company.contabilistaEmail,
      codigoMunicipioIbge: company.contabilistaCodigoMunicipioIbge!,
    };

    const builderInput: SpedEfdBuilderInput = {
      competencia,
      finalidade,
      inicio: period.start,
      fim: period.end,
      empresa,
      contabilista,
      participantes: [...participantes.values()],
      unidades: [...unidades.values()],
      itensCatalogo: [...itensCatalogo.values()],
      informacoesComplementares: [...information.values()],
      nfe,
      cte: cteDocuments,
      saldos,
      ajustes,
      obrigacoes,
      responsabilidades,
      inventario,
      indicadores1010: company.indicadores1010 ?? {},
      inconsistencias,
    };
    const builtRecords = buildEfdIcmsIpiRecords(builderInput);

    this.validarApuracao(
      builtRecords.apuracao,
      obrigacoes,
      responsabilidades,
      inputTaxSignals(nfe),
      inconsistencias,
    );
    for (const item of itensCatalogo.values()) {
      if (item.tipoItemInferido) {
        inconsistencias.push({
          codigo: 'TIPO_ITEM_INFERIDO',
          severidade: 'AVISO',
          mensagem: `O TIPO_ITEM de ${item.codigo} foi inferido como ${item.tipoItem}; confirme o cadastro 0200.`,
          campo: item.codigo,
        });
      }
    }

    let counts = {
      totalLinhas: 0,
      porBloco: {},
      porRegistro: {},
    } as SpedPreview['contadores'];
    try {
      const file = buildSpedFile({ records: builtRecords.records });
      counts = {
        totalLinhas: file.totalLines,
        porBloco: file.blockCounts,
        porRegistro: file.recordCounts,
      };
      const validation = validateSpedFile(file.bytes, {
        strictFieldCounts: true,
      });
      for (const issue of validation.issues) {
        inconsistencias.push({
          codigo: `ESTRUTURA_${issue.code}`,
          severidade: 'ERRO',
          mensagem: issue.message,
        });
      }
    } catch (error: unknown) {
      inconsistencias.push({
        codigo: 'ERRO_MONTAGEM_SPED',
        severidade: 'ERRO',
        mensagem:
          error instanceof Error
            ? error.message
            : 'Não foi possível montar o arquivo.',
      });
    }

    const included = nfe.length + cteDocuments.length;
    const preview: SpedPreview = {
      podeGerar: !inconsistencias.some((item) => item.severidade === 'ERRO'),
      competencia,
      finalidade,
      codVersao: '020',
      versaoLeiaute: '119',
      guiaPratico: '3.2.2',
      pvaReferencia: '6.1.1',
      perfil: profile,
      contadores: counts,
      documentos: {
        incluidos: included,
        excluidos: excluded,
        pendentes: pending,
        nfe: nfe.filter((document) => document.row.modelo === '55').length,
        nfce: nfe.filter((document) => document.row.modelo === '65').length,
        cte: cteDocuments.length,
      },
      apuracao: builtRecords.apuracao,
      inconsistencias,
    };

    return {
      preview,
      records: builtRecords.records,
      clientDocument: company.cnpj,
      participantes: [...participantes.values()],
      unidades: [...unidades.values()],
      itensCatalogo: [...itensCatalogo.values()],
    };
  }

  private validarConfiguracao(
    company: {
      tipoPessoa: string;
      configuracaoId: string | null;
      obrigadoEfdIcmsIpi: boolean | null;
      perfilEfd: string | null;
      indAtiv: string | null;
      classificacaoEstabelecimentoIndustrial: string | null;
      codigoMunicipioIbge: string | null;
      cnpj: string;
      razaoSocial: string;
      uf: string | null;
      inscricaoEstadual: string | null;
      cep: string | null;
      logradouro: string | null;
      numero: string | null;
      bairro: string | null;
      contabilistaId: string | null;
      contabilistaNome: string | null;
      contabilistaCrc: string | null;
      contabilistaCodigoMunicipioIbge: string | null;
    },
    issues: SpedInconsistencia[],
  ) {
    const required = (
      condition: boolean,
      codigo: string,
      mensagem: string,
      campo: string,
    ) => {
      if (!condition)
        issues.push({ codigo, severidade: 'ERRO', mensagem, campo });
    };
    required(
      company.tipoPessoa === 'PJ',
      'ESTABELECIMENTO_DEVE_SER_PJ',
      'A EFD ICMS/IPI deve ser gerada por estabelecimento pessoa jurídica.',
      'tipoPessoa',
    );
    required(
      Boolean(company.configuracaoId),
      'CONFIGURACAO_SPED_AUSENTE',
      'Cadastre o enquadramento SPED do estabelecimento.',
      'configuracao',
    );
    required(
      company.obrigadoEfdIcmsIpi === true,
      'ESTABELECIMENTO_NAO_HABILITADO',
      'O estabelecimento não está marcado como obrigado/habilitado à EFD ICMS/IPI.',
      'obrigadoEfdIcmsIpi',
    );
    required(
      isSpedProfile(company.perfilEfd),
      'PERFIL_EFD_AUSENTE',
      'Informe o perfil estadual A, B ou C.',
      'perfilEfd',
    );
    required(
      company.indAtiv === '0' || company.indAtiv === '1',
      'IND_ATIV_AUSENTE',
      'Informe o indicador de atividade do estabelecimento.',
      'indAtiv',
    );
    if (company.indAtiv === '0') {
      required(
        /^\d{2}$/.test(company.classificacaoEstabelecimentoIndustrial ?? ''),
        'CLASSIFICACAO_INDUSTRIAL_AUSENTE',
        'Estabelecimento industrial deve informar a classificação do registro 0002.',
        'classificacaoEstabelecimentoIndustrial',
      );
    }
    required(
      /^[0-9A-Z]{12}[0-9]{2}$/.test(normalizeIdentifier(company.cnpj)),
      'CNPJ_INVALIDO',
      'O CNPJ do estabelecimento é inválido para o SPED.',
      'cnpj',
    );
    required(
      Boolean(company.razaoSocial.trim()),
      'RAZAO_SOCIAL_AUSENTE',
      'Informe a razão social.',
      'razaoSocial',
    );
    required(
      /^[A-Z]{2}$/.test(company.uf ?? ''),
      'UF_AUSENTE',
      'Informe a UF do estabelecimento.',
      'uf',
    );
    required(
      Boolean(company.inscricaoEstadual?.trim()),
      'IE_AUSENTE',
      'Informe a inscrição estadual.',
      'inscricaoEstadual',
    );
    required(
      /^\d{7}$/.test(company.codigoMunicipioIbge ?? ''),
      'COD_MUN_AUSENTE',
      'Informe o código IBGE de 7 dígitos.',
      'codigoMunicipioIbge',
    );
    required(
      /^\d{8}$/.test(company.cep ?? ''),
      'CEP_AUSENTE',
      'Informe o CEP do estabelecimento.',
      'cep',
    );
    required(
      Boolean(company.logradouro?.trim()),
      'ENDERECO_AUSENTE',
      'Informe o logradouro.',
      'logradouro',
    );
    required(
      Boolean(company.numero?.trim()),
      'NUMERO_ENDERECO_AUSENTE',
      'Informe o número do endereço.',
      'numero',
    );
    required(
      Boolean(company.bairro?.trim()),
      'BAIRRO_AUSENTE',
      'Informe o bairro.',
      'bairro',
    );
    required(
      Boolean(company.contabilistaId),
      'CONTABILISTA_AUSENTE',
      'Cadastre o contabilista do registro 0100.',
      'contabilista',
    );
    required(
      Boolean(company.contabilistaNome?.trim()),
      'CONTABILISTA_NOME_AUSENTE',
      'Informe o nome do contabilista.',
      'contabilista.nome',
    );
    required(
      Boolean(company.contabilistaCrc?.trim()),
      'CONTABILISTA_CRC_AUSENTE',
      'Informe o CRC do contabilista.',
      'contabilista.crc',
    );
    required(
      /^\d{7}$/.test(company.contabilistaCodigoMunicipioIbge ?? ''),
      'CONTABILISTA_COD_MUN_AUSENTE',
      'Informe o código IBGE do contabilista.',
      'contabilista.codigoMunicipioIbge',
    );
  }

  private resolveParticipant(
    document: typeof documentosFiscais.$inferSelect,
    clientDocument: string,
    participants: Map<string, CatalogParticipant>,
    issues: SpedInconsistencia[],
    allowAnonymous = false,
  ): CatalogParticipant | null {
    const ownEmission =
      normalizeIdentifier(document.emitenteCnpjCpf) ===
      normalizeIdentifier(clientDocument);
    const raw = (
      ownEmission ? document.destinatarioDados : document.emitenteDados
    ) as FiscalPartyData | null;
    const fallbackDocument = ownEmission
      ? document.destinatarioCnpjCpf
      : document.emitenteCnpjCpf;
    const fallbackName = ownEmission
      ? document.destinatarioRazaoSocial
      : document.emitenteRazaoSocial;
    const identifier = normalizeIdentifier(
      raw?.cnpjCpf || raw?.cnpj || raw?.cpf || fallbackDocument || '',
    );
    if (!identifier) {
      if (allowAnonymous) return null;
      issues.push(
        this.documentIssue(
          document,
          'PARTICIPANTE_DOCUMENTO_AUSENTE',
          'ERRO',
          'Não foi possível identificar o participante referenciado pelo documento.',
        ),
      );
      return null;
    }
    if (identifier === normalizeIdentifier(clientDocument)) return null;

    const name = (raw?.nome || fallbackName || '').trim();
    const codigoMunicipio = raw?.codMun?.trim() || null;
    const address = raw?.endereco?.trim() || null;
    if (!name || !codigoMunicipio || !address) {
      issues.push(
        this.documentIssue(
          document,
          'PARTICIPANTE_CADASTRO_INCOMPLETO',
          'ERRO',
          'O participante precisa de nome, código IBGE e endereço para o registro 0150.',
        ),
      );
    }
    const existing = participants.get(identifier);
    if (existing) return existing;
    const participant: CatalogParticipant = {
      codigo: stableCode('P', identifier, 16),
      documento: identifier,
      tipoDocumento: identifier.length === 11 ? 'CPF' : 'CNPJ',
      nome: name || 'PARTICIPANTE SEM NOME',
      codigoPais: raw?.codPais || '01058',
      inscricaoEstadual: raw?.ie?.trim() || null,
      codigoMunicipioIbge: codigoMunicipio,
      suframa: raw?.suframa?.trim() || null,
      logradouro: address,
      numero: raw?.numero?.trim() || null,
      complemento: raw?.complemento?.trim() || null,
      bairro: raw?.bairro?.trim() || null,
      uf: raw?.uf?.trim().toUpperCase() || null,
      fonteDocumentoId: document.id,
    };
    participants.set(identifier, participant);
    return participant;
  }

  private prepareItem(
    item: typeof documentosFiscaisItens.$inferSelect,
    document: typeof documentosFiscais.$inferSelect,
    participant: CatalogParticipant | null,
    clientDocument: string,
    defaultType: string,
    units: Map<string, SpedUnidadeBuilderData>,
    catalog: Map<string, CatalogItem>,
    declareCatalog: boolean,
    issues: SpedInconsistencia[],
  ): SpedItemDocumentoBuilderData {
    const unitCode = uniqueUnitCode(item.unidadeComercial, units);
    if (declareCatalog) {
      units.set(unitCode, {
        codigo: unitCode,
        descricao: item.unidadeComercial,
      });
    }
    const ownEmission =
      normalizeIdentifier(document.emitenteCnpjCpf) ===
      normalizeIdentifier(clientDocument);
    const originCode = ownEmission ? null : (participant?.codigo ?? null);
    const identity = `${originCode ?? 'PROPRIO'}|${item.codigoProduto}`;
    let catalogItem = declareCatalog ? catalog.get(identity) : undefined;
    if (!catalogItem) {
      catalogItem = {
        identity,
        codigo: stableCode('I', identity, 16),
        codigoExterno: item.codigoProduto,
        descricao: item.descricao,
        codigoBarras:
          item.codigoEan && !/^SEM GTIN$/i.test(item.codigoEan)
            ? item.codigoEan
            : null,
        unidade: unitCode,
        tipoItem: defaultType,
        tipoItemInferido: true,
        ncm: item.ncm,
        exIpi: null,
        codigoGenero: item.ncm?.slice(0, 2) ?? null,
        codigoServico: null,
        aliquotaIcms: item.aliquotaIcms,
        cest: item.cest,
        participanteOrigemCodigo: originCode,
      };
      if (declareCatalog) catalog.set(identity, catalogItem);
    }
    if (
      declareCatalog &&
      catalogItem.tipoItem === '00' &&
      !/^\d{8}$/.test(item.ncm ?? '')
    ) {
      issues.push({
        codigo: 'ITEM_NCM_AUSENTE',
        severidade: 'ERRO',
        mensagem: `O item ${catalogItem.codigo} classificado como mercadoria precisa de NCM válido.`,
        campo: catalogItem.codigo,
        documentoId: document.id,
        chaveAcesso: document.chaveAcesso,
      });
    }
    if (!item.cstIcms && !item.csosnIcms) {
      issues.push({
        codigo: 'ITEM_CST_ICMS_AUSENTE',
        severidade: 'ERRO',
        mensagem: `O item ${catalogItem.codigo} não possui CST/CSOSN do ICMS.`,
        campo: catalogItem.codigo,
        documentoId: document.id,
        chaveAcesso: document.chaveAcesso,
      });
    }
    return {
      row: item,
      codigoItem: catalogItem.codigo,
      codigoUnidade: unitCode,
    };
  }

  private async loadInventario(
    db: DatabaseExecutor,
    clienteId: string,
    endDate: string,
    participants: Map<string, CatalogParticipant>,
    units: Map<string, SpedUnidadeBuilderData>,
    catalog: Map<string, CatalogItem>,
    issues: SpedInconsistencia[],
  ): Promise<SpedEfdBuilderInput['inventario']> {
    const rows = await db
      .select()
      .from(spedInventarios)
      .where(
        and(
          eq(spedInventarios.clienteId, clienteId),
          eq(spedInventarios.status, 'FECHADO'),
          lte(spedInventarios.dataInventario, endDate),
        ),
      )
      .orderBy(desc(spedInventarios.dataInventario))
      .limit(1);
    const inventory = rows[0];
    if (!inventory) return null;
    if (inventory.motivo !== '01') {
      issues.push({
        codigo: 'INVENTARIO_MOTIVO_NAO_SUPORTADO',
        severidade: 'ERRO',
        mensagem:
          'Inventários com motivo 02 a 06 exigem H020/H030 e devem ser completados antes da geração.',
        campo: 'inventario.motivo',
      });
    }
    const items = await db
      .select({
        row: spedInventarioItens,
        codigoItem: spedItens.codigo,
        codigoExterno: spedItens.codigoExterno,
        descricaoItem: spedItens.descricao,
        codigoBarras: spedItens.codigoBarras,
        tipoItem: spedItens.tipoItem,
        tipoItemInferido: spedItens.tipoItemInferido,
        ncm: spedItens.ncm,
        exIpi: spedItens.exIpi,
        codigoGenero: spedItens.codigoGenero,
        codigoServico: spedItens.codigoServico,
        aliquotaIcms: spedItens.aliquotaIcms,
        cest: spedItens.cest,
        unidadeCodigo: spedUnidades.codigo,
        unidadeDescricao: spedUnidades.descricao,
        participanteCodigo: spedParticipantes.codigo,
        participanteDocumento: spedParticipantes.documento,
        participanteTipoDocumento: spedParticipantes.tipoDocumento,
        participanteNome: spedParticipantes.nome,
        participanteCodigoPais: spedParticipantes.codigoPais,
        participanteIe: spedParticipantes.inscricaoEstadual,
        participanteCodigoMunicipio: spedParticipantes.codigoMunicipioIbge,
        participanteSuframa: spedParticipantes.suframa,
        participanteLogradouro: spedParticipantes.logradouro,
        participanteNumero: spedParticipantes.numero,
        participanteComplemento: spedParticipantes.complemento,
        participanteBairro: spedParticipantes.bairro,
      })
      .from(spedInventarioItens)
      .innerJoin(spedItens, eq(spedItens.id, spedInventarioItens.spedItemId))
      .innerJoin(spedUnidades, eq(spedUnidades.id, spedItens.unidadeId))
      .leftJoin(
        spedParticipantes,
        eq(spedParticipantes.id, spedInventarioItens.participanteId),
      )
      .where(eq(spedInventarioItens.inventarioId, inventory.id))
      .orderBy(asc(spedItens.codigo));
    if (items.length === 0) {
      issues.push({
        codigo: 'INVENTARIO_SEM_ITENS',
        severidade: 'ERRO',
        mensagem: 'O inventário fechado não possui itens.',
      });
    }
    for (const item of items) {
      units.set(item.unidadeCodigo, {
        codigo: item.unidadeCodigo,
        descricao: item.unidadeDescricao,
      });
      if (item.row.unidade !== item.unidadeCodigo) {
        issues.push({
          codigo: 'INVENTARIO_UNIDADE_DIVERGENTE',
          severidade: 'ERRO',
          mensagem: `A unidade ${item.row.unidade} do inventário diverge da unidade ${item.unidadeCodigo} cadastrada no item ${item.codigoItem}.`,
          campo: item.codigoItem,
        });
      }
      const identity = `${item.participanteCodigo ?? 'PROPRIO'}|${item.codigoExterno}`;
      if (
        ![...catalog.values()].some(
          (catalogItem) => catalogItem.codigo === item.codigoItem,
        )
      ) {
        catalog.set(identity, {
          identity,
          codigo: item.codigoItem,
          codigoExterno: item.codigoExterno,
          descricao: item.descricaoItem,
          codigoBarras: item.codigoBarras,
          unidade: item.unidadeCodigo,
          tipoItem: item.tipoItem,
          tipoItemInferido: item.tipoItemInferido,
          ncm: item.ncm,
          exIpi: item.exIpi,
          codigoGenero: item.codigoGenero,
          codigoServico: item.codigoServico,
          aliquotaIcms: item.aliquotaIcms,
          cest: item.cest,
          participanteOrigemCodigo: item.participanteCodigo,
        });
      }
      if (
        item.participanteCodigo &&
        item.participanteDocumento &&
        (item.participanteTipoDocumento === 'CPF' ||
          item.participanteTipoDocumento === 'CNPJ') &&
        !participants.has(item.participanteDocumento)
      ) {
        participants.set(item.participanteDocumento, {
          codigo: item.participanteCodigo,
          documento: item.participanteDocumento,
          tipoDocumento: item.participanteTipoDocumento,
          nome: item.participanteNome ?? 'PARTICIPANTE SEM NOME',
          codigoPais: item.participanteCodigoPais ?? '01058',
          inscricaoEstadual: item.participanteIe,
          codigoMunicipioIbge: item.participanteCodigoMunicipio,
          suframa: item.participanteSuframa,
          logradouro: item.participanteLogradouro,
          numero: item.participanteNumero,
          complemento: item.participanteComplemento,
          bairro: item.participanteBairro,
          uf: null,
          fonteDocumentoId: null,
        });
      }
    }
    return {
      row: inventory,
      itens: items.map((item) => ({
        row: item.row,
        codigoItem: item.codigoItem,
        participanteCodigo: item.participanteCodigo,
      })),
    };
  }

  private validarApuracao(
    apuracao: SpedPreview['apuracao'],
    obrigacoes: Array<typeof spedObrigacoesRecolhimento.$inferSelect>,
    responsabilidades: Array<{ tipo: string; uf: string }>,
    taxSignals: { fcpProprio: bigint; fcpSt: bigint },
    issues: SpedInconsistencia[],
  ) {
    if (taxSignals.fcpProprio > 0n) {
      issues.push({
        codigo: 'FCP_PROPRIO_EXIGE_AJUSTE_ESTADUAL',
        severidade: 'ERRO',
        mensagem:
          'Há FCP próprio no período; informe o ajuste estadual aplicável antes da geração.',
      });
    }
    if (taxSignals.fcpSt > 0n) {
      issues.push({
        codigo: 'FCP_ST_EXIGE_TRATAMENTO_ESTADUAL',
        severidade: 'ERRO',
        mensagem:
          'Há FCP-ST no período; configure o recolhimento estadual aplicável antes da geração.',
      });
    }

    this.validarObrigacao(
      'ICMS_PROPRIO',
      null,
      apuracao.icmsProprio.icmsRecolher,
      obrigacoes,
      issues,
    );
    for (const row of apuracao.icmsStPorUf) {
      if (
        toScaledInteger(row.debitos) > 0n &&
        !responsabilidades.some(
          (item) => item.tipo === 'ICMS_ST' && item.uf === row.uf,
        )
      ) {
        issues.push({
          codigo: 'RESPONSABILIDADE_ICMS_ST_NAO_CONFIGURADA',
          severidade: 'ERRO',
          mensagem: `Confirme a responsabilidade por ICMS-ST para ${row.uf}.`,
          campo: row.uf,
        });
      }
      this.validarObrigacao(
        'ICMS_ST',
        row.uf,
        row.recolher,
        obrigacoes,
        issues,
      );
    }
    for (const row of apuracao.difalFcpPorUf) {
      if (
        toScaledInteger(row.recolher) > 0n &&
        !responsabilidades.some(
          (item) => item.tipo === 'DIFAL_FCP' && item.uf === row.uf,
        )
      ) {
        issues.push({
          codigo: 'RESPONSABILIDADE_DIFAL_NAO_CONFIGURADA',
          severidade: 'ERRO',
          mensagem: `Confirme a responsabilidade por DIFAL/FCP para ${row.uf}.`,
          campo: row.uf,
        });
      }
      this.validarObrigacao(
        'DIFAL_FCP',
        row.uf,
        row.recolher,
        obrigacoes,
        issues,
      );
    }
  }

  private validarObrigacao(
    tipo: string,
    uf: string | null,
    valorCalculado: string,
    obrigacoes: Array<typeof spedObrigacoesRecolhimento.$inferSelect>,
    issues: SpedInconsistencia[],
  ) {
    if (toScaledInteger(valorCalculado) <= 0n) return;
    const row = obrigacoes.find((item) => item.tipo === tipo && item.uf === uf);
    if (!row) {
      issues.push({
        codigo: `OBRIGACAO_${tipo}_AUSENTE`,
        severidade: 'ERRO',
        mensagem: `Cadastre código, valor e vencimento da obrigação ${tipo}${uf ? ` para ${uf}` : ''}.`,
        campo: uf ?? tipo,
      });
      return;
    }
    if (!differenceWithinTolerance(row.valor, valorCalculado)) {
      issues.push({
        codigo: `OBRIGACAO_${tipo}_VALOR_DIVERGENTE`,
        severidade: 'ERRO',
        mensagem: `A obrigação informada (${row.valor}) não fecha com a apuração (${valorCalculado}).`,
        campo: uf ?? tipo,
      });
    }
    if (!row.codigoReceita?.trim() || !row.mesReferencia?.trim()) {
      issues.push({
        codigo: `OBRIGACAO_${tipo}_DADOS_INCOMPLETOS`,
        severidade: 'ERRO',
        mensagem: 'Código de receita e mês de referência são obrigatórios.',
        campo: uf ?? tipo,
      });
    }
  }

  private async persistirCatalogos(
    db: DatabaseExecutor,
    clienteId: string,
    prepared: PreparedInternal,
  ) {
    for (const participant of prepared.participantes) {
      const sourceValues = participant.fonteDocumentoId
        ? { fonteUltimoDocumentoId: participant.fonteDocumentoId }
        : {};
      await db
        .insert(spedParticipantes)
        .values({
          clienteId,
          codigo: participant.codigo,
          documento: participant.documento,
          tipoDocumento: participant.tipoDocumento,
          nome: participant.nome,
          codigoPais: participant.codigoPais,
          inscricaoEstadual: participant.inscricaoEstadual,
          codigoMunicipioIbge: participant.codigoMunicipioIbge,
          suframa: participant.suframa,
          logradouro: participant.logradouro,
          numero: participant.numero,
          complemento: participant.complemento,
          bairro: participant.bairro,
          ...sourceValues,
          atualizadoEm: new Date(),
        })
        .onConflictDoUpdate({
          target: [spedParticipantes.clienteId, spedParticipantes.documento],
          set: {
            nome: participant.nome,
            inscricaoEstadual: participant.inscricaoEstadual,
            codigoMunicipioIbge: participant.codigoMunicipioIbge,
            suframa: participant.suframa,
            logradouro: participant.logradouro,
            numero: participant.numero,
            complemento: participant.complemento,
            bairro: participant.bairro,
            ...sourceValues,
            atualizadoEm: new Date(),
          },
        });
    }
    for (const unit of prepared.unidades) {
      await db
        .insert(spedUnidades)
        .values({ clienteId, codigo: unit.codigo, descricao: unit.descricao })
        .onConflictDoUpdate({
          target: [spedUnidades.clienteId, spedUnidades.codigo],
          set: { descricao: unit.descricao, atualizadoEm: new Date() },
        });
    }

    const participantRows = await db
      .select({ id: spedParticipantes.id, codigo: spedParticipantes.codigo })
      .from(spedParticipantes)
      .where(eq(spedParticipantes.clienteId, clienteId));
    const unitRows = await db
      .select({ id: spedUnidades.id, codigo: spedUnidades.codigo })
      .from(spedUnidades)
      .where(eq(spedUnidades.clienteId, clienteId));
    const participantIds = new Map(
      participantRows.map((row) => [row.codigo, row.id]),
    );
    const unitIds = new Map(unitRows.map((row) => [row.codigo, row.id]));

    for (const item of prepared.itensCatalogo) {
      const unitId = unitIds.get(item.unidade);
      if (!unitId) throw new Error('Unidade SPED não persistida.');
      const originId = item.participanteOrigemCodigo
        ? participantIds.get(item.participanteOrigemCodigo)
        : null;
      const existing = await db
        .select({ id: spedItens.id })
        .from(spedItens)
        .where(
          and(
            eq(spedItens.clienteId, clienteId),
            originId
              ? eq(spedItens.participanteOrigemId, originId)
              : isNull(spedItens.participanteOrigemId),
            eq(spedItens.codigoExterno, item.codigoExterno),
          ),
        )
        .limit(1);
      const values = {
        codigo: item.codigo,
        descricao: item.descricao,
        codigoBarras: item.codigoBarras,
        unidadeId: unitId,
        tipoItem: item.tipoItem,
        tipoItemInferido: item.tipoItemInferido,
        ncm: item.ncm,
        exIpi: item.exIpi,
        codigoGenero: item.codigoGenero,
        codigoServico: item.codigoServico,
        aliquotaIcms: item.aliquotaIcms,
        cest: item.cest,
        ativo: true,
        atualizadoEm: new Date(),
      };
      if (existing[0]) {
        await db
          .update(spedItens)
          .set(values)
          .where(eq(spedItens.id, existing[0].id));
      } else {
        await db.insert(spedItens).values({
          clienteId,
          participanteOrigemId: originId,
          codigoExterno: item.codigoExterno,
          ...values,
        });
      }
    }
  }

  private parseCompetencia(competencia: string, issues: SpedInconsistencia[]) {
    const match = competencia.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
    if (!match) {
      issues.push({
        codigo: 'COMPETENCIA_INVALIDA',
        severidade: 'ERRO',
        mensagem: 'Competência deve estar no formato YYYY-MM.',
        campo: 'competencia',
      });
      return null;
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (year !== 2026) {
      issues.push({
        codigo: 'LEIAUTE_NAO_SUPORTADO',
        severidade: 'ERRO',
        mensagem:
          'Esta versão gera somente competências de 2026 (COD_VER 020). Cadastre o leiaute correspondente para outro ano.',
        campo: 'competencia',
      });
      return null;
    }
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
    return {
      start,
      end,
      startDate: `${match[1]}-${match[2]}-01`,
      endDate: `${match[1]}-${match[2]}-${String(end.getUTCDate()).padStart(2, '0')}`,
      competenciaDate: `${match[1]}-${match[2]}-01`,
    };
  }

  private emptyPrepared(
    competencia: string,
    finalidade: '0' | '1',
    inconsistencias: SpedInconsistencia[],
  ): PreparedInternal {
    return {
      records: [],
      clientDocument: '',
      participantes: [],
      unidades: [],
      itensCatalogo: [],
      preview: {
        podeGerar: false,
        competencia,
        finalidade,
        codVersao: '020',
        versaoLeiaute: '119',
        guiaPratico: '3.2.2',
        pvaReferencia: '6.1.1',
        perfil: null,
        contadores: { totalLinhas: 0, porBloco: {}, porRegistro: {} },
        documentos: {
          incluidos: 0,
          excluidos: 0,
          pendentes: 0,
          nfe: 0,
          nfce: 0,
          cte: 0,
        },
        apuracao: EMPTY_APURACAO,
        inconsistencias,
      },
    };
  }

  private documentIssue(
    document: typeof documentosFiscais.$inferSelect,
    codigo: string,
    severidade: 'ERRO' | 'AVISO',
    mensagem: string,
  ): SpedInconsistencia {
    return {
      codigo,
      severidade,
      mensagem,
      documentoId: document.id,
      chaveAcesso: document.chaveAcesso,
    };
  }

  private async marcarFalha(id: string, erro: string) {
    await this.database.db
      .update(spedArquivosGerados)
      .set({
        status: 'FALHOU',
        erro: erro.slice(0, 2000),
        concluidoEm: new Date(),
      })
      .where(eq(spedArquivosGerados.id, id));
  }
}

function isSpedProfile(value: string | null): value is 'A' | 'B' | 'C' {
  return value === 'A' || value === 'B' || value === 'C';
}

function normalizeIdentifier(value: string): string {
  return value.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
}

function stableCode(prefix: string, value: string, totalLength: number) {
  const digest = createHash('sha256')
    .update(value, 'utf8')
    .digest('hex')
    .toUpperCase();
  return `${prefix}${digest.slice(0, Math.max(1, totalLength - prefix.length))}`;
}

function uniqueUnitCode(
  raw: string,
  units: Map<string, SpedUnidadeBuilderData>,
) {
  const normalized = raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^0-9A-Za-z]/g, '')
    .toUpperCase();
  let code = (normalized || 'UN').slice(0, 6);
  const existing = units.get(code);
  if (existing && existing.descricao !== raw) {
    code = stableCode('U', raw, 6);
  }
  return code;
}

function inputTaxSignals(documents: SpedDocumentoNfeBuilderData[]) {
  return documents.reduce(
    (total, document) => {
      for (const item of document.itens) {
        total.fcpProprio += toScaledInteger(item.row.valorFcp);
        total.fcpSt += toScaledInteger(item.row.valorFcpSt);
      }
      return total;
    },
    { fcpProprio: 0n, fcpSt: 0n },
  );
}
