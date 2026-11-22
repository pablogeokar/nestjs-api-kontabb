import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { SignPdf } from '@signpdf/signpdf';
import { P12Signer } from '@signpdf/signer-p12';
import { ContadorCertificadoService } from '../../cadastros/contadores/contador-certificado.service';
import { RateLimitService } from '../../common/rate-limit.service';
import { DatabaseService } from '../../database/database.service';
import {
  clientes,
  contadores,
  eventosAuditoria,
  relatoriosFaturamento,
  type FaturamentoMesSnapshot,
} from '../../database/schema';
import { StorageService } from '../../storage/storage.service';
import { FaturamentoDocumentoService } from './faturamento-documento.service';
import {
  SimplesNacionalService,
  type ReceitaBrutaCompetencia,
} from './simples-nacional.service';
import { centavos as cents, decimal } from './faturamento-relatorio';

export function parseFaturamentoPeriod(start: string, end: string) {
  if (
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(start) ||
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(end)
  )
    throw new BadRequestException('Informe o período em AAAA-MM.');
  if (Number(start.slice(0, 4)) < 1900 || Number(end.slice(0, 4)) > 9998)
    throw new BadRequestException('Informe um ano entre 1900 e 9998.');
  const first = Number(start.slice(0, 4)) * 12 + Number(start.slice(5)) - 1;
  const last = Number(end.slice(0, 4)) * 12 + Number(end.slice(5)) - 1;
  if (last < first || last - first > 119)
    throw new BadRequestException(
      'O período deve ter de 1 a 120 competências em ordem cronológica.',
    );
  const next = new Date(
    Date.UTC(Number(end.slice(0, 4)), Number(end.slice(5)), 1),
  )
    .toISOString()
    .slice(0, 10);
  return { first, last, startDate: `${start}-01`, nextDate: next };
}

/** Snapshot mensal do relatório a partir da base de apuração de cada competência. */
export function montarMesesFaturamento(receitas: ReceitaBrutaCompetencia[]) {
  let total = 0n;
  const meses: FaturamentoMesSnapshot[] = receitas.map((receita) => {
    total += cents(receita.receitaBruta);
    return {
      competencia: receita.competencia,
      valorProdutos: receita.mercadorias,
      valorServicos: receita.servicos,
      valorTransportes: receita.transportes,
      valorDevolucoes: receita.devolucoes,
      total: receita.receitaBruta,
      origem: receita.origem,
      detalhado: receita.detalhado,
    };
  });
  return { meses, total: decimal(total) };
}
@Injectable()
export class FaturamentoService {
  constructor(
    private readonly database: DatabaseService,
    private readonly storage: StorageService,
    private readonly certs: ContadorCertificadoService,
    private readonly pdf: FaturamentoDocumentoService,
    private readonly rateLimit: RateLimitService,
    private readonly simples: SimplesNacionalService,
  ) {}

  async emitir(userId: string, inicio: string, fim: string, actorId = userId) {
    // Valida o período (formato, ordem e limite de 120 competências).
    parseFaturamentoPeriod(inicio, fim);
    await this.rateLimit.consume({
      key: `faturamento:emitir:${userId}`,
      limit: 12,
      windowMs: 60 * 60 * 1000,
    });
    const [empresa] = await this.database.db
      .select({
        id: clientes.id,
        nome: clientes.razaoSocial,
        documento: clientes.cnpj,
        contadorId: clientes.contadorId,
        suspenso: clientes.suspenso,
        contadorNome: contadores.nome,
        contadorCrc: contadores.crc,
      })
      .from(clientes)
      .leftJoin(contadores, eq(contadores.id, clientes.contadorId))
      .where(eq(clientes.userId, userId))
      .limit(1);
    if (!empresa) throw new NotFoundException('Empresa não encontrada.');
    if (empresa.suspenso)
      throw new ForbiddenException(
        'A emissão está indisponível para esta empresa.',
      );
    // A receita de cada mês é a mesma base usada na apuração dos tributos.
    const { meses, total } = montarMesesFaturamento(
      await this.simples.receitaBrutaPorCompetencia(empresa.id, inicio, fim),
    );
    const codigo = `KTB-${randomBytes(16).toString('hex').toUpperCase()}`;
    const [record] = await this.database.db
      .insert(relatoriosFaturamento)
      .values({
        codigo,
        clienteId: empresa.id,
        contadorId: empresa.contadorId,
        periodoInicio: inicio,
        periodoFim: fim,
        empresaNome: empresa.nome,
        empresaDocumento: empresa.documento,
        contadorNome: empresa.contadorNome,
        contadorCrc: empresa.contadorCrc,
        meses,
        total,
        emitidoPor: actorId,
      })
      .returning({
        id: relatoriosFaturamento.id,
        numero: relatoriosFaturamento.numero,
        criadoEm: relatoriosFaturamento.criadoEm,
      });
    const key = `relatorios/faturamento/${empresa.id}/${record.id}.pdf`;
    let uploaded = false;
    try {
      const certificate = empresa.contadorId
        ? await this.certs.getForSigning(empresa.contadorId)
        : null;
      const number = `FAT-${record.criadoEm.getUTCFullYear()}-${String(record.numero).padStart(6, '0')}`;
      let buffer = await this.pdf.render({
        numero: number,
        codigo,
        nome: empresa.nome,
        documento: empresa.documento,
        contadorNome: empresa.contadorNome,
        contadorCrc: empresa.contadorCrc,
        inicio,
        fim,
        meses,
        total,
        emitidoEm: record.criadoEm,
        assinado: Boolean(certificate),
      });
      if (certificate)
        buffer = await new SignPdf().sign(
          buffer,
          new P12Signer(certificate.buffer, { passphrase: certificate.senha }),
          record.criadoEm,
        );
      await this.storage.upload(key, buffer, 'application/pdf');
      uploaded = true;
      const sha256 = createHash('sha256').update(buffer).digest('hex');
      await this.database.db.transaction(async (tx) => {
        await tx
          .update(relatoriosFaturamento)
          .set({
            pdfKey: key,
            pdfSha256: sha256,
            assinaturaStatus: certificate ? 'ASSINADO' : 'SEM_CERTIFICADO',
            assinaturaThumbprint: certificate?.thumbprint ?? null,
            status: 'EMITIDO',
            emitidoEm: record.criadoEm,
          })
          .where(eq(relatoriosFaturamento.id, record.id));
        await tx.insert(eventosAuditoria).values({
          atorUserId: actorId,
          acao: 'FATURAMENTO_RELATORIO_EMITIDO',
          entidadeTipo: 'RELATORIO_FATURAMENTO',
          entidadeId: record.id,
          dados: {
            clienteId: empresa.id,
            periodoInicio: inicio,
            periodoFim: fim,
            assinaturaStatus: certificate ? 'ASSINADO' : 'SEM_CERTIFICADO',
          },
        });
      });
      return {
        id: record.id,
        numero: number,
        codigo,
        total,
        assinaturaStatus: certificate ? 'ASSINADO' : 'SEM_CERTIFICADO',
      };
    } catch {
      if (uploaded) await this.storage.delete(key).catch(() => undefined);
      await this.database.db
        .update(relatoriosFaturamento)
        .set({ status: 'FALHOU' })
        .where(eq(relatoriosFaturamento.id, record.id))
        .catch(() => undefined);
      throw new ServiceUnavailableException(
        'Não foi possível emitir a relação de faturamento. Tente novamente.',
      );
    }
  }

