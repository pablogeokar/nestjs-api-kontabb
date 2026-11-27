import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service';
import {
  documentosFiscais,
  documentosFiscaisItens,
} from '../../database/schema';
import { DifalEntradaService } from '../services/difal-entrada.service';
import { FiscalPeriodSelectionService } from '../services/fiscal-period-selection.service';
import {
  apurarEntradasInterestaduais,
  apurarSaidasInterestaduais,
  type DestdaItemSaida,
  type ResultadoApuracaoDestda,
} from './destda-apuracao';
import type { DestdaInconsistencia } from './destda.types';

@Injectable()
export class DestdaApuracaoService {
  constructor(
    private readonly database: DatabaseService,
    private readonly difalEntrada: DifalEntradaService,
    private readonly periodos: FiscalPeriodSelectionService,
  ) {}

  async apurar(input: {
    clienteId: string;
    competencia: string;
    ufEmpresa: string;
  }): Promise<ResultadoApuracaoDestda> {
    const [saidas, entradas] = await Promise.all([
      this.apurarSaidas(input),
      this.apurarEntradas(input),
    ]);
    return {
      totais: {
        entradas: entradas.entradas,
        consumoFinal: saidas.totais.consumoFinal,
        st: saidas.totais.st,
      },
      inconsistencias: [...entradas.inconsistencias, ...saidas.inconsistencias],
    };
  }

  private async apurarEntradas(input: {
    clienteId: string;
    competencia: string;
  }) {
    const resultado = await this.difalEntrada.apurarCompetencia({
      clienteId: input.clienteId,
      competencia: input.competencia,
    });
    return apurarEntradasInterestaduais({
      difal: resultado.itens.map((item) => ({
        cfop: item.cfop,
        hipotese: item.hipotese,
        statusCalculo: item.status_calculo,
        recolhimentoProprio: item.recolhimento_proprio,
        valorDifal: item.valor_difal,
        valorFcp: item.valor_fcp,
      })),
      antecipacao: resultado.antecipacao_parcial.itens.map((item) => ({
        situacao: item.situacao,
        // Valor que o contribuinte de fato recolhe: com a redução condicionada
        // (ex.: 20% ME/EPP, RICMS-BA art. 274) quando a regra a prevê.
        valorAntecipacao:
          ('reducao_condicionada' in item
            ? item.reducao_condicionada?.valor_com_reducao
            : null) ??
          item.calculo?.valor_antecipacao ??
          null,
      })),
    });
  }

  private async apurarSaidas(input: {
    clienteId: string;
    competencia: string;
    ufEmpresa: string;
  }): Promise<ResultadoApuracaoDestda> {
    const { where: periodo } = this.periodos.predicadoPeriodo(
      input.competencia,
      'EMISSAO',
    );
    const ufDestino = sql<
      string | null
    >`NULLIF(UPPER(BTRIM(${documentosFiscais.destinatarioDados} ->> 'uf')), '')`;
    const itemRelevante = sql`(
      COALESCE(${documentosFiscaisItens.valorIcmsSt}, 0) > 0
      OR COALESCE(${documentosFiscaisItens.valorFcpSt}, 0) > 0
      OR COALESCE(${documentosFiscaisItens.valorIcmsUfDest}, 0) > 0
      OR COALESCE(${documentosFiscaisItens.valorFcpUfDest}, 0) > 0
    )`;

    const linhas = await this.database.db
      .select({
        documentoFiscalId: documentosFiscaisItens.documentoFiscalId,
        numeroDocumento: documentosFiscais.numeroDocumento,
        situacao: documentosFiscais.situacao,
        escriturado: documentosFiscais.escriturado,
        escrituracaoStatus: documentosFiscais.escrituracaoStatus,
        integridadeStatus: documentosFiscais.integridadeStatus,
        valorTotal: documentosFiscais.valorTotal,
        ufDestino,
        cfop: documentosFiscaisItens.cfop,
        cfopRevisaoNecessaria: documentosFiscaisItens.cfopRevisaoNecessaria,
        csosnIcms: documentosFiscaisItens.csosnIcms,
        cstIcms: documentosFiscaisItens.cstIcms,
        valorIcmsSt: documentosFiscaisItens.valorIcmsSt,
        valorFcpSt: documentosFiscaisItens.valorFcpSt,
        valorIcmsUfDest: documentosFiscaisItens.valorIcmsUfDest,
        valorFcpUfDest: documentosFiscaisItens.valorFcpUfDest,
      })
      .from(documentosFiscaisItens)
      .innerJoin(
        documentosFiscais,
        eq(documentosFiscais.id, documentosFiscaisItens.documentoFiscalId),
      )
      .where(
        and(
          eq(documentosFiscais.clienteId, input.clienteId),
          eq(documentosFiscais.tipoDocumento, 'NFE'),
          eq(documentosFiscais.tipoOperacaoEscriturada, 'SAIDA'),
          eq(documentosFiscaisItens.tipoOperacaoEscriturada, 'SAIDA'),
          eq(documentosFiscais.situacao, 'AUTORIZADA'),
          periodo,
          itemRelevante,
        ),
      );

    const elegiveis: DestdaItemSaida[] = [];
    const pendentes = new Map<string, string>();
    for (const linha of linhas) {
      const motivo = this.periodos.classificarExclusao({
        situacao: linha.situacao,
        escriturado: linha.escriturado,
        escrituracaoStatus: linha.escrituracaoStatus,
        integridadeStatus: linha.integridadeStatus,
        valorTotal: linha.valorTotal,
      });
      if (motivo || linha.cfopRevisaoNecessaria) {
        pendentes.set(linha.documentoFiscalId, linha.numeroDocumento);
        continue;
      }
      elegiveis.push({
        documentoFiscalId: linha.documentoFiscalId,
        numeroDocumento: linha.numeroDocumento,
        ufDestino: linha.ufDestino,
        cfop: linha.cfop,
        csosnIcms: linha.csosnIcms,
        cstIcms: linha.cstIcms,
        valorIcmsSt: linha.valorIcmsSt,
        valorFcpSt: linha.valorFcpSt,
        valorIcmsUfDest: linha.valorIcmsUfDest,
        valorFcpUfDest: linha.valorFcpUfDest,
      });
    }

    const resultado = apurarSaidasInterestaduais(elegiveis, input.ufEmpresa);
    const inconsistencias: DestdaInconsistencia[] = [
      ...resultado.inconsistencias,
    ];
    if (pendentes.size > 0) {
      const numeros = [...pendentes.values()];
      inconsistencias.push({
        codigo: 'DOCUMENTO_SAIDA_PENDENTE',
        severidade: 'ERRO',
        mensagem: `${pendentes.size} NF-e de saída com ICMS-ST ou DIFAL ainda não está escriturada, conferida ou com CFOP revisado (${numeros.slice(0, 5).join(', ')}${numeros.length > 5 ? '…' : ''}). Conclua a escrituração antes de gerar a DeSTDA.`,
      });
    }
    return { totais: resultado.totais, inconsistencias };
  }
}
