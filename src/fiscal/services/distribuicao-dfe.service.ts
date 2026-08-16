import { Injectable, Logger } from '@nestjs/common';
import { eq, and, sql, desc, ilike, or, inArray } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service';
import { StorageService } from '../../storage/storage.service';
import { NfeWizardService } from './nfewizard.service';
import {
  extractDfeDocZips,
  extractDfeResponseMetadata,
  parseDfeDocZip,
  type ParsedDocumentoFiscal,
} from './dfe-document.parser';
import {
  controleNsu,
  documentosFiscais,
  eventosFiscais,
  certificadosDigitais,
  clientes,
} from '../../database/schema';
import type { PaginationParams } from '../../common/types';

@Injectable()
export class DistribuicaoDfeService {
  private readonly logger = new Logger(DistribuicaoDfeService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly storage: StorageService,
    private readonly nfeWizard: NfeWizardService,
  ) {}

  /**
   * Executa a sincronização de documentos fiscais para um cliente.
   * Respeita o controle de NSU e frequência de consultas.
   */
  async sincronizarCliente(
    clienteId: string,
    tipoDocumento: 'NFE' | 'CTE' = 'NFE',
  ) {
    // 1. Buscar dados do cliente e certificado
    const clienteData = await this.database.db
      .select({
        id: clientes.id,
        cnpj: clientes.cnpj,
        uf: clientes.uf,
      })
      .from(clientes)
      .where(eq(clientes.id, clienteId))
      .limit(1);

    if (!clienteData[0]) {
      throw new Error(`Cliente ${clienteId} não encontrado.`);
    }

    const { cnpj, uf } = clienteData[0];

    // 2. Buscar ou criar controle de NSU
    let nsuControl = await this.database.db
      .select()
      .from(controleNsu)
      .where(
        and(
          eq(controleNsu.clienteId, clienteId),
          eq(controleNsu.tipoDocumento, tipoDocumento),
        ),
      )
      .limit(1);

    if (!nsuControl[0]) {
      await this.database.db.insert(controleNsu).values({
        clienteId,
        cnpj,
        tipoDocumento,
        ultimoNsu: 0,
        maxNsu: 0,
      });
      nsuControl = await this.database.db
        .select()
        .from(controleNsu)
        .where(
          and(
            eq(controleNsu.clienteId, clienteId),
            eq(controleNsu.tipoDocumento, tipoDocumento),
          ),
        )
        .limit(1);
    }

    const control = nsuControl[0];

    // 3. Verificar se podemos consultar (respeitar frequência)
    if (control.proximaConsultaEm && control.proximaConsultaEm > new Date()) {
      this.logger.log(
        `Consulta para ${cnpj}/${tipoDocumento} adiada até ${control.proximaConsultaEm.toISOString()}`,
      );
      return {
        status: 'ADIADO',
        message: `Próxima consulta permitida em ${control.proximaConsultaEm.toISOString()}`,
        documentosProcessados: 0,
      };
    }

    // 4. Consultar SEFAZ
    let resposta: unknown;
    try {
      if (tipoDocumento === 'NFE') {
        resposta = await this.nfeWizard.consultarDistribuicaoDFe({
          clienteId,
          cnpj,
          uf: uf || 'SP',
          ultimoNsu: control.ultimoNsu,
        });
      } else {
        resposta = await this.nfeWizard.consultarDistribuicaoCTe({
          clienteId,
          cnpj,
          uf: uf || 'SP',
          ultimoNsu: control.ultimoNsu,
        });
      }
    } catch (error: any) {
      this.logger.error(
        `Erro na consulta SEFAZ para ${cnpj}: ${error.message}`,
      );

      // Se for erro de validação de schema XSD, apenas pular (não bloquear)
      const isSchemaError =
        error.message?.includes('Validação do XML') ||
        error.message?.includes('No matching global declaration') ||
        error.message?.includes('SchemaValidat');

      if (isSchemaError) {
        this.logger.warn(
          `Validação de schema falhou para ${cnpj}/${tipoDocumento} — pulando. ` +
            `Isso geralmente indica XSD desatualizado na lib.`,
        );
        await this.atualizarControleNsu(control.id, {
          statusSefaz: 998,
          motivoSefaz: `Schema validation error: ${error.message?.substring(0, 200)}`,
          proximaConsultaEm: new Date(Date.now() + 60 * 60 * 1000),
        });
        return {
          status: 'SCHEMA_ERROR',
          message: `Erro de validação de schema XSD para ${tipoDocumento}. Consulta será retentada posteriormente.`,
          documentosProcessados: 0,
        };
      }

      // Consumo Indevido (cStat 656) — SEFAZ pede para aguardar 1 hora
      const isConsumoIndevido =
        error.message?.includes('Consumo Indevido') ||
        error.message?.includes('656');

      if (isConsumoIndevido) {
        this.logger.warn(
          `Consumo Indevido para ${cnpj}/${tipoDocumento} — aguardando 1 hora.`,
        );
        await this.atualizarControleNsu(control.id, {
          statusSefaz: 656,
          motivoSefaz: 'Consumo Indevido - aguardar 1 hora',
          proximaConsultaEm: new Date(Date.now() + 60 * 60 * 1000),
        });
        return {
          status: 'CONSUMO_INDEVIDO',
          message:
            'SEFAZ rejeitou por Consumo Indevido. Próxima tentativa em 1 hora.',
          documentosProcessados: 0,
        };
      }

      // Agendar próxima consulta para daqui 30 minutos em caso de erro
      await this.atualizarControleNsu(control.id, {
        statusSefaz: 999,
        motivoSefaz: error.message,
        proximaConsultaEm: new Date(Date.now() + 30 * 60 * 1000),
      });
      throw error;
    }

    // 5. Processar resposta da SEFAZ
    const metadata = extractDfeResponseMetadata(resposta);
    const { cStat, ultimoNsu: ultNSU, maxNsu: maxNSU } = metadata;

    this.logger.log(
      `SEFAZ response for ${cnpj}/${tipoDocumento}: cStat=${cStat}, ultNSU=${ultNSU}, maxNSU=${maxNSU}`,
    );

    // Atualizar controle de NSU
    let proximaConsulta: Date | null = null;

    // cStat 137 = sem docs, 656 = consumo indevido - aguardar
    if (cStat === 137 || cStat === 656) {
      proximaConsulta = new Date(Date.now() + 60 * 60 * 1000); // 1 hora
    }

    // Se ultNSU alcançou maxNSU, não há mais documentos no momento
    if (ultNSU >= maxNSU && maxNSU > 0) {
      proximaConsulta = new Date(Date.now() + 4 * 60 * 60 * 1000); // 4 horas
    }

    // 6. Processar documentos retornados
    const docZips = extractDfeDocZips(resposta);
    let documentosProcessados = 0;
    let documentosIgnorados = 0;

    for (const docZip of docZips) {
      try {
        const parsed = parseDfeDocZip(docZip, tipoDocumento);
        if (!parsed) {
          documentosIgnorados++;
          this.logger.debug(
            `docZip ignorado: consulta=${tipoDocumento}, NSU=${docZip.nsu}, schema=${docZip.schema || 'desconhecido'}`,
          );
          continue;
        }

        if (await this.salvarDocumento(clienteId, cnpj, parsed)) {
          documentosProcessados += 1;
        }
      } catch (error: any) {
        documentosIgnorados++;
        this.logger.warn(
          `Erro ao processar docZip NSU ${docZip.nsu}: ${error.message}`,
        );
      }
    }

    // 7. Atualizar controle de NSU final
    await this.atualizarControleNsu(control.id, {
      ultimoNsu: ultNSU > control.ultimoNsu ? ultNSU : control.ultimoNsu,
      maxNsu: maxNSU > control.maxNsu ? maxNSU : control.maxNsu,
      statusSefaz: cStat,
      motivoSefaz: metadata.motivo,
      proximaConsultaEm: proximaConsulta,
    });

    return {
      status: 'OK',
      cStat,
      ultimoNsu: ultNSU,
      maxNsu: maxNSU,
      documentosRecebidos: docZips.length,
      documentosProcessados,
      documentosIgnorados,
    };
  }

