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
import type { RegimeTributario } from '../../clientes/clientes.types';
import {
  fromScaledInteger,
  positive,
  toScaledInteger,
} from '../sped/sped-decimal';
import { parseCompetenciaMensal } from '../fiscal-date.util';

// Alíquotas legais (percentuais).
const ALIQUOTAS = {
  CUMULATIVO: { pis: '0.65', cofins: '3.00' }, // Lei 9.718/98
  NAO_CUMULATIVO: { pis: '1.65', cofins: '7.60' }, // Leis 10.637/02 e 10.833/03
} as const;

// CSTs de PIS/COFINS que representam receita tributada (débito).
// 01 tributável alíquota básica, 02 alíquota diferenciada.
const CST_TRIBUTADO = new Set(['01', '02']);
// CSTs monofásicos/ST/alíquota zero — a receita NÃO gera débito próprio.
// 04 monofásico alíquota zero, 05 ST, 06 alíquota zero, 07 isenta,
// 08 sem incidência, 09 suspensão.
const CST_SEM_DEBITO = new Set(['04', '05', '06', '07', '08', '09']);
// CSTs de crédito (entradas, regime não-cumulativo): 50-56 e 60-66.
const CST_CREDITO = new Set([
  '50',
  '51',
  '52',
  '53',
  '54',
  '55',
  '56',
  '60',
  '61',
  '62',
  '63',
  '64',
  '65',
  '66',
]);

@Injectable()
export class PisCofinsService {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Apura PIS e COFINS da competência conforme o regime do cliente:
   *  - Simples Nacional: recolhido via DAS, sem apuração destacada.
   *  - Lucro Presumido: cumulativo (0,65%/3,00%) sobre receita, sem créditos.
   *  - Lucro Real: não-cumulativo (1,65%/7,60%) com créditos das entradas.
   *
   * Segrega receita tributada de receita monofásica/ST/alíquota zero para não
   * tributar em duplicidade (base do Bloco M da EFD Contribuições).
   */
  async apurarCompetencia(input: { clienteId: string; competencia: string }) {
    const { competencia, inicio, fim } = this.competenciaRange(
      input.competencia,
    );
    const cliente = await this.getCliente(input.clienteId);
    const regime = cliente.regimeTributario as RegimeTributario | null;

    if (regime === 'SIMPLES_NACIONAL') {
      return {
        competencia,
        regime,
        regime_apuracao: 'DAS',
        observacao:
          'Optante do Simples Nacional — PIS/COFINS recolhidos via DAS (PGDAS-D). Apuração destacada não aplicável.',
        pis: this.zeroTributo(),
        cofins: this.zeroTributo(),
      };
    }

    const naoCumulativo = regime === 'LUCRO_REAL';
    const aliquotas = naoCumulativo
      ? ALIQUOTAS.NAO_CUMULATIVO
      : ALIQUOTAS.CUMULATIVO;

    const [saidas, entradas] = await Promise.all([
      this.somarPorSegmento({
        clienteId: input.clienteId,
        tipoOperacao: 'SAIDA',
        inicio,
        fim,
      }),
      naoCumulativo
        ? this.somarPorSegmento({
            clienteId: input.clienteId,
            tipoOperacao: 'ENTRADA',
            inicio,
            fim,
          })
        : Promise.resolve(null),
    ]);

    const pis = this.calcularTributo({
      aliquota: aliquotas.pis,
      naoCumulativo,
      baseTributadaScaled: saidas.pis.baseTributada,
      valorDestacadoScaled: saidas.pis.valorDestacado,
      baseCreditoScaled: entradas?.pis.baseCredito ?? 0n,
      valorMonofasicoStScaled: saidas.pis.baseSemDebito,
    });
    const cofins = this.calcularTributo({
      aliquota: aliquotas.cofins,
      naoCumulativo,
      baseTributadaScaled: saidas.cofins.baseTributada,
      valorDestacadoScaled: saidas.cofins.valorDestacado,
      baseCreditoScaled: entradas?.cofins.baseCredito ?? 0n,
      valorMonofasicoStScaled: saidas.cofins.baseSemDebito,
    });

    return {
      competencia,
      regime,
      regime_apuracao: naoCumulativo ? 'NAO_CUMULATIVO' : 'CUMULATIVO',
      observacao: null,
      pis,
      cofins,
    };
  }

  private calcularTributo(input: {
    aliquota: string;
    naoCumulativo: boolean;
    baseTributadaScaled: bigint;
    valorDestacadoScaled: bigint;
    baseCreditoScaled: bigint;
    valorMonofasicoStScaled: bigint;
  }) {
    const aliqScaled = toScaledInteger(input.aliquota, 4); // pontos * 1e4
    const denom = 100n * 10n ** 4n;
    // Débito: preferimos o valor destacado nos documentos; se ausente,
    // calculamos base * alíquota.
    const debito =
      input.valorDestacadoScaled > 0n
        ? input.valorDestacadoScaled
        : (input.baseTributadaScaled * aliqScaled) / denom;
    // Crédito (só não-cumulativo): base das entradas creditáveis * alíquota.
    const credito = input.naoCumulativo
      ? (input.baseCreditoScaled * aliqScaled) / denom
      : 0n;
    const saldo = positive(debito - credito);
    return {
      aliquota: input.aliquota,
      base_tributada: fromScaledInteger(input.baseTributadaScaled),
      base_monofasica_st: fromScaledInteger(input.valorMonofasicoStScaled),
      base_credito: fromScaledInteger(input.baseCreditoScaled),
      debito: fromScaledInteger(debito),
      credito: fromScaledInteger(credito),
      saldo_a_recolher: fromScaledInteger(saldo),
    };
  }

