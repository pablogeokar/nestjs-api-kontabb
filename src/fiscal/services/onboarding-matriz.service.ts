import { Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, gte, lte, sql, type SQL } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service';
import {
  clientes,
  documentosFiscais,
  documentosFiscaisItens,
  spedConfiguracoes,
  spedInventarios,
} from '../../database/schema';
import { parseCompetenciaMensal } from '../fiscal-date.util';
import {
  CST_ICMS_MONOFASICO_COMBUSTIVEIS,
  CST_PIS_COFINS_MONOFASICO,
  montarMatrizOnboarding,
  type OnboardingMatriz,
  type OnboardingMatrizFatos,
} from './onboarding-matriz';

/**
 * MATRIZ DE ONBOARDING POR ESTABELECIMENTO (Fase 5, tarefa 4.1 — R4.1).
 *
 * Serviço READ-ONLY que MONTA e APRESENTA a cobertura de um estabelecimento numa
 * competência: modelos de documento usados, perfil, setor, regime especial,
 * Blocos B/K/1, 1601, combustíveis/monofásicos, inventário por motivo e
 * controles ST (R4.1). Não cria esquema novo — DERIVA tudo de dados fiscais já
 * persistidos (configuração SPED, documentos escriturados, inventários).
 *
 * Espelha o padrão de `FiscalBooksProjectionService`/`FiscalClosingService`: o
 * serviço CARREGA os fatos do banco (aqui com agregações no SQL, evitando N+1
 * sobre os itens) e delega a montagem ao núcleo PURO `montarMatrizOnboarding`,
 * que apenas classifica/apresenta. O núcleo puro deriva, sobre os fatos, os
 * impedimentos explícitos (4.2 — R4.2/R4.3) e o status "pronto para entrega"
 * (4.3 — R4.4/R4.5): a matriz já chega montada e com a prontidão resolvida.
 */
@Injectable()
export class OnboardingMatrizService {
  constructor(private readonly database: DatabaseService) { }

  /**
   * Monta a matriz de onboarding do estabelecimento (`clienteId`) para a
   * competência mensal 'YYYY-MM'. Lança 404 quando o estabelecimento não existe.
   * A competência inválida é tratada pelo chamador (BadRequest).
   */
  async montar(input: {
    clienteId: string;
    competencia: string;
  }): Promise<OnboardingMatriz> {
    const { competencia, inicio, fim } = parseCompetenciaMensal(
      input.competencia,
    );
    const competenciaMensal = competencia.slice(0, 7);

    // Estabelecimento + configuração SPED numa só leitura (left join: a config
    // pode não existir ainda — ausência, não defeito, R4.5).
    const cabecalho = await this.carregarCabecalho(input.clienteId);

    const [modelosContagem, sinaisItens, inventarios] = await Promise.all([
      this.contarModelos(input.clienteId, inicio, fim),
      this.agregarSinaisItens(input.clienteId, inicio, fim),
      this.carregarInventarios(input.clienteId),
    ]);

    const fatos: OnboardingMatrizFatos = {
      clienteId: input.clienteId,
      competencia: competenciaMensal,
      cliente: {
        razaoSocial: cabecalho.razaoSocial,
        cnpj: cabecalho.cnpj,
        uf: cabecalho.uf,
        regimeTributario: cabecalho.regimeTributario,
      },
      configuracao: cabecalho.temConfiguracao
        ? {
          perfilEfd: cabecalho.perfilEfd,
          indAtiv: cabecalho.indAtiv,
          obrigadoEfdIcmsIpi: cabecalho.obrigadoEfdIcmsIpi ?? false,
          inventarioObrigatorio: cabecalho.inventarioObrigatorio ?? false,
          mesEntregaInventario: cabecalho.mesEntregaInventario ?? 2,
          blocoKComMovimento: cabecalho.blocoKComMovimento ?? false,
          indicadores1010: cabecalho.indicadores1010 ?? {},
        }
        : null,
      modelosContagem,
      sinaisItens,
      inventarios,
    };

    return montarMatrizOnboarding(fatos);
  }

  /**
   * Carrega o estabelecimento e a sua configuração SPED (left join). O escopo
   * por cliente é verificado pelo chamador (controller) resolvendo o cliente do
   * contexto; aqui a ausência da linha de cliente é 404.
   */
  private async carregarCabecalho(clienteId: string) {
    const rows = await this.database.db
      .select({
        clienteId: clientes.id,
        razaoSocial: clientes.razaoSocial,
        cnpj: clientes.cnpj,
        uf: clientes.uf,
        regimeTributario: clientes.regimeTributario,
        configuracaoId: spedConfiguracoes.id,
        perfilEfd: spedConfiguracoes.perfilEfd,
        indAtiv: spedConfiguracoes.indAtiv,
        obrigadoEfdIcmsIpi: spedConfiguracoes.obrigadoEfdIcmsIpi,
        inventarioObrigatorio: spedConfiguracoes.inventarioObrigatorio,
        mesEntregaInventario: spedConfiguracoes.mesEntregaInventario,
        blocoKComMovimento: spedConfiguracoes.blocoKComMovimento,
        indicadores1010: spedConfiguracoes.indicadores1010,
      })
      .from(clientes)
      .leftJoin(spedConfiguracoes, eq(spedConfiguracoes.clienteId, clientes.id))
      .where(eq(clientes.id, clienteId))
      .limit(1);

    const row = rows[0];
    if (!row) throw new NotFoundException('Empresa não encontrada.');
    return { ...row, temConfiguracao: row.configuracaoId != null };
  }

