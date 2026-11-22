import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { SignPdf } from '@signpdf/signpdf';
import { P12Signer } from '@signpdf/signer-p12';
import { ContadorCertificadoService } from '../../cadastros/contadores/contador-certificado.service';
import { RateLimitService } from '../../common/rate-limit.service';
import { resultRows } from '../../common/db-result';
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
import { centavos as cents, decimal } from './faturamento-relatorio';

export interface RevenueRow {
  competencia: string;
  tipo: string;
  valor: string;
  quantidade: number;
}
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

export function buildFaturamentoMeses(
  first: number,
  last: number,
  rows: RevenueRow[],
) {
  const values = new Map<
    string,
    {
      products: bigint;
      services: bigint;
      transports: bigint;
      countProducts: number;
      countServices: number;
      countTransports: number;
    }
  >();
  for (const row of rows) {
    const current = values.get(row.competencia) ?? {
      products: 0n,
      services: 0n,
      transports: 0n,
      countProducts: 0,
      countServices: 0,
      countTransports: 0,
    };
    if (row.tipo === 'SERVICO') {
      current.services += cents(row.valor);
      current.countServices += Number(row.quantidade);
    } else if (row.tipo === 'TRANSPORTE') {
      current.transports += cents(row.valor);
      current.countTransports += Number(row.quantidade);
    } else {
      current.products += cents(row.valor);
      current.countProducts += Number(row.quantidade);
    }
    values.set(row.competencia, current);
  }
  const meses: FaturamentoMesSnapshot[] = [];
  let total = 0n;
  for (let offset = first; offset <= last; offset++) {
    const competencia = `${Math.floor(offset / 12)
      .toString()
      .padStart(4, '0')}-${String((offset % 12) + 1).padStart(2, '0')}`;
    const row = values.get(competencia) ?? {
      products: 0n,
      services: 0n,
      transports: 0n,
      countProducts: 0,
      countServices: 0,
      countTransports: 0,
    };
    const mes = row.products + row.services + row.transports;
    total += mes;
    meses.push({
      competencia,
      valorProdutos: decimal(row.products),
      valorServicos: decimal(row.services),
      valorTransportes: decimal(row.transports),
      total: decimal(mes),
      quantidadeProdutos: row.countProducts,
      quantidadeServicos: row.countServices,
      quantidadeTransportes: row.countTransports,
    });
  }
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
  ) {}

  async emitir(userId: string, inicio: string, fim: string, actorId = userId) {
    const period = parseFaturamentoPeriod(inicio, fim);
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
    const result = await this.database.db.execute(sql`
      WITH receitas AS (
        SELECT to_char(coalesce(df.data_emissao_fiscal, df.data_emissao::date), 'YYYY-MM') AS competencia,
          'PRODUTO' AS tipo,
          sum(i.valor_bruto_produto + coalesce(i.valor_frete, 0) + coalesce(i.valor_seguro, 0)
            + coalesce(i.valor_outras_despesas, 0) - coalesce(i.valor_desconto, 0)) AS valor,
          count(DISTINCT df.id)::int AS quantidade
        FROM documentos_fiscais df
        JOIN documentos_fiscais_itens i ON i.documento_fiscal_id = df.id
        WHERE df.cliente_id = ${empresa.id}::uuid AND df.situacao = 'AUTORIZADA'
          AND df.tipo_operacao_escriturada = 'SAIDA' AND df.tipo_documento IN ('NFE', 'NFCE')
          AND i.ind_total = '1'
          AND coalesce(i.cfop_xml, i.cfop) ~ '^[567](10[1-9]|11[0-9]|12[0-5]|35[1-9]|360|40[1-5]|65[1-6])$'
          AND regexp_replace(upper(df.emitente_cnpj_cpf), '[^0-9A-Z]', '', 'g') = ${empresa.documento.toUpperCase().replace(/[^0-9A-Z]/g, '')}
          AND coalesce(df.data_emissao_fiscal, df.data_emissao::date) >= ${period.startDate}::date
          AND coalesce(df.data_emissao_fiscal, df.data_emissao::date) < ${period.nextDate}::date
        GROUP BY 1
        UNION ALL
        SELECT to_char(coalesce(df.competencia_declarada, df.data_emissao_fiscal, df.data_emissao::date), 'YYYY-MM') AS competencia,
          'SERVICO' AS tipo, sum(df.valor_total) AS valor, count(*)::int AS quantidade
        FROM documentos_fiscais df
        WHERE df.cliente_id = ${empresa.id}::uuid AND df.situacao = 'AUTORIZADA'
          AND df.tipo_operacao_escriturada = 'SAIDA' AND df.tipo_documento = 'NFSE'
          AND regexp_replace(upper(df.emitente_cnpj_cpf), '[^0-9A-Z]', '', 'g') = ${empresa.documento.toUpperCase().replace(/[^0-9A-Z]/g, '')}
          AND coalesce(df.competencia_declarada, df.data_emissao_fiscal, df.data_emissao::date) >= ${period.startDate}::date
          AND coalesce(df.competencia_declarada, df.data_emissao_fiscal, df.data_emissao::date) < ${period.nextDate}::date
        GROUP BY 1
        UNION ALL
        -- Prestação de serviço de transporte (CT-e). Mesmo critério do cálculo do Simples:
        -- CFOP de transporte, escrituração de saída e CT-e de anulação fora da receita.
        -- O CT-e anulado ou substituído por outro presente na base também não conta,
        -- para o mesmo frete não entrar duas vezes.
        SELECT to_char(coalesce(df.data_emissao_fiscal, df.data_emissao::date), 'YYYY-MM') AS competencia,
          'TRANSPORTE' AS tipo, sum(e.valor_total_servico) AS valor, count(DISTINCT df.id)::int AS quantidade
        FROM documentos_fiscais df
        JOIN documentos_fiscais_cte_escrituracao e ON e.documento_fiscal_id = df.id
        WHERE df.cliente_id = ${empresa.id}::uuid AND df.situacao = 'AUTORIZADA'
          AND df.tipo_documento = 'CTE'
          AND e.tipo_operacao_escriturada = 'SAIDA' AND e.escrituravel = true
          AND e.cfop_xml ~ '^[56](35[1-7]|360)$'
          AND coalesce(e.tp_cte, '0') <> '2'
          AND regexp_replace(upper(df.emitente_cnpj_cpf), '[^0-9A-Z]', '', 'g') = ${empresa.documento.toUpperCase().replace(/[^0-9A-Z]/g, '')}
          AND NOT EXISTS (
            SELECT 1
            FROM documentos_fiscais_cte_escrituracao r
            JOIN documentos_fiscais rd ON rd.id = r.documento_fiscal_id
            WHERE r.cliente_id = df.cliente_id AND rd.situacao = 'AUTORIZADA'
              AND r.tp_cte IN ('2', '3') AND r.chave_cte_referenciado = df.chave_acesso
          )
          AND coalesce(df.data_emissao_fiscal, df.data_emissao::date) >= ${period.startDate}::date
          AND coalesce(df.data_emissao_fiscal, df.data_emissao::date) < ${period.nextDate}::date
        GROUP BY 1
      )
      SELECT competencia, tipo, valor::text, quantidade FROM receitas ORDER BY competencia, tipo
    `);
    const { meses, total } = buildFaturamentoMeses(
      period.first,
      period.last,
      resultRows<RevenueRow>(result),
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
