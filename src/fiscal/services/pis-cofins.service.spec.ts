import { PisCofinsService } from './pis-cofins.service';
import {
  derivarLinhaSegmentoF12,
  PIS_COFINS_FIXTURE_ALIQUOTA_ITEM,
  PIS_COFINS_FIXTURE_F12,
  PIS_COFINS_FIXTURE_F12_33,
} from '../sped/__fixtures__/pis-cofins-normative-cases';

// DB falso: a primeira consulta (getCliente) resolve por .limit; as demais
// (somarPorSegmento) resolvem por .where. Usamos uma fila de resultados.
//
// Nota (F12): o débito de PIS/COFINS passou a ser decidido POR ITEM na própria
// consulta SQL (destaque quando presente; senão base × alíquota). Portanto os
// mocks fornecem diretamente `pis_debito`/`cofins_debito`, refletindo o que o
// PostgreSQL calcularia — o serviço apenas soma crédito e apura o saldo.
function createDb(
  cliente: { regimeTributario: string | null },
  segmentos: unknown[][],
) {
  const queue = [...segmentos];
  return {
    db: {
      select: jest
        .fn()
        .mockImplementation((selection: Record<string, unknown>) => {
          if ('regimeTributario' in selection) {
            return {
              from: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  limit: jest
                    .fn()
                    .mockResolvedValue([{ id: 'c1', ...cliente }]),
                }),
              }),
            };
          }
          return {
            from: jest.fn().mockReturnValue({
              innerJoin: jest.fn().mockReturnValue({
                where: jest.fn().mockResolvedValue(queue.shift() ?? [{}]),
              }),
            }),
          };
        }),
    },
  };
}

