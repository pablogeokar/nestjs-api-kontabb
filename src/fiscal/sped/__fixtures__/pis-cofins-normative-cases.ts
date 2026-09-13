/**
 * Fixture normativa do 6º cenário P0: fallback agregado de PIS/COFINS (F12).
 *
 * Ao contrário dos outros cinco cenários, este defeito vive no cálculo de
 * PIS/COFINS (`PisCofinsService.apurarCompetencia`), não no builder do SPED.
 * A decisão de débito é feita POR ITEM no SQL: destaque quando presente,
 * senão base × alíquota. O oráculo abaixo é a soma manual item a item — NÃO
 * o agregado — para provar que um mix (um item com destaque, outro sem) não
 * perde a base do item sem destaque (regressão do fallback agregado).
 *
 * Os "itens" são declarados de forma crua e independente; a expectativa de
 * `pis_debito`/`cofins_debito` é calculada campo a campo à mão.
 */

/** Um item de saída tributado (CST 01/02) com base e destaque explícitos. */
export interface PisCofinsItemFixture {
  cstPis: string;
  cstCofins: string;
  /** Base de cálculo do item (BC) — usada quando não há destaque. */
  baseCalculo: string;
  /** Destaque de PIS informado no item (vazio/'0.00' = ausente). */
  valorPis: string;
  /** Destaque de COFINS informado no item. */
  valorCofins: string;
  /**
   * Alíquota de PIS do próprio item (percentual). `null` = ausente ⇒ usa a
   * alíquota do regime no fallback base × alíquota.
   */
  aliquotaPisItem?: string | null;
  /** Alíquota de COFINS do próprio item (percentual). `null` = ausente. */
  aliquotaCofinsItem?: string | null;
}

export interface PisCofinsFixtureNormativa {
  id: string;
  descricao: string;
  achado: string;
  regime: 'LUCRO_PRESUMIDO' | 'LUCRO_REAL';
  aliquotaPis: string;
  aliquotaCofins: string;
  itens: PisCofinsItemFixture[];
  /** Débito esperado (soma POR ITEM), calculado à mão. */
  debitoPisEsperado: string;
  debitoCofinsEsperado: string;
  baseTributadaEsperada: string;
}

/**
 * F12 (reprodução do plano §F12): duas bases de 1.000,00 tributadas à alíquota
 * básica de PIS (0,65%). Um item traz destaque 6,50; o outro NÃO traz destaque.
 *
 * Débito POR ITEM (normativo):
 *  - item 1: destaque presente ⇒ 6,50
 *  - item 2: sem destaque      ⇒ 1.000,00 × 0,65% = 6,50
 *  - total PIS = 13,00 (nunca 6,50: o fallback agregado perderia metade)
 *
 * COFINS 3,00%:
 *  - item 1: destaque 30,00
 *  - item 2: 1.000,00 × 3,00% = 30,00
 *  - total = 60,00
 */
export const PIS_COFINS_FIXTURE_F12: PisCofinsFixtureNormativa = {
  id: 'F12-fallback-agregado-mix',
  descricao:
    'Mix de itens tributados (um com destaque, outro sem) soma o débito de ambas as bases',
  achado: 'F12',
  regime: 'LUCRO_PRESUMIDO',
  aliquotaPis: '0.65',
  aliquotaCofins: '3.00',
  itens: [
    {
      cstPis: '01',
      cstCofins: '01',
      baseCalculo: '1000.00',
      valorPis: '6.50',
      valorCofins: '30.00',
    },
    {
      cstPis: '01',
      cstCofins: '01',
      baseCalculo: '1000.00',
      valorPis: '0.00',
      valorCofins: '0.00',
    },
  ],
  debitoPisEsperado: '13.00',
  debitoCofinsEsperado: '60.00',
  baseTributadaEsperada: '2000.00',
};

/**
 * F12 / R5.2 (respeitando alíquota por item): dois itens tributados SEM
 * destaque, com alíquotas DIFERENTES por item. O fallback base × alíquota deve
 * usar a alíquota de cada item — não a alíquota do regime — senão o item de
 * alíquota diferenciada seria sub/superapurado.
 *
 * Débito PIS POR ITEM (normativo):
 *  - item 1: sem destaque, alíquota própria 1,65% ⇒ 1.000,00 × 1,65% = 16,50
 *  - item 2: sem destaque, alíquota própria 0,65% ⇒ 1.000,00 × 0,65% =  6,50
 *  - total PIS = 23,00 (o regime aqui é 1,65% — usar só ele daria 33,00, errado)
 *
 * Débito COFINS POR ITEM:
 *  - item 1: 1.000,00 × 7,60% = 76,00
 *  - item 2: 1.000,00 × 3,00% = 30,00
 *  - total = 106,00 (o regime é 7,60% — usar só ele daria 152,00, errado)
 */