  /**
   * Sincroniza todos os clientes com certificados ativos.
   */
  async sincronizarTodos() {
    const clientesAtivos = await this.database.db
      .select({
        clienteId: certificadosDigitais.clienteId,
      })
      .from(certificadosDigitais)
      .where(
        inArray(certificadosDigitais.status, ['ATIVO', 'PRESTES_A_EXPIRAR']),
      );

    const resultados: Array<{
      clienteId: string;
      nfe: any;
      cte: any;
    }> = [];

    for (const { clienteId } of clientesAtivos) {
      try {
        const nfe = await this.sincronizarCliente(clienteId, 'NFE');
        let cte: any;
        try {
          cte = await this.sincronizarCliente(clienteId, 'CTE');
        } catch (cteError: any) {
          cte = { status: 'ERRO', message: cteError.message };
        }
        resultados.push({ clienteId, nfe, cte });
      } catch (error: any) {
        this.logger.error(
          `Erro ao sincronizar cliente ${clienteId}: ${error.message}`,
        );
        resultados.push({
          clienteId,
          nfe: { status: 'ERRO', message: error.message },
          cte: { status: 'ERRO', message: error.message },
        });
      }
    }

    return resultados;
  }

  /**
   * Lista documentos fiscais com filtros e paginação.
   */
  async listDocumentosFiscais(input: {
    clienteId?: string;
    tipoDocumento?: string;
    situacao?: string;
    manifestacaoStatus?: string;
    dataInicio?: Date;
    dataFim?: Date;
    search?: string;
    pagination: PaginationParams;
  }) {
    const conditions: any[] = [];

    if (input.clienteId) {
      conditions.push(eq(documentosFiscais.clienteId, input.clienteId));
    }
    if (input.tipoDocumento) {
      conditions.push(eq(documentosFiscais.tipoDocumento, input.tipoDocumento));
    }
    if (input.situacao) {
      conditions.push(eq(documentosFiscais.situacao, input.situacao));
    }
    if (input.manifestacaoStatus) {
      conditions.push(
        eq(documentosFiscais.manifestacaoStatus, input.manifestacaoStatus),
      );
    }
    if (input.dataInicio) {
      conditions.push(
        sql`${documentosFiscais.dataEmissao} >= ${input.dataInicio}`,
      );
    }
    if (input.dataFim) {
      conditions.push(
        sql`${documentosFiscais.dataEmissao} <= ${input.dataFim}`,
      );
    }
    if (input.search) {
      const searchTerm = `%${input.search}%`;
      conditions.push(
        or(
          ilike(documentosFiscais.chaveAcesso, searchTerm),
          ilike(documentosFiscais.emitenteRazaoSocial, searchTerm),
          ilike(documentosFiscais.emitenteCnpjCpf, searchTerm),
          ilike(documentosFiscais.destinatarioRazaoSocial, searchTerm),
          ilike(documentosFiscais.numeroDocumento, searchTerm),
        ),
      );
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [countResult, rows] = await Promise.all([
      this.database.db
        .select({ count: sql<number>`count(*)` })
        .from(documentosFiscais)
        .where(where),
      this.database.db
        .select({
          id: documentosFiscais.id,
          clienteId: documentosFiscais.clienteId,
          chaveAcesso: documentosFiscais.chaveAcesso,
          nsu: documentosFiscais.nsu,
          tipoDocumento: documentosFiscais.tipoDocumento,
          modelo: documentosFiscais.modelo,
          serie: documentosFiscais.serie,
          numeroDocumento: documentosFiscais.numeroDocumento,
          emitenteCnpjCpf: documentosFiscais.emitenteCnpjCpf,
          emitenteRazaoSocial: documentosFiscais.emitenteRazaoSocial,
          destinatarioCnpjCpf: documentosFiscais.destinatarioCnpjCpf,
          destinatarioRazaoSocial: documentosFiscais.destinatarioRazaoSocial,
          dataEmissao: documentosFiscais.dataEmissao,
          valorTotal: documentosFiscais.valorTotal,
          situacao: documentosFiscais.situacao,
          manifestacaoStatus: documentosFiscais.manifestacaoStatus,
          criadoEm: documentosFiscais.criadoEm,
        })
        .from(documentosFiscais)
        .where(where)
        .orderBy(desc(documentosFiscais.dataEmissao))
        .limit(input.pagination.limit)
        .offset(input.pagination.offset),
    ]);

    const data = rows.map((row) => ({
      id: row.id,
      cliente_id: row.clienteId,
      chave_acesso: row.chaveAcesso,
      nsu: row.nsu,
      tipo_documento: row.tipoDocumento,
      modelo: row.modelo,
      serie: row.serie,
      numero_documento: row.numeroDocumento,
      emitente_cnpj_cpf: row.emitenteCnpjCpf,
      emitente_razao_social: row.emitenteRazaoSocial,
      destinatario_cnpj_cpf: row.destinatarioCnpjCpf,
      destinatario_razao_social: row.destinatarioRazaoSocial,
      data_emissao: row.dataEmissao.toISOString(),
      valor_total: row.valorTotal,
      situacao: row.situacao,
      manifestacao_status: row.manifestacaoStatus,
      criado_em: row.criadoEm.toISOString(),
    }));

    return { total: Number(countResult[0]?.count ?? 0), data };
  }

  /**
   * Retorna URL assinada para download do XML de um documento fiscal.
   */
  async getXmlDownloadUrl(documentoId: string, clienteId?: string) {
    const conditions: any[] = [eq(documentosFiscais.id, documentoId)];
    if (clienteId) {
      conditions.push(eq(documentosFiscais.clienteId, clienteId));
    }

    const doc = await this.database.db
      .select({ xmlKey: documentosFiscais.xmlKey })
      .from(documentosFiscais)
      .where(and(...conditions))
      .limit(1);

    if (!doc[0]) return null;
    return this.storage.getSignedUrl(doc[0].xmlKey, 600);
  }

  /**
   * Registra evento de manifestação no banco.
   */
  async registrarManifestacao(input: {
    documentoId: string;
    tipoEvento: string;
    codigoEvento: string;
    protocolo?: string;
    statusSefaz?: number;
    motivoSefaz?: string;
    xmlEventoKey?: string;
  }) {
    // Buscar a sequência do evento
    const ultimoEvento = await this.database.db
      .select({ seq: eventosFiscais.sequenciaEvento })
      .from(eventosFiscais)
      .where(
        and(
          eq(eventosFiscais.documentoFiscalId, input.documentoId),
          eq(eventosFiscais.tipoEvento, input.tipoEvento),
        ),
      )
      .orderBy(desc(eventosFiscais.sequenciaEvento))
      .limit(1);

    const sequencia = (ultimoEvento[0]?.seq ?? 0) + 1;

    await this.database.db.insert(eventosFiscais).values({
      documentoFiscalId: input.documentoId,
      tipoEvento: input.tipoEvento,
      codigoEvento: input.codigoEvento,
      sequenciaEvento: sequencia,
      protocolo: input.protocolo,
      statusSefaz: input.statusSefaz,
      motivoSefaz: input.motivoSefaz,
      xmlEventoKey: input.xmlEventoKey,
    });

    // Atualizar manifestacaoStatus no documento fiscal
    const manifestacaoMap: Record<string, string> = {
      '210210': 'CIENCIA',
      '210200': 'CONFIRMADA',
      '210220': 'DESCONHECIDA',
      '210240': 'NAO_REALIZADA',
    };

    const novoStatus = manifestacaoMap[input.codigoEvento];
    if (novoStatus) {
      await this.database.db
        .update(documentosFiscais)
        .set({
          manifestacaoStatus: novoStatus,
          atualizadoEm: new Date(),
        })
        .where(eq(documentosFiscais.id, input.documentoId));
    }
  }

  /**
   * Retorna estatísticas do módulo fiscal para o dashboard.
   */
  async getDashboardStats(clienteId?: string) {
    const mesAtual = new Date();
    const inicioMes = new Date(mesAtual.getFullYear(), mesAtual.getMonth(), 1);

    const conditions: any[] = [
      sql`${documentosFiscais.criadoEm} >= ${inicioMes}`,
    ];
    if (clienteId) {
      conditions.push(eq(documentosFiscais.clienteId, clienteId));
    }

    const where = and(...conditions);

    const [totalDocsResult, volumeResult] = await Promise.all([
      this.database.db
        .select({ count: sql<number>`count(*)` })
        .from(documentosFiscais)
        .where(where),
      this.database.db
        .select({
          total: sql<string>`COALESCE(SUM(${documentosFiscais.valorTotal}), 0)`,
        })
        .from(documentosFiscais)
        .where(where),
    ]);

    // Certificados
    const certConditions: any[] = [];
    if (clienteId) {
      certConditions.push(eq(certificadosDigitais.clienteId, clienteId));
    }

    const [certAtivos, certExpirando] = await Promise.all([
      this.database.db
        .select({ count: sql<number>`count(*)` })
        .from(certificadosDigitais)
        .where(
          and(
            eq(certificadosDigitais.status, 'ATIVO'),
            ...(certConditions.length ? certConditions : []),
          ),
        ),
      this.database.db
        .select({ count: sql<number>`count(*)` })
        .from(certificadosDigitais)
        .where(
          and(
            eq(certificadosDigitais.status, 'PRESTES_A_EXPIRAR'),
            ...(certConditions.length ? certConditions : []),
          ),
        ),
    ]);

    return {
      documentos_mes: Number(totalDocsResult[0]?.count ?? 0),
      volume_financeiro: volumeResult[0]?.total ?? '0',
      certificados_ativos: Number(certAtivos[0]?.count ?? 0),
      certificados_expirando: Number(certExpirando[0]?.count ?? 0),
    };
  }

  // ─── Private Methods ────────────────────────────────────────────────────────

  private async salvarDocumento(
    clienteId: string,
    cnpj: string,
    parsed: ParsedDocumentoFiscal,
  ): Promise<boolean> {
    // Um resumo/evento salvo por uma versao anterior deve ser substituido
    // quando o XML fiscal completo chegar para o mesmo cliente.
    const existing = await this.database.db
      .select({
        id: documentosFiscais.id,
        nsu: documentosFiscais.nsu,
        situacao: documentosFiscais.situacao,
        xmlKey: documentosFiscais.xmlKey,
      })
      .from(documentosFiscais)
      .where(
        and(
          eq(documentosFiscais.clienteId, clienteId),
          eq(documentosFiscais.chaveAcesso, parsed.chaveAcesso),
        ),
      )
      .limit(1);

    if (
      existing[0]?.nsu === parsed.nsu &&
      existing[0]?.situacao !== 'RESUMIDA'
    ) {
      this.logger.debug(`Documento ${parsed.chaveAcesso} já existe, pulando.`);
      return false;
    }

    // Upload XML ao R2
    const dataEmissao = parsed.dataEmissao;
    const ano = dataEmissao.getFullYear().toString();
    const mes = (dataEmissao.getMonth() + 1).toString().padStart(2, '0');
    const tipoDir = parsed.tipoDocumento.toLowerCase();
    const xmlKey = `clientes/${cnpj}/fiscais/${ano}/${mes}/${tipoDir}/${parsed.chaveAcesso}.xml`;

    await this.storage.upload(
      xmlKey,
      Buffer.from(parsed.xmlContent, 'utf-8'),
      'application/xml',
    );

    const values = {
      clienteId,
      chaveAcesso: parsed.chaveAcesso,
      nsu: parsed.nsu,
      tipoDocumento: parsed.tipoDocumento,
      modelo: parsed.modelo,
      serie: parsed.serie,
      numeroDocumento: parsed.numeroDocumento,
      emitenteCnpjCpf: parsed.emitenteCnpjCpf,
      emitenteRazaoSocial: parsed.emitenteRazaoSocial,
      destinatarioCnpjCpf: parsed.destinatarioCnpjCpf,
      destinatarioRazaoSocial: parsed.destinatarioRazaoSocial,
      dataEmissao: parsed.dataEmissao,
      valorTotal: parsed.valorTotal,
      situacao: parsed.situacao,
      xmlKey,
    };

    await this.database.db
      .insert(documentosFiscais)
      .values(values)
      .onConflictDoUpdate({
        target: [documentosFiscais.clienteId, documentosFiscais.chaveAcesso],
        set: {
          nsu: parsed.nsu,
          tipoDocumento: parsed.tipoDocumento,
          modelo: parsed.modelo,
          serie: parsed.serie,
          numeroDocumento: parsed.numeroDocumento,
          emitenteCnpjCpf: parsed.emitenteCnpjCpf,
          emitenteRazaoSocial: parsed.emitenteRazaoSocial,
          destinatarioCnpjCpf: parsed.destinatarioCnpjCpf,
          destinatarioRazaoSocial: parsed.destinatarioRazaoSocial,
          dataEmissao: parsed.dataEmissao,
          valorTotal: parsed.valorTotal,
          situacao: parsed.situacao,
          xmlKey,
          danfeKey: null,
          atualizadoEm: new Date(),
        },
      });

    if (existing[0]?.xmlKey && existing[0].xmlKey !== xmlKey) {
      try {
        await this.storage.delete(existing[0].xmlKey);
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'erro desconhecido';
        this.logger.warn(
          `XML fiscal antigo nao removido (${existing[0].xmlKey}): ${message}`,
        );
      }
    }

    return true;
  }

  private async atualizarControleNsu(
    controlId: string,
    data: {
      ultimoNsu?: number;
      maxNsu?: number;
      statusSefaz?: number;
      motivoSefaz?: string;
      proximaConsultaEm?: Date | null;
    },
  ) {
    await this.database.db
      .update(controleNsu)
      .set({
        ...(data.ultimoNsu !== undefined && { ultimoNsu: data.ultimoNsu }),
        ...(data.maxNsu !== undefined && { maxNsu: data.maxNsu }),
        ...(data.statusSefaz !== undefined && {
          statusSefaz: data.statusSefaz,
        }),
        ...(data.motivoSefaz !== undefined && {
          motivoSefaz: data.motivoSefaz,
        }),
        ...(data.proximaConsultaEm !== undefined && {
          proximaConsultaEm: data.proximaConsultaEm,
        }),
        ultimaConsultaEm: new Date(),
        atualizadoEm: new Date(),
      })
      .where(eq(controleNsu.id, controlId));
  }
}