describe('PisCofinsService', () => {
  it('Simples Nacional: sem apuração destacada (via DAS)', async () => {
    const service = new PisCofinsService(
      createDb({ regimeTributario: 'SIMPLES_NACIONAL' }, []) as never,
    );
    const result = await service.apurarCompetencia({
      clienteId: 'c1',
      competencia: '2026-09',
    });
    expect(result.regime_apuracao).toBe('DAS');
    expect(result.pis.saldo_a_recolher).toBe('0.00');
    expect(result.cofins.saldo_a_recolher).toBe('0.00');
  });

  it('Lucro Presumido: cumulativo 0,65%/3% sobre base tributada, sem crédito', async () => {
    // Saídas: base tributada 10.000; débito por item calculado no SQL.
    const saidas = [
      {
        pis_base_tributada: '10000.00',
        pis_debito: '65.00',
        pis_base_sem_debito: '0.00',
        pis_base_credito: '0.00',
        cofins_base_tributada: '10000.00',
        cofins_debito: '300.00',
        cofins_base_sem_debito: '0.00',
        cofins_base_credito: '0.00',
      },
    ];
    const service = new PisCofinsService(
      createDb({ regimeTributario: 'LUCRO_PRESUMIDO' }, [saidas]) as never,
    );
    const result = await service.apurarCompetencia({
      clienteId: 'c1',
      competencia: '2026-09',
    });
    expect(result.regime_apuracao).toBe('CUMULATIVO');
    // PIS 0,65% de 10.000 = 65,00 ; COFINS 3% = 300,00. Sem crédito.
    expect(result.pis.debito).toBe('65.00');
    expect(result.pis.credito).toBe('0.00');
    expect(result.pis.saldo_a_recolher).toBe('65.00');
    expect(result.cofins.debito).toBe('300.00');
    expect(result.cofins.saldo_a_recolher).toBe('300.00');
  });

  it('Lucro Real: não-cumulativo com crédito das entradas', async () => {
    const saidas = [
      {
        pis_base_tributada: '10000.00',
        pis_debito: '165.00',
        pis_base_sem_debito: '0.00',
        pis_base_credito: '0.00',
        cofins_base_tributada: '10000.00',
        cofins_debito: '760.00',
        cofins_base_sem_debito: '0.00',
        cofins_base_credito: '0.00',
      },
    ];
    const entradas = [
      {
        pis_base_tributada: '0.00',
        pis_debito: '0.00',
        pis_base_sem_debito: '0.00',
        pis_base_credito: '4000.00',
        cofins_base_tributada: '0.00',
        cofins_debito: '0.00',
        cofins_base_sem_debito: '0.00',
        cofins_base_credito: '4000.00',
      },
    ];
    const service = new PisCofinsService(
      createDb({ regimeTributario: 'LUCRO_REAL' }, [saidas, entradas]) as never,
    );
    const result = await service.apurarCompetencia({
      clienteId: 'c1',
      competencia: '2026-09',
    });
    expect(result.regime_apuracao).toBe('NAO_CUMULATIVO');
    // PIS: débito 1,65% de 10.000 = 165 ; crédito 1,65% de 4.000 = 66 ; saldo 99.
    expect(result.pis.debito).toBe('165.00');
    expect(result.pis.credito).toBe('66.00');
    expect(result.pis.saldo_a_recolher).toBe('99.00');
    // COFINS: débito 7,6% de 10.000 = 760 ; crédito 7,6% de 4.000 = 304 ; saldo 456.
    expect(result.cofins.debito).toBe('760.00');
    expect(result.cofins.credito).toBe('304.00');
    expect(result.cofins.saldo_a_recolher).toBe('456.00');
  });

  it('não tributa receita monofásica/ST (sem débito próprio)', async () => {
    const saidas = [
      {
        pis_base_tributada: '0.00',
        pis_debito: '0.00',
        pis_base_sem_debito: '5000.00',
        pis_base_credito: '0.00',
        cofins_base_tributada: '0.00',
        cofins_debito: '0.00',
        cofins_base_sem_debito: '5000.00',
        cofins_base_credito: '0.00',
      },
    ];
    const service = new PisCofinsService(
      createDb({ regimeTributario: 'LUCRO_PRESUMIDO' }, [saidas]) as never,
    );
    const result = await service.apurarCompetencia({
      clienteId: 'c1',
      competencia: '2026-09',
    });
    expect(result.pis.debito).toBe('0.00');
    expect(result.pis.base_monofasica_st).toBe('5000.00');
    expect(result.cofins.debito).toBe('0.00');
  });

  // F12 (regressão): mix de itens tributados, um com destaque e outro sem.
  // O débito por item (destaque OU base×alíquota) não pode perder a base do
  // item sem destaque. Duas bases de 1.000 a 0,65% ⇒ débito total 13,00.
  it('F12: mix com/sem destaque soma o débito de ambas as bases', async () => {
    // O SQL por item somaria: item com destaque 6,50 + item sem destaque
    // (1.000 × 0,65% = 6,50) = 13,00. base tributada agregada = 2.000.
    const saidas = [
      {
        pis_base_tributada: '2000.00',
        pis_debito: '13.00',
        pis_base_sem_debito: '0.00',
        pis_base_credito: '0.00',
        cofins_base_tributada: '2000.00',
        cofins_debito: '60.00',
        cofins_base_sem_debito: '0.00',
        cofins_base_credito: '0.00',
      },
    ];
    const service = new PisCofinsService(
      createDb({ regimeTributario: 'LUCRO_PRESUMIDO' }, [saidas]) as never,
    );
    const result = await service.apurarCompetencia({
      clienteId: 'c1',
      competencia: '2026-09',
    });
    // Não pode ficar só com o destaque de uma das bases (6,50): é 13,00.
    expect(result.pis.debito).toBe('13.00');
    expect(result.pis.saldo_a_recolher).toBe('13.00');
    expect(result.cofins.debito).toBe('60.00');
  });

  // F12 (fixture normativa): a linha derivada item a item da fixture bate com
  // o débito esperado calculado à mão e com o que o serviço apura.
  it('F12: fixture normativa (mix com/sem destaque) casa com a soma por item', () => {
    const linha = derivarLinhaSegmentoF12(PIS_COFINS_FIXTURE_F12);
    expect(linha.pis_debito).toBe(PIS_COFINS_FIXTURE_F12.debitoPisEsperado);
    expect(linha.cofins_debito).toBe(
      PIS_COFINS_FIXTURE_F12.debitoCofinsEsperado,
    );
    expect(linha.pis_base_tributada).toBe(
      PIS_COFINS_FIXTURE_F12.baseTributadaEsperada,
    );
  });

  // F12 (reconciliação "33,00" do plano): o mix com/sem destaque na alíquota
  // NÃO-CUMULATIVA (1,65%) soma 33,00 POR ITEM (16,50 do destaque + 16,50 do
  // fallback base × alíquota). Este é o "33,00" legítimo do plano: a soma item
  // a item — o fallback agregado ficaria só com um destaque (16,50), perdendo
  // metade da base. Falharia sob a agregação antiga.
  it('F12: mix 1,65% com/sem destaque soma 33,00 por item (nunca perde base)', async () => {
    const f = PIS_COFINS_FIXTURE_F12_33;
    const linha = derivarLinhaSegmentoF12(f);
    // Oráculo independente casa com o esperado escrito à mão (33,00 / 152,00).
    expect(linha.pis_debito).toBe(f.debitoPisEsperado);
    expect(linha.cofins_debito).toBe(f.debitoCofinsEsperado);

    const service = new PisCofinsService(
      createDb({ regimeTributario: f.regime }, [
        [linha],
        // entradas (LUCRO_REAL) — sem créditos neste cenário.
        [
          {
            pis_base_tributada: '0.00',
            pis_debito: '0.00',
            pis_base_sem_debito: '0.00',
            pis_base_credito: '0.00',
            cofins_base_tributada: '0.00',
            cofins_debito: '0.00',
            cofins_base_sem_debito: '0.00',
            cofins_base_credito: '0.00',
          },
        ],
      ]) as never,
    );
    const result = await service.apurarCompetencia({
      clienteId: 'c1',
      competencia: '2026-09',
    });
    // 33,00 — não 16,50 (o agregado perderia a base do item sem destaque).
    expect(result.pis.debito).toBe('33.00');
    expect(result.pis.saldo_a_recolher).toBe('33.00');
    expect(result.cofins.debito).toBe('152.00');
  });

  // F12 ("33,00 OU pendência" — os dois lados coexistem no MESMO segmento):
  // um mix válido soma a base normalmente (33,00) E, no mesmo segmento, um item
  // tributado inválido (sem destaque e sem base) surge como pendência. O débito
  // NÃO absorve o item inválido como zero silencioso; a pendência sinaliza a
  // revisão. Cobre a leitura do plano em que a soma correta e a pendência não
  // são mutuamente exclusivas.
  it('F12: mix soma 33,00 E item inválido no mesmo segmento vira pendência', async () => {
    const saidas = [
      {
        // 2.000 de base tributada válida ⇒ débito 33,00 (mix 1,65%).
        pis_base_tributada: '2000.00',
        pis_debito: '33.00',
        pis_base_sem_debito: '0.00',
        pis_base_credito: '0.00',
        // ...mais 1 item tributado inválido (sem destaque e sem base).
        pis_pendencias: '1',
        cofins_base_tributada: '2000.00',
        cofins_debito: '152.00',
        cofins_base_sem_debito: '0.00',
        cofins_base_credito: '0.00',
        cofins_pendencias: '1',
      },
    ];
    const service = new PisCofinsService(
      createDb({ regimeTributario: 'LUCRO_REAL' }, [
        saidas,
        [
          {
            pis_base_tributada: '0.00',
            pis_debito: '0.00',
            pis_base_sem_debito: '0.00',
            pis_base_credito: '0.00',
            cofins_base_tributada: '0.00',
            cofins_debito: '0.00',
            cofins_base_sem_debito: '0.00',
            cofins_base_credito: '0.00',
          },
        ],
      ]) as never,
    );
    const result = await service.apurarCompetencia({
      clienteId: 'c1',
      competencia: '2026-09',
    });
    // A base válida é somada (33,00) sem ser afetada pela pendência...
    expect(result.pis.debito).toBe('33.00');
    expect(result.cofins.debito).toBe('152.00');
    // ...e o item inválido aparece como pendência (não some num zero).
    expect(result.pis.itens_pendentes).toBe(1);
    expect(result.cofins.itens_pendentes).toBe(1);
  });

  // R5.2: dois itens SEM destaque com alíquotas por item diferentes. O fallback
  // base × alíquota deve usar a alíquota do ITEM (não a do regime). Aqui o
  // regime é 1,65%/7,60%, mas os itens têm alíquotas próprias; o débito por
  // item é 23,00 (PIS) e 106,00 (COFINS), não 33,00/152,00 do regime.
  it('R5.2: respeita a alíquota por item no fallback base × alíquota', async () => {
    const f = PIS_COFINS_FIXTURE_ALIQUOTA_ITEM;
    const linha = derivarLinhaSegmentoF12(f);
    // Sanidade: a derivação por item usa a alíquota do item, não do regime.
    expect(linha.pis_debito).toBe(f.debitoPisEsperado); // 23,00 (≠ 33,00)
    expect(linha.cofins_debito).toBe(f.debitoCofinsEsperado); // 106,00 (≠ 152,00)

    const service = new PisCofinsService(
      createDb({ regimeTributario: f.regime }, [
        [linha],
        // entradas (LUCRO_REAL) — sem créditos neste cenário.
        [
          {
            pis_base_tributada: '0.00',
            pis_debito: '0.00',
            pis_base_sem_debito: '0.00',
            pis_base_credito: '0.00',
            cofins_base_tributada: '0.00',
            cofins_debito: '0.00',
            cofins_base_sem_debito: '0.00',
            cofins_base_credito: '0.00',
          },
        ],
      ]) as never,
    );
    const result = await service.apurarCompetencia({
      clienteId: 'c1',
      competencia: '2026-09',
    });
    expect(result.pis.debito).toBe('23.00');
    expect(result.cofins.debito).toBe('106.00');
  });

  // R5.3 (zero informado ≠ ausente): um item tributado com destaque explícito
  // de 0,00 (sem imposto devido, mas informado) é honrado como débito 0 — NÃO
  // pode cair no fallback base × alíquota como se o valor estivesse faltando.
  //
  // O SQL usa `valorPis IS NOT NULL` para honrar o zero informado; o mock aqui
  // representa a linha que o PostgreSQL produziria: base tributada 1.000, mas
  // débito 0,00 porque o único item tributado tem destaque informado = 0,00.
  it('R5.3: zero informado num item tributado é respeitado, não vira base × alíquota', async () => {
    const saidas = [
      {
        pis_base_tributada: '1000.00',
        // destaque informado 0,00 ⇒ débito 0,00 (não 1.000 × 0,65% = 6,50).
        pis_debito: '0.00',
        pis_base_sem_debito: '0.00',
        pis_base_credito: '0.00',
        pis_pendencias: '0',
        cofins_base_tributada: '1000.00',
        cofins_debito: '0.00',
        cofins_base_sem_debito: '0.00',
        cofins_base_credito: '0.00',
        cofins_pendencias: '0',
      },
    ];
    const service = new PisCofinsService(
      createDb({ regimeTributario: 'LUCRO_PRESUMIDO' }, [saidas]) as never,
    );
    const result = await service.apurarCompetencia({
      clienteId: 'c1',
      competencia: '2026-09',
    });
    // Débito permanece 0,00 (zero informado respeitado), sem pendência.
    expect(result.pis.debito).toBe('0.00');
    expect(result.pis.itens_pendentes).toBe(0);
    expect(result.cofins.debito).toBe('0.00');
    expect(result.cofins.itens_pendentes).toBe(0);
  });

  // R5.3 (ausente ⇒ fallback): quando o destaque está AUSENTE (NULL) mas há
  // base, o SQL calcula base × alíquota. Item tributado sem destaque, base
  // 1.000 ⇒ 1.000 × 0,65% = 6,50 (PIS) e × 3% = 30,00 (COFINS).
  it('R5.3: destaque ausente com base presente cai em base × alíquota', async () => {
    const saidas = [
      {
        pis_base_tributada: '1000.00',
        pis_debito: '6.50',
        pis_base_sem_debito: '0.00',
        pis_base_credito: '0.00',
        pis_pendencias: '0',
        cofins_base_tributada: '1000.00',
        cofins_debito: '30.00',
        cofins_base_sem_debito: '0.00',
        cofins_base_credito: '0.00',
        cofins_pendencias: '0',
      },
    ];
    const service = new PisCofinsService(
      createDb({ regimeTributario: 'LUCRO_PRESUMIDO' }, [saidas]) as never,
    );
    const result = await service.apurarCompetencia({
      clienteId: 'c1',
      competencia: '2026-09',
    });
    expect(result.pis.debito).toBe('6.50');
    expect(result.pis.itens_pendentes).toBe(0);
    expect(result.cofins.debito).toBe('30.00');
  });

  // R5.4 (proibir fallback silencioso em valor inválido): item tributado SEM
  // destaque E SEM base não tem de onde calcular. Ele NÃO entra no débito com
  // um 0 silencioso — surge como pendência (itens_pendentes > 0) para revisão.
  it('R5.4: item tributado sem destaque e sem base surge como pendência, não zero silencioso', async () => {
    const saidas = [
      {
        // sem base tributável apurável ⇒ base tributada 0, débito 0, mas...
        pis_base_tributada: '0.00',
        pis_debito: '0.00',
        pis_base_sem_debito: '0.00',
        pis_base_credito: '0.00',
        // ...1 item tributado inválido (destaque e base ausentes) ⇒ pendência.
        pis_pendencias: '1',
        cofins_base_tributada: '0.00',
        cofins_debito: '0.00',
        cofins_base_sem_debito: '0.00',
        cofins_base_credito: '0.00',
        cofins_pendencias: '1',
      },
    ];
    const service = new PisCofinsService(
      createDb({ regimeTributario: 'LUCRO_PRESUMIDO' }, [saidas]) as never,
    );
    const result = await service.apurarCompetencia({
      clienteId: 'c1',
      competencia: '2026-09',
    });
    // O débito é 0, mas a pendência sinaliza que NÃO é um zero apurado válido.
    expect(result.pis.debito).toBe('0.00');
    expect(result.pis.itens_pendentes).toBe(1);
    expect(result.cofins.debito).toBe('0.00');
    expect(result.cofins.itens_pendentes).toBe(1);
  });

  // R5.5 (COFINS simétrico): o mesmo tratamento por item (mix com/sem destaque,
  // zero informado, alíquota por item, pendência) vale para COFINS tal como
  // para PIS. Aqui um mix de COFINS: item com destaque 30,00 + item sem
  // destaque (1.000 × 3% = 30,00) = 60,00, com pendência independente do PIS.
  it('R5.5: COFINS trata mix/pendência de forma simétrica ao PIS', async () => {
    const saidas = [
      {
        pis_base_tributada: '2000.00',
        pis_debito: '13.00',
        pis_base_sem_debito: '0.00',
        pis_base_credito: '0.00',
        pis_pendencias: '0',
        cofins_base_tributada: '2000.00',
        cofins_debito: '60.00',
        cofins_base_sem_debito: '0.00',
        cofins_base_credito: '0.00',
        // COFINS pode ter pendência própria, distinta do PIS.
        cofins_pendencias: '2',
      },
    ];
    const service = new PisCofinsService(
      createDb({ regimeTributario: 'LUCRO_PRESUMIDO' }, [saidas]) as never,
    );
    const result = await service.apurarCompetencia({
      clienteId: 'c1',
      competencia: '2026-09',
    });
    expect(result.cofins.debito).toBe('60.00');
    expect(result.cofins.base_tributada).toBe('2000.00');
    expect(result.cofins.itens_pendentes).toBe(2);
    // PIS não é contaminado pela pendência de COFINS (segmentos independentes).
    expect(result.pis.itens_pendentes).toBe(0);
  });

  // R5.5 (arredondamento consistente crédito × débito): o débito usa ROUND(.,2)
  // por item; o crédito DEVE arredondar a 2 casas do mesmo jeito (meia casa
  // para cima), não truncar. Base de crédito 100,10 × 7,60% = 7,6076 ⇒ 7,61
  // (arredondado). A divisão truncada daria 7,60 — divergente do débito.
  it('R5.5: crédito arredonda a 2 casas (half-up) como o débito, não trunca', async () => {
    const saidas = [
      {
        pis_base_tributada: '0.00',
        pis_debito: '0.00',
        pis_base_sem_debito: '0.00',
        pis_base_credito: '0.00',
        pis_pendencias: '0',
        cofins_base_tributada: '0.00',
        cofins_debito: '0.00',
        cofins_base_sem_debito: '0.00',
        cofins_base_credito: '0.00',
        cofins_pendencias: '0',
      },
    ];
    const entradas = [
      {
        pis_base_tributada: '0.00',
        pis_debito: '0.00',
        pis_base_sem_debito: '0.00',
        // PIS: 100,10 × 1,65% = 1,65165 ⇒ 1,65 (arredondado; truncado daria 1,65
        // também aqui — o caso decisivo é COFINS abaixo).
        pis_base_credito: '100.10',
        cofins_base_tributada: '0.00',
        cofins_debito: '0.00',
        cofins_base_sem_debito: '0.00',
        // COFINS: 100,10 × 7,60% = 7,6076 ⇒ 7,61 arredondado (≠ 7,60 truncado).
        cofins_base_credito: '100.10',
      },
    ];
    const service = new PisCofinsService(
      createDb({ regimeTributario: 'LUCRO_REAL' }, [saidas, entradas]) as never,
    );
    const result = await service.apurarCompetencia({
      clienteId: 'c1',
      competencia: '2026-09',
    });
    expect(result.cofins.credito).toBe('7.61');
    expect(result.pis.credito).toBe('1.65');
  });

  // R5.5 (reduções): PIS/COFINS NÃO têm campo de percentual de redução de base
  // no layout (ao contrário do ICMS, que tem `percentualReducaoBcIcms`). A base
  // `valorBcPis`/`valorBcCofins` já é a base final líquida de qualquer redução,
  // conforme informada no documento. Portanto o serviço usa a base tal como
  // armazenada — não aplica redução adicional — evitando dupla redução. Este
  // teste documenta e trava esse contrato: base 800,00 (já reduzida) × 0,65% =
  // 5,20, sem qualquer redução extra sobre a base.
  it('R5.5: base de PIS/COFINS já reflete a redução — sem dupla redução', async () => {
    const saidas = [
      {
        // Base já reduzida (ex.: de 1.000,00 para 800,00 no documento).
        pis_base_tributada: '800.00',
        // Débito por item sobre a base já reduzida: 800 × 0,65% = 5,20.
        pis_debito: '5.20',
        pis_base_sem_debito: '0.00',
        pis_base_credito: '0.00',
        pis_pendencias: '0',
        cofins_base_tributada: '800.00',
        // 800 × 3% = 24,00.
        cofins_debito: '24.00',
        cofins_base_sem_debito: '0.00',
        cofins_base_credito: '0.00',
        cofins_pendencias: '0',
      },
    ];
    const service = new PisCofinsService(
      createDb({ regimeTributario: 'LUCRO_PRESUMIDO' }, [saidas]) as never,
    );
    const result = await service.apurarCompetencia({
      clienteId: 'c1',
      competencia: '2026-09',
    });
    // A base apurada é exatamente a base já reduzida (nenhuma redução extra).
    expect(result.pis.base_tributada).toBe('800.00');
    expect(result.pis.debito).toBe('5.20');
    expect(result.cofins.base_tributada).toBe('800.00');
    expect(result.cofins.debito).toBe('24.00');
  });
});