  /**
   * Soma bases e valores destacados por segmento (tributado / sem-débito /
   * creditável) para PIS e COFINS, num tipo de operação e período.
   */
  private async somarPorSegmento(input: {
    clienteId: string;
    tipoOperacao: 'ENTRADA' | 'SAIDA';
    inicio: Date;
    fim: Date;
  }) {
    const tributadoIn = sqlInList([...CST_TRIBUTADO]);
    const semDebitoIn = sqlInList([...CST_SEM_DEBITO]);
    const creditoIn = sqlInList([...CST_CREDITO]);

    const rows = await this.database.db
      .select({
        pis_base_tributada: sql<string>`COALESCE(SUM(CASE WHEN ${documentosFiscaisItens.cstPis} IN ${tributadoIn} THEN COALESCE(${documentosFiscaisItens.valorBcPis}, 0) ELSE 0 END), 0)`,
        pis_valor_destacado: sql<string>`COALESCE(SUM(CASE WHEN ${documentosFiscaisItens.cstPis} IN ${tributadoIn} THEN COALESCE(${documentosFiscaisItens.valorPis}, 0) ELSE 0 END), 0)`,
        pis_base_sem_debito: sql<string>`COALESCE(SUM(CASE WHEN ${documentosFiscaisItens.cstPis} IN ${semDebitoIn} THEN COALESCE(${documentosFiscaisItens.valorBcPis}, COALESCE(${documentosFiscaisItens.valorBrutoProduto}, 0)) ELSE 0 END), 0)`,
        pis_base_credito: sql<string>`COALESCE(SUM(CASE WHEN ${documentosFiscaisItens.cstPis} IN ${creditoIn} THEN COALESCE(${documentosFiscaisItens.valorBcPis}, 0) ELSE 0 END), 0)`,
        cofins_base_tributada: sql<string>`COALESCE(SUM(CASE WHEN ${documentosFiscaisItens.cstCofins} IN ${tributadoIn} THEN COALESCE(${documentosFiscaisItens.valorBcCofins}, 0) ELSE 0 END), 0)`,
        cofins_valor_destacado: sql<string>`COALESCE(SUM(CASE WHEN ${documentosFiscaisItens.cstCofins} IN ${tributadoIn} THEN COALESCE(${documentosFiscaisItens.valorCofins}, 0) ELSE 0 END), 0)`,
        cofins_base_sem_debito: sql<string>`COALESCE(SUM(CASE WHEN ${documentosFiscaisItens.cstCofins} IN ${semDebitoIn} THEN COALESCE(${documentosFiscaisItens.valorBcCofins}, COALESCE(${documentosFiscaisItens.valorBrutoProduto}, 0)) ELSE 0 END), 0)`,
        cofins_base_credito: sql<string>`COALESCE(SUM(CASE WHEN ${documentosFiscaisItens.cstCofins} IN ${creditoIn} THEN COALESCE(${documentosFiscaisItens.valorBcCofins}, 0) ELSE 0 END), 0)`,
      })
      .from(documentosFiscaisItens)
      .innerJoin(
        documentosFiscais,
        eq(documentosFiscais.id, documentosFiscaisItens.documentoFiscalId),
      )
      .where(
        and(
          eq(documentosFiscaisItens.clienteId, input.clienteId),
          eq(
            documentosFiscaisItens.tipoOperacaoEscriturada,
            input.tipoOperacao,
          ),
          eq(documentosFiscais.situacao, 'AUTORIZADA'),
          eq(documentosFiscais.escriturado, true),
          gte(documentosFiscais.dataEmissao, input.inicio),
          lte(documentosFiscais.dataEmissao, input.fim),
        ),
      );

    const r = rows[0];
    return {
      pis: {
        baseTributada: toScaledInteger(r?.pis_base_tributada ?? '0'),
        valorDestacado: toScaledInteger(r?.pis_valor_destacado ?? '0'),
        baseSemDebito: toScaledInteger(r?.pis_base_sem_debito ?? '0'),
        baseCredito: toScaledInteger(r?.pis_base_credito ?? '0'),
      },
      cofins: {
        baseTributada: toScaledInteger(r?.cofins_base_tributada ?? '0'),
        valorDestacado: toScaledInteger(r?.cofins_valor_destacado ?? '0'),
        baseSemDebito: toScaledInteger(r?.cofins_base_sem_debito ?? '0'),
        baseCredito: toScaledInteger(r?.cofins_base_credito ?? '0'),
      },
    };
  }

  private zeroTributo() {
    return {
      aliquota: '0.00',
      base_tributada: '0.00',
      base_monofasica_st: '0.00',
      base_credito: '0.00',
      debito: '0.00',
      credito: '0.00',
      saldo_a_recolher: '0.00',
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
      .select({
        id: clientes.id,
        regimeTributario: clientes.regimeTributario,
      })
      .from(clientes)
      .where(eq(clientes.id, clienteId))
      .limit(1);
    if (!rows[0]) throw new NotFoundException('Empresa não encontrada.');
    return rows[0];
  }
}

// Monta um literal SQL de lista para uso em `IN (...)`.
function sqlInList(values: string[]) {
  return sql`(${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )})`;
}
