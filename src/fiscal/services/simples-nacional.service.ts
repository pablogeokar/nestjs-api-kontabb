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
  fiscalSimplesHistoricosMensais,
  fiscalSimplesSublimites,
  fiscalSimplesTabelas,
  folhasPagamento,
} from '../../database/schema';
import {
  monthsBetweenCompetencias,
  parseCompetenciaMensal,
} from '../fiscal-date.util';
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
import {
  classificarOperacaoSimples,
  somarReceitaSimples,
  valorReceitaSimples,
} from './simples-receita';
import type {
  SalvarHistoricoSimplesDto,
  SalvarSimplesTabelaDto,
} from '../dto/simples-nacional.dto';

const SIMPLES_MOTOR_VERSAO = 'simples-nacional@4';

interface ReceitaAgrupada {
  anexo: SimplesAnexo;
  segregacao: SimplesSegregacao;
  deducoes: Array<'ICMS' | 'ISS' | 'PIS' | 'COFINS'>;
  receita: bigint;
  issOutroMunicipio: boolean;
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

  async criarTabela(input: SalvarSimplesTabelaDto) {
    return this.salvarTabela(null, input);
  }

  async editarTabela(tabelaId: string, input: SalvarSimplesTabelaDto) {
    return this.salvarTabela(tabelaId, input);
  }

  async listarHistorico(input: {
    clienteId: string;
    competenciaFinal: string;
  }) {
    await this.buscarClienteSimples(input.clienteId);
    const meses = mesesAnteriores(input.competenciaFinal, 12);
    const inicio = `${meses[0]}-01`;
    const fim = `${meses[meses.length - 1]}-01`;
    const [receitas, folhas, manuais] = await Promise.all([
      this.carregarReceitasAutomaticasPeriodo(input.clienteId, inicio, fim),
      this.carregarFolhasAutomaticasPeriodo(input.clienteId, inicio, fim),
      this.database.db
        .select()
        .from(fiscalSimplesHistoricosMensais)
        .where(
          and(
            eq(fiscalSimplesHistoricosMensais.clienteId, input.clienteId),
            sql`${fiscalSimplesHistoricosMensais.competencia} >= ${inicio}`,
            sql`${fiscalSimplesHistoricosMensais.competencia} <= ${fim}`,
          ),
        ),
    ]);
    const receitaPorMes = new Map(
      receitas.map((item) => [item.mes, item.valor]),
    );
    const folhaPorMes = new Map(folhas.map((item) => [item.mes, item.valor]));
    const manualPorMes = new Map(
      manuais.map((item) => [item.competencia.slice(0, 7), item]),
    );
    return meses.map((competencia) => {
      const manual = manualPorMes.get(competencia);
      const receitaAutomatica = receitaPorMes.get(competencia) ?? '0.00';
      const folhaAutomatica = folhaPorMes.get(competencia) ?? '0.00';
      return {
        id: manual?.id ?? null,
        competencia,
        receita_automatica: receitaAutomatica,
        receita_manual: manual?.receitaBruta ?? null,
        receita_efetiva: manual?.receitaBruta ?? receitaAutomatica,
        origem_receita:
          manual?.receitaBruta != null
            ? 'INFORMADO_MANUALMENTE'
            : 'DOCUMENTOS_FISCAIS',
        folha_automatica: folhaAutomatica,
        folha_manual: manual?.folhaSalariosEncargos ?? null,
        folha_efetiva: manual?.folhaSalariosEncargos ?? folhaAutomatica,
        origem_folha:
          manual?.folhaSalariosEncargos != null
            ? 'INFORMADO_MANUALMENTE'
            : 'FOLHAS_PAGAMENTO',
        observacao: manual?.observacao ?? null,
        atualizado_em: manual?.atualizadoEm?.toISOString() ?? null,
      };
    });
  }

