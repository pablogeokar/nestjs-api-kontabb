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
  constructor(private readonly database: DatabaseService) { }

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
        aliquotaPis: aliquotas.pis,
        aliquotaCofins: aliquotas.cofins,
      }),
      naoCumulativo
        ? this.somarPorSegmento({
          clienteId: input.clienteId,
          tipoOperacao: 'ENTRADA',
          inicio,
          fim,
          aliquotaPis: aliquotas.pis,
          aliquotaCofins: aliquotas.cofins,
        })
        : Promise.resolve(null),
    ]);

    const pis = this.calcularTributo({
      aliquota: aliquotas.pis,
      naoCumulativo,
      baseTributadaScaled: saidas.pis.baseTributada,
      debitoScaled: saidas.pis.debito,
      baseCreditoScaled: entradas?.pis.baseCredito ?? 0n,
      valorMonofasicoStScaled: saidas.pis.baseSemDebito,
      // R5.4: pendências de débito vêm das SAÍDAS (itens tributados sem destaque
      // e sem base). As entradas alimentam crédito, não débito.
      pendencias: saidas.pis.pendencias,
    });
    const cofins = this.calcularTributo({
      aliquota: aliquotas.cofins,
      naoCumulativo,
      baseTributadaScaled: saidas.cofins.baseTributada,
      debitoScaled: saidas.cofins.debito,
      baseCreditoScaled: entradas?.cofins.baseCredito ?? 0n,
      valorMonofasicoStScaled: saidas.cofins.baseSemDebito,
      pendencias: saidas.cofins.pendencias,
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
    // F12: débito já decidido POR ITEM na consulta (destaque quando presente,
    // senão base × alíquota). Somar por item evita que um mix de itens com e
    // sem destaque perca base quando o destaque agregado é positivo.
    debitoScaled: bigint;
    baseCreditoScaled: bigint;
    valorMonofasicoStScaled: bigint;
    // R5.4: quantidade de itens tributados com valor inválido/insuficiente
    // (sem destaque e sem base). Surge como pendência, não como débito zero.
    pendencias: number;
  }) {
    const aliqScaled = toScaledInteger(input.aliquota, 4); // pontos * 1e4
    const denom = 100n * 10n ** 4n;
    const debito = input.debitoScaled;
    // Crédito (só não-cumulativo): base das entradas creditáveis * alíquota.
    //
    // R5.5 (arredondamento consistente): o débito é decidido POR ITEM com
    // ROUND(...,2) no SQL (arredonda meia casa para cima). O crédito DEVE usar
    // o MESMO arredondamento a 2 casas — a divisão inteira de bigint trunca em
    // vez de arredondar, o que divergiria do débito (ex.: base 100,10 × 7,60%
    // = 7,6076 ⇒ 7,61 arredondado, mas 7,60 truncado). `roundScaledDivision`
    // arredonda meia casa para cima, igualando o critério do ROUND do SQL.
    const credito = input.naoCumulativo
      ? roundScaledDivision(input.baseCreditoScaled * aliqScaled, denom)
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
      // R5.4: >0 sinaliza itens tributados sem valor apurável (destaque e base
      // ausentes). O débito acima NÃO inclui esses itens; eles são pendência a
      // resolver, não um zero silencioso.
      itens_pendentes: input.pendencias,
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
    aliquotaPis: string;
    aliquotaCofins: string;
  }) {
    const tributadoIn = sqlInList([...CST_TRIBUTADO]);
    const semDebitoIn = sqlInList([...CST_SEM_DEBITO]);
    const creditoIn = sqlInList([...CST_CREDITO]);
    // F12: débito por item = destaque quando presente (>0), senão base ×
    // alíquota. Somado por item para não perder base num mix com/sem destaque.
    //
    // R5.2 (respeitando alíquota por item): quando o item traz sua própria
    // alíquota (`aliquota_pis_percentual`/`aliquota_cofins_percentual` — ex.:
    // CST 02, alíquota diferenciada), o fallback base × alíquota usa a alíquota
    // DO ITEM; só cai na alíquota do regime quando o item não a informa.
    const pisAliquotaItem = sql`COALESCE(${documentosFiscaisItens.aliquotaPisPercentual}, ${input.aliquotaPis}::numeric)`;
    const cofinsAliquotaItem = sql`COALESCE(${documentosFiscaisItens.aliquotaCofinsPercentual}, ${input.aliquotaCofins}::numeric)`;
    // F12 / R5.3 (distinguir zero informado de ausente): o destaque só é usado
    // como fallback base × alíquota quando ESTÁ AUSENTE (`valorPis IS NULL`).
    // Um destaque explícito — inclusive ZERO informado — é honrado como o
    // débito do item. Assim um item tributado com destaque 0,00 legítimo
    // ("sem imposto devido") NÃO cai silenciosamente em base × alíquota como se
    // o valor estivesse faltando.
    //
    // F12 / R5.4 (proibir fallback silencioso em valor inválido): quando o item
    // tributado NÃO tem destaque (`valorPis IS NULL`) E também NÃO tem base
    // (`valorBcPis IS NULL`), não há de onde calcular. Esse item contribui 0
    // para o débito, mas é contado como PENDÊNCIA (ver `pisPendencias`) para
    // que a inconsistência apareça em vez de virar um 0 silencioso e errado.
    const pisDebitoItem = sql`CASE WHEN ${documentosFiscaisItens.cstPis} IN ${tributadoIn} THEN CASE WHEN ${documentosFiscaisItens.valorPis} IS NOT NULL THEN ${documentosFiscaisItens.valorPis} WHEN ${documentosFiscaisItens.valorBcPis} IS NOT NULL THEN ROUND(${documentosFiscaisItens.valorBcPis} * ${pisAliquotaItem} / 100, 2) ELSE 0 END ELSE 0 END`;
    const cofinsDebitoItem = sql`CASE WHEN ${documentosFiscaisItens.cstCofins} IN ${tributadoIn} THEN CASE WHEN ${documentosFiscaisItens.valorCofins} IS NOT NULL THEN ${documentosFiscaisItens.valorCofins} WHEN ${documentosFiscaisItens.valorBcCofins} IS NOT NULL THEN ROUND(${documentosFiscaisItens.valorBcCofins} * ${cofinsAliquotaItem} / 100, 2) ELSE 0 END ELSE 0 END`;
    // Contagem de itens tributados sem destaque E sem base (valor inválido /
    // insuficiente) — surge como pendência no envelope de resposta (R5.4).
    const pisPendenciaItem = sql`CASE WHEN ${documentosFiscaisItens.cstPis} IN ${tributadoIn} AND ${documentosFiscaisItens.valorPis} IS NULL AND ${documentosFiscaisItens.valorBcPis} IS NULL THEN 1 ELSE 0 END`;
    const cofinsPendenciaItem = sql`CASE WHEN ${documentosFiscaisItens.cstCofins} IN ${tributadoIn} AND ${documentosFiscaisItens.valorCofins} IS NULL AND ${documentosFiscaisItens.valorBcCofins} IS NULL THEN 1 ELSE 0 END`;

    const rows = await this.database.db
      .select({
        pis_base_tributada: sql<string>`COALESCE(SUM(CASE WHEN ${documentosFiscaisItens.cstPis} IN ${tributadoIn} THEN COALESCE(${documentosFiscaisItens.valorBcPis}, 0) ELSE 0 END), 0)`,
        pis_debito: sql<string>`COALESCE(SUM(${pisDebitoItem}), 0)`,
        pis_base_sem_debito: sql<string>`COALESCE(SUM(CASE WHEN ${documentosFiscaisItens.cstPis} IN ${semDebitoIn} THEN COALESCE(${documentosFiscaisItens.valorBcPis}, COALESCE(${documentosFiscaisItens.valorBrutoProduto}, 0)) ELSE 0 END), 0)`,
        pis_base_credito: sql<string>`COALESCE(SUM(CASE WHEN ${documentosFiscaisItens.cstPis} IN ${creditoIn} THEN COALESCE(${documentosFiscaisItens.valorBcPis}, 0) ELSE 0 END), 0)`,
        pis_pendencias: sql<string>`COALESCE(SUM(${pisPendenciaItem}), 0)`,
        cofins_base_tributada: sql<string>`COALESCE(SUM(CASE WHEN ${documentosFiscaisItens.cstCofins} IN ${tributadoIn} THEN COALESCE(${documentosFiscaisItens.valorBcCofins}, 0) ELSE 0 END), 0)`,
        cofins_debito: sql<string>`COALESCE(SUM(${cofinsDebitoItem}), 0)`,
        cofins_base_sem_debito: sql<string>`COALESCE(SUM(CASE WHEN ${documentosFiscaisItens.cstCofins} IN ${semDebitoIn} THEN COALESCE(${documentosFiscaisItens.valorBcCofins}, COALESCE(${documentosFiscaisItens.valorBrutoProduto}, 0)) ELSE 0 END), 0)`,
        cofins_base_credito: sql<string>`COALESCE(SUM(CASE WHEN ${documentosFiscaisItens.cstCofins} IN ${creditoIn} THEN COALESCE(${documentosFiscaisItens.valorBcCofins}, 0) ELSE 0 END), 0)`,
        cofins_pendencias: sql<string>`COALESCE(SUM(${cofinsPendenciaItem}), 0)`,
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
        debito: toScaledInteger(r?.pis_debito ?? '0'),
        baseSemDebito: toScaledInteger(r?.pis_base_sem_debito ?? '0'),
        baseCredito: toScaledInteger(r?.pis_base_credito ?? '0'),
        // R5.4: itens tributados sem destaque e sem base (valor inválido).
        pendencias: Number(r?.pis_pendencias ?? '0'),
      },
      cofins: {
        baseTributada: toScaledInteger(r?.cofins_base_tributada ?? '0'),
        debito: toScaledInteger(r?.cofins_debito ?? '0'),
        baseSemDebito: toScaledInteger(r?.cofins_base_sem_debito ?? '0'),
        baseCredito: toScaledInteger(r?.cofins_base_credito ?? '0'),
        pendencias: Number(r?.cofins_pendencias ?? '0'),
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
      itens_pendentes: 0,
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

/**
 * Divisão inteira de bigint com arredondamento meia casa para cima (half-up),
 * equivalente ao `ROUND(x, 2)` do PostgreSQL usado no débito por item. A
 * divisão nativa de bigint trunca; aqui somamos metade do divisor antes de
 * dividir para arredondar de forma consistente com o débito (R5.5).
 *
 * Trata sinal explicitamente para arredondar simetricamente (magnitude), ainda
 * que crédito/base sejam não-negativos no fluxo atual.
 */
function roundScaledDivision(numerator: bigint, divisor: bigint): bigint {
  if (divisor === 0n) return 0n;
  const negative = numerator < 0n !== divisor < 0n;
  const absNum = numerator < 0n ? -numerator : numerator;
  const absDiv = divisor < 0n ? -divisor : divisor;
  const rounded = (absNum + absDiv / 2n) / absDiv;
  return negative ? -rounded : rounded;
}

// Monta um literal SQL de lista para uso em `IN (...)`.
function sqlInList(values: string[]) {
  return sql`(${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )})`;
}
