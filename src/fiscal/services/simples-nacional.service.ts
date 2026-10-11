import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service';
import {
  clientes,
  documentosFiscais,
  documentosFiscaisItens,
  fiscalSimplesAnexos,
  fiscalSimplesApuracaoItens,
  fiscalSimplesApuracoes,
  fiscalSimplesFaixas,
  fiscalSimplesSublimites,
  fiscalSimplesTabelas,
  folhasPagamento,
} from '../../database/schema';
import { monthsBetweenCompetencias, parseCompetenciaMensal } from '../fiscal-date.util';
import { fromScaledInteger, toScaledInteger } from '../sped/sped-decimal';
import {
  SimplesCalculadorService,
  type SimplesAnexo,
  type SimplesFaixaCalculo,
  type SimplesItemCalculoResult,
  type SimplesSegregacao,
} from './simples-calculador.service';
import { FiscalClosingService } from './fiscal-closing.service';
import { FiscalGuiasService } from './fiscal-guias.service';

const SIMPLES_MOTOR_VERSAO = 'simples-nacional@1';

interface ReceitaAgrupada {
  anexo: SimplesAnexo;
  segregacao: SimplesSegregacao;
  deducoes: Array<'ICMS' | 'PIS' | 'COFINS'>;
  receita: bigint;
}

@Injectable()
export class SimplesNacionalService {
  constructor(
    private readonly database: DatabaseService,
    private readonly calculador: SimplesCalculadorService,
    private readonly closingService: FiscalClosingService,
    private readonly guiasService: FiscalGuiasService,
  ) {}

  async listarTabelas() {
    const tabelas = await this.database.db
      .select()
      .from(fiscalSimplesTabelas)
      .orderBy(desc(fiscalSimplesTabelas.vigenciaInicio));
    return Promise.all(
      tabelas.map(async (tabela) => ({
        id: tabela.id,
        versao: tabela.versao,
        descricao: tabela.descricao,
        vigencia_inicio: tabela.vigenciaInicio,
        vigencia_fim: tabela.vigenciaFim,
        ativo: tabela.ativo,
        anexos: await this.carregarAnexos(tabela.id),
      })),
    );
  }

  async obterApuracao(clienteId: string, competencia: string) {
    const competenciaDate = this.competencia(competencia);
    const [existente] = await this.database.db
      .select()
      .from(fiscalSimplesApuracoes)
      .where(
        and(
          eq(fiscalSimplesApuracoes.clienteId, clienteId),
          eq(fiscalSimplesApuracoes.competencia, competenciaDate),
        ),
      )
      .orderBy(desc(fiscalSimplesApuracoes.versao))
      .limit(1);
    if (existente) return this.carregarResposta(existente);
    return this.calcular(clienteId, competencia);
  }