  async salvarHistorico(input: SalvarHistoricoSimplesDto, actorUserId: string) {
    await this.buscarClienteSimples(input.clienteId);
    const competencias = new Set<string>();
    for (const item of input.itens) {
      this.competencia(item.competencia);
      if (competencias.has(item.competencia)) {
        throw new BadRequestException(
          `Competência duplicada no histórico: ${item.competencia}.`,
        );
      }
      competencias.add(item.competencia);
    }
    await this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`simples-historico:${input.clienteId}`}, 0))`,
      );
      for (const item of input.itens) {
        if (item.receitaBruta == null && item.folhaSalariosEncargos == null) {
          await tx
            .delete(fiscalSimplesHistoricosMensais)
            .where(
              and(
                eq(fiscalSimplesHistoricosMensais.clienteId, input.clienteId),
                eq(
                  fiscalSimplesHistoricosMensais.competencia,
                  `${item.competencia}-01`,
                ),
              ),
            );
          continue;
        }
        await tx
          .insert(fiscalSimplesHistoricosMensais)
          .values({
            clienteId: input.clienteId,
            competencia: `${item.competencia}-01`,
            receitaBruta: item.receitaBruta ?? null,
            folhaSalariosEncargos: item.folhaSalariosEncargos ?? null,
            observacao: item.observacao?.trim() || null,
            informadoPor: actorUserId,
          })
          .onConflictDoUpdate({
            target: [
              fiscalSimplesHistoricosMensais.clienteId,
              fiscalSimplesHistoricosMensais.competencia,
            ],
            set: {
              receitaBruta: item.receitaBruta ?? null,
              folhaSalariosEncargos: item.folhaSalariosEncargos ?? null,
              observacao: item.observacao?.trim() || null,
              informadoPor: actorUserId,
              atualizadoEm: new Date(),
            },
          });
      }
    });
    const ultimaCompetencia = [...competencias].sort().at(-1)!;
    return this.listarHistorico({
      clienteId: input.clienteId,
      competenciaFinal: proximaCompetencia(ultimaCompetencia),
    });
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
          .set({
            status: 'RETIFICADO',
            corrente: false,
            atualizadoEm: new Date(),
          })
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
    if (input.apuracaoId)
      conditions.push(eq(fiscalSimplesApuracoes.id, input.apuracaoId));
    const [apuracaoInicial] = await this.database.db
      .select()
      .from(fiscalSimplesApuracoes)
      .where(and(...conditions))
      .orderBy(desc(fiscalSimplesApuracoes.versao))
      .limit(1);
    if (!apuracaoInicial)
      throw new NotFoundException(
        'Apuração do Simples Nacional não encontrada.',
      );
    if (apuracaoInicial.status === 'FECHADO')
      return this.carregarResposta(apuracaoInicial);
    if (apuracaoInicial.status !== 'RASCUNHO') {
      throw new ConflictException(
        'Somente uma apuração em rascunho pode ser fechada.',
      );
    }
    if (apuracaoInicial.memoriaCalculo.motorVersao !== SIMPLES_MOTOR_VERSAO) {
      throw new UnprocessableEntityException({
        code: 'APURACAO_SIMPLES_MOTOR_DESATUALIZADO',
        message:
          'Recalcule esta apuração com o motor fiscal atual antes do fechamento.',
      });
    }
    const pendencias = apuracaoInicial.memoriaCalculo.pendencias;
    if (Array.isArray(pendencias) && pendencias.length > 0) {
      throw new UnprocessableEntityException({
        code: 'APURACAO_SIMPLES_COM_PENDENCIAS',
        message:
          'Revise as pendências da memória de cálculo antes de fechar a apuração do Simples Nacional.',
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
          regras: [
            {
              motorVersao: SIMPLES_MOTOR_VERSAO,
              tabelaId: apuracaoInicial.tabelaId,
            },
          ],
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
      fechamento = await this.closingService.transicionar(
        fechamento.id,
        'PENDENTE',
      );
      fechamento = await this.closingService.transicionar(
        fechamento.id,
        'REVISADO',
      );
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
      if (!cliente?.uf)
        throw new UnprocessableEntityException(
          'A UF da empresa é obrigatória para gerar a guia DAS.',
        );
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
        .set({
          corrente: false,
          status: 'RETIFICADO',
          atualizadoEm: new Date(),
        })
        .where(
          and(
            eq(fiscalSimplesApuracoes.clienteId, input.clienteId),
            eq(fiscalSimplesApuracoes.competencia, competenciaDate),
            eq(fiscalSimplesApuracoes.corrente, true),
          ),
        );
      await tx
        .update(fiscalSimplesApuracoes)
        .set({
          status: 'FECHADO',
          corrente: true,
          fechamentoId,
          guiaId,
          atualizadoEm: new Date(),
        })
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
    const {
      competencia: competenciaDate,
      inicio,
      fim,
    } = this.competenciaRange(competencia);
    const [cliente, tabela] = await Promise.all([
      this.buscarClienteSimples(clienteId),
      this.buscarTabelaVigente(competenciaDate),
    ]);
    const [
      receitasMensais,
      primeiraCompetencia,
      receitasAtividade,
      folha,
      sublimite,
      anexos,
      auditoriaReceitas,
      folhaMes,
    ] = await Promise.all([
      this.carregarReceitasMensais(clienteId, competenciaDate),
      this.carregarPrimeiraCompetenciaReceita(clienteId),
      this.carregarReceitasAtividade(clienteId, inicio, fim),
      this.carregarFolha12m(clienteId, competenciaDate),
      this.carregarSublimite(cliente.uf, competencia.slice(0, 4)),
      this.carregarAnexosCalculo(tabela.id),
      this.auditarReceitasPeriodo(
        clienteId,
        `${mesesAnteriores(competencia, 12)[0]}-01`,
        fim.toISOString().slice(0, 10),
        competencia,
      ),
      this.carregarFolhasAutomaticasPeriodo(
        clienteId,
        competenciaDate,
        competenciaDate,
      ),
    ]);
    const receitaMesDocumentos =
      receitasMensais.rows.find((row) => row.mes === competencia)?.receita ??
      '0.00';
    const anteriores = receitasMensais.rows
      .filter((row) => row.mes < competencia)
      .map((row) => row.receita);
    const quantidadeMesesAnteriores = Math.max(
      0,
      monthsBetweenCompetencias(
        primeiraCompetencia ?? competencia,
        competencia,
      ),
    );
    const rbt = this.calculador.calcularRbt12({
      receitasAnteriores: anteriores,
      mesesAnteriores: quantidadeMesesAnteriores,
      receitaPrimeiroMes: receitaMesDocumentos,
    });
    const fatorR = receitasAtividade.grupos.some(
      (grupo) => grupo.anexo === 'ANEXO_V',
    )
      ? this.calculador.calcularFatorR(
          folha.valor,
          rbt.rbt12,
          quantidadeMesesAnteriores === 0
            ? {
                folhaMes: folhaMes[0]?.valor ?? '0.00',
                receitaMes: receitaMesDocumentos,
              }
            : undefined,
        )
      : null;
    const excedeuSublimite =
      toScaledInteger(rbt.rbt12) > toScaledInteger(sublimite.valor);
    const calculados: SimplesItemCalculoResult[] = [];
    for (const receita of receitasAtividade.grupos) {
      const anexo =
        receita.anexo === 'ANEXO_V'
          ? this.calculador.resolverAnexoFatorR(fatorR)
          : receita.anexo;
      const faixas = anexos.get(anexo);
      if (!faixas)
        throw new UnprocessableEntityException(
          `Tabela do ${anexo} não encontrada.`,
        );
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
      calculados.reduce(
        (sum, item) => sum + toScaledInteger(item.valorDevido),
        0n,
      ),
    );
    const receitaClassificada = fromScaledInteger(
      receitasAtividade.grupos.reduce((sum, item) => sum + item.receita, 0n),
    );
    const pendencias = [
      ...receitasAtividade.pendencias,
      ...auditoriaReceitas.pendencias,
    ];
    if (
      toScaledInteger(receitaClassificada) !==
      toScaledInteger(receitaMesDocumentos)
    ) {
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
        rbt12: `${rbt.origem}:${receitasMensais.origem}`,
        receita: 'ITENS_DE_VENDA_E_SERVICO_AUTORIZADOS',
        folha: folha.origem,
        sublimite: sublimite.origem,
        classificacaoAnexo: 'CFOP_CNAE_LC116_FATOR_R',
      },
      memoria_calculo: {
        motorVersao: SIMPLES_MOTOR_VERSAO,
        receitaMesDocumentos,
        receitaClassificada,
        folhaMesPrimeiroPeriodo:
          fatorR !== null && quantidadeMesesAnteriores === 0
            ? (folhaMes[0]?.valor ?? '0.00')
            : null,
        bonificacoesExcluidas: auditoriaReceitas.bonificacoesExcluidas,
        operacoesSemReceitaExcluidas:
          auditoriaReceitas.operacoesSemReceitaExcluidas,
        sublimiteEstadual: sublimite.valor,
        receitaIssOutroMunicipio: fromScaledInteger(
          receitasAtividade.grupos
            .filter((item) => item.issOutroMunicipio)
            .reduce((sum, item) => sum + item.receita, 0n),
        ),
        pendencias,
      },
      itens: calculados.map(toItemResponse),
    };
  }

  private async salvarTabela(
    tabelaId: string | null,
    input: SalvarSimplesTabelaDto,
  ) {
    this.validarPacoteTabela(input);
    const id = await this.database.db.transaction(
      async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended('simples-tabelas-normativas', 0))`,
        );
        if (tabelaId) {
          const [existente] = await tx
            .select({ id: fiscalSimplesTabelas.id })
            .from(fiscalSimplesTabelas)
            .where(eq(fiscalSimplesTabelas.id, tabelaId))
            .limit(1);
          if (!existente)
            throw new NotFoundException(
              'Tabela do Simples Nacional não encontrada.',
            );
          const [uso] = await tx
            .select({ total: sql<number>`count(*)` })
            .from(fiscalSimplesApuracoes)
            .where(eq(fiscalSimplesApuracoes.tabelaId, tabelaId));
          if (Number(uso?.total ?? 0) > 0) {
            throw new ConflictException({
              code: 'TABELA_SIMPLES_IMUTAVEL',
              message:
                'Esta versão já foi usada em apurações e não pode ser alterada. Cadastre uma nova versão com outra vigência.',
            });
          }
        }
        const sobreposta = await tx
          .select({ id: fiscalSimplesTabelas.id })
          .from(fiscalSimplesTabelas)
          .where(
            and(
              eq(fiscalSimplesTabelas.ativo, true),
              ...(tabelaId
                ? [sql`${fiscalSimplesTabelas.id} <> ${tabelaId}`]
                : []),
              sql`${fiscalSimplesTabelas.vigenciaInicio} <= coalesce(${input.vigenciaFim ?? null}::date, 'infinity'::date)`,
              sql`coalesce(${fiscalSimplesTabelas.vigenciaFim}, 'infinity'::date) >= ${input.vigenciaInicio}::date`,
            ),
          )
          .limit(1);
        if (input.ativo && sobreposta.length > 0) {
          throw new ConflictException({
            code: 'VIGENCIA_SIMPLES_SOBREPOSTA',
            message:
              'Já existe uma tabela ativa com vigência sobreposta ao período informado.',
          });
        }

        let savedId = tabelaId;
        if (tabelaId) {
          await tx
            .update(fiscalSimplesTabelas)
            .set({
              versao: input.versao,
              descricao: input.descricao,
              vigenciaInicio: input.vigenciaInicio,
              vigenciaFim: input.vigenciaFim ?? null,
              ativo: input.ativo,
            })
            .where(eq(fiscalSimplesTabelas.id, tabelaId));
          await tx
            .delete(fiscalSimplesAnexos)
            .where(eq(fiscalSimplesAnexos.tabelaId, tabelaId));
        } else {
          const [created] = await tx
            .insert(fiscalSimplesTabelas)
            .values({
              versao: input.versao,
              descricao: input.descricao,
              vigenciaInicio: input.vigenciaInicio,
              vigenciaFim: input.vigenciaFim ?? null,
              ativo: input.ativo,
            })
            .returning({ id: fiscalSimplesTabelas.id });
          savedId = created.id;
        }
        for (const anexo of input.anexos) {
          const [createdAnexo] = await tx
            .insert(fiscalSimplesAnexos)
            .values({
              tabelaId: savedId!,
              anexo: anexo.anexo,
              descricao: anexo.descricao,
              tipoAtividade: anexo.tipoAtividade,
              permiteFatorR: anexo.permiteFatorR,
              recolheCppNoDas: anexo.recolheCppNoDas,
            })
            .returning({ id: fiscalSimplesAnexos.id });
          await tx.insert(fiscalSimplesFaixas).values(
            anexo.faixas.map((faixa) => ({
              anexoId: createdAnexo.id,
              ...faixa,
            })),
          );
        }
        return savedId!;
      },
      { isolationLevel: 'serializable' },
    );
    const tabelas = await this.listarTabelas();
    return tabelas.find((tabela) => tabela.id === id)!;
  }

  private validarPacoteTabela(input: SalvarSimplesTabelaDto) {
    if (input.vigenciaFim && input.vigenciaFim < input.vigenciaInicio) {
      throw new BadRequestException(
        'O fim da vigência não pode ser anterior ao início.',
      );
    }
    const anexos = new Set(input.anexos.map((item) => item.anexo));
    if (anexos.size !== 5 || input.anexos.length !== 5) {
      throw new BadRequestException(
        'A versão normativa deve conter uma vez cada Anexo I a V.',
      );
    }
    for (const anexo of input.anexos) {
      const faixas = new Set(anexo.faixas.map((item) => item.faixa));
      if (faixas.size !== 6 || anexo.faixas.length !== 6) {
        throw new BadRequestException(
          `${anexo.anexo} deve conter exatamente as faixas 1 a 6.`,
        );
      }
      for (const faixa of anexo.faixas) {
        const soma = [
          faixa.percentualIrpj,
          faixa.percentualCsll,
          faixa.percentualCofins,
          faixa.percentualPis,
          faixa.percentualCpp,
          faixa.percentualIpi,
          faixa.percentualIcms,
          faixa.percentualIss,
        ].reduce((total, valor) => total + toScaledInteger(valor, 4), 0n);
        if (soma !== 10_000n) {
          throw new BadRequestException(
            `${anexo.anexo}, faixa ${faixa.faixa}: a partilha deve somar 100%.`,
          );
        }
      }
    }
  }

  private async buscarClienteSimples(clienteId: string) {
    const [cliente] = await this.database.db
      .select({
        id: clientes.id,
        regimeTributario: clientes.regimeTributario,
        uf: clientes.uf,
      })
      .from(clientes)
      .where(eq(clientes.id, clienteId))
      .limit(1);
    if (!cliente) throw new NotFoundException('Empresa não encontrada.');
    if (cliente.regimeTributario !== 'SIMPLES_NACIONAL') {
      throw new UnprocessableEntityException({
        code: 'EMPRESA_FORA_SIMPLES_NACIONAL',
        message:
          'A empresa selecionada não está enquadrada no Simples Nacional.',
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
        message:
          'Não existe tabela do Simples Nacional vigente. Execute o seed normativo.',
      });
    }
    return tabela;
  }

  private async carregarReceitasMensais(
    clienteId: string,
    competencia: string,
  ) {
    const inicio = `${mesesAnteriores(competencia.slice(0, 7), 12)[0]}-01`;
    const automaticas = await this.carregarReceitasAutomaticasPeriodo(
      clienteId,
      inicio,
      competencia,
    );
    const manuais = await this.database.db
      .select({
        mes: sql<string>`to_char(${fiscalSimplesHistoricosMensais.competencia}, 'YYYY-MM')`,
        receita: fiscalSimplesHistoricosMensais.receitaBruta,
      })
      .from(fiscalSimplesHistoricosMensais)
      .where(
        and(
          eq(fiscalSimplesHistoricosMensais.clienteId, clienteId),
          sql`${fiscalSimplesHistoricosMensais.competencia} >= (${competencia}::date - interval '12 months')`,
          sql`${fiscalSimplesHistoricosMensais.competencia} < ${competencia}::date`,
          sql`${fiscalSimplesHistoricosMensais.receitaBruta} IS NOT NULL`,
        ),
      );
    const porMes = new Map(automaticas.map((row) => [row.mes, row.valor]));
    for (const manual of manuais) {
      if (manual.receita != null) porMes.set(manual.mes, manual.receita);
    }
    return {
      rows: [...porMes.entries()]
        .map(([mes, receita]) => ({ mes, receita }))
        .sort((a, b) => a.mes.localeCompare(b.mes)),
      origem:
        manuais.length > 0
          ? 'HISTORICO_MANUAL_COM_SOBRESCRITA_POR_COMPETENCIA'
          : 'DOCUMENTOS_FISCAIS',
    };
  }

  private async carregarPrimeiraCompetenciaReceita(clienteId: string) {
    const [documento, manual] = await Promise.all([
      this.database.db
        .select({
          mes: sql<
            string | null
          >`to_char(min(coalesce(${documentosFiscais.competenciaDeclarada}, ${documentosFiscais.dataEmissaoFiscal}, ${documentosFiscais.dataEmissao}::date)), 'YYYY-MM')`,
        })
        .from(documentosFiscaisItens)
        .innerJoin(
          documentosFiscais,
          eq(documentosFiscais.id, documentosFiscaisItens.documentoFiscalId),
        )
        .where(
          and(
            eq(documentosFiscais.clienteId, clienteId),
            eq(documentosFiscais.tipoOperacaoEscriturada, 'SAIDA'),
            eq(documentosFiscais.situacao, 'AUTORIZADA'),
            eq(documentosFiscaisItens.indTotal, '1'),
            sql`(${documentosFiscais.tipoDocumento} = 'NFSE' OR coalesce(${documentosFiscaisItens.cfopXml}, ${documentosFiscaisItens.cfop}) ~ '^[567](10[1-9]|11[0-9]|12[0-5]|35[1-9]|360|40[1-5]|65[1-6])$')`,
          ),
        ),
      this.database.db
        .select({
          mes: sql<
            string | null
          >`to_char(min(${fiscalSimplesHistoricosMensais.competencia}), 'YYYY-MM')`,
        })
        .from(fiscalSimplesHistoricosMensais)
        .where(
          and(
            eq(fiscalSimplesHistoricosMensais.clienteId, clienteId),
            sql`${fiscalSimplesHistoricosMensais.receitaBruta} IS NOT NULL`,
          ),
        ),
    ]);
    return (
      [documento[0]?.mes, manual[0]?.mes]
        .filter((value): value is string => Boolean(value))
        .sort()[0] ?? null
    );
  }

  private async carregarReceitasAtividade(
    clienteId: string,
    inicio: Date,
    fim: Date,
  ) {
    const rows = await this.carregarItensReceitaPeriodo(
      clienteId,
      inicio.toISOString().slice(0, 10),
      fim.toISOString().slice(0, 10),
    );
    const grupos = new Map<string, ReceitaAgrupada>();
    const pendencias = new Set<string>();
    for (const row of rows) {
      if (row.indTotal !== '1') continue;
      const cfop = row.cfopXml ?? row.cfop;
      const classificacao = classificarOperacaoSimples(row.tipoDocumento, cfop);
      if (classificacao === 'NAO_RECEITA') continue;
      if (classificacao === 'REVISAR') {
        pendencias.add(
          `CFOP ${cfop ?? 'ausente'} sem classificação segura no Simples. Revise a operação antes de fechar.`,
        );
        continue;
      }
      const receita = valorReceitaSimples(row);
      if (receita < 0n) {
        pendencias.add(
          `Item com valor líquido negativo na nota ${row.numeroDocumento}. Revise os descontos.`,
        );
        continue;
      }
      if (receita === 0n) continue;
      const anexo =
        row.tipoDocumento === 'NFSE'
          ? anexoPorServico(row.itemListaServico, row.cnae)
          : anexoPorCfop(cfop);
      const st = ['5405', '6405'].includes(cfop) || row.csosn === '500';
      const monofasico = row.cstPis === '04' || row.cstCofins === '04';
      const segregacao: SimplesSegregacao = row.issRetido
        ? 'ISS_RETIDO'
        : st
          ? 'ICMS_ST'
          : monofasico
            ? 'PIS_COFINS_MONOFASICO'
            : 'TRIBUTACAO_INTEGRAL';
      const deducoes = [
        ...(row.issRetido ? (['ISS'] as const) : []),
        ...(st ? (['ICMS'] as const) : []),
        ...(monofasico ? (['PIS', 'COFINS'] as const) : []),
      ];
      const issOutroMunicipio = Boolean(
        row.tipoDocumento === 'NFSE' &&
        row.municipioIncidencia &&
        row.municipioPrestador &&
        row.municipioIncidencia !== row.municipioPrestador,
      );
      const key = `${anexo}:${segregacao}:${issOutroMunicipio ? 'OUTRO_MUNICIPIO' : 'LOCAL'}:${deducoes.join('+') || 'INTEGRAL'}`;
      const atual = grupos.get(key) ?? {
        anexo,
        segregacao,
        deducoes: [...deducoes],
        receita: 0n,
        issOutroMunicipio,
      };
      atual.receita += receita;
      grupos.set(key, atual);
    }
    return { grupos: [...grupos.values()], pendencias: [...pendencias] };
  }

  private async carregarItensReceitaPeriodo(
    clienteId: string,
    inicio: string,
    fim: string,
  ) {
    return this.database.db
      .select({
        documentoId: documentosFiscais.id,
        numeroDocumento: documentosFiscais.numeroDocumento,
        mes: sql<string>`to_char(coalesce(${documentosFiscais.competenciaDeclarada}, ${documentosFiscais.dataEmissaoFiscal}, ${documentosFiscais.dataEmissao}::date), 'YYYY-MM')`,
        documentoTotal: documentosFiscais.valorTotal,
        tipoDocumento: documentosFiscais.tipoDocumento,
        municipioPrestador: sql<
          string | null
        >`NULLIF(${documentosFiscais.emitenteDados} ->> 'codMun', '')`,
        cfop: documentosFiscaisItens.cfop,
        cfopXml: documentosFiscaisItens.cfopXml,
        itemListaServico: documentosFiscaisItens.itemListaServico,
        cnae: documentosFiscaisItens.cnae,
        issRetido: documentosFiscaisItens.issRetido,
        municipioIncidencia: documentosFiscaisItens.municipioIncidencia,
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
      .innerJoin(
        documentosFiscais,
        eq(documentosFiscais.id, documentosFiscaisItens.documentoFiscalId),
      )
      .where(
        and(
          eq(documentosFiscaisItens.clienteId, clienteId),
          eq(documentosFiscaisItens.tipoOperacaoEscriturada, 'SAIDA'),
          eq(documentosFiscais.tipoOperacaoEscriturada, 'SAIDA'),
          eq(documentosFiscais.situacao, 'AUTORIZADA'),
          sql`coalesce(${documentosFiscais.competenciaDeclarada}, ${documentosFiscais.dataEmissaoFiscal}, ${documentosFiscais.dataEmissao}::date) >= ${inicio}::date`,
          sql`coalesce(${documentosFiscais.competenciaDeclarada}, ${documentosFiscais.dataEmissaoFiscal}, ${documentosFiscais.dataEmissao}::date) <= ${fim}::date`,
        ),
      );
  }

  private async auditarReceitasPeriodo(
    clienteId: string,
    inicio: string,
    fim: string,
    competencia: string,
  ) {
    const [documentos, itens, historicosManuais] = await Promise.all([
      this.database.db
        .select({
          id: documentosFiscais.id,
          numero: documentosFiscais.numeroDocumento,
          mes: sql<string>`to_char(coalesce(${documentosFiscais.competenciaDeclarada}, ${documentosFiscais.dataEmissaoFiscal}, ${documentosFiscais.dataEmissao}::date), 'YYYY-MM')`,
          total: documentosFiscais.valorTotal,
        })
        .from(documentosFiscais)
        .where(
          and(
            eq(documentosFiscais.clienteId, clienteId),
            eq(documentosFiscais.tipoOperacaoEscriturada, 'SAIDA'),
            eq(documentosFiscais.situacao, 'AUTORIZADA'),
            sql`coalesce(${documentosFiscais.competenciaDeclarada}, ${documentosFiscais.dataEmissaoFiscal}, ${documentosFiscais.dataEmissao}::date) >= ${inicio}::date`,
            sql`coalesce(${documentosFiscais.competenciaDeclarada}, ${documentosFiscais.dataEmissaoFiscal}, ${documentosFiscais.dataEmissao}::date) <= ${fim}::date`,
          ),
        ),
      this.carregarItensReceitaPeriodo(clienteId, inicio, fim),
      this.database.db
        .select({
          mes: sql<string>`to_char(${fiscalSimplesHistoricosMensais.competencia}, 'YYYY-MM')`,
        })
        .from(fiscalSimplesHistoricosMensais)
        .where(
          and(
            eq(fiscalSimplesHistoricosMensais.clienteId, clienteId),
            sql`${fiscalSimplesHistoricosMensais.competencia} >= ${inicio}::date`,
            sql`${fiscalSimplesHistoricosMensais.competencia} <= ${fim}::date`,
            sql`${fiscalSimplesHistoricosMensais.receitaBruta} IS NOT NULL`,
          ),
        ),
    ]);
    const mesesComReceitaManual = new Set(
      historicosManuais.map((row) => row.mes),
    );
    const porDocumento = new Map<string, typeof itens>();
    for (const item of itens) {
      const grupo = porDocumento.get(item.documentoId) ?? [];
      grupo.push(item);
      porDocumento.set(item.documentoId, grupo);
    }
    const pendencias: string[] = [];
    let bonificacoes = 0n;
    let demais = 0n;
    for (const documento of documentos) {
      if (
        documento.mes !== competencia &&
        mesesComReceitaManual.has(documento.mes)
      )
        continue;
      const linhas = porDocumento.get(documento.id) ?? [];
      if (linhas.length === 0) {
        pendencias.push(
          `Nota ${documento.numero} (${documento.mes}) sem itens fiscais para avaliar a receita.`,
        );
        continue;
      }
      let totalElegivel = 0n;
      let somenteReceita = true;
      for (const linha of linhas) {
        if (linha.indTotal !== '1') {
          somenteReceita = false;
          continue;
        }
        const cfop = linha.cfopXml ?? linha.cfop;
        const classificacao = classificarOperacaoSimples(
          linha.tipoDocumento,
          cfop,
        );
        const valor = valorReceitaSimples(linha);
        if (
          classificacao === 'REVISAR' ||
          (classificacao === 'RECEITA' && valor < 0n)
        ) {
          pendencias.push(
            `Nota ${documento.numero} (${documento.mes}): CFOP ${cfop ?? 'ausente'} ou valor líquido requer conferência.`,
          );
          somenteReceita = false;
        } else if (classificacao === 'RECEITA') {
          totalElegivel += valor;
        } else {
          somenteReceita = false;
          if (documento.mes === competencia && valor > 0n) {
            if (/^[567]91[01]$/.test(cfop)) bonificacoes += valor;
            else demais += valor;
          }
        }
      }
      if (
        somenteReceita &&
        totalElegivel !== toScaledInteger(documento.total)
      ) {
        pendencias.push(
          `Nota ${documento.numero} (${documento.mes}): itens de receita (${fromScaledInteger(totalElegivel)}) divergem do total da nota (${documento.total}). Confira tributos e parcelas antes de fechar.`,
        );
      }
    }
    const pendenciasUnicas = [...new Set(pendencias)];
    return {
      pendencias:
        pendenciasUnicas.length > 20
          ? [
              ...pendenciasUnicas.slice(0, 20),
              `Há mais ${pendenciasUnicas.length - 20} pendências documentais. Revise o histórico fiscal.`,
            ]
          : pendenciasUnicas,
      bonificacoesExcluidas: fromScaledInteger(bonificacoes),
      operacoesSemReceitaExcluidas: fromScaledInteger(demais),
    };
  }

  private async carregarFolha12m(clienteId: string, competencia: string) {
    const meses = mesesAnteriores(competencia.slice(0, 7), 12);
    const inicio = `${meses[0]}-01`;
    const fim = `${meses[meses.length - 1]}-01`;
    const [automaticas, manuais] = await Promise.all([
      this.carregarFolhasAutomaticasPeriodo(clienteId, inicio, fim),
      this.database.db
        .select({
          mes: sql<string>`to_char(${fiscalSimplesHistoricosMensais.competencia}, 'YYYY-MM')`,
          valor: fiscalSimplesHistoricosMensais.folhaSalariosEncargos,
        })
        .from(fiscalSimplesHistoricosMensais)
        .where(
          and(
            eq(fiscalSimplesHistoricosMensais.clienteId, clienteId),
            sql`${fiscalSimplesHistoricosMensais.competencia} >= ${inicio}`,
            sql`${fiscalSimplesHistoricosMensais.competencia} <= ${fim}`,
            sql`${fiscalSimplesHistoricosMensais.folhaSalariosEncargos} IS NOT NULL`,
          ),
        ),
    ]);
    const porMes = new Map(automaticas.map((row) => [row.mes, row.valor]));
    for (const manual of manuais) {
      if (manual.valor != null) porMes.set(manual.mes, manual.valor);
    }
    return {
      valor: fromScaledInteger(
        [...porMes.values()].reduce(
          (sum, valor) => sum + toScaledInteger(valor),
          0n,
        ),
      ),
      origem:
        manuais.length > 0
          ? 'HISTORICO_MANUAL_COM_SOBRESCRITA_POR_COMPETENCIA'
          : 'FOLHAS_PAGAMENTO_TOTAL_BRUTO_MAIS_FGTS',
    };
  }

  private async carregarReceitasAutomaticasPeriodo(
    clienteId: string,
    inicio: string,
    fim: string,
  ) {
    const ultimoDia = new Date(`${fim.slice(0, 7)}-01T00:00:00.000Z`);
    ultimoDia.setUTCMonth(ultimoDia.getUTCMonth() + 1);
    ultimoDia.setUTCDate(0);
    const rows = await this.carregarItensReceitaPeriodo(
      clienteId,
      inicio,
      ultimoDia.toISOString().slice(0, 10),
    );
    const porMes = new Map<string, bigint[]>();
    for (const row of rows) {
      if (row.indTotal !== '1') continue;
      if (
        classificarOperacaoSimples(
          row.tipoDocumento,
          row.cfopXml ?? row.cfop,
        ) !== 'RECEITA'
      )
        continue;
      const valor = valorReceitaSimples(row);
      if (valor < 0n) continue;
      const valores = porMes.get(row.mes) ?? [];
      valores.push(valor);
      porMes.set(row.mes, valores);
    }
    return [...porMes.entries()].map(([mes, valores]) => ({
      mes,
      valor: somarReceitaSimples(valores),
    }));
  }

  private async carregarFolhasAutomaticasPeriodo(
    clienteId: string,
    inicio: string,
    fim: string,
  ) {
    return this.database.db
      .select({
        mes: sql<string>`to_char(to_date('01/' || ${folhasPagamento.competencia}, 'DD/MM/YYYY'), 'YYYY-MM')`,
        valor: sql<string>`coalesce(sum(${folhasPagamento.totalBruto} + ${folhasPagamento.totalFgts}), 0)::text`,
      })
      .from(folhasPagamento)
      .where(
        and(
          eq(folhasPagamento.clienteId, clienteId),
          sql`to_date('01/' || ${folhasPagamento.competencia}, 'DD/MM/YYYY') >= ${inicio}`,
          sql`to_date('01/' || ${folhasPagamento.competencia}, 'DD/MM/YYYY') <= ${fim}`,
        ),
      )
      .groupBy(
        sql`to_date('01/' || ${folhasPagamento.competencia}, 'DD/MM/YYYY')`,
      );
  }

  private async carregarSublimite(uf: string | null, ano: string) {
    if (!uf)
      return { valor: '3600000.00', origem: 'SIMPLES_SUBLIMITE_PADRAO_SEM_UF' };
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
      .innerJoin(
        fiscalSimplesFaixas,
        eq(fiscalSimplesFaixas.anexoId, fiscalSimplesAnexos.id),
      )
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
        faixas: await this.database.db
          .select()
          .from(fiscalSimplesFaixas)
          .where(eq(fiscalSimplesFaixas.anexoId, anexo.id))
          .orderBy(asc(fiscalSimplesFaixas.faixa)),
      })),
    );
  }

  private async carregarItens(apuracaoId: string) {
    return this.database.db
      .select()
      .from(fiscalSimplesApuracaoItens)
      .where(eq(fiscalSimplesApuracaoItens.apuracaoId, apuracaoId))
      .orderBy(
        asc(fiscalSimplesApuracaoItens.anexo),
        asc(fiscalSimplesApuracaoItens.segregacao),
      );
  }

  private async carregarResposta(
    apuracao: typeof fiscalSimplesApuracoes.$inferSelect,
  ) {
    const itens = await this.carregarItens(apuracao.id);
    const sublimite =
      (apuracao.memoriaCalculo.sublimiteEstadual as string | undefined) ??
      '3600000.00';
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
      excedeu_sublimite:
        toScaledInteger(apuracao.rbt12) > toScaledInteger(sublimite),
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
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Competência inválida.',
      );
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

