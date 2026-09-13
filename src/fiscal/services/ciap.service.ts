import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, gte, lte, sql, type SQL } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service';
import {
  ciapAtivoPermanente,
  ciapCompetenciasApropriadas,
  clientes,
  documentosFiscais,
  documentosFiscaisItens,
  spedAjustesApuracao,
} from '../../database/schema';
import {
  fromScaledInteger,
  positive,
  toScaledInteger,
} from '../sped/sped-decimal';
import { parseCompetenciaMensal } from '../fiscal-date.util';

// CFOPs de entrada de bem para o ativo imobilizado (aquisição).
const CFOPS_ATIVO_ENTRADA = new Set(['1551', '2551', '3551']);

// Escala usada para o coeficiente de saídas tributadas (4 casas decimais).
const COEFICIENTE_SCALE = 4;

export interface RegistroBemCiapInput {
  clienteId: string;
  documentoFiscalId?: string | null;
  documentoFiscalItemId?: string | null;
  codigoBem: string;
  identificacaoBem: string;
  dataEntrada: string; // 'YYYY-MM-DD'
  valorIcmsTotal: string;
  valorIcmsFrete?: string;
  valorIcmsDifal?: string;
  quantidadeParcelas?: number;
}

interface CiapRow {
  ciap: typeof ciapAtivoPermanente.$inferSelect;
}

@Injectable()
export class CiapService {
  constructor(private readonly database: DatabaseService) { }

  /**
   * Registra manualmente um bem do ativo permanente no CIAP.
   * O saldo credor inicial = ICMS total + frete + DIFAL (base de apropriação).
   */
  async registrarBem(input: RegistroBemCiapInput) {
    const parcelas = input.quantidadeParcelas ?? 48;
    if (parcelas <= 0) {
      throw new BadRequestException(
        'Quantidade de parcelas deve ser positiva.',
      );
    }
    const saldoInicial = fromScaledInteger(
      toScaledInteger(input.valorIcmsTotal) +
      toScaledInteger(input.valorIcmsFrete ?? '0') +
      toScaledInteger(input.valorIcmsDifal ?? '0'),
    );

    const rows = await this.database.db
      .insert(ciapAtivoPermanente)
      .values({
        clienteId: input.clienteId,
        documentoFiscalId: input.documentoFiscalId ?? null,
        documentoFiscalItemId: input.documentoFiscalItemId ?? null,
        codigoBem: input.codigoBem,
        identificacaoBem: input.identificacaoBem,
        dataEntrada: input.dataEntrada,
        valorIcmsTotal: input.valorIcmsTotal,
        valorIcmsFrete: input.valorIcmsFrete ?? '0',
        valorIcmsDifal: input.valorIcmsDifal ?? '0',
        quantidadeParcelas: parcelas,
        parcelasApropriadas: 0,
        saldoCredorRestante: saldoInicial,
        status: 'ATIVO',
      })
      .onConflictDoUpdate({
        target: [ciapAtivoPermanente.clienteId, ciapAtivoPermanente.codigoBem],
        set: {
          identificacaoBem: input.identificacaoBem,
          documentoFiscalId: input.documentoFiscalId ?? null,
          documentoFiscalItemId: input.documentoFiscalItemId ?? null,
          dataEntrada: input.dataEntrada,
          valorIcmsTotal: input.valorIcmsTotal,
          valorIcmsFrete: input.valorIcmsFrete ?? '0',
          valorIcmsDifal: input.valorIcmsDifal ?? '0',
          atualizadoEm: new Date(),
        },
      })
      .returning();
    return this.toBemResponse(rows[0]);
  }

