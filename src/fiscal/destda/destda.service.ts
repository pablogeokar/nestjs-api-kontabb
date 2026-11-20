import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { AppLogger } from '../../common/logger.service';
import { DatabaseService } from '../../database/database.service';
import {
  clientes,
  destdaArquivosGerados,
  destdaConfiguracoes,
  spedConfiguracoes,
} from '../../database/schema';
import { resolverContadorDoCliente } from '../../cadastros/contadores/contador-resolver';
import { StorageService } from '../../storage/storage.service';
import { DestdaApuracaoService } from './destda-apuracao.service';
import {
  buildDestdaFile,
  totaisParaPreview,
  type BuiltDestdaFile,
} from './destda-builder';
import {
  DESTDA_COD_ASSINANTE_CONTADOR,
  DESTDA_COD_ASSINANTES,
  DESTDA_COD_VER,
  DESTDA_UF_POR_CODIGO_IBGE,
  DESTDA_UFS,
  type DestdaFinalidade,
} from './destda-leiaute';
import { montarPerfil } from './destda-perfil';
import { validateDestdaFile } from './destda-validator';
import type {
  DestdaBuilderInput,
  DestdaInconsistencia,
  DestdaPreview,
  DestdaTotais,
  GeneratedDestdaFile,
} from './destda.types';

interface Preparado {
  preview: DestdaPreview;
  built: BuiltDestdaFile | null;
  clientDocument: string;
}

const COMPETENCIA = /^\d{4}-(0[1-9]|1[0-2])$/u;

@Injectable()
export class DestdaService {
  constructor(
    private readonly database: DatabaseService,
    private readonly storage: StorageService,
    private readonly logger: AppLogger,
    private readonly apuracao: DestdaApuracaoService,
  ) {}

  async preview(input: {
    clienteId: string;
    competencia: string;
    finalidade: DestdaFinalidade;
  }): Promise<DestdaPreview> {
    return (await this.preparar(input)).preview;
  }