export const PIS_COFINS_FIXTURE_ALIQUOTA_ITEM: PisCofinsFixtureNormativa = {
  id: 'F12-aliquota-por-item',
  descricao:
    'Itens sem destaque com alíquotas por item diferentes usam a alíquota do item no fallback',
  achado: 'F12',
  regime: 'LUCRO_REAL',
  aliquotaPis: '1.65',
  aliquotaCofins: '7.60',
  itens: [
    {
      cstPis: '02',
      cstCofins: '02',
      baseCalculo: '1000.00',
      valorPis: '0.00',
      valorCofins: '0.00',
      aliquotaPisItem: '1.6500',
      aliquotaCofinsItem: '7.6000',
    },
    {
      cstPis: '02',
      cstCofins: '02',
      baseCalculo: '1000.00',
      valorPis: '0.00',
      valorCofins: '0.00',
      aliquotaPisItem: '0.6500',
      aliquotaCofinsItem: '3.0000',
    },
  ],
  debitoPisEsperado: '23.00',
  debitoCofinsEsperado: '106.00',
  baseTributadaEsperada: '2000.00',
};

/**
 * F12 (reconciliação da ilustração "33,00" do plano): o texto do plano cita
 * "33,00 ou pendência" para o mix de PIS/COFINS. O valor 33,00 é a ilustração
 * NÃO-CUMULATIVA (1,65%): duas bases de 1.000,00 tributadas a 1,65%, uma COM
 * destaque (16,50) e outra SEM. A soma POR ITEM é exatamente 33,00 — e o ponto
 * do achado é que o fallback agregado (que ficaria só com o destaque de uma das
 * bases, 16,50) perderia metade. Este é o "33,00" legítimo: mix somado item a
 * item, sem perder base.
 *
 * Débito PIS POR ITEM (normativo):
 *  - item 1: destaque presente ⇒ 16,50
 *  - item 2: sem destaque      ⇒ 1.000,00 × 1,65% = 16,50
 *  - total PIS = 33,00 (o fallback agregado daria 16,50: perde metade)
 *
 * COFINS 7,60%:
 *  - item 1: destaque 76,00
 *  - item 2: 1.000,00 × 7,60% = 76,00
 *  - total = 152,00
 */
export const PIS_COFINS_FIXTURE_F12_33: PisCofinsFixtureNormativa = {
  id: 'F12-mix-33-nao-cumulativo',
  descricao:
    'Mix com/sem destaque na alíquota não-cumulativa (1,65%) soma 33,00 por item, sem perder base',
  achado: 'F12',
  regime: 'LUCRO_REAL',
  aliquotaPis: '1.65',
  aliquotaCofins: '7.60',
  itens: [
    {
      cstPis: '01',
      cstCofins: '01',
      baseCalculo: '1000.00',
      valorPis: '16.50',
      valorCofins: '76.00',
    },
    {
      cstPis: '01',
      cstCofins: '01',
      baseCalculo: '1000.00',
      valorPis: '0.00',
      valorCofins: '0.00',
    },
  ],
  debitoPisEsperado: '33.00',
  debitoCofinsEsperado: '152.00',
  baseTributadaEsperada: '2000.00',
};

/**
 * Deriva os totais que o SQL por item do serviço produziria para esta fixture,
 * calculados AQUI de forma independente (destaque quando > 0, senão base ×
 * alíquota; arredondado a 2 casas). Serve como a "linha" que o mock de banco
 * entregaria — o serviço apenas soma crédito e apura o saldo.
 */
export function derivarLinhaSegmentoF12(f: PisCofinsFixtureNormativa): {
  pis_base_tributada: string;
  pis_debito: string;
  pis_base_sem_debito: string;
  pis_base_credito: string;
  cofins_base_tributada: string;
  cofins_debito: string;
  cofins_base_sem_debito: string;
  cofins_base_credito: string;
} {
  const somaBase = f.itens.reduce((s, i) => s + toCents(i.baseCalculo), 0);
  const debitoPor = (
    valorDestaque: string,
    base: string,
    aliquota: string,
  ): number => {
    const destaque = toCents(valorDestaque);
    if (destaque > 0) return destaque;
    // base × alíquota, ROUND a 2 casas (equivalente ao ROUND(...,2) do SQL).
    return Math.round((toCents(base) * Number(aliquota)) / 100);
  };
  // R5.2: no fallback base × alíquota, usar a alíquota do item quando presente
  // (COALESCE(item, regime)) — espelha o COALESCE do SQL.
  const pisDebito = f.itens.reduce(
    (s, i) =>
      s +
      debitoPor(
        i.valorPis,
        i.baseCalculo,
        i.aliquotaPisItem ?? f.aliquotaPis,
      ),
    0,
  );
  const cofinsDebito = f.itens.reduce(
    (s, i) =>
      s +
      debitoPor(
        i.valorCofins,
        i.baseCalculo,
        i.aliquotaCofinsItem ?? f.aliquotaCofins,
      ),
    0,
  );
  return {
    pis_base_tributada: fromCents(somaBase),
    pis_debito: fromCents(pisDebito),
    pis_base_sem_debito: '0.00',
    pis_base_credito: '0.00',
    cofins_base_tributada: fromCents(somaBase),
    cofins_debito: fromCents(cofinsDebito),
    cofins_base_sem_debito: '0.00',
    cofins_base_credito: '0.00',
  };
}

function toCents(value: string): number {
  return Math.round(Number(value) * 100);
}

function fromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}