  /**
   * Conta os documentos POR MODELO na competência (modelo → quantidade),
   * agregando no SQL (`count` + `group by`) para não carregar documento a
   * documento. Filtra por `data_emissao` dentro do intervalo da competência,
   * o mesmo recorte usado na escrituração.
   */
  private async contarModelos(
    clienteId: string,
    inicio: Date,
    fim: Date,
  ): Promise<Array<{ modelo: string; quantidade: number }>> {
    const rows = await this.database.db
      .select({
        modelo: documentosFiscais.modelo,
        quantidade: sql<number>`cast(count(*) as int)`,
      })
      .from(documentosFiscais)
      .where(
        and(
          eq(documentosFiscais.clienteId, clienteId),
          gte(documentosFiscais.dataEmissao, inicio),
          lte(documentosFiscais.dataEmissao, fim),
        ),
      )
      .groupBy(documentosFiscais.modelo);
    return rows.map((r) => ({ modelo: r.modelo, quantidade: r.quantidade }));
  }

  /**
   * Agrega os sinais dos ITENS dos documentos da competência numa só varredura
   * no SQL (sem N+1): se há item com CST ICMS monofásico de combustíveis, com
   * CST PIS/COFINS monofásico, e as contagens de ST (CEST, ICMS-ST destacado,
   * ST retido anteriormente). `IND_COMB` vem da configuração 1010, não daqui.
   *
   * O join é por `documento_fiscal_id`; o recorte de competência é aplicado na
   * data de emissão do documento-pai.
   */
  private async agregarSinaisItens(
    clienteId: string,
    inicio: Date,
    fim: Date,
  ): Promise<OnboardingMatrizFatos['sinaisItens']> {
    const cstIcmsLista = [...CST_ICMS_MONOFASICO_COMBUSTIVEIS];
    const rows = await this.database.db
      .select({
        itensComCstIcmsMonofasico: contarSe(
          sql`${documentosFiscaisItens.cstIcms} in ${cstIcmsLista}`,
        ),
        itensComCstPisCofinsMonofasico: contarSe(
          sql`${documentosFiscaisItens.cstPis} = ${CST_PIS_COFINS_MONOFASICO} or ${documentosFiscaisItens.cstCofins} = ${CST_PIS_COFINS_MONOFASICO}`,
        ),
        itensComCest: contarSe(sql`${documentosFiscaisItens.cest} is not null`),
        itensComIcmsSt: contarSe(
          sql`${documentosFiscaisItens.valorIcmsSt} is not null and ${documentosFiscaisItens.valorIcmsSt} > 0`,
        ),
        itensComStRetido: contarSe(
          sql`${documentosFiscaisItens.valorIcmsStRetido} is not null and ${documentosFiscaisItens.valorIcmsStRetido} > 0`,
        ),
      })
      .from(documentosFiscaisItens)
      .innerJoin(
        documentosFiscais,
        eq(documentosFiscais.id, documentosFiscaisItens.documentoFiscalId),
      )
      .where(
        and(
          eq(documentosFiscaisItens.clienteId, clienteId),
          gte(documentosFiscais.dataEmissao, inicio),
          lte(documentosFiscais.dataEmissao, fim),
        ),
      );

    const row = rows[0];
    return {
      // IND_COMB é derivado da configuração 1010 pelo núcleo puro; aqui falso.
      temIndComb: false,
      temCstIcmsMonofasico: (row?.itensComCstIcmsMonofasico ?? 0) > 0,
      temCstPisCofinsMonofasico: (row?.itensComCstPisCofinsMonofasico ?? 0) > 0,
      itensComCest: row?.itensComCest ?? 0,
      itensComIcmsSt: row?.itensComIcmsSt ?? 0,
      itensComStRetido: row?.itensComStRetido ?? 0,
    };
  }

  /**
   * Carrega os inventários do estabelecimento (qualquer data), por motivo. O
   * inventário não é recortado pela competência mensal: a matriz lista a
   * cobertura de inventário por motivo do estabelecimento como um todo (R4.1).
   */
  private async carregarInventarios(
    clienteId: string,
  ): Promise<OnboardingMatrizFatos['inventarios']> {
    const rows = await this.database.db
      .select({
        dataInventario: spedInventarios.dataInventario,
        motivo: spedInventarios.motivo,
        status: spedInventarios.status,
      })
      .from(spedInventarios)
      .where(eq(spedInventarios.clienteId, clienteId));
    return rows.map((r) => ({
      dataInventario: r.dataInventario,
      motivo: r.motivo,
      status: r.status,
    }));
  }
}

/**
 * Expressão agregada `count(*) filter (where <cond>)` tipada como inteiro — a
 * forma portável de contar linhas que satisfazem uma condição numa única
 * varredura, sem N+1.
 */
function contarSe(condicao: SQL): SQL<number> {
  return sql<number>`cast(count(*) filter (where ${condicao}) as int)`;
}