export function anexoPorCfop(cfop: string): SimplesAnexo {
  const operacao = cfop.slice(1);
  if (/^(101|103|105|109|111|116|118|122|124|125)$/.test(operacao))
    return 'ANEXO_II';
  if (/^(351|352|353|354|355|356|357|358|359|360)$/.test(operacao))
    return 'ANEXO_III';
  return 'ANEXO_I';
}

/**
 * Classificação de serviços municipais para o Simples. O Anexo V é usado
 * como marcador das atividades sujeitas ao Fator R e é resolvido para III/V
 * depois que a folha e a RBT12 da competência estiverem disponíveis.
 */
export function anexoPorServico(
  itemListaServico: string | null,
  cnae: string | null,
): SimplesAnexo {
  const item = (itemListaServico ?? '').replace(/\D/g, '').padStart(4, '0');
  const atividade = (cnae ?? '').replace(/\D/g, '');

  const itensAnexoIv = new Set([
    '0702',
    '0704',
    '0705',
    '0710',
    '1102',
    '1714',
  ]);
  if (
    itensAnexoIv.has(item) ||
    /^(41|42|43|69117|8011|8012|8020|8111|8121|8122|8129)/.test(atividade)
  ) {
    return 'ANEXO_IV';
  }

  const itensFatorR = new Set([
    '0101',
    '0102',
    '0103',
    '0104',
    '0105',
    '0106',
    '0107',
    '0108',
    '0401',
    '0402',
    '0403',
    '0404',
    '0405',
    '0406',
    '0407',
    '0408',
    '0409',
    '0410',
    '0411',
    '0412',
    '0413',
    '0414',
    '0415',
    '0416',
    '0417',
    '0418',
    '0419',
    '0420',
    '0501',
    '0701',
    '1701',
    '1702',
    '1703',
  ]);
  if (
    itensFatorR.has(item) ||
    /^(62|63|69|70|71|72|73|74|75|85|86|87|88)/.test(atividade)
  ) {
    return 'ANEXO_V';
  }
  return 'ANEXO_III';
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
  return !new Set([
    '01-01',
    '04-21',
    '05-01',
    '09-07',
    '10-12',
    '11-02',
    '11-15',
    '11-20',
    '12-25',
  ]).has(key);
}

export function mesesAnteriores(
  competencia: string,
  quantidade: number,
): string[] {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(competencia);
  if (!match) throw new BadRequestException('Competência inválida.');
  const indiceBase = Number(match[1]) * 12 + Number(match[2]) - 1;
  return Array.from({ length: quantidade }, (_, index) => {
    const indice = indiceBase - quantidade + index;
    const ano = Math.floor(indice / 12);
    const mes = (indice % 12) + 1;
    return `${ano}-${String(mes).padStart(2, '0')}`;
  });
}

export function proximaCompetencia(competencia: string): string {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(competencia);
  if (!match) throw new BadRequestException('Competência inválida.');
  const indice = Number(match[1]) * 12 + Number(match[2]);
  return `${Math.floor(indice / 12)}-${String((indice % 12) + 1).padStart(2, '0')}`;
}
