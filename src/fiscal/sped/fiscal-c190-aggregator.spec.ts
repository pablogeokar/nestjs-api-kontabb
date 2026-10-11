import { fromScaledInteger } from './sped-decimal';
import {
  aggregateC190Analitico,
  normalizeC190Cst,
  type C190ItemInput,
} from './fiscal-c190-aggregator';

function makeItem(overrides: Partial<C190ItemInput> = {}): C190ItemInput {
  return {
    cstIcms: '00',
    csosnIcms: null,
    origemMercadoria: '0',
    cfop: '1102',
    aliquotaIcms: '18.00',
    percentualReducaoBcIcms: null,
    valorBrutoProduto: '100.00',
    valorDesconto: '0.00',
    valorFrete: '0.00',
    valorSeguro: '0.00',
    valorOutrasDespesas: '0.00',
    valorBcIcms: '100.00',
    valorIcms: '18.00',
    valorBcIcmsSt: '0.00',
    valorIcmsSt: '0.00',
    valorFcpSt: '0.00',
    valorIpi: '0.00',
    ...overrides,
  };
}

describe('normalizeC190Cst (R5.2)', () => {
  it('prefixa a origem exatamente uma vez em CST puro de 2 dígitos', () => {
    expect(normalizeC190Cst(makeItem({ cstIcms: '00', origemMercadoria: '0' }))).toBe(
      '000',
    );
    expect(normalizeC190Cst(makeItem({ cstIcms: '20', origemMercadoria: '2' }))).toBe(
      '220',
    );
  });

  it('não reprefixa a origem em CST já composto de 3 dígitos', () => {
    const cst = normalizeC190Cst(makeItem({ cstIcms: '000' }));
    expect(cst).toBe('000');
    expect(cst).not.toBe('0000');
  });

  it('usa o CSOSN quando não há CST de ICMS (Simples)', () => {
    expect(
      normalizeC190Cst(makeItem({ cstIcms: null, csosnIcms: '102' })),
    ).toBe('102');
  });

  it('assume origem 0 quando a origem está ausente', () => {
    expect(
      normalizeC190Cst(makeItem({ cstIcms: '40', origemMercadoria: null })),
    ).toBe('040');
  });

  it('prefixa a origem uma vez mesmo com origem não-zero ausente de dupla aplicação', () => {
    // Origem 2 + CST 20 → '220' exatamente uma vez; nunca '2220' nem '20'.
    const cst = normalizeC190Cst(
      makeItem({ cstIcms: '20', origemMercadoria: '2' }),
    );
    expect(cst).toBe('220');
    expect(cst).toHaveLength(3);
  });

  it('não reprefixa quando a origem ausente mas o CST já vem composto', () => {
    // CST composto (3 dígitos) com origem ausente: mantém o composto, sem
    // inventar prefixo (evita dupla origem).
    expect(
      normalizeC190Cst(makeItem({ cstIcms: '220', origemMercadoria: null })),
    ).toBe('220');
  });
});