  /**
   * Importa automaticamente para o CIAP os itens de compra de ativo
   * imobilizado (CFOP 1551/2551) escriturados no período informado que ainda
   * não possuem ficha CIAP. Idempotente por (clienteId, codigoBem).
   */
  async importarBensDoPeriodo(input: {
    clienteId: string;
    competencia: string;
  }) {
    const { inicio, fim } = this.competenciaRange(input.competencia);
    const itens = await this.database.db
      .select({
        documentoFiscalId: documentosFiscaisItens.documentoFiscalId,
        documentoFiscalItemId: documentosFiscaisItens.id,
        codigoProduto: documentosFiscaisItens.codigoProduto,
        descricao: documentosFiscaisItens.descricao,
        cfop: documentosFiscaisItens.cfop,
        valorIcms: documentosFiscaisItens.valorIcms,
        dataEmissao: documentosFiscais.dataEmissao,
      })
      .from(documentosFiscaisItens)
      .innerJoin(
        documentosFiscais,
        eq(documentosFiscais.id, documentosFiscaisItens.documentoFiscalId),
      )
      .where(
        and(
          eq(documentosFiscaisItens.clienteId, input.clienteId),
          eq(documentosFiscaisItens.tipoOperacaoEscriturada, 'ENTRADA'),
          eq(documentosFiscais.situacao, 'AUTORIZADA'),
          eq(documentosFiscais.escriturado, true),
          gte(documentosFiscais.dataEmissao, inicio),
          lte(documentosFiscais.dataEmissao, fim),
        ),
      );

    const ativos = itens.filter((item) => CFOPS_ATIVO_ENTRADA.has(item.cfop));
    let importados = 0;
    for (const item of ativos) {
      // Código do bem estável: produto do documento/item. Se não houver
      // código de produto, usa o id do item para garantir unicidade.
      const codigoBem = (
        item.codigoProduto ?? item.documentoFiscalItemId
      ).slice(0, 60);
      const dataEntrada = item.dataEmissao.toISOString().slice(0, 10);
      const jaExiste = await this.database.db
        .select({ id: ciapAtivoPermanente.id })
        .from(ciapAtivoPermanente)
        .where(
          and(
            eq(ciapAtivoPermanente.clienteId, input.clienteId),
            eq(ciapAtivoPermanente.codigoBem, codigoBem),
          ),
        )
        .limit(1);
      if (jaExiste[0]) continue;

      await this.registrarBem({
        clienteId: input.clienteId,
        documentoFiscalId: item.documentoFiscalId,
        documentoFiscalItemId: item.documentoFiscalItemId,
        codigoBem,
        identificacaoBem: item.descricao ?? codigoBem,
        dataEntrada,
        valorIcmsTotal: item.valorIcms ?? '0',
      });
      importados += 1;
    }
    return { importados, elegiveis: ativos.length };
  }

  /**
   * Calcula a parcela CIAP de uma competência para todos os bens ativos:
   *   parcela = (valor_icms_total_do_bem / quantidade_parcelas)
   *   credito_apropriado = parcela * coeficiente
   * onde coeficiente = saídas tributadas / saídas totais no período.
   * Não persiste; apenas projeta os valores (preview do Bloco G / E111).
   */
  async apurarCompetencia(input: { clienteId: string; competencia: string }) {
    const { competencia, inicio, fim } = this.competenciaRange(
      input.competencia,
    );
    const coeficiente = await this.coeficienteSaidasTributadas({
      clienteId: input.clienteId,
      inicio,
      fim,
    });
    const coefScaled = toScaledInteger(coeficiente, COEFICIENTE_SCALE);

    const bens = await this.database.db
      .select()
      .from(ciapAtivoPermanente)
      .where(
        and(
          eq(ciapAtivoPermanente.clienteId, input.clienteId),
          eq(ciapAtivoPermanente.status, 'ATIVO'),
        ),
      )
      .orderBy(asc(ciapAtivoPermanente.dataEntrada));

    let totalParcela = 0n;
    let totalCredito = 0n;
    const detalhes = bens.map((bem) => {
      const baseScaled =
        toScaledInteger(bem.valorIcmsTotal) +
        toScaledInteger(bem.valorIcmsFrete) +
        toScaledInteger(bem.valorIcmsDifal);
      const parcela = baseScaled / BigInt(bem.quantidadeParcelas);
      // credito = parcela * coeficiente (coeficiente tem escala 4).
      const credito = (parcela * coefScaled) / 10n ** BigInt(COEFICIENTE_SCALE);
      totalParcela += parcela;
      totalCredito += credito;
      return {
        id: bem.id,
        codigo_bem: bem.codigoBem,
        identificacao_bem: bem.identificacaoBem,
        parcelas_apropriadas: bem.parcelasApropriadas,
        quantidade_parcelas: bem.quantidadeParcelas,
        valor_parcela: fromScaledInteger(parcela),
        credito_apropriado: fromScaledInteger(credito),
        saldo_credor_restante: bem.saldoCredorRestante,
      };
    });

    return {
      competencia,
      coeficiente_saidas_tributadas: coeficiente,
      total_parcela: fromScaledInteger(totalParcela),
      total_credito_apropriado: fromScaledInteger(totalCredito),
      quantidade_bens: bens.length,
      bens: detalhes,
    };
  }

