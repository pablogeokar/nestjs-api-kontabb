import { Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service';
import {
  ciapApropriacoes,
  ciapAtivoPermanente,
  clientes,
  documentosFiscaisCteEscrituracao,
  documentosFiscaisItens,
  fiscalDecisoesItem,
  fiscalEntregas,
  fiscalFechamentos,
} from '../../database/schema';
import {
  montarInventarioRollout,
  type RolloutInventario,
  type RolloutInventarioFatos,
} from './rollout-inventario';

/**
 * CSTs de PIS/COFINS que representam receita TRIBUTADA (gera débito): 01
 * (alíquota básica) e 02 (alíquota diferenciada). Mesma classificação de
 * `pis-cofins.service.ts` — a fonte da definição de operação mista.
 */
const CST_PIS_TRIBUTADO: readonly string[] = ['01', '02'];
/**
 * CSTs de PIS/COFINS SEM débito próprio: 04 monofásico, 05 ST, 06 alíquota
 * zero, 07 isenta, 08 sem incidência, 09 suspensão. A coexistência com um CST
 * tributado no mesmo escopo é o que caracteriza a operação MISTA.
 */
const CST_PIS_SEM_DEBITO: readonly string[] = [
  '04',
  '05',
  '06',
  '07',
  '08',
  '09',
];

/**
 * INVENTÁRIO DE ROLLOUT READ-ONLY (Fase 5, tarefa 5.1 — R5.2).
 *
 * Serviço ESTRITAMENTE READ-ONLY que MONTA e APRESENTA o retrato exigido pelo
 * design (§Rollout §13) ANTES de ativar correções fiscais: versões entregues,
 * competências abertas e operações afetadas (CIAP, CT-e de saída, créditos
 * vedados, PIS misto). Não cria esquema novo nem escreve nada — todas as leituras
 * são `select` (nunca `insert`/`update`/`delete`), para que o inventário seja
 * uma fotografia inócua do estado atual, inclusive sob rollout.
 *
 * Espelha o padrão de `OnboardingMatrizService`/`FiscalBooksProjectionService`:
 * o serviço CARREGA os fatos do banco (com agregações no SQL, evitando N+1) e
 * delega a montagem ao núcleo PURO `montarInventarioRollout`, que apenas
 * classifica/agrega. A derivação fica testável sem banco e determinística.
 *
 * O inventário NÃO decide ativar correções nem o status "homologado" (isso é a
 * tarefa 5.2) e NÃO retifica/reconstrói nada (tarefas 5.3/5.4): apenas inventaria.
 */
@Injectable()
export class RolloutInventarioService {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Monta o inventário de rollout do estabelecimento (`clienteId`). Lança 404
   * quando o estabelecimento não existe. É read-only: nenhuma linha é alterada.
   */
  async inventariar(input: { clienteId: string }): Promise<RolloutInventario> {
    await this.assertCliente(input.clienteId);

    const [entregas, fechamentos, operacoes] = await Promise.all([
      this.carregarEntregas(input.clienteId),
      this.carregarFechamentos(input.clienteId),
      this.agregarOperacoes(input.clienteId),
    ]);

    const fatos: RolloutInventarioFatos = {
      clienteId: input.clienteId,
      geradoEm: new Date().toISOString(),
      entregas,
      fechamentos,
      operacoes,
    };

    return montarInventarioRollout(fatos);
  }

  /**
   * Garante que o estabelecimento existe (escopo por cliente verificado pelo
   * chamador). Leitura mínima; inexistente é 404 (nunca cria nada).
   */
  private async assertCliente(clienteId: string): Promise<void> {
    const rows = await this.database.db
      .select({ id: clientes.id })
      .from(clientes)
      .where(eq(clientes.id, clienteId))
      .limit(1);
    if (!rows[0]) throw new NotFoundException('Empresa não encontrada.');
  }

  /**
   * EIXO 1 — carrega as ENTREGAS do estabelecimento (`fiscal_entregas`), sem
   * recorte de competência: o inventário retrata TODAS as entregas já
   * registradas. A competência (coluna `date`) é normalizada para 'YYYY-MM'; o
   * sinal de retificação vem de `entrega_original_id` não nulo.
   */
  private async carregarEntregas(
    clienteId: string,
  ): Promise<RolloutInventarioFatos['entregas']> {
    const rows = await this.database.db
      .select({
        id: fiscalEntregas.id,
        obrigacao: fiscalEntregas.obrigacao,
        competencia: fiscalEntregas.competencia,
        statusValidacao: fiscalEntregas.statusValidacao,
        entregaOriginalId: fiscalEntregas.entregaOriginalId,
        protocoloNumero: fiscalEntregas.protocoloNumero,
        transmitidaEm: fiscalEntregas.transmitidaEm,
      })
      .from(fiscalEntregas)
      .where(eq(fiscalEntregas.clienteId, clienteId));

    return rows.map((r) => ({
      id: r.id,
      obrigacao: r.obrigacao,
      competencia: competenciaMensal(r.competencia),
      statusValidacao: r.statusValidacao,
      ehRetificacao: r.entregaOriginalId != null,
      protocoloNumero: r.protocoloNumero ?? null,
      transmitidaEm: r.transmitidaEm ? r.transmitidaEm.toISOString() : null,
    }));
  }

  /**
   * EIXO 2 — carrega os FECHAMENTOS do estabelecimento (`fiscal_fechamentos`).
   * O núcleo puro decide quais competências estão ABERTAS (sem versão corrente
   * fechada); aqui apenas trazemos versão/estado/corrente por competência.
   */
  private async carregarFechamentos(
    clienteId: string,
  ): Promise<RolloutInventarioFatos['fechamentos']> {
    const rows = await this.database.db
      .select({
        obrigacao: fiscalFechamentos.obrigacao,
        competencia: fiscalFechamentos.competencia,
        versao: fiscalFechamentos.versao,
        estado: fiscalFechamentos.estado,
        corrente: fiscalFechamentos.corrente,
      })
      .from(fiscalFechamentos)
      .where(eq(fiscalFechamentos.clienteId, clienteId));

    return rows.map((r) => ({
      obrigacao: r.obrigacao,
      competencia: competenciaMensal(r.competencia),
      versao: r.versao,
      estado: r.estado,
      corrente: r.corrente,
    }));
  }

  /**
   * EIXO 3 — agrega os sinais das OPERAÇÕES AFETADAS numa varredura por fonte
   * (sem N+1 e sem carregar linha a linha): CIAP (bens ativos, saneamento
   * pendente, apropriações com parcela vedada), CT-e escriturado como SAÍDA,
   * créditos de ICMS vedados por decisão de item e os lados tributado/sem
   * débito de PIS/COFINS (que o núcleo puro combina em "misto").
   */
  private async agregarOperacoes(
    clienteId: string,
  ): Promise<RolloutInventarioFatos['operacoes']> {
    const [ciap, ciapVedada, cteSaida, creditoVedado, pis] = await Promise.all([
      this.agregarCiapBens(clienteId),
      this.contar(
        ciapApropriacoes,
        and(
          eq(ciapApropriacoes.clienteId, clienteId),
          sql`${ciapApropriacoes.parcelaVedada} > 0`,
        ),
      ),
      this.contar(
        documentosFiscaisCteEscrituracao,
        and(
          eq(documentosFiscaisCteEscrituracao.clienteId, clienteId),
          eq(documentosFiscaisCteEscrituracao.tipoOperacaoEscriturada, 'SAIDA'),
        ),
      ),
      this.contar(
        fiscalDecisoesItem,
        and(
          eq(fiscalDecisoesItem.clienteId, clienteId),
          eq(fiscalDecisoesItem.decisao, 'VEDADO'),
        ),
      ),
      this.agregarPis(clienteId),
    ]);

    return {
      ciapBensAtivos: ciap.ativos,
      ciapSaneamentoPendente: ciap.saneamento,
      ciapApropriacoesComParcelaVedada: ciapVedada,
      cteSaidaEscriturado: cteSaida,
      creditosIcmsVedados: creditoVedado,
      pisItensTributados: pis.tributados,
      pisItensSemDebito: pis.semDebito,
    };
  }

  /**
   * Agrega os bens de CIAP numa só varredura: quantos estão ATIVO e quantos
   * estão marcados para saneamento assistido (R5.4 — não reconstruir por
   * contador; apenas inventariar que existem).
   */
  private async agregarCiapBens(
    clienteId: string,
  ): Promise<{ ativos: number; saneamento: number }> {
    const rows = await this.database.db
      .select({
        ativos: contarSe(sql`${ciapAtivoPermanente.status} = 'ATIVO'`),
        saneamento: contarSe(
          sql`${ciapAtivoPermanente.saneamentoPendente} = true`,
        ),
      })
      .from(ciapAtivoPermanente)
      .where(eq(ciapAtivoPermanente.clienteId, clienteId));
    const row = rows[0];
    return {
      ativos: row?.ativos ?? 0,
      saneamento: row?.saneamento ?? 0,
    };
  }

  /**
   * Agrega os lados de PIS/COFINS numa só varredura dos itens do estabelecimento:
   * itens com CST (PIS ou COFINS) TRIBUTADO (01/02) e itens com CST SEM DÉBITO
   * (04..09). O núcleo puro marca "misto" quando ambos coexistem.
   */
  private async agregarPis(
    clienteId: string,
  ): Promise<{ tributados: number; semDebito: number }> {
    const rows = await this.database.db
      .select({
        tributados: contarSe(
          sql`${documentosFiscaisItens.cstPis} in ${CST_PIS_TRIBUTADO} or ${documentosFiscaisItens.cstCofins} in ${CST_PIS_TRIBUTADO}`,
        ),
        semDebito: contarSe(
          sql`${documentosFiscaisItens.cstPis} in ${CST_PIS_SEM_DEBITO} or ${documentosFiscaisItens.cstCofins} in ${CST_PIS_SEM_DEBITO}`,
        ),
      })
      .from(documentosFiscaisItens)
      .where(eq(documentosFiscaisItens.clienteId, clienteId));
    const row = rows[0];
    return {
      tributados: row?.tributados ?? 0,
      semDebito: row?.semDebito ?? 0,
    };
  }

  /**
   * Conta linhas de uma tabela que satisfazem uma condição, numa só consulta
   * (`count(*)`), sem carregar as linhas. Read-only por construção.
   */
  private async contar(table: any, where: SQL | undefined): Promise<number> {
    const rows = await this.database.db
      .select({ total: sql<number>`cast(count(*) as int)` })
      .from(table)
      .where(where);
    return rows[0]?.total ?? 0;
  }
}

/**
 * Expressão agregada `count(*) filter (where <cond>)` tipada como inteiro — a
 * forma portável de contar linhas que satisfazem uma condição numa única
 * varredura, sem N+1 (mesma utilidade de `onboarding-matriz.service.ts`).
 */
function contarSe(condicao: SQL): SQL<number> {
  return sql<number>`cast(count(*) filter (where ${condicao}) as int)`;
}

/**
 * Normaliza uma competência da coluna `date` ('YYYY-MM-DD') ou já em 'YYYY-MM'
 * para a chave mensal 'YYYY-MM' usada no inventário.
 */
function competenciaMensal(value: string): string {
  return value.slice(0, 7);
}
