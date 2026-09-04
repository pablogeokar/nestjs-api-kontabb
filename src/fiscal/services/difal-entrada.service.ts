import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service';
import {
  clientes,
  documentosFiscais,
  documentosFiscaisItens,
} from '../../database/schema';
import {
  fromScaledInteger,
  positive,
  toScaledInteger,
} from '../sped/sped-decimal';
import { parseCompetenciaMensal } from '../fiscal-date.util';

// CFOPs interestaduais de entrada que geram DIFAL para uso/consumo e ativo.
// Uso/consumo: 2556 (e 2407 ST). Ativo: 2551 (e 2406 ST).
const CFOPS_DIFAL_ENTRADA = new Set(['2556', '2551', '2407', '2406']);

// Alíquota interna padrão de ICMS por UF (%), usada como fallback quando a UF
// interna do adquirente não fornece uma alíquota específica no item. São as
// alíquotas modais gerais vigentes; o valor real pode variar por NCM.
const ALIQUOTA_INTERNA_PADRAO: Record<string, string> = {
  AC: '19',
  AL: '20',
  AM: '20',
  AP: '18',
  BA: '20.5',
  CE: '20',
  DF: '20',
  ES: '17',
  GO: '19',
  MA: '23',
  MG: '18',
  MS: '17',
  MT: '17',
  PA: '19',
  PB: '20',
  PE: '20.5',
  PI: '22.5',
  PR: '19.5',
  RJ: '22',
  RN: '20',
  RO: '19.5',
  RR: '20',
  RS: '17',
  SC: '17',
  SE: '19',
  SP: '18',
  TO: '20',
};

@Injectable()
export class DifalEntradaService {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Apura o DIFAL de entrada da competência: para cada item interestadual de
   * uso/consumo ou ativo, a diferença entre a alíquota interna da UF do
   * adquirente e a alíquota interestadual da operação, aplicada sobre a base.
   *
   * DIFAL = base * (aliquota_interna - aliquota_interestadual) / 100
   */
  async apurarCompetencia(input: { clienteId: string; competencia: string }) {
    const { competencia, inicio, fim } = this.competenciaRange(
      input.competencia,
    );
    const cliente = await this.getCliente(input.clienteId);
    const aliquotaInternaUf = ALIQUOTA_INTERNA_PADRAO[cliente.uf ?? ''] ?? '18';

    const cfops = [...CFOPS_DIFAL_ENTRADA];
    const itens = await this.database.db
      .select({
        documentoFiscalId: documentosFiscaisItens.documentoFiscalId,
        itemId: documentosFiscaisItens.id,
        cfop: documentosFiscaisItens.cfop,
        valorBcIcms: documentosFiscaisItens.valorBcIcms,
        valorBrutoProduto: documentosFiscaisItens.valorBrutoProduto,
        aliquotaIcms: documentosFiscaisItens.aliquotaIcms,
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
          sql`${documentosFiscaisItens.cfop} = ANY(${cfops})`,
        ),
      );

    const internaScaled = toScaledInteger(aliquotaInternaUf, 4);
    let totalDifal = 0n;
    let totalBase = 0n;
    const detalhes = itens.map((item) => {
      // Base do DIFAL: BC de ICMS se houver, senão o valor bruto do produto.
      const baseScaled =
        toScaledInteger(item.valorBcIcms ?? '0') > 0n
          ? toScaledInteger(item.valorBcIcms)
          : toScaledInteger(item.valorBrutoProduto ?? '0');
      // Alíquota interestadual: destacada no item; se ausente, presume 12%.
      const interScaled =
        toScaledInteger(item.aliquotaIcms ?? '0', 4) > 0n
          ? toScaledInteger(item.aliquotaIcms, 4)
          : toScaledInteger('12', 4);
      const difScaled = positive(internaScaled - interScaled); // pontos * 1e4
      // DIFAL = base(centavos) * dif(pontos*1e4) / (100 * 1e4)
      const difal = (baseScaled * difScaled) / (100n * 10n ** 4n);
      totalDifal += difal;
      totalBase += baseScaled;
      return {
        documento_fiscal_id: item.documentoFiscalId,
        item_id: item.itemId,
        cfop: item.cfop,
        base_calculo: fromScaledInteger(baseScaled),
        aliquota_interna: aliquotaInternaUf,
        aliquota_interestadual: fromScaledInteger(interScaled, 4),
        valor_difal: fromScaledInteger(difal),
      };
    });

    return {
      competencia,
      uf_adquirente: cliente.uf,
      aliquota_interna_uf: aliquotaInternaUf,
      quantidade_itens: itens.length,
      total_base_calculo: fromScaledInteger(totalBase),
      total_difal_recolher: fromScaledInteger(totalDifal),
      itens: detalhes,
    };
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

  private async getCliente(clienteId: string) {
    const rows = await this.database.db
      .select({ id: clientes.id, uf: clientes.uf })
      .from(clientes)
      .where(eq(clientes.id, clienteId))
      .limit(1);
    if (!rows[0]) throw new NotFoundException('Empresa não encontrada.');
    return rows[0];
  }
}