  /**
   * Efetiva a apropriação da competência: para cada bem ativo, incrementa
   * parcelasApropriadas, reduz o saldo credor e conclui o bem ao chegar na
   * última parcela. Retorna o crédito total apropriado (para o E111/Bloco G).
   */
  async apropriarCompetencia(input: {
    clienteId: string;
    competencia: string;
  }) {
    const { competencia, inicio, fim } = this.competenciaRange(
      input.competencia,
    );
    const coeficiente = await this.coeficienteSaidasTributadas({
      clienteId: input.clienteId,
      inicio,
      fim,
    });
    const coefScaled = toScaledInteger(coeficiente, COEFICIENTE_SCALE);
    const uf = await this.getUfCliente(input.clienteId);

    return this.database.db.transaction(async (tx) => {
      // F06: serializa apropriações concorrentes do mesmo cliente/competência,
      // impedindo que duas execuções simultâneas consumam duas parcelas.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`ciap-apropriacao:${input.clienteId}:${competencia}`}, 0))`,
      );

      const bens = await tx
        .select()
        .from(ciapAtivoPermanente)
        .where(
          and(
            eq(ciapAtivoPermanente.clienteId, input.clienteId),
            eq(ciapAtivoPermanente.status, 'ATIVO'),
          ),
        );

      // F06: bens que já tiveram esta competência apropriada não são
      // consumidos de novo (idempotência por bem/competência).
      const jaApropriados = await tx
        .select({ bemId: ciapCompetenciasApropriadas.bemId })
        .from(ciapCompetenciasApropriadas)
        .where(
          and(
            eq(ciapCompetenciasApropriadas.clienteId, input.clienteId),
            eq(ciapCompetenciasApropriadas.competencia, competencia),
          ),
        );
      const bensJaApropriados = new Set(jaApropriados.map((r) => r.bemId));

      // R2.1/R2.4: o número de parcelas apropriadas de cada bem é DERIVADO da
      // razão auxiliar (ciap_competencias_apropriadas) — quantidade de
      // competências distintas já registradas para o bem — em vez de um
      // incremento cego sobre o contador armazenado. Isso torna
      // parcelasApropriadas reconstruível e consistente mesmo após retries ou
      // falhas parciais, evitando divergência (drift).
      const ledgerPorBem = await tx
        .select({
          bemId: ciapCompetenciasApropriadas.bemId,
          total: sql<number>`count(*)::int`,
        })
        .from(ciapCompetenciasApropriadas)
        .where(eq(ciapCompetenciasApropriadas.clienteId, input.clienteId))
        .groupBy(ciapCompetenciasApropriadas.bemId);
      const parcelasNaRazaoPorBem = new Map(
        ledgerPorBem.map((r) => [r.bemId, Number(r.total)]),
      );

      let totalCredito = 0n;
      let bensApropriados = 0;
      for (const bem of bens) {
        // Parcelas já apropriadas segundo a razão auxiliar (fonte de verdade),
        // não o contador armazenado no bem.
        const parcelasNaRazao = parcelasNaRazaoPorBem.get(bem.id) ?? 0;
        if (parcelasNaRazao >= bem.quantidadeParcelas) continue;
        if (bensJaApropriados.has(bem.id)) continue;
        const baseScaled =
          toScaledInteger(bem.valorIcmsTotal) +
          toScaledInteger(bem.valorIcmsFrete) +
          toScaledInteger(bem.valorIcmsDifal);
        const parcela = baseScaled / BigInt(bem.quantidadeParcelas);
        const credito =
          (parcela * coefScaled) / 10n ** BigInt(COEFICIENTE_SCALE);
        const novoSaldo = positive(
          toScaledInteger(bem.saldoCredorRestante) - parcela,
        );
        // R2.1/R2.4: contagem resultante = competências na razão ANTES deste
        // insert + 1 (a competência ora apropriada). Derivado da razão, nunca
        // um +1 cego sobre bem.parcelasApropriadas.
        const parcelasApropriadas = parcelasNaRazao + 1;
        const concluido = parcelasApropriadas >= bem.quantidadeParcelas;

        await tx
          .update(ciapAtivoPermanente)
          .set({
            parcelasApropriadas,
            saldoCredorRestante: fromScaledInteger(novoSaldo),
            status: concluido ? 'CONCLUIDO' : 'ATIVO',
            atualizadoEm: new Date(),
          })
          .where(eq(ciapAtivoPermanente.id, bem.id));

        // F06: marca a competência como apropriada para este bem. O unique
        // (clienteId, competencia, bemId) impede o registro em duplicidade.
        await tx.insert(ciapCompetenciasApropriadas).values({
          clienteId: input.clienteId,
          bemId: bem.id,
          competencia,
        });

        totalCredito += credito;
        bensApropriados += 1;
      }

      // Reflete o crédito apropriado como ajuste E111 (CREDITO) na apuração do
      // ICMS da competência. O código UF+02CIAP satisfaz o check de coerência
      // (E111, natureza 2 = crédito → indicador CREDITO).
      //
      // F06: numa reexecução idempotente (nada novo apropriado), NÃO mexemos no
      // ajuste E111 existente — o delete-then-insert só é aplicado quando esta
      // execução acrescenta crédito, e o valor é somado ao ajuste já existente
      // para refletir o total apropriado na competência.
      const competenciaDate = competencia;
      let ajusteGerado: string | null = null;
      if (totalCredito > 0n) {
        const existente = await tx
          .select({ valor: spedAjustesApuracao.valor })
          .from(spedAjustesApuracao)
          .where(
            and(
              eq(spedAjustesApuracao.clienteId, input.clienteId),
              eq(spedAjustesApuracao.competencia, competenciaDate),
              eq(spedAjustesApuracao.registro, 'E111'),
              eq(spedAjustesApuracao.codigoAjuste, `${uf}02CIAP`),
            ),
          );
        const acumulado =
          totalCredito +
          (existente[0] ? toScaledInteger(existente[0].valor) : 0n);
        await tx
          .delete(spedAjustesApuracao)
          .where(
            and(
              eq(spedAjustesApuracao.clienteId, input.clienteId),
              eq(spedAjustesApuracao.competencia, competenciaDate),
              eq(spedAjustesApuracao.registro, 'E111'),
              eq(spedAjustesApuracao.codigoAjuste, `${uf}02CIAP`),
            ),
          );
        await tx.insert(spedAjustesApuracao).values({
          clienteId: input.clienteId,
          competencia: competenciaDate,
          registro: 'E111',
          codigoAjuste: `${uf}02CIAP`,
          descricao:
            'Crédito de ICMS do ativo permanente (CIAP - 1/48) apropriado no período.',
          valor: fromScaledInteger(acumulado),
          indicador: 'CREDITO',
          uf: null,
          numeroDocumento: null,
        });
        ajusteGerado = `${uf}02CIAP`;
      }

      return {
        competencia,
        coeficiente_saidas_tributadas: coeficiente,
        bens_apropriados: bensApropriados,
        total_credito_apropriado: fromScaledInteger(totalCredito),
        ajuste_e111_gerado: ajusteGerado,
      };
    });
  }

  private async getUfCliente(clienteId: string): Promise<string> {
    const rows = await this.database.db
      .select({ uf: clientes.uf })
      .from(clientes)
      .where(eq(clientes.id, clienteId))
      .limit(1);
    const uf = (rows[0]?.uf ?? '').toUpperCase();
    if (!/^[A-Z]{2}$/.test(uf)) {
      throw new BadRequestException(
        'A UF da empresa é obrigatória para gerar o ajuste E111 do CIAP.',
      );
    }
    return uf;
  }

  /**
   * Baixa um bem do CIAP (venda, baixa ou transferência). O saldo credor
   * remanescente deixa de ser apropriado.
   */
  async baixarBem(input: {
    clienteId: string;
    bemId: string;
    dataBaixa: string;
    motivoBaixa: '01' | '02' | '03';
  }) {
    const rows = await this.database.db
      .update(ciapAtivoPermanente)
      .set({
        status: 'BAIXADO',
        dataBaixa: input.dataBaixa,
        motivoBaixa: input.motivoBaixa,
        atualizadoEm: new Date(),
      })
      .where(
        and(
          eq(ciapAtivoPermanente.id, input.bemId),
          eq(ciapAtivoPermanente.clienteId, input.clienteId),
        ),
      )
      .returning();
    if (!rows[0]) throw new NotFoundException('Bem do CIAP não encontrado.');
    return this.toBemResponse(rows[0]);
  }

  async listarBens(input: {
    clienteId: string;
    status?: 'ATIVO' | 'BAIXADO' | 'CONCLUIDO';
  }) {
    const conditions: SQL[] = [
      eq(ciapAtivoPermanente.clienteId, input.clienteId),
    ];
    if (input.status) {
      conditions.push(eq(ciapAtivoPermanente.status, input.status));
    }
    const rows = await this.database.db
      .select()
      .from(ciapAtivoPermanente)
      .where(and(...conditions))
      .orderBy(asc(ciapAtivoPermanente.dataEntrada));
    return { data: rows.map((row) => this.toBemResponse(row)) };
  }

  /**
   * Coeficiente = saídas tributadas / saídas totais no período.
   * Saídas tributadas: itens de SAÍDA com ICMS destacado > 0.
   * Retorna string decimal com 4 casas (0.0000 a 1.0000). Sem saídas => 1.
   */
  private async coeficienteSaidasTributadas(input: {
    clienteId: string;
    inicio: Date;
    fim: Date;
  }): Promise<string> {
    const valorOperacao = sql`COALESCE(${documentosFiscaisItens.valorBrutoProduto}, 0) - COALESCE(${documentosFiscaisItens.valorDesconto}, 0)`;
    const rows = await this.database.db
      .select({
        totais: sql<string>`COALESCE(SUM(${valorOperacao}), 0)`,
        tributadas: sql<string>`COALESCE(SUM(CASE WHEN COALESCE(${documentosFiscaisItens.valorIcms}, 0) > 0 THEN ${valorOperacao} ELSE 0 END), 0)`,
      })
      .from(documentosFiscaisItens)
      .innerJoin(
        documentosFiscais,
        eq(documentosFiscais.id, documentosFiscaisItens.documentoFiscalId),
      )
      .where(
        and(
          eq(documentosFiscaisItens.clienteId, input.clienteId),
          eq(documentosFiscaisItens.tipoOperacaoEscriturada, 'SAIDA'),
          eq(documentosFiscais.situacao, 'AUTORIZADA'),
          eq(documentosFiscais.escriturado, true),
          gte(documentosFiscais.dataEmissao, input.inicio),
          lte(documentosFiscais.dataEmissao, input.fim),
        ),
      );

    const totais = toScaledInteger(rows[0]?.totais ?? '0');
    const tributadas = toScaledInteger(rows[0]?.tributadas ?? '0');
    if (totais === 0n) return '1.0000';
    // coeficiente escalado em 4 casas: (tributadas / totais) arredondado.
    const escala = 10n ** BigInt(COEFICIENTE_SCALE);
    const coef = (tributadas * escala) / totais;
    return fromScaledInteger(coef, COEFICIENTE_SCALE);
  }

  private competenciaRange(competencia: string) {
    try {
      return parseCompetenciaMensal(competencia);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Competência inválida.',
      );
    }
  }

  async assertCliente(clienteId: string) {
    const rows = await this.database.db
      .select({ id: clientes.id })
      .from(clientes)
      .where(eq(clientes.id, clienteId))
      .limit(1);
    if (!rows[0]) throw new NotFoundException('Empresa não encontrada.');
  }

  private toBemResponse(row: CiapRow['ciap']) {
    return {
      id: row.id,
      cliente_id: row.clienteId,
      documento_fiscal_id: row.documentoFiscalId,
      documento_fiscal_item_id: row.documentoFiscalItemId,
      codigo_bem: row.codigoBem,
      identificacao_bem: row.identificacaoBem,
      data_entrada: row.dataEntrada,
      valor_icms_total: row.valorIcmsTotal,
      valor_icms_frete: row.valorIcmsFrete,
      valor_icms_difal: row.valorIcmsDifal,
      quantidade_parcelas: row.quantidadeParcelas,
      parcelas_apropriadas: row.parcelasApropriadas,
      saldo_credor_restante: row.saldoCredorRestante,
      status: row.status,
      data_baixa: row.dataBaixa,
      motivo_baixa: row.motivoBaixa,
      criado_em: row.criadoEm.toISOString(),
      atualizado_em: row.atualizadoEm.toISOString(),
    };
  }
}