describe('aggregateC190Analitico', () => {
  it('R5.1: CST 40 isento sem redução não gera valor de redução de base', () => {
    const [linha] = aggregateC190Analitico([
      makeItem({
        cstIcms: '40',
        aliquotaIcms: '0.00',
        valorBcIcms: '0.00',
        valorIcms: '0.00',
        percentualReducaoBcIcms: null,
      }),
    ]);

    // A diferença líquido(100) × base(0) NÃO é classificada como redução.
    expect(fromScaledInteger(linha.valorReducaoBc)).toBe('0.00');
  });

  it('R5.1: percentual de redução zero explícito (0.00) não gera redução', () => {
    const [linha] = aggregateC190Analitico([
      makeItem({
        cstIcms: '00',
        aliquotaIcms: '18.00',
        valorBrutoProduto: '100.00',
        // Percentual presente porém zero: NÃO é redução efetiva.
        percentualReducaoBcIcms: '0.00',
        // Base menor que o líquido por outro motivo (ex.: dado inconsistente):
        // sem percentual efetivo, a diferença não vira redução.
        valorBcIcms: '80.00',
        valorIcms: '14.40',
      }),
    ]);

    expect(fromScaledInteger(linha.valorReducaoBc)).toBe('0.00');
  });

  it('R5.1: redução nunca é negativa quando a base excede o líquido', () => {
    const [linha] = aggregateC190Analitico([
      makeItem({
        cstIcms: '20',
        aliquotaIcms: '18.00',
        valorBrutoProduto: '100.00',
        percentualReducaoBcIcms: '10.00',
        // Base (120) > líquido (100): a diferença negativa é saturada em 0.
        valorBcIcms: '120.00',
        valorIcms: '21.60',
      }),
    ]);

    expect(fromScaledInteger(linha.valorReducaoBc)).toBe('0.00');
  });

  it('R5.1: redução de base entra apenas com percentual efetivo', () => {
    const [linha] = aggregateC190Analitico([
      makeItem({
        cstIcms: '20',
        origemMercadoria: '0',
        aliquotaIcms: '18.00',
        valorBrutoProduto: '100.00',
        percentualReducaoBcIcms: '40.00',
        valorBcIcms: '60.00',
        valorIcms: '10.80',
      }),
    ]);

    // líquido(100) - base(60) = 40 de redução, pois o percentual é efetivo.
    expect(fromScaledInteger(linha.valorReducaoBc)).toBe('40.00');
  });

  it('R5.3: normaliza a alíquota antes da chave (18 e 18.00 agrupam juntos)', () => {
    const linhas = aggregateC190Analitico([
      makeItem({ aliquotaIcms: '18', valorIcms: '18.00', valorBcIcms: '100.00' }),
      makeItem({
        aliquotaIcms: '18.00',
        valorIcms: '18.00',
        valorBcIcms: '100.00',
      }),
    ]);

    expect(linhas).toHaveLength(1);
    expect(linhas[0].aliquota).toBe('18.00');
    expect(fromScaledInteger(linhas[0].valorIcms)).toBe('36.00');
    expect(fromScaledInteger(linhas[0].valorBcIcms)).toBe('200.00');
  });

  it('R5.3: normaliza variantes com vírgula e casas finas na chave', () => {
    // '18', '18,0000' e '18.0000' são a mesma alíquota: um único grupo,
    // emitido a 2 casas.
    const linhas = aggregateC190Analitico([
      makeItem({ aliquotaIcms: '18', valorIcms: '18.00', valorBcIcms: '100.00' }),
      makeItem({
        aliquotaIcms: '18,0000',
        valorIcms: '18.00',
        valorBcIcms: '100.00',
      }),
      makeItem({
        aliquotaIcms: '18.0000',
        valorIcms: '18.00',
        valorBcIcms: '100.00',
      }),
    ]);

    expect(linhas).toHaveLength(1);
    expect(linhas[0].aliquota).toBe('18.00');
    expect(fromScaledInteger(linhas[0].valorIcms)).toBe('54.00');
  });

  it('R5.3: alíquotas com fração fina distinta não colidem no agrupamento', () => {
    // 18.0000 e 18.2500 diferem na precisão de 4 casas: dois grupos.
    const linhas = aggregateC190Analitico([
      makeItem({ aliquotaIcms: '18.0000', valorBcIcms: '100.00' }),
      makeItem({ aliquotaIcms: '18.2500', valorBcIcms: '100.00' }),
    ]);

    expect(linhas).toHaveLength(2);
    // A emissão arredonda a 2 casas (18.00 e 18.25) sem fundir os grupos.
    expect(linhas.map((linha) => linha.aliquota).sort()).toEqual([
      '18.00',
      '18.25',
    ]);
  });

  it('R5.2: CST puro e CST já composto da mesma origem caem no mesmo grupo', () => {
    // '00' (origem 0) e '000' representam o mesmo CST normalizado: a chave usa
    // o CST normalizado, então não há dupla origem criando grupos duplicados.
    const linhas = aggregateC190Analitico([
      makeItem({
        cstIcms: '00',
        origemMercadoria: '0',
        valorIcms: '18.00',
        valorBcIcms: '100.00',
      }),
      makeItem({
        cstIcms: '000',
        origemMercadoria: '0',
        valorIcms: '18.00',
        valorBcIcms: '100.00',
      }),
    ]);

    expect(linhas).toHaveLength(1);
    expect(linhas[0].cst).toBe('000');
    expect(fromScaledInteger(linhas[0].valorBcIcms)).toBe('200.00');
  });

  it('R5.3: separa linhas por CST, CFOP e alíquota distintos', () => {
    const linhas = aggregateC190Analitico([
      makeItem({ cfop: '1102', aliquotaIcms: '18.00' }),
      makeItem({ cfop: '1102', aliquotaIcms: '12.00' }),
      makeItem({ cfop: '2102', aliquotaIcms: '18.00' }),
    ]);

    expect(linhas).toHaveLength(3);
  });

  it('compõe o VL_OPR com ST, FCP ST e IPI além do líquido', () => {
    const [linha] = aggregateC190Analitico([
      makeItem({
        valorBrutoProduto: '100.00',
        valorDesconto: '10.00',
        valorFrete: '5.00',
        valorSeguro: '2.00',
        valorOutrasDespesas: '3.00',
        valorIcmsSt: '8.00',
        valorFcpSt: '1.00',
        valorIpi: '4.00',
      }),
    ]);

    // líquido = 100 - 10 + 5 + 2 + 3 = 100; + ST 8 + FCP ST 1 + IPI 4 = 113.
    expect(fromScaledInteger(linha.valorOperacao)).toBe('113.00');
  });

  it('ordena as linhas de forma estável pela chave (reprodutibilidade)', () => {
    const linhas = aggregateC190Analitico([
      makeItem({ cfop: '2102', aliquotaIcms: '18.00' }),
      makeItem({ cfop: '1102', aliquotaIcms: '18.00' }),
    ]);

    expect(linhas.map((linha) => linha.cfop)).toEqual(['1102', '2102']);
  });

  it('retorna lista vazia para entrada vazia', () => {
    expect(aggregateC190Analitico([])).toEqual([]);
  });

  it('R5.4: a decomposição não depende da ordem de entrada dos itens', () => {
    const itens = [
      makeItem({ cfop: '1102', aliquotaIcms: '18.00', valorIcms: '18.00' }),
      makeItem({ cfop: '1102', aliquotaIcms: '18.00', valorIcms: '12.00' }),
    ];
    const diretos = aggregateC190Analitico(itens);
    const invertidos = aggregateC190Analitico([...itens].reverse());

    expect(invertidos).toEqual(diretos);
    expect(fromScaledInteger(diretos[0].valorIcms)).toBe('30.00');
  });
});