  async apurar(input: { clienteId: string; competencia: string }) {
    const calculo = await this.calcular(input.clienteId, input.competencia);
    const competenciaDate = this.competencia(input.competencia);
    return this.database.db.transaction(
      async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`simples:${input.clienteId}:${competenciaDate}`}, 0))`,
        );
        const [ultima] = await tx
          .select({ versao: fiscalSimplesApuracoes.versao })
          .from(fiscalSimplesApuracoes)
          .where(
            and(
              eq(fiscalSimplesApuracoes.clienteId, input.clienteId),
              eq(fiscalSimplesApuracoes.competencia, competenciaDate),
            ),
          )
          .orderBy(desc(fiscalSimplesApuracoes.versao))
          .limit(1);
        const versao = (ultima?.versao ?? 0) + 1;
        await tx
          .update(fiscalSimplesApuracoes)
          .set({ status: 'RETIFICADO', corrente: false, atualizadoEm: new Date() })
          .where(
            and(
              eq(fiscalSimplesApuracoes.clienteId, input.clienteId),
              eq(fiscalSimplesApuracoes.competencia, competenciaDate),
              eq(fiscalSimplesApuracoes.status, 'RASCUNHO'),
            ),
          );
        const [apuracao] = await tx
          .insert(fiscalSimplesApuracoes)
          .values({
            clienteId: input.clienteId,
            tabelaId: calculo.tabela_id,
            competencia: competenciaDate,
            versao,
            rbt12: calculo.rbt12,
            rbt12Proporcional: calculo.rbt12_proporcional,
            receitaBrutaMes: calculo.receita_bruta_mes,
            folhaSalarios12m: calculo.folha_salarios_12m,
            fatorR: calculo.fator_r,
            valorTotalDas: calculo.valor_total_das,
            status: 'RASCUNHO',
            corrente: false,
            origens: calculo.origens,
            memoriaCalculo: calculo.memoria_calculo,
          })
          .returning();
        if (calculo.itens.length) {
          await tx.insert(fiscalSimplesApuracaoItens).values(
            calculo.itens.map((item) => ({
              apuracaoId: apuracao.id,
              anexo: item.anexo,
              faixaEnquadrada: item.faixa_enquadrada,
              aliquotaNominal: item.aliquota_nominal,
              parcelaDeduzir: item.parcela_deduzir,
              aliquotaEfetiva: item.aliquota_efetiva,
              receitaBrutaAtividade: item.receita_bruta_atividade,
              segregacao: item.segregacao,
              aliquotaEfetivaAposDeducoes: item.aliquota_efetiva_apos_deducoes,
              valorDevido: item.valor_devido,
              tributosPartilhados: item.tributos_partilhados,
            })),
          );
        }
        if (calculo.excedeu_sublimite) {
          await tx
            .update(clientes)
            .set({ apuraIcms: true })
            .where(eq(clientes.id, input.clienteId));
        }
        return this.carregarResposta(apuracao);
      },
      { isolationLevel: 'repeatable read' },
    );
  }

  async fechar(input: {
    clienteId: string;
    competencia: string;
    apuracaoId?: string;
    actorUserId: string;
  }) {
    const competenciaDate = this.competencia(input.competencia);
    const conditions = [
      eq(fiscalSimplesApuracoes.clienteId, input.clienteId),
      eq(fiscalSimplesApuracoes.competencia, competenciaDate),
    ];
    if (input.apuracaoId) conditions.push(eq(fiscalSimplesApuracoes.id, input.apuracaoId));
    const [apuracaoInicial] = await this.database.db
      .select()
      .from(fiscalSimplesApuracoes)
      .where(and(...conditions))
      .orderBy(desc(fiscalSimplesApuracoes.versao))
      .limit(1);
    if (!apuracaoInicial) throw new NotFoundException('Apuração do Simples Nacional não encontrada.');
    if (apuracaoInicial.status === 'FECHADO') return this.carregarResposta(apuracaoInicial);
    if (apuracaoInicial.status !== 'RASCUNHO') {
      throw new ConflictException('Somente uma apuração em rascunho pode ser fechada.');
    }
    const pendencias = apuracaoInicial.memoriaCalculo.pendencias;
    if (Array.isArray(pendencias) && pendencias.length > 0) {
      throw new UnprocessableEntityException({
        code: 'APURACAO_SIMPLES_COM_PENDENCIAS',
        message: 'Revise as pendências da memória de cálculo antes de fechar a apuração do Simples Nacional.',
        pendencias,
      });
    }

    let fechamentoId = apuracaoInicial.fechamentoId;
    if (!fechamentoId) {
      const itens = await this.carregarItens(apuracaoInicial.id);
      let fechamento = await this.closingService.abrir({
        clienteId: input.clienteId,
        obrigacao: 'DAS',
        competencia: input.competencia,
        entradas: {
          documentos: itens.map((item) => ({ ...item })),
          decisoes: [],
          regras: [{ motorVersao: SIMPLES_MOTOR_VERSAO, tabelaId: apuracaoInicial.tabelaId }],
          parametros: {
            regime: 'SIMPLES_NACIONAL',
            rbt12: apuracaoInicial.rbt12,
            fatorR: apuracaoInicial.fatorR,
            origens: apuracaoInicial.origens,
          },
          saldos: {
            saldoApurado: apuracaoInicial.valorTotalDas,
            icmsRecolher: apuracaoInicial.valorTotalDas,
          },
        },
      });
      fechamento = await this.closingService.transicionar(fechamento.id, 'PENDENTE');
      fechamento = await this.closingService.transicionar(fechamento.id, 'REVISADO');
      fechamento = await this.closingService.fechar({
        fechamentoId: fechamento.id,
        aprovadoPor: input.actorUserId,
      });
      fechamentoId = fechamento.id;
      await this.database.db
        .update(fiscalSimplesApuracoes)
        .set({ fechamentoId, atualizadoEm: new Date() })
        .where(eq(fiscalSimplesApuracoes.id, apuracaoInicial.id));
    }

    let guiaId = apuracaoInicial.guiaId;
    if (!guiaId && toScaledInteger(apuracaoInicial.valorTotalDas) > 0n) {
      const [cliente] = await this.database.db
        .select({ uf: clientes.uf })
        .from(clientes)
        .where(eq(clientes.id, input.clienteId))
        .limit(1);
      if (!cliente?.uf) throw new UnprocessableEntityException('A UF da empresa é obrigatória para gerar a guia DAS.');
      const guia = await this.guiasService.criarGuia({
        clienteId: input.clienteId,
        competencia: input.competencia,
        tributo: 'DAS_SIMPLES',
        ufFavorecida: cliente.uf,
        tipoGuia: 'DAS',
        codigoReceita: 'DAS',
        dataVencimento: vencimentoDas(input.competencia),
        valorPrincipal: apuracaoInicial.valorTotalDas,
        origem: 'APURACAO',
        fechamentoId,
        idempotencyKey: `simples:${apuracaoInicial.id}:das`,
      });
      guiaId = guia.id;
    }

    await this.database.db.transaction(async (tx) => {
      await tx
        .update(fiscalSimplesApuracoes)
        .set({ corrente: false, status: 'RETIFICADO', atualizadoEm: new Date() })
        .where(
          and(
            eq(fiscalSimplesApuracoes.clienteId, input.clienteId),
            eq(fiscalSimplesApuracoes.competencia, competenciaDate),
            eq(fiscalSimplesApuracoes.corrente, true),
          ),
        );
      await tx
        .update(fiscalSimplesApuracoes)
        .set({ status: 'FECHADO', corrente: true, fechamentoId, guiaId, atualizadoEm: new Date() })
        .where(eq(fiscalSimplesApuracoes.id, apuracaoInicial.id));
    });
    const [fechada] = await this.database.db
      .select()
      .from(fiscalSimplesApuracoes)
      .where(eq(fiscalSimplesApuracoes.id, apuracaoInicial.id))
      .limit(1);
    return this.carregarResposta(fechada);
  }

  private async calcular(clienteId: string, competencia: string) {
    const { competencia: competenciaDate, inicio, fim } = this.competenciaRange(competencia);
    const [cliente, tabela] = await Promise.all([
      this.buscarClienteSimples(clienteId),
      this.buscarTabelaVigente(competenciaDate),
    ]);
    const [receitasMensais, primeiraCompetencia, receitasAtividade, folha, sublimite, anexos] = await Promise.all([
      this.carregarReceitasMensais(clienteId, competenciaDate),
      this.carregarPrimeiraCompetenciaReceita(clienteId),
      this.carregarReceitasAtividade(clienteId, inicio, fim),
      this.carregarFolha12m(clienteId, competenciaDate),
      this.carregarSublimite(cliente.uf, competencia.slice(0, 4)),
      this.carregarAnexosCalculo(tabela.id),
    ]);
    const receitaMesDocumentos = receitasMensais.find((row) => row.mes === competencia)?.receita ?? '0.00';
    const anteriores = receitasMensais.filter((row) => row.mes < competencia).map((row) => row.receita);
    const mesesAnteriores = Math.max(0, monthsBetweenCompetencias(primeiraCompetencia ?? competencia, competencia));
    const rbt = this.calculador.calcularRbt12({
      receitasAnteriores: anteriores,
      mesesAnteriores,
      receitaPrimeiroMes: receitaMesDocumentos,
    });
    const fatorR = this.calculador.calcularFatorR(folha.valor, rbt.rbt12);
    const excedeuSublimite = toScaledInteger(rbt.rbt12) > toScaledInteger(sublimite.valor);
    const calculados: SimplesItemCalculoResult[] = [];
    for (const receita of receitasAtividade.grupos) {
      const anexo = receita.anexo === 'ANEXO_V' ? this.calculador.resolverAnexoFatorR(fatorR) : receita.anexo;
      const faixas = anexos.get(anexo);
      if (!faixas) throw new UnprocessableEntityException(`Tabela do ${anexo} não encontrada.`);
      const faixa = this.calculador.selecionarFaixa(rbt.rbt12, faixas);
      calculados.push(
        this.calculador.calcularItem({
          anexo,
          receita: fromScaledInteger(receita.receita),
          segregacao: receita.segregacao,
          faixa,
          rbt12: rbt.rbt12,
          excedeuSublimite,
          deducoesAdicionais: receita.deducoes,
        }),
      );
    }
    const valorTotalDas = fromScaledInteger(
      calculados.reduce((sum, item) => sum + toScaledInteger(item.valorDevido), 0n),
    );
    const receitaClassificada = fromScaledInteger(
      receitasAtividade.grupos.reduce((sum, item) => sum + item.receita, 0n),
    );
    const pendencias = [...receitasAtividade.pendencias];
    if (toScaledInteger(receitaClassificada) !== toScaledInteger(receitaMesDocumentos)) {
      pendencias.push(
        'O total classificado por itens difere do faturamento documental do mês. Revise documentos sem itens, fretes, descontos e outras parcelas antes do fechamento.',
      );
    }
    return {
      id: null,
      cliente_id: clienteId,
      tabela_id: tabela.id,
      competencia: competenciaDate,
      versao: null,
      status: 'PREVIEW' as const,
      corrente: false,
      rbt12: rbt.rbt12,
      rbt12_proporcional: rbt.proporcional,
      receita_bruta_mes: receitaClassificada,
      folha_salarios_12m: folha.valor,
      fator_r: fatorR,
      valor_total_das: valorTotalDas,
      excedeu_sublimite: excedeuSublimite,
      sublimite_estadual: sublimite.valor,
      fechamento_id: null,
      guia_id: null,
      origens: {
        rbt12: rbt.origem,
        receita: 'DOCUMENTOS_FISCAIS_SAIDA_AUTORIZADOS',
        folha: folha.origem,
        sublimite: sublimite.origem,
        classificacaoAnexo: 'CFOP_DOCUMENTO_FISCAL',
      },
      memoria_calculo: {
        motorVersao: SIMPLES_MOTOR_VERSAO,
        receitaMesDocumentos,
        receitaClassificada,
        sublimiteEstadual: sublimite.valor,
        pendencias,
      },
      itens: calculados.map(toItemResponse),
    };
  }

  private async buscarClienteSimples(clienteId: string) {
    const [cliente] = await this.database.db
      .select({ id: clientes.id, regimeTributario: clientes.regimeTributario, uf: clientes.uf })
      .from(clientes)
      .where(eq(clientes.id, clienteId))
      .limit(1);
    if (!cliente) throw new NotFoundException('Empresa não encontrada.');
    if (cliente.regimeTributario !== 'SIMPLES_NACIONAL') {
      throw new UnprocessableEntityException({
        code: 'EMPRESA_FORA_SIMPLES_NACIONAL',
        message: 'A empresa selecionada não está enquadrada no Simples Nacional.',
      });
    }
    return cliente;
  }

  private async buscarTabelaVigente(competencia: string) {
    const [tabela] = await this.database.db
      .select()
      .from(fiscalSimplesTabelas)
      .where(
        and(
          eq(fiscalSimplesTabelas.ativo, true),
          sql`${fiscalSimplesTabelas.vigenciaInicio} <= ${competencia}`,
          sql`(${fiscalSimplesTabelas.vigenciaFim} IS NULL OR ${fiscalSimplesTabelas.vigenciaFim} >= ${competencia})`,
        ),
      )
      .orderBy(desc(fiscalSimplesTabelas.vigenciaInicio))
      .limit(1);
    if (!tabela) {
      throw new UnprocessableEntityException({
        code: 'TABELA_SIMPLES_NAO_CONFIGURADA',
        message: 'Não existe tabela do Simples Nacional vigente. Execute o seed normativo.',
      });
    }
    return tabela;
  }

  private async carregarReceitasMensais(clienteId: string, competencia: string) {
    const rows = await this.database.db
      .select({
        mes: sql<string>`to_char(date_trunc('month', coalesce(${documentosFiscais.dataEmissaoFiscal}, ${documentosFiscais.dataEmissao}::date)), 'YYYY-MM')`,
        receita: sql<string>`coalesce(sum(${documentosFiscais.valorTotal}), 0)::text`,
      })
      .from(documentosFiscais)
      .where(
        and(
          eq(documentosFiscais.clienteId, clienteId),
          eq(documentosFiscais.tipoOperacaoEscriturada, 'SAIDA'),
          eq(documentosFiscais.situacao, 'AUTORIZADA'),
          sql`coalesce(${documentosFiscais.dataEmissaoFiscal}, ${documentosFiscais.dataEmissao}::date) >= (${competencia}::date - interval '12 months')`,
          sql`coalesce(${documentosFiscais.dataEmissaoFiscal}, ${documentosFiscais.dataEmissao}::date) < (${competencia}::date + interval '1 month')`,
        ),
      )
      .groupBy(sql`date_trunc('month', coalesce(${documentosFiscais.dataEmissaoFiscal}, ${documentosFiscais.dataEmissao}::date))`)
      .orderBy(asc(sql`date_trunc('month', coalesce(${documentosFiscais.dataEmissaoFiscal}, ${documentosFiscais.dataEmissao}::date))`));
    return rows;
  }

  private async carregarPrimeiraCompetenciaReceita(clienteId: string) {
    const [row] = await this.database.db
      .select({
        mes: sql<string | null>`to_char(min(coalesce(${documentosFiscais.dataEmissaoFiscal}, ${documentosFiscais.dataEmissao}::date)), 'YYYY-MM')`,
      })
      .from(documentosFiscais)
      .where(
        and(
          eq(documentosFiscais.clienteId, clienteId),
          eq(documentosFiscais.tipoOperacaoEscriturada, 'SAIDA'),
          eq(documentosFiscais.situacao, 'AUTORIZADA'),
        ),
      );
    return row?.mes ?? null;
  }

  private async carregarReceitasAtividade(clienteId: string, inicio: Date, fim: Date) {
    const rows = await this.database.db
      .select({
        documentoId: documentosFiscais.id,
        documentoTotal: documentosFiscais.valorTotal,
        cfop: documentosFiscaisItens.cfop,
        csosn: documentosFiscaisItens.csosnIcms,
        cstPis: documentosFiscaisItens.cstPis,
        cstCofins: documentosFiscaisItens.cstCofins,
        indTotal: documentosFiscaisItens.indTotal,
        bruto: documentosFiscaisItens.valorBrutoProduto,
        frete: documentosFiscaisItens.valorFrete,
        seguro: documentosFiscaisItens.valorSeguro,
        desconto: documentosFiscaisItens.valorDesconto,
        outras: documentosFiscaisItens.valorOutrasDespesas,
      })
      .from(documentosFiscaisItens)
      .innerJoin(documentosFiscais, eq(documentosFiscais.id, documentosFiscaisItens.documentoFiscalId))
      .where(
        and(
          eq(documentosFiscaisItens.clienteId, clienteId),
          eq(documentosFiscaisItens.tipoOperacaoEscriturada, 'SAIDA'),
          eq(documentosFiscais.situacao, 'AUTORIZADA'),
          sql`coalesce(${documentosFiscais.dataEmissaoFiscal}, ${documentosFiscais.dataEmissao}::date) >= ${inicio.toISOString().slice(0, 10)}::date`,
          sql`coalesce(${documentosFiscais.dataEmissaoFiscal}, ${documentosFiscais.dataEmissao}::date) <= ${fim.toISOString().slice(0, 10)}::date`,
        ),
      );
    const grupos = new Map<string, ReceitaAgrupada>();
    const porDocumento = new Map<string, typeof rows>();
    for (const row of rows) {
      const itens = porDocumento.get(row.documentoId) ?? [];
      itens.push(row);
      porDocumento.set(row.documentoId, itens);
    }
    for (const itensDocumento of porDocumento.values()) {
      const itens = itensDocumento.filter((row) => row.indTotal === '1');
      const pesos = itens.map((row) => {
        const valor =
          toScaledInteger(row.bruto) +
          toScaledInteger(row.frete) +
          toScaledInteger(row.seguro) +
          toScaledInteger(row.outras) -
          toScaledInteger(row.desconto);
        return valor > 0n ? valor : 0n;
      });
      const pesoTotal = pesos.reduce((sum, valor) => sum + valor, 0n);
      const totalDocumento = toScaledInteger(itensDocumento[0].documentoTotal);
      let alocado = 0n;
      for (const [index, row] of itens.entries()) {
        const receita =
          index === itens.length - 1
            ? totalDocumento - alocado
            : pesoTotal > 0n
              ? (totalDocumento * pesos[index] + pesoTotal / 2n) / pesoTotal
              : 0n;
        alocado += receita;
        const anexo = anexoPorCfop(row.cfop);
        const st = ['5405', '6405'].includes(row.cfop) || row.csosn === '500';
        const monofasico = row.cstPis === '04' || row.cstCofins === '04';
        const segregacao: SimplesSegregacao = st
          ? 'ICMS_ST'
          : monofasico
            ? 'PIS_COFINS_MONOFASICO'
            : 'TRIBUTACAO_INTEGRAL';
        const deducoes = [
          ...(st ? (['ICMS'] as const) : []),
          ...(monofasico ? (['PIS', 'COFINS'] as const) : []),
        ];
        const key = `${anexo}:${deducoes.join('+') || 'INTEGRAL'}`;
        const atual = grupos.get(key) ?? { anexo, segregacao, deducoes: [...deducoes], receita: 0n };
        atual.receita += receita;
        grupos.set(key, atual);
      }
    }
    return {
      grupos: [...grupos.values()].filter((item) => item.receita > 0n),
      pendencias: rows.some((row) => row.indTotal !== '1')
        ? ['Itens com indTot diferente de 1 foram excluídos da receita classificada.']
        : [],
    };
  }

  private async carregarFolha12m(clienteId: string, competencia: string) {
    const rows = await this.database.db
      .select({
        liquido: folhasPagamento.totalLiquido,
        inss: folhasPagamento.totalInss,
        fgts: folhasPagamento.totalFgts,
      })
      .from(folhasPagamento)
      .where(
        and(
          eq(folhasPagamento.clienteId, clienteId),
          sql`to_date('01/' || ${folhasPagamento.competencia}, 'DD/MM/YYYY') >= (${competencia}::date - interval '12 months')`,
          sql`to_date('01/' || ${folhasPagamento.competencia}, 'DD/MM/YYYY') < ${competencia}::date`,
        ),
      );
    return {
      valor: fromScaledInteger(
        rows.reduce(
          (sum, row) =>
            sum +
            toScaledInteger(row.liquido) +
            toScaledInteger(row.inss) +
            toScaledInteger(row.fgts),
          0n,
        ),
      ),
      origem: 'FOLHAS_PAGAMENTO_TOTAL_LIQUIDO_MAIS_INSS_E_FGTS',
    };
  }

  private async carregarSublimite(uf: string | null, ano: string) {
    if (!uf) return { valor: '3600000.00', origem: 'SIMPLES_SUBLIMITE_PADRAO_SEM_UF' };
    const [row] = await this.database.db
      .select({ valor: fiscalSimplesSublimites.valorSublimite })
      .from(fiscalSimplesSublimites)
      .where(
        and(
          eq(fiscalSimplesSublimites.uf, uf),
          eq(fiscalSimplesSublimites.anoVigencia, Number(ano)),
          eq(fiscalSimplesSublimites.ativo, true),
        ),
      )
      .limit(1);
    return row
      ? { valor: row.valor, origem: 'TABELA_SUBLIMITE_UF_ANO' }
      : { valor: '3600000.00', origem: 'SIMPLES_SUBLIMITE_PADRAO' };
  }

  private async carregarAnexosCalculo(tabelaId: string) {
    const rows = await this.database.db
      .select({
        anexo: fiscalSimplesAnexos.anexo,
        faixa: fiscalSimplesFaixas.faixa,
        rbt12De: fiscalSimplesFaixas.rbt12De,
        rbt12Ate: fiscalSimplesFaixas.rbt12Ate,
        aliquotaNominal: fiscalSimplesFaixas.aliquotaNominal,
        parcelaDeduzir: fiscalSimplesFaixas.parcelaDeduzir,
        percentualIrpj: fiscalSimplesFaixas.percentualIrpj,
        percentualCsll: fiscalSimplesFaixas.percentualCsll,
        percentualCofins: fiscalSimplesFaixas.percentualCofins,
        percentualPis: fiscalSimplesFaixas.percentualPis,
        percentualCpp: fiscalSimplesFaixas.percentualCpp,
        percentualIpi: fiscalSimplesFaixas.percentualIpi,
        percentualIcms: fiscalSimplesFaixas.percentualIcms,
        percentualIss: fiscalSimplesFaixas.percentualIss,
      })
      .from(fiscalSimplesAnexos)
      .innerJoin(fiscalSimplesFaixas, eq(fiscalSimplesFaixas.anexoId, fiscalSimplesAnexos.id))
      .where(eq(fiscalSimplesAnexos.tabelaId, tabelaId))
      .orderBy(asc(fiscalSimplesAnexos.anexo), asc(fiscalSimplesFaixas.faixa));
    const result = new Map<SimplesAnexo, SimplesFaixaCalculo[]>();
    for (const row of rows) {
      const anexo = row.anexo as SimplesAnexo;
      const faixas = result.get(anexo) ?? [];
      faixas.push({
        faixa: row.faixa,
        rbt12De: row.rbt12De,
        rbt12Ate: row.rbt12Ate,
        aliquotaNominal: row.aliquotaNominal,
        parcelaDeduzir: row.parcelaDeduzir,
        partilha: {
          irpj: row.percentualIrpj,
          csll: row.percentualCsll,
          cofins: row.percentualCofins,
          pis: row.percentualPis,
          cpp: row.percentualCpp,
          ipi: row.percentualIpi,
          icms: row.percentualIcms,
          iss: row.percentualIss,
        },
      });
      result.set(anexo, faixas);
    }
    return result;
  }

  private async carregarAnexos(tabelaId: string) {
    const anexos = await this.database.db
      .select()
      .from(fiscalSimplesAnexos)
      .where(eq(fiscalSimplesAnexos.tabelaId, tabelaId))
      .orderBy(asc(fiscalSimplesAnexos.anexo));
    return Promise.all(
      anexos.map(async (anexo) => ({
        id: anexo.id,
        anexo: anexo.anexo,
        descricao: anexo.descricao,
        tipo_atividade: anexo.tipoAtividade,
        permite_fator_r: anexo.permiteFatorR,
        recolhe_cpp_no_das: anexo.recolheCppNoDas,
        faixas: await this.database.db.select().from(fiscalSimplesFaixas).where(eq(fiscalSimplesFaixas.anexoId, anexo.id)).orderBy(asc(fiscalSimplesFaixas.faixa)),
      })),
    );
  }

  private async carregarItens(apuracaoId: string) {
    return this.database.db
      .select()
      .from(fiscalSimplesApuracaoItens)
      .where(eq(fiscalSimplesApuracaoItens.apuracaoId, apuracaoId))
      .orderBy(asc(fiscalSimplesApuracaoItens.anexo), asc(fiscalSimplesApuracaoItens.segregacao));
  }

  private async carregarResposta(apuracao: typeof fiscalSimplesApuracoes.$inferSelect) {
    const itens = await this.carregarItens(apuracao.id);
    const sublimite = (apuracao.memoriaCalculo.sublimiteEstadual as string | undefined) ?? '3600000.00';
    return {
      id: apuracao.id,
      cliente_id: apuracao.clienteId,
      tabela_id: apuracao.tabelaId,
      competencia: apuracao.competencia,
      versao: apuracao.versao,
      status: apuracao.status,
      corrente: apuracao.corrente,
      rbt12: apuracao.rbt12,
      rbt12_proporcional: apuracao.rbt12Proporcional,
      receita_bruta_mes: apuracao.receitaBrutaMes,
      folha_salarios_12m: apuracao.folhaSalarios12m,
      fator_r: apuracao.fatorR,
      valor_total_das: apuracao.valorTotalDas,
      excedeu_sublimite: toScaledInteger(apuracao.rbt12) > toScaledInteger(sublimite),
      sublimite_estadual: sublimite,
      fechamento_id: apuracao.fechamentoId,
      guia_id: apuracao.guiaId,
      origens: apuracao.origens,
      memoria_calculo: apuracao.memoriaCalculo,
      itens: itens.map((item) => ({
        anexo: item.anexo,
        faixa_enquadrada: item.faixaEnquadrada,
        aliquota_nominal: item.aliquotaNominal,
        parcela_deduzir: item.parcelaDeduzir,
        aliquota_efetiva: item.aliquotaEfetiva,
        receita_bruta_atividade: item.receitaBrutaAtividade,
        segregacao: item.segregacao,
        aliquota_efetiva_apos_deducoes: item.aliquotaEfetivaAposDeducoes,
        valor_devido: item.valorDevido,
        tributos_partilhados: item.tributosPartilhados,
      })),
    };
  }

  private competencia(value: string) {
    return this.competenciaRange(value).competencia;
  }

  private competenciaRange(value: string) {
    try {
      return parseCompetenciaMensal(value);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Competência inválida.');
    }
  }
}

function toItemResponse(item: SimplesItemCalculoResult) {
  return {
    anexo: item.anexo,
    faixa_enquadrada: item.faixaEnquadrada,
    aliquota_nominal: item.aliquotaNominal,
    parcela_deduzir: item.parcelaDeduzir,
    aliquota_efetiva: item.aliquotaEfetiva,
    receita_bruta_atividade: item.receitaBrutaAtividade,
    segregacao: item.segregacao,
    aliquota_efetiva_apos_deducoes: item.aliquotaEfetivaAposDeducoes,
    valor_devido: item.valorDevido,
    tributos_partilhados: item.tributosPartilhados,
    deducoes: item.deducoes,
  };
}

function anexoPorCfop(cfop: string): SimplesAnexo {
  const operacao = cfop.slice(1);
  if (/^(101|103|105|109|111|116|118|122|124|125)$/.test(operacao)) return 'ANEXO_II';
  if (/^(351|352|353|354|355|356|357|358|359|360)$/.test(operacao)) return 'ANEXO_III';
  return 'ANEXO_I';
}

export function vencimentoDas(competencia: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(competencia);
  if (!match) throw new BadRequestException('Competência inválida.');
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]), 20));
  while (!isDiaUtilBancario(date)) date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function isDiaUtilBancario(date: Date) {
  const day = date.getUTCDay();
  if (day === 0 || day === 6) return false;
  const key = `${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
  return !new Set(['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25']).has(key);
}