  async listar(userId: string) {
    const [empresa] = await this.database.db
      .select({ id: clientes.id })
      .from(clientes)
      .where(eq(clientes.userId, userId))
      .limit(1);
    if (!empresa) throw new NotFoundException('Empresa não encontrada.');
    const rows = await this.database.db
      .select({
        id: relatoriosFaturamento.id,
        numero: relatoriosFaturamento.numero,
        codigo: relatoriosFaturamento.codigo,
        inicio: relatoriosFaturamento.periodoInicio,
        fim: relatoriosFaturamento.periodoFim,
        total: relatoriosFaturamento.total,
        assinaturaStatus: relatoriosFaturamento.assinaturaStatus,
        emitidoEm: relatoriosFaturamento.emitidoEm,
      })
      .from(relatoriosFaturamento)
      .where(
        and(
          eq(relatoriosFaturamento.clienteId, empresa.id),
          eq(relatoriosFaturamento.status, 'EMITIDO'),
        ),
      )
      .orderBy(desc(relatoriosFaturamento.criadoEm))
      .limit(30);
    return rows.map((row) => ({
      ...row,
      numero: `FAT-${row.emitidoEm!.getUTCFullYear()}-${String(row.numero).padStart(6, '0')}`,
    }));
  }

  async verificar(codigo: string) {
    if (!/^KTB-[A-F0-9]{32}$/.test(codigo))
      throw new NotFoundException('Código de controle não encontrado.');
    const [row] = await this.database.db
      .select()
      .from(relatoriosFaturamento)
      .where(
        and(
          eq(relatoriosFaturamento.codigo, codigo),
          eq(relatoriosFaturamento.status, 'EMITIDO'),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException('Código de controle não encontrado.');
    return {
      numero: `FAT-${row.emitidoEm!.getUTCFullYear()}-${String(row.numero).padStart(6, '0')}`,
      codigo: row.codigo,
      empresaNome: row.empresaNome,
      empresaDocumento: row.empresaDocumento,
      periodoInicio: row.periodoInicio,
      periodoFim: row.periodoFim,
      total: row.total,
      meses: row.meses,
      contadorNome: row.contadorNome,
      contadorCrc: row.contadorCrc,
      assinaturaStatus: row.assinaturaStatus,
      sha256: row.pdfSha256,
      emitidoEm: row.emitidoEm,
    };
  }

  async documento(codigo: string, userId?: string) {
    if (!/^KTB-[A-F0-9]{32}$/.test(codigo))
      throw new NotFoundException('Documento não encontrado.');
    const [row] = await this.database.db
      .select({
        key: relatoriosFaturamento.pdfKey,
        hash: relatoriosFaturamento.pdfSha256,
        clienteId: relatoriosFaturamento.clienteId,
        status: relatoriosFaturamento.status,
      })
      .from(relatoriosFaturamento)
      .where(eq(relatoriosFaturamento.codigo, codigo))
      .limit(1);
    if (!row || row.status !== 'EMITIDO' || !row.key)
      throw new NotFoundException('Documento não encontrado.');
    if (userId) {
      const [client] = await this.database.db
        .select({ id: clientes.id })
        .from(clientes)
        .where(eq(clientes.userId, userId))
        .limit(1);
      if (!client || client.id !== row.clienteId)
        throw new ForbiddenException();
    }
    const buffer = await this.storage.download(row.key);
    if (
      !row.hash ||
      createHash('sha256').update(buffer).digest('hex') !== row.hash
    )
      throw new ServiceUnavailableException(
        'A cópia arquivada não passou na verificação de integridade.',
      );
    return buffer;
  }
}