  async gerar(input: {
    clienteId: string;
    competencia: string;
    finalidade: DestdaFinalidade;
    actorUserId: string;
    requestId?: string;
  }): Promise<GeneratedDestdaFile> {
    const generationId = randomUUID();
    const preparado = await this.preparar(input);
    if (!preparado.preview.podeGerar || !preparado.built) {
      throw new UnprocessableEntityException({
        code: 'DESTDA_INCONSISTENTE',
        message:
          'A DeSTDA possui inconsistências impeditivas. Revise a prévia antes de gerar.',
        inconsistencias: preparado.preview.inconsistencias,
      });
    }
    const { built } = preparado;
    const documento = normalizeIdentifier(preparado.clientDocument);
    const [ano, mes] = input.competencia.split('-');
    const filename = `DESTDA_${documento}_${ano}${mes}.txt`;
    const objectKey = [
      'clientes',
      documento,
      'fiscais',
      'destda',
      ano,
      mes,
      `${generationId}.txt`,
    ].join('/');
    const hashSha256 = createHash('sha256').update(built.bytes).digest('hex');

    await this.database.db.insert(destdaArquivosGerados).values({
      id: generationId,
      clienteId: input.clienteId,
      competencia: `${input.competencia}-01`,
      finalidade: input.finalidade,
      codVersao: DESTDA_COD_VER,
      status: 'PROCESSANDO',
      contadores: { ...preparado.preview.contadores },
      totais: { ...preparado.preview.totais },
      inconsistencias: preparado.preview.inconsistencias.map((item) => ({
        ...item,
      })),
      geradoPor: input.actorUserId,
    });

    try {
      await this.storage.upload(
        objectKey,
        built.bytes,
        'text/plain; charset=ISO-8859-1',
      );
      await this.database.db
        .update(destdaArquivosGerados)
        .set({
          status: 'GERADO',
          hashSha256,
          arquivoKey: objectKey,
          arquivoNome: filename,
          tamanhoBytes: built.bytes.length,
          concluidoEm: new Date(),
        })
        .where(eq(destdaArquivosGerados.id, generationId));
    } catch (error: unknown) {
      await this.marcarFalha(generationId, 'Falha ao armazenar o arquivo.');
      this.logger.error('destda_generation_storage_failed', error, {
        requestId: input.requestId,
        userId: input.actorUserId,
        entityType: 'DESTDA_ARQUIVO',
        entityId: generationId,
        clienteId: input.clienteId,
        operation: 'gerar_destda',
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

  async historico(clienteId: string, competencia?: string) {
    const filtros = [eq(destdaArquivosGerados.clienteId, clienteId)];
    if (competencia) {
      filtros.push(eq(destdaArquivosGerados.competencia, `${competencia}-01`));
    }
    const rows = await this.database.db
      .select({
        id: destdaArquivosGerados.id,
        competencia: destdaArquivosGerados.competencia,
        finalidade: destdaArquivosGerados.finalidade,
        codVersao: destdaArquivosGerados.codVersao,
        status: destdaArquivosGerados.status,
        hashSha256: destdaArquivosGerados.hashSha256,
        arquivoNome: destdaArquivosGerados.arquivoNome,
        tamanhoBytes: destdaArquivosGerados.tamanhoBytes,
        totais: destdaArquivosGerados.totais,
        erro: destdaArquivosGerados.erro,
        criadoEm: destdaArquivosGerados.criadoEm,
        concluidoEm: destdaArquivosGerados.concluidoEm,
      })
      .from(destdaArquivosGerados)
      .where(and(...filtros))
      .orderBy(desc(destdaArquivosGerados.criadoEm))
      .limit(100);
    return { data: rows };
  }

  /** Reabre um arquivo já gerado e armazenado (mesmos bytes e hash). */
  async baixar(clienteId: string, arquivoId: string) {
    const rows = await this.database.db
      .select()
      .from(destdaArquivosGerados)
      .where(
        and(
          eq(destdaArquivosGerados.id, arquivoId),
          eq(destdaArquivosGerados.clienteId, clienteId),
        ),
      )
      .limit(1);
    const arquivo = rows[0];
    if (!arquivo || arquivo.status !== 'GERADO' || !arquivo.arquivoKey) {
      throw new NotFoundException('Arquivo da DeSTDA não encontrado.');
    }
    const buffer = await this.storage.download(arquivo.arquivoKey);
    return {
      id: arquivo.id,
      buffer,
      filename: arquivo.arquivoNome ?? `DESTDA_${arquivo.id}.txt`,
      hashSha256: arquivo.hashSha256 ?? '',
    };
  }

  private async preparar(input: {
    clienteId: string;
    competencia: string;
    finalidade: DestdaFinalidade;
  }): Promise<Preparado> {
    const inconsistencias: DestdaInconsistencia[] = [];
    const vazio = (
      totais: DestdaTotais = { entradas: [], consumoFinal: [], st: [] },
    ): DestdaPreview => ({
      podeGerar: false,
      competencia: input.competencia,
      finalidade: input.finalidade,
      codVersao: DESTDA_COD_VER,
      semMovimento: true,
      totais: totaisParaPreview(totais),
      contadores: { totalLinhas: 0, porBloco: {}, porRegistro: {} },
      inconsistencias,
    });

    if (!COMPETENCIA.test(input.competencia)) {
      inconsistencias.push({
        codigo: 'COMPETENCIA_INVALIDA',
        severidade: 'ERRO',
        mensagem: 'Informe a competência no formato AAAA-MM.',
        campo: 'competencia',
      });
      return { preview: vazio(), built: null, clientDocument: '' };
    }

    const rows = await this.database.db
      .select({
        tipoPessoa: clientes.tipoPessoa,
        cnpj: clientes.cnpj,
        razaoSocial: clientes.razaoSocial,
        emails: clientes.emails,
        cep: clientes.cep,
        logradouro: clientes.logradouro,
        numero: clientes.numero,
        complemento: clientes.complemento,
        bairro: clientes.bairro,
        uf: clientes.uf,
        regimeTributario: clientes.regimeTributario,
        inscricaoEstadual: clientes.inscricaoEstadual,
        contadorId: clientes.contadorId,
        codigoMunicipioIbge: clientes.codigoMunicipioIbge,
        nomeFantasia: clientes.nomeFantasia,
        inscricaoMunicipal: clientes.inscricaoMunicipal,
        suframa: clientes.suframa,
        nire: clientes.nire,
        telefone: clientes.telefone,
        responsavelNome: clientes.responsavelNome,
        responsavelCpf: clientes.responsavelCpf,
        responsavelCodAssinante: clientes.responsavelCodAssinante,
        configuracaoId: destdaConfiguracoes.id,
        fax: destdaConfiguracoes.fax,
        inscricoesSubstituto: destdaConfiguracoes.inscricoesSubstituto,
        perfil: destdaConfiguracoes.perfil,
        spedFax: spedConfiguracoes.fax,
      })
      .from(clientes)
      .leftJoin(
        destdaConfiguracoes,
        eq(destdaConfiguracoes.clienteId, clientes.id),
      )
      .leftJoin(spedConfiguracoes, eq(spedConfiguracoes.clienteId, clientes.id))
      .where(eq(clientes.id, input.clienteId))
      .limit(1);
    const company = rows[0];
    if (!company) throw new NotFoundException('Empresa não encontrada.');

    if (company.regimeTributario !== 'SIMPLES_NACIONAL') {
      throw new UnprocessableEntityException({
        code: 'ESTABELECIMENTO_NAO_SIMPLES',
        message:
          'A DeSTDA é obrigação exclusiva de contribuintes optantes pelo Simples Nacional.',
      });
    }

    const erro = (codigo: string, mensagem: string, campo?: string) =>
      inconsistencias.push({ codigo, severidade: 'ERRO', mensagem, campo });
    const aviso = (codigo: string, mensagem: string, campo?: string) =>
      inconsistencias.push({ codigo, severidade: 'AVISO', mensagem, campo });

    const cnpj = normalizeIdentifier(company.cnpj);
    const uf = (company.uf ?? '').trim().toUpperCase();
    const ie = normalizeIdentifier(company.inscricaoEstadual ?? '');
    const codMun = company.codigoMunicipioIbge ?? '';
    const responsavelCpf = company.responsavelCpf ?? '';
    const cadastral = inconsistencias.length;

    if (company.tipoPessoa !== 'PJ') {
      erro(
        'ESTABELECIMENTO_DEVE_SER_PJ',
        'A DeSTDA deve ser gerada por estabelecimento pessoa jurídica.',
        'tipoPessoa',
      );
    }
    if (!/^[0-9A-Z]{12}[0-9]{2}$/u.test(cnpj)) {
      erro('CNPJ_INVALIDO', 'O CNPJ do estabelecimento é inválido.', 'cnpj');
    }
    if (!company.razaoSocial.trim()) {
      erro('RAZAO_SOCIAL_AUSENTE', 'Informe a razão social.', 'razaoSocial');
    }
    if (!(DESTDA_UFS as readonly string[]).includes(uf) || uf === 'EX') {
      erro('UF_AUSENTE', 'Informe a UF do estabelecimento.', 'uf');
    }
    if (!ie) {
      erro('IE_AUSENTE', 'Informe a inscrição estadual.', 'inscricaoEstadual');
    }
    if (!/^\d{7}$/u.test(codMun)) {
      erro(
        'COD_MUN_AUSENTE',
        'Informe o código IBGE de 7 dígitos do município no cadastro da empresa.',
        'codigoMunicipioIbge',
      );
    }
    const responsavelNome = (company.responsavelNome ?? '').trim();
    if (!responsavelNome || !/^\d{11}$/u.test(responsavelCpf)) {
      erro(
        'RESPONSAVEL_AUSENTE',
        'Informe o nome e o CPF do responsável pela empresa (registro 0005).',
        'responsavel',
      );
    }
    const codAssinante = company.responsavelCodAssinante ?? '801';
    if (!(DESTDA_COD_ASSINANTES as readonly string[]).includes(codAssinante)) {
      erro(
        'COD_ASSINANTE_INVALIDO',
        'Qualificação do assinante inválida.',
        'responsavelCodAssinante',
      );
    }

    const resolucao = await resolverContadorDoCliente(
      this.database.db,
      company.contadorId,
    );
    const contador = resolucao?.contador ?? null;
    if (!contador) {
      erro(
        'CONTABILISTA_AUSENTE',
        'Vincule um contabilista à empresa (registro 0100).',
        'contadorId',
      );
    } else if (!contador.cpf && !contador.cnpj) {
      erro(
        'CONTABILISTA_SEM_DOCUMENTO',
        'O contabilista precisa de CPF ou CNPJ cadastrado.',
        'contabilista',
      );
    }
    const ufContador = contador
      ? (DESTDA_UF_POR_CODIGO_IBGE[contador.codigoMunicipioIbge.slice(0, 2)] ??
        '')
      : '';
    if (contador && !ufContador) {
      erro(
        'CONTABILISTA_MUNICIPIO_INVALIDO',
        'O código IBGE do município do contabilista é inválido.',
        'contabilista',
      );
    }

    const inscricoes = (company.inscricoesSubstituto ?? []).filter(
      (item) => item.uf !== uf,
    );
    const cadastralInvalido = inconsistencias.length > cadastral;

    // Apuração dos valores. Só roda com UF válida (usada para separar as
    // operações interestaduais das internas).
    let totais: DestdaTotais = { entradas: [], consumoFinal: [], st: [] };
    if (/^[A-Z]{2}$/u.test(uf)) {
      const resultado = await this.apuracao.apurar({
        clienteId: input.clienteId,
        competencia: input.competencia,
        ufEmpresa: uf,
      });
      totais = resultado.totais;
      inconsistencias.push(...resultado.inconsistencias);
    }

    const ufsComIe = new Set(inscricoes.map((item) => item.uf));
    const ufsSemIe = [
      ...new Set(
        totais.st
          .map((linha) => linha.uf)
          .filter((ufSt) => !ufsComIe.has(ufSt)),
      ),
    ].sort();
    if (ufsSemIe.length > 0) {
      erro(
        'IE_SUBSTITUTO_AUSENTE',
        `Há ICMS-ST retido para ${ufsSemIe.join(', ')}, mas a empresa não possui inscrição estadual de substituto cadastrada para essa(s) UF(s) (registro 0002).`,
        'inscricoesSubstituto',
      );
    }
    if (input.finalidade === '1') {
      const originais = await this.database.db
        .select({ total: sql<number>`count(*)::int` })
        .from(destdaArquivosGerados)
        .where(
          and(
            eq(destdaArquivosGerados.clienteId, input.clienteId),
            eq(destdaArquivosGerados.competencia, `${input.competencia}-01`),
            eq(destdaArquivosGerados.status, 'GERADO'),
          ),
        );
      if (!originais[0]?.total) {
        aviso(
          'SUBSTITUTO_SEM_ORIGINAL',
          'Não há arquivo original gerado para esta competência neste sistema. Confirme que o original foi entregue antes de enviar um arquivo substituto.',
          'finalidade',
        );
      }
    }

    if (cadastralInvalido || !contador) {
      return {
        preview: { ...vazio(totais), semMovimento: this.semMovimento(totais) },
        built: null,
        clientDocument: cnpj,
      };
    }

    const perfil = montarPerfil(company.perfil, {
      indSt: totais.st.length > 0 || inscricoes.length > 0 ? '0' : undefined,
      indAt: totais.entradas.some(
        (linha) => linha.indSit === '2' || linha.indSit === '3',
      )
        ? '0'
        : undefined,
    });
    const builderInput: DestdaBuilderInput = {
      competencia: input.competencia,
      finalidade: input.finalidade,
      empresa: {
        nome: company.razaoSocial,
        cnpj,
        uf,
        ie,
        codMun,
        im: company.inscricaoMunicipal,
        suframa: company.suframa,
        fantasia: company.nomeFantasia,
        nire: company.nire,
      },
      inscricoesSubstituto: inscricoes.map((item) => ({
        uf: item.uf,
        ie: normalizeIdentifier(item.ie),
      })),
      responsavel: {
        nome: responsavelNome,
        codAssin: codAssinante,
        cpf: responsavelCpf,
        cep: company.cep,
        endereco: company.logradouro,
        numero: company.numero,
        complemento: company.complemento,
        bairro: company.bairro,
        fone: company.telefone,
        fax: company.fax ?? company.spedFax,
        email: company.emails?.[0] ?? null,
      },
      perfil,
      contabilista: {
        nome: contador.nome,
        codAssin: DESTDA_COD_ASSINANTE_CONTADOR,
        cnpj: contador.cnpj,
        cpf: contador.cpf,
        crc: contador.crc,
        cep: contador.cep,
        endereco: contador.logradouro,
        numero: contador.numero,
        complemento: contador.complemento,
        bairro: contador.bairro,
        uf: ufContador,
        codMun: contador.codigoMunicipioIbge,
        fone: contador.telefone,
        fax: contador.fax,
        email: contador.email,
      },
      totais,
    };

    let built: BuiltDestdaFile;
    try {
      built = buildDestdaFile(builderInput);
    } catch (error: unknown) {
      erro(
        'MONTAGEM_INVALIDA',
        error instanceof Error
          ? error.message
          : 'O arquivo não pôde ser montado com segurança.',
      );
      return {
        preview: { ...vazio(totais), semMovimento: this.semMovimento(totais) },
        built: null,
        clientDocument: cnpj,
      };
    }

    const validacao = validateDestdaFile(built.bytes);
    for (const problema of validacao.issues) {
      erro(
        `ESTRUTURA_${problema.code}`,
        `${problema.reg ? `${problema.reg}: ` : ''}${problema.message}`,
      );
    }

    return {
      preview: {
        podeGerar: !inconsistencias.some((item) => item.severidade === 'ERRO'),
        competencia: input.competencia,
        finalidade: input.finalidade,
        codVersao: DESTDA_COD_VER,
        semMovimento: built.semMovimento,
        totais: built.totais,
        contadores: {
          totalLinhas: built.totalLines,
          porBloco: { ...built.blockCounts },
          porRegistro: { ...built.recordCounts },
        },
        inconsistencias,
      },
      built,
      clientDocument: cnpj,
    };
  }

  private semMovimento(totais: DestdaTotais): boolean {
    return (
      totais.entradas.length === 0 &&
      totais.consumoFinal.length === 0 &&
      totais.st.length === 0
    );
  }

  private async marcarFalha(id: string, erro: string) {
    await this.database.db
      .update(destdaArquivosGerados)
      .set({ status: 'FALHOU', erro, concluidoEm: new Date() })
      .where(eq(destdaArquivosGerados.id, id));
  }
}

function normalizeIdentifier(value: string): string {
  return value.replace(/[^0-9A-Za-z]/gu, '').toUpperCase();
}
