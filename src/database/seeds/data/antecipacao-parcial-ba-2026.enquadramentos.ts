// Enquadramentos de Antecipação Parcial da BA para 2026 (gerado a partir das
// entradas interestaduais do banco de desenvolvimento em 14/11/2026).
// Fundamentação por linha em docs/antecipacao-parcial-ba-2026-fundamentacao.md.
// Nenhuma linha está confirmada fiscalmente: o seed grava rascunho.

export interface EnquadramentoAntecipacaoSeed {
  ncm: string;
  cest: string | null;
  regime: 'SIMPLES_NACIONAL' | 'LUCRO_PRESUMIDO' | 'LUCRO_REAL';
  uf_origem: string;
  origem_mercadoria: string;
  tratamento: 'APLICAVEL' | 'ICMS_ST' | 'DISPENSADO' | 'CONFERIR';
  aliquota_interna?: string;
  aliquota_interestadual?: string;
  motivo?: string;
  fundamento?: string;
  revisao_fiscal?: string;
  confirmado_fiscalmente: boolean;
}

export const ENQUADRAMENTOS_ANTECIPACAO_BA_2026: EnquadramentoAntecipacaoSeed[] =
  [
    {
      ncm: '00000000',
      cest: null,
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'SP',
      origem_mercadoria: '0',
      confirmado_fiscalmente: false,
      tratamento: 'CONFERIR',
      motivo:
        'NCM 00000000 não é código válido da NCM; reclassificar o item (SUPORTE DA ROLDANA INOX) antes de definir o tratamento.',
    },
    {
      ncm: '17041000',
      cest: '2804100',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'SE',
      origem_mercadoria: '0',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '12',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º (origem SE → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'CEST 28.041.00 informado no XML pertence ao Anexo XXVI do Conv. ICMS 142/18 (porta a porta, "bolsas de outras matérias", NCM 4202.29.00) e não corresponde ao NCM 1704 (Conv. 142/18, cl. 7ª, § 1º). Pedir correção do CEST ao fornecedor. Evidência: 15 item(ns) de entrada; descrição no XML: CHICLE BUZZY 090UNX4G TATTOO TRIBAL HORT CX 20DP QTD. 10.00 CX | CICLE FLORESTAL CLISS CART MENTA 201G CX24UN QTD. 20.00 CX',
    },
    {
      ncm: '17049020',
      cest: '1700100',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'CE',
      origem_mercadoria: '0',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '12',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º (origem CE → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'Evidência: 1 item(ns) de entrada; descrição no XML: PIRUILITO MEGALITO MEGA XTREME 900GR',
    },
    {
      ncm: '17049020',
      cest: '1700900',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'CE',
      origem_mercadoria: '0',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '12',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º (origem CE → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'Evidência: 6 item(ns) de entrada; descrição no XML: BALA SANTA FE HORTELA 600GR | PIRULITO BERBAU MEGALITO SORT 1KG',
    },
    {
      ncm: '17049020',
      cest: '2804100',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'SE',
      origem_mercadoria: '0',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '12',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º (origem SE → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'CEST 28.041.00 informado no XML pertence ao Anexo XXVI do Conv. ICMS 142/18 (porta a porta, "bolsas de outras matérias", NCM 4202.29.00) e não corresponde ao NCM 1704 (Conv. 142/18, cl. 7ª, § 1º). Pedir correção do CEST ao fornecedor. Evidência: 8 item(ns) de entrada; descrição no XML: BALA DURA ICEKISS AZED CHICLE MORANG400G FD24UN QTD. 9.00 FD | PIRULITO SAMS CHERRY POP MARACUJA 50UN CX24PT QTD. 10.00 CX',
    },
    {
      ncm: '17049020',
      cest: '2804100',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'SE',
      origem_mercadoria: '5',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '12',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º (origem SE → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'CEST 28.041.00 informado no XML pertence ao Anexo XXVI do Conv. ICMS 142/18 (porta a porta, "bolsas de outras matérias", NCM 4202.29.00) e não corresponde ao NCM 1704 (Conv. 142/18, cl. 7ª, § 1º). Pedir correção do CEST ao fornecedor. Evidência: 1 item(ns) de entrada; descrição no XML: MENTOS SLIM BOX 9P 12UNX24,1G TUTTI FRUT CX 24DP QTD. 3.00 CX',
    },
    {
      ncm: '17049090',
      cest: '1704700',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'SE',
      origem_mercadoria: '0',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '12',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º (origem SE → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'CEST 17.047.00 informado no XML é de massas alimentícias e não corresponde a pirulito (NCM 1704.90.90). O NCM 1704 não consta do Anexo 1 do RICMS-BA 2026. Pedir correção do CEST ao fornecedor. Evidência: 1 item(ns) de entrada; descrição no XML: PIRULITO PECCIN BLONG ENERGY 672G CX12PT QTD. 5.00 CX',
    },
    {
      ncm: '18063120',
      cest: '1700202',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'SP',
      origem_mercadoria: '0',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '7',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º, par. único, I (origem SP → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'Evidência: 4 item(ns) de entrada; descrição no XML: KITRUFA BEIJINHO POTE 6X510G | KITRUFA MARACUJA POTE 6X510G',
    },
    {
      ncm: '18063220',
      cest: '1700301',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'SP',
      origem_mercadoria: '0',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '7',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º, par. único, I (origem SP → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'Evidência: 3 item(ns) de entrada; descrição no XML: BICHO MANIA AO LEITE DISP 12X192G | PURISSIMO KIDS MEIO AMARGO 20G DISP 6X400G',
    },
    {
      ncm: '19012090',
      cest: '2300200',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'SE',
      origem_mercadoria: '0',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '12',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º (origem SE → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'CEST 23.002.00 (preparados para sorvete) não consta do Anexo 1 do RICMS-BA 2026 (item 15.1 lista só 23.001.00). NCM 1901.20 aparece nos itens 11.3/11.4 apenas para misturas para pães (CEST 17.046.xx), descrição diferente do produto. Conferir a classificação do DUCREM. Evidência: 2 item(ns) de entrada; descrição no XML: DUCREM JAZAM LOVE NAPOLITANO DP18X25G CX18DP QTD. 10.00 CX | DUCREM JAZAM NAPOLITANO DP48X10G CX20DP QTD. 15.00 CX',
    },
    {
      ncm: '19041000',
      cest: '1703000',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'PE',
      origem_mercadoria: '0',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '12',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º (origem PE → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'Evidência: 16 item(ns) de entrada; descrição no XML: SALGADINHO LAM CARNE SECA S/CAT 30G BROTINHOS - 10PCTX10UN | SALGADINHO LAM SORTIDO S/CAT 50G BROTINHOS - 12PCTX10UN',
    },
    {
      ncm: '19053100',
      cest: '1705301',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'SE',
      origem_mercadoria: '0',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '12',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º (origem SE → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'Evidência: 2 item(ns) de entrada; descrição no XML: COQUINHO CAIXA 24 X 300 G | MAIZENA 24 X 350 G',
    },
    {
      ncm: '19053100',
      cest: '1705301',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'SP',
      origem_mercadoria: '0',
      confirmado_fiscalmente: false,
      tratamento: 'CONFERIR',
      motivo:
        'Descrições "BROINHA DE MILHO" e "PAO DE MEL" sugerem produto de panificação (NCM 1905.90.90, CEST 17.062.01), que está sujeito a ST no Anexo 1 do RICMS-BA, item 11.18.1 (Prot. ICMS 53/17). O XML declara 1905.31.00/17.053.01 (biscoitos, itens 11.11.x revogados). Confirmar a classificação com o fornecedor.',
    },
    {
      ncm: '19053100',
      cest: '1705302',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'SE',
      origem_mercadoria: '0',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '12',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º (origem SE → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'Evidência: 1 item(ns) de entrada; descrição no XML: CREAM CRACKER 24 X 350 G',
    },
    {
      ncm: '29242999',
      cest: '2804300',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'SE',
      origem_mercadoria: '0',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '12',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º (origem SE → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'Produto descrito como drágea MENTOS com NCM 2924.29.99 (químico) e CEST 28.043.00 (porta a porta, NCM 4202.92.00): ambos incompatíveis com a descrição. Nenhum dos códigos está em ST na BA; a alíquota resultante é a mesma (20,5%). Pedir correção ao fornecedor. Evidência: 1 item(ns) de entrada; descrição no XML: MENTOS SLIM BOX 9P 12UNX24,1G SPEARMINT CX 24DP QTD. 4.00 CX',
    },
    {
      ncm: '33074900',
      cest: null,
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'SP',
      origem_mercadoria: '0',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '7',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º, par. único, I (origem SP → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'Evidência: 3 item(ns) de entrada; descrição no XML: DIFUSOR DE AROMAS ALECRIM 100ML | ODORIZANTE DE AMBIENTES E TECIDOS CHA BRANCO 260ML',
    },
    {
      ncm: '34012010',
      cest: '2003600',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'MG',
      origem_mercadoria: '5',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '7',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º, par. único, I (origem MG → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'Evidência: 1 item(ns) de entrada; descrição no XML: HIGI CALCINHA ORIGINAL SAB LIQ 12X300ML',
    },
    {
      ncm: '34013000',
      cest: '2003700',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'SP',
      origem_mercadoria: '0',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '7',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º, par. único, I (origem SP → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'Evidência: 1 item(ns) de entrada; descrição no XML: SABONETE LIQUIDO ALECRIM 500ML',
    },
    {
      ncm: '34025000',
      cest: '1100600',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'SP',
      origem_mercadoria: '0',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '7',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º, par. único, I (origem SP → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'Evidência: 1 item(ns) de entrada; descrição no XML: LAVA ROUPAS LIQUIDO CHA BRANCO COALA LAUNDRY - UNIDADE',
    },
    {
      ncm: '34029029',
      cest: '1100700',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'SP',
      origem_mercadoria: '0',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '7',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º, par. único, I (origem SP → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'Evidência: 4 item(ns) de entrada; descrição no XML: ESSENCIA LIMP.CONC.COALA ALECRIM 120ML | ESSENCIA LIMP.CONC.COALA CITRONELA 120ML',
    },
    {
      ncm: '34029090',
      cest: '1100700',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'SP',
      origem_mercadoria: '0',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '7',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º, par. único, I (origem SP → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'Evidência: 2 item(ns) de entrada; descrição no XML: LIMPADOR PERFUMADO CHA BRANCO COALA 500ML | LIMPADOR PERFUMADO CHA BRANCO ZULU PERFUMES 12X500ML',
    },
    {
      ncm: '38089419',
      cest: null,
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'MG',
      origem_mercadoria: '5',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '7',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º, par. único, I (origem MG → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'Evidência: 1 item(ns) de entrada; descrição no XML: DESINF. HORTIFRUTICOLA QUALIFOOD 12X350ML',
    },
    {
      ncm: '38089429',
      cest: null,
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'MG',
      origem_mercadoria: '5',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '7',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º, par. único, I (origem MG → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'Evidência: 1 item(ns) de entrada; descrição no XML: HIG ASSEPTGEL CRISTAL CX 24X420G',
    },
    {
      ncm: '38099190',
      cest: '1100800',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'SP',
      origem_mercadoria: '0',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '7',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º, par. único, I (origem SP → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'Evidência: 2 item(ns) de entrada; descrição no XML: AMACIANTE DE ROUPAS CONCENTRADO CHA BRANCO COALA LAUNDRY - UNIDADE | FACILITADOR DE PASSAR ROUPA ZULU PERFUMES COALA 12X500 ML',
    },
    {
      ncm: '39169090',
      cest: null,
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'SP',
      origem_mercadoria: '0',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '7',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º, par. único, I (origem SP → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'NCM 3916 aparece no Anexo 1 do RICMS-BA, item 8.5 (CEST 10.005.00), só para revestimentos de PVC para construção. A roldana de nylon não corresponde à descrição (Conv. ICMS 142/18, cl. 7ª, § 1º). Evidência: 1 item(ns) de entrada; descrição no XML: ROLDANA DE NYLON 70MM X 60MM',
    },
    {
      ncm: '39269090',
      cest: null,
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'SC',
      origem_mercadoria: '0',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '7',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º, par. único, I (origem SC → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'NCM 3926.9 aparece no Anexo 1 do RICMS-BA, item 8.20 (CEST 10.020.00), só para obras de plástico para construção. O suporte para notebook não corresponde à descrição (Conv. ICMS 142/18, cl. 7ª, § 1º). Evidência: 1 item(ns) de entrada; descrição no XML: SUPORTE REGULAVEL PARA NOTEBOOK PRETO BRIGHT',
    },
    {
      ncm: '40161090',
      cest: null,
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'SC',
      origem_mercadoria: '1',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '4',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 13/2012 (origem 1: importado/conteúdo de importação > 40%). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'Evidência: 2 item(ns) de entrada; descrição no XML: MOUSE PAD COM APOIO | MOUSE PAD OFFICE PRETO',
    },
    {
      ncm: '42029200',
      cest: '1900500',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'SP',
      origem_mercadoria: '1',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '4',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 13/2012 (origem 1: importado/conteúdo de importação > 40%). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'Evidência: 2 item(ns) de entrada; descrição no XML: Mochila Dell 14-16 EcoLoop CP3724',
    },
    {
      ncm: '82089000',
      cest: null,
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'SP',
      origem_mercadoria: '0',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '7',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º, par. único, I (origem SP → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'Evidência: 1 item(ns) de entrada; descrição no XML: EIXO ROLDANA TREF 1"X62MM',
    },
    {
      ncm: '83052000',
      cest: null,
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'SC',
      origem_mercadoria: '2',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '4',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 13/2012 (origem 2: importado/conteúdo de importação > 40%). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'Evidência: 1 item(ns) de entrada; descrição no XML: GRAMPOS GALVANIZADO 26/6 ATE 30F C/5000 UNIDADES',
    },
    {
      ncm: '84145990',
      cest: '2108800',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'MG',
      origem_mercadoria: '6',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '7',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º, par. único, I (origem MG → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'NCM 8414.59.90 também consta do Anexo II do Conv. ICMS 142/18 (autopeças, CEST 01.094.00). O XML informa CEST 21.088.00 (eletrônicos, sem ST na BA) e a descrição é de cooler/base para computador, não autopeça. A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 6 item(ns) de entrada; descrição no XML: BASE P/NOTEBOOK 14  NBC-11BK C3TECH | COOLER FAN F9-L160BK RGB 1...',
    },
    {
      ncm: '84145990',
      cest: '2108800',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'SC',
      origem_mercadoria: '2',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '4',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 13/2012 (origem 2: importado/conteúdo de importação > 40%). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'NCM 8414.59.90 também consta do Anexo II do Conv. ICMS 142/18 (autopeças, CEST 01.094.00). O XML informa CEST 21.088.00 (eletrônicos, sem ST na BA) e a descrição é de cooler/base para computador, não autopeça. A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 1 item(ns) de entrada; descrição no XML: WATER COOLER GAMEMAX ICEBURG 120 BLACK ARGB ICEBURGD120BK',
    },
    {
      ncm: '84248990',
      cest: '2109900',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'MG',
      origem_mercadoria: '0',
      confirmado_fiscalmente: false,
      tratamento: 'CONFERIR',
      motivo:
        'NCM 8424.89.90 consta do Anexo I do Conv. ICMS 52/91 (item 20.6, "outros aparelhos de pulverização"). Se abrangido, RICMS-BA art. 266, I, "a" (carga 8,80%) deve ser considerado na antecipação parcial (art. 268, § 3º). Confirmar se o pulverizador manual 500 ml está no alcance do convênio.',
    },
    {
      ncm: '84433111',
      cest: '2101600',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'GO',
      origem_mercadoria: '2',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '4',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 13/2012 (origem 2: importado/conteúdo de importação > 40%). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 2 item(ns) de entrada; descrição no XML: IMP. CANON MULT. MEGA TANK G3110 | IMP MULT TANK COLOR HP 9130 WF BIV',
    },
    {
      ncm: '84433111',
      cest: '2101600',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'PE',
      origem_mercadoria: '2',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '4',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 13/2012 (origem 2: importado/conteúdo de importação > 40%). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 1 item(ns) de entrada; descrição no XML: Multifuncional Tanque de Tinta Canon Mega Tank G3110 Wi Fi',
    },
    {
      ncm: '84433113',
      cest: '2101600',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'ES',
      origem_mercadoria: '2',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '4',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 13/2012 (origem 2: importado/conteúdo de importação > 40%). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 1 item(ns) de entrada; descrição no XML: MULTIFUNCIONAL LASER MONO BROTHER DCPL2540DW 30PPM/CM 10.000',
    },
    {
      ncm: '84433113',
      cest: '2101600',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'ES',
      origem_mercadoria: '4',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '12',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º (origem ES → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 1 item(ns) de entrada; descrição no XML: MULTIFUNCIONAL HP LASERJET PRO MONO MFP 4103FDW DUPLEX REDE',
    },
    {
      ncm: '84433240',
      cest: '2101700',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'ES',
      origem_mercadoria: '7',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '12',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º (origem ES → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 1 item(ns) de entrada; descrição no XML: IMPRESSORA LASER MONO BROTHER HLL5212DW 48PPM/CM 90.000',
    },
    {
      ncm: '84433240',
      cest: '2101700',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'GO',
      origem_mercadoria: '7',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '12',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º (origem GO → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 1 item(ns) de entrada; descrição no XML: IMP. BROTHER LASER MONO HLL5212DW',
    },
    {
      ncm: '84433299',
      cest: '2101700',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'ES',
      origem_mercadoria: '2',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '4',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 13/2012 (origem 2: importado/conteúdo de importação > 40%). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 1 item(ns) de entrada; descrição no XML: IMPRESSORA DE ETIQUETA ZEBRA ZD220 USB',
    },
    {
      ncm: '84433299',
      cest: '2101700',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'ES',
      origem_mercadoria: '4',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '12',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º (origem ES → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 2 item(ns) de entrada; descrição no XML: IMPRESSORA ELGIN TERMICA NAO FISCAL I8 USBSERIALETHERNET C GUILHOTINA | IMPRESSORA TERMICA DE ETIQUETAS ELGIN L42PRO FULL',
    },
    {
      ncm: '84433299',
      cest: '2101700',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'GO',
      origem_mercadoria: '4',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '12',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º (origem GO → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 1 item(ns) de entrada; descrição no XML: IMPRESSORA ELGIN TERMICA NAO FISCAL I8 USBSERIALETHERNET C GUILHOTINA',
    },
    {
      ncm: '84433299',
      cest: '2101700',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'MG',
      origem_mercadoria: '5',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '7',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º, par. único, I (origem MG → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 1 item(ns) de entrada; descrição no XML: IMPRESSORA TERMICA P/RECIBO CUPOM IT-110 C3T',
    },
    {
      ncm: '84433299',
      cest: '2101700',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'MG',
      origem_mercadoria: '6',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '7',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º, par. único, I (origem MG → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 1 item(ns) de entrada; descrição no XML: IMPRESSORA UP-X898MD TRANSF TERMICA 4 7206108A',
    },
    {
      ncm: '84433299',
      cest: '2101700',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'PR',
      origem_mercadoria: '4',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '7',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º, par. único, I (origem PR → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 1 item(ns) de entrada; descrição no XML: IMPRESSORA NAO FISCAL TERMICA I8 ELGIN USB ETHERNET SERIAL',
    },
    {
      ncm: '84433299',
      cest: '2101700',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'SC',
      origem_mercadoria: '1',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '4',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 13/2012 (origem 1: importado/conteúdo de importação > 40%). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 2 item(ns) de entrada; descrição no XML: IMPRESSORA DE ETIQUETAS ZEBRA ZD220 203 DPI USB',
    },
    {
      ncm: '84439923',
      cest: '2101800',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'GO',
      origem_mercadoria: '7',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '12',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º (origem GO → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 4 item(ns) de entrada; descrição no XML: CARTUCHO HP 938 AMARELO | CARTUCHO HP 938 PRETO',
    },
    {
      ncm: '84439933',
      cest: '2101800',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'ES',
      origem_mercadoria: '4',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '12',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º (origem ES → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 1 item(ns) de entrada; descrição no XML: CARTUCHO DE TONER BROTHER TN116BR PRETO 1.000PG P/HLL1222-V/HLL12',
    },
    {
      ncm: '84439933',
      cest: '2101800',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'GO',
      origem_mercadoria: '4',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '12',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º (origem GO → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 1 item(ns) de entrada; descrição no XML: TONER BROTHER PRETO TN116BR',
    },
    {
      ncm: '84713012',
      cest: null,
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'SP',
      origem_mercadoria: '0',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '7',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º, par. único, I (origem SP → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 4 item(ns) de entrada; descrição no XML: Notebook Dell Latitude 5400 I5 de 8 Geracao  Tela de 14 polegadas SSD 240 e 8 de Ram Teclado retro iluminado | Notebook Lenovo T480 I5 de 8 Geracao SSD 240 e 8 de Ram',
    },
    {
      ncm: '84713019',
      cest: '2102800',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'SP',
      origem_mercadoria: '4',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '7',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º, par. único, I (origem SP → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 9 item(ns) de entrada; descrição no XML: Microcomputador Portatil Dell 15 DC15250 | NOTEBOOK LENOVO LOQ 15IRX9 / LINUX',
    },
    {
      ncm: '84715010',
      cest: '2103000',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'ES',
      origem_mercadoria: '1',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '4',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 13/2012 (origem 1: importado/conteúdo de importação > 40%). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 1 item(ns) de entrada; descrição no XML: MINI PC BLUEBOX I3-5010U BLUECASE S/MEMORIA S/SSD PN BBOX5I3MSHR2 - HDMI / VGA / 4X USB 3.0 / 2,5" / M-SATA',
    },
    {
      ncm: '84715010',
      cest: '2103000',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'PR',
      origem_mercadoria: '4',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '7',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º, par. único, I (origem PR → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 2 item(ns) de entrada; descrição no XML: COMPUTADOR PCYES ONE B500 QUAD CORE I5 3470 3.20GHZ MEM 8GB DDR3 SSD 256GB LINUX UBUNTU | MINI COMPUTADOR B500 DECA-CORE I5 1235U 3.30 GHZ MEM 16GB DDR4 SSD 512GB NVME WI-FI BLUETOOTH LINUX UBUNTU',
    },
    {
      ncm: '84716052',
      cest: '2103100',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'DF',
      origem_mercadoria: '2',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '4',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 13/2012 (origem 2: importado/conteúdo de importação > 40%). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 5 item(ns) de entrada; descrição no XML: COMBO S/FIO TEC/MOUSE LOGITECH MK220 | TECLADO LOGITECH K120 USB',
    },
    {
      ncm: '84716052',
      cest: '2103100',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'ES',
      origem_mercadoria: '2',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '4',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 13/2012 (origem 2: importado/conteúdo de importação > 40%). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 1 item(ns) de entrada; descrição no XML: KIT MOUSE E TECLADO LOGITECH MK120 COM FIO USB PTO',
    },
    {
      ncm: '84716052',
      cest: '2103100',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'MG',
      origem_mercadoria: '1',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '4',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 13/2012 (origem 1: importado/conteúdo de importação > 40%). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 2 item(ns) de entrada; descrição no XML: TECLADO USB PADRAO KB103 PRETO LECOO',
    },
    {
      ncm: '84716052',
      cest: '2103100',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'MG',
      origem_mercadoria: '5',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '7',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º, par. único, I (origem MG → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 5 item(ns) de entrada; descrição no XML: TECL USB MULT KB-M10BK PRETO C3T',
    },
    {
      ncm: '84716052',
      cest: '2103100',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'SC',
      origem_mercadoria: '1',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '4',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 13/2012 (origem 1: importado/conteúdo de importação > 40%). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 4 item(ns) de entrada; descrição no XML: TECLADO BASIC PRETO USB | TECLADO SEM FIO DUAL MODE FREEDOM PRETO',
    },
    {
      ncm: '84716052',
      cest: '2105600',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'DF',
      origem_mercadoria: '1',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '4',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 13/2012 (origem 1: importado/conteúdo de importação > 40%). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 3 item(ns) de entrada; descrição no XML: COMBO KROSS TEC/MOUSE C/FIO KE-KM400V1 2 | TECLADO KROSS KE-K095V2 PRETO 2',
    },
    {
      ncm: '84716053',
      cest: '2103100',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'DF',
      origem_mercadoria: '1',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '4',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 13/2012 (origem 1: importado/conteúdo de importação > 40%). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 1 item(ns) de entrada; descrição no XML: MOUSE KROSS USB KE-M099 PRETO',
    },
    {
      ncm: '84716053',
      cest: '2103100',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'DF',
      origem_mercadoria: '2',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '4',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 13/2012 (origem 2: importado/conteúdo de importação > 40%). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 1 item(ns) de entrada; descrição no XML: MOUSE C/FIO USB LOGITECH M90 PRETO',
    },
    {
      ncm: '84716053',
      cest: '2103100',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'ES',
      origem_mercadoria: '2',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '4',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 13/2012 (origem 2: importado/conteúdo de importação > 40%). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 1 item(ns) de entrada; descrição no XML: MOUSE OPTICO SEM FIO M170 AZUL LOGITECH',
    },
    {
      ncm: '84716053',
      cest: '2103100',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'MG',
      origem_mercadoria: '1',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '4',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 13/2012 (origem 1: importado/conteúdo de importação > 40%). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 3 item(ns) de entrada; descrição no XML: APRESENTADOR S/FIO PRETO AP-400 BLISTER C3T | MOUSE USB MS104 2000 DPI PRETO LECOO',
    },
    {
      ncm: '84716053',
      cest: '2103100',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'MG',
      origem_mercadoria: '5',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '7',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º, par. único, I (origem MG → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 11 item(ns) de entrada; descrição no XML: KIT TECL+MOUSE S/FIO KW202 BRANCO LECOO | MOUSE USB MS-35BK PRETO C3TECH',
    },
    {
      ncm: '84716053',
      cest: '2103100',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'SC',
      origem_mercadoria: '1',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '4',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 13/2012 (origem 1: importado/conteúdo de importação > 40%). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 4 item(ns) de entrada; descrição no XML: MOUSE SEM FIO PRETO 2.4G | MOUSE USB PRETO',
    },
    {
      ncm: '84716053',
      cest: null,
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'SC',
      origem_mercadoria: '1',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '4',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 13/2012 (origem 1: importado/conteúdo de importação > 40%). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 1 item(ns) de entrada; descrição no XML: COMBO GAMER 5 EM 1 LUMEN PRETO',
    },
    {
      ncm: '84717010',
      cest: '2103300',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'DF',
      origem_mercadoria: '6',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '12',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º (origem DF → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 1 item(ns) de entrada; descrição no XML: HD EXT TOSHIBA 1TB CANVIO HDTB510XK3AA',
    },
    {
      ncm: '84717010',
      cest: '2103300',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'ES',
      origem_mercadoria: '7',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '12',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º (origem ES → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 1 item(ns) de entrada; descrição no XML: HD PORTATIL WD ELEMENTS 1TB PLUG AND PLAY USB 32 GEN 1 MICRO B PRETO WDBUZG0010BBKWESN',
    },
    {
      ncm: '84717010',
      cest: '2103300',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'PR',
      origem_mercadoria: '6',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '7',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º, par. único, I (origem PR → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 1 item(ns) de entrada; descrição no XML: HD INTERNO 8TB WESTERN DIGITAL GOLD SATAIII 256MB WD8005FRYZ',
    },
    {
      ncm: '84717040',
      cest: '2103300',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'PR',
      origem_mercadoria: '1',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '4',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 13/2012 (origem 1: importado/conteúdo de importação > 40%). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 1 item(ns) de entrada; descrição no XML: SSD WD GREEN 2TB SATA3 2.5 7MM LEITURA 545MB/S GRAVACAO 515MB/S WDS200T5G0A',
    },
    {
      ncm: '84719012',
      cest: '2103400',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'MG',
      origem_mercadoria: '5',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '7',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º, par. único, I (origem MG → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 1 item(ns) de entrada; descrição no XML: LEITOR COD 1D USB LB-50BK C3TECH',
    },
    {
      ncm: '84719012',
      cest: '2103400',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'MG',
      origem_mercadoria: '6',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '7',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º, par. único, I (origem MG → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 9 item(ns) de entrada; descrição no XML: LEITOR COD 1D/2D S/FIO LB-W110BK C3TECH | LEITOR COD 1D/2D USB LB-D300 C3TECH',
    },
    {
      ncm: '84719012',
      cest: '2103400',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'PR',
      origem_mercadoria: '4',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '7',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º, par. único, I (origem PR → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 1 item(ns) de entrada; descrição no XML: LEITOR DE CODIGO DE BARRAS LASER TANCA TL-220 USB PRETO COM PEDESTAL',
    },
    {
      ncm: '84719014',
      cest: '2103400',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'GO',
      origem_mercadoria: '7',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '12',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º (origem GO → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 1 item(ns) de entrada; descrição no XML: SCANNER DE MESA CANON DR-M160 II',
    },
    {
      ncm: '84733011',
      cest: '2103500',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'MG',
      origem_mercadoria: '5',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '7',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º, par. único, I (origem MG → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 5 item(ns) de entrada; descrição no XML: GAB MICRO-ATX MT-30BK C/FTE 200W C3T | GAB MICRO-ATX MT-37BK C/FTE 200W C3T',
    },
    {
      ncm: '84733019',
      cest: '2103500',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'MG',
      origem_mercadoria: '5',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '7',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º, par. único, I (origem MG → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 3 item(ns) de entrada; descrição no XML: GAB AQUARIUS MT-G720BK S/FTE C3T | GAB GAME MT-G150BK S/FTE C3T',
    },
    {
      ncm: '84733041',
      cest: '2103500',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'ES',
      origem_mercadoria: '1',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '4',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 13/2012 (origem 1: importado/conteúdo de importação > 40%). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 1 item(ns) de entrada; descrição no XML: PLACA-MAE BMBH81-G32HGU-ITX BULK DDR3 1150P GIGABIT BLUECASE - 16GB / 2X HDMI / NVME / MINI ITX REF 8582',
    },
    {
      ncm: '84733041',
      cest: '2103500',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'PR',
      origem_mercadoria: '1',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '4',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 13/2012 (origem 1: importado/conteúdo de importação > 40%). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 3 item(ns) de entrada; descrição no XML: PLACA MAE ASUS PRIME H610M-F D4 R2.0 - INTEL 1700 - DDR4 - MATX - M.2 NVME - HDMI | PLACA MAE MSI PRO H610M - S - INTEL 1700 - DDR4 - MATX - M.2 - HDMI',
    },
    {
      ncm: '84733041',
      cest: '2103500',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'PR',
      origem_mercadoria: '4',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '7',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º, par. único, I (origem PR → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 1 item(ns) de entrada; descrição no XML: PLACA MAE ASROCK H610M-HVS/ M.2 R2.0 - INTEL 1700 - DDR4 - MATX - M.2 NVME -VGA/HDMI',
    },
    {
      ncm: '84733041',
      cest: null,
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'ES',
      origem_mercadoria: '1',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '4',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 13/2012 (origem 1: importado/conteúdo de importação > 40%). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 1 item(ns) de entrada; descrição no XML: PLACA-MAE BMBH110-G3HGU-ITX BULK DDR4 1151P GIGABIT BLUECASE - 32GB / HDMI / VGA / NVME / MINI-ITX',
    },
    {
      ncm: '84821010',
      cest: null,
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'SP',
      origem_mercadoria: '0',
      confirmado_fiscalmente: false,
      tratamento: 'CONFERIR',
      motivo:
        'NCM 8482 consta do Anexo II do Conv. ICMS 142/18 (autopeças, item 49.0, CEST 01.049.00), incluído no Anexo 1 do RICMS-BA, item 1.1. O XML não traz CEST. Confirmar se o rolamento 6204 é destinado a veículo automotor (ST) ou a outro uso (antecipação parcial).',
    },
    {
      ncm: '85044021',
      cest: null,
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'MG',
      origem_mercadoria: '5',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '7',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º, par. único, I (origem MG → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'Evidência: 15 item(ns) de entrada; descrição no XML: FTE ATX 200W PS-200V4 FAN 8CM C3TECH S/CABO | FTE SFX 200W PS-200SFX C3TECH S/CABO',
    },
    {
      ncm: '85044040',
      cest: '2103800',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'DF',
      origem_mercadoria: '4',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '12',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º (origem DF → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 3 item(ns) de entrada; descrição no XML: NOBREAK SMS LITE 600BI/115 29202 | NOBREAK SMS TECH 1400BI/115 29305',
    },
    {
      ncm: '85044040',
      cest: '2103800',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'ES',
      origem_mercadoria: '4',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '12',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º (origem ES → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 3 item(ns) de entrada; descrição no XML: NOBREAK SMS LITE 1200VA ENTRADA BIVOLT AUTOMATICO SAIDA 115V 29205 | NOBREAK SMS TECH 1400VA ENTRADA BIVOLT AUTOMATICO E SAIDA 115V 29305',
    },
    {
      ncm: '85044040',
      cest: '2103800',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'GO',
      origem_mercadoria: '2',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '4',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 13/2012 (origem 2: importado/conteúdo de importação > 40%). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 1 item(ns) de entrada; descrição no XML: NOBREAK INTELBRAS 720VA360W MONO220V 4822001 XNB 720',
    },
    {
      ncm: '85044040',
      cest: '2103800',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'PE',
      origem_mercadoria: '4',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '12',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º (origem PE → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 1 item(ns) de entrada; descrição no XML: Nobreak SMS Bivolt 600VA Lite',
    },
    {
      ncm: '85061019',
      cest: null,
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'SC',
      origem_mercadoria: '1',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '4',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 13/2012 (origem 1: importado/conteúdo de importação > 40%). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'Evidência: 2 item(ns) de entrada; descrição no XML: PILHA ALCALINA AAA BLISTER COM 2 PECAS | PILHA ALCALINA AA BLISTER COM 2 PECAS',
    },
    {
      ncm: '85072010',
      cest: null,
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'SC',
      origem_mercadoria: '1',
      confirmado_fiscalmente: false,
      tratamento: 'CONFERIR',
      motivo:
        'NCM 8507.20 consta do Anexo II do Conv. ICMS 142/18 (autopeças, item 99.0, CEST 01.099.00), incluído no Anexo 1 do RICMS-BA, item 1.1. O XML não traz CEST. Confirmar se a bateria VRLA 12V 7Ah é destinada a veículo automotor (ST) ou a nobreak/alarme (antecipação parcial).',
    },
    {
      ncm: '85072010',
      cest: null,
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'SP',
      origem_mercadoria: '2',
      confirmado_fiscalmente: false,
      tratamento: 'CONFERIR',
      motivo:
        'NCM 8507.20 consta do Anexo II do Conv. ICMS 142/18 (autopeças, item 99.0, CEST 01.099.00), incluído no Anexo 1 do RICMS-BA, item 1.1. O XML não traz CEST. Confirmar se a bateria VRLA 12V 7Ah é destinada a veículo automotor (ST) ou a nobreak/alarme (antecipação parcial).',
    },
    {
      ncm: '85076000',
      cest: null,
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'SC',
      origem_mercadoria: '1',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '4',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 13/2012 (origem 1: importado/conteúdo de importação > 40%). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'Evidência: 1 item(ns) de entrada; descrição no XML: POWER BANK BRIGHT 10.000 mAh PRETO',
    },
    {
      ncm: '85171300',
      cest: '2105301',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'DF',
      origem_mercadoria: '4',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '12',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º (origem DF → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'Evidência: 1 item(ns) de entrada; descrição no XML: CEL. SAMS. S942 S26 256GB PRETO ZF',
    },
    {
      ncm: '85176234',
      cest: '2108200',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'PR',
      origem_mercadoria: '2',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '4',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 13/2012 (origem 2: importado/conteúdo de importação > 40%). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 1 item(ns) de entrada; descrição no XML: SWITCH MERCUSYS 8 PTS FAST NAO GERENCIAVEL MS108',
    },
    {
      ncm: '85176234',
      cest: '2108200',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'PR',
      origem_mercadoria: '4',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '7',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º, par. único, I (origem PR → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 2 item(ns) de entrada; descrição no XML: SWITCH TP-LINK OMADA 24 PTS GIGABIT NAO GERENCIAVEL TL-SG1024D',
    },
    {
      ncm: '85176262',
      cest: '2108400',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'SP',
      origem_mercadoria: '5',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '7',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º, par. único, I (origem SP → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'Produto descrito como iPad (tablet) com NCM 8517.62.62. Mesmo se reclassificado para 8471, a alíquota é 20,5% (RICMS-BA art. 266, XIII, revogado a partir de 01/03/25) e não há ST na BA. Evidência: 1 item(ns) de entrada; descrição no XML: APPLE IPAD WI-FI 128GB SILVER A3354',
    },
    {
      ncm: '85176262',
      cest: null,
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'SP',
      origem_mercadoria: '5',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '7',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º, par. único, I (origem SP → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'Produto descrito como MacBook (computador portátil) com NCM 8517.62.62. Mesmo se reclassificado para 8471, a alíquota é 20,5% (RICMS-BA art. 266, XIII, revogado a partir de 01/03/25) e não há ST na BA. Evidência: 1 item(ns) de entrada; descrição no XML: APPLE MACBOOK NEO 13" 8GB RAM 256GB',
    },
    {
      ncm: '85176272',
      cest: '2105600',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'SC',
      origem_mercadoria: '1',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '4',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 13/2012 (origem 1: importado/conteúdo de importação > 40%). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'Evidência: 2 item(ns) de entrada; descrição no XML: LOCALIZADOR SEM FIO BRIGHT GOTAG KIDS | LOCALIZADOR SEM FIO BRIGHT GOTAG PET',
    },
    {
      ncm: '85176277',
      cest: '2111000',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'DF',
      origem_mercadoria: '2',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '4',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 13/2012 (origem 2: importado/conteúdo de importação > 40%). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'Evidência: 2 item(ns) de entrada; descrição no XML: ADAP. TP-LINK PCIE AC600 T2E DUAL BAND | ADAP. USB TP-LINK AC600 T2U DUAL BAND',
    },
    {
      ncm: '85182100',
      cest: '2105700',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'SC',
      origem_mercadoria: '1',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '4',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 13/2012 (origem 1: importado/conteúdo de importação > 40%). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'Evidência: 2 item(ns) de entrada; descrição no XML: CAIXA DE SOM OFFICE - LIGHT | CAIXA DE SOM PEGASUS',
    },
    {
      ncm: '85182200',
      cest: '2105700',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'DF',
      origem_mercadoria: '4',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '12',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º (origem DF → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'Evidência: 1 item(ns) de entrada; descrição no XML: CAIXA BT JBL BOOMBOX 3 BLACK BR',
    },
    {
      ncm: '85183000',
      cest: '2105700',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'DF',
      origem_mercadoria: '2',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '4',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 13/2012 (origem 2: importado/conteúdo de importação > 40%). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'Evidência: 2 item(ns) de entrada; descrição no XML: HEADSET LOGITECH H390 USB 2',
    },
    {
      ncm: '85183000',
      cest: '2105700',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'MG',
      origem_mercadoria: '2',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '4',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 13/2012 (origem 2: importado/conteúdo de importação > 40%). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'Evidência: 2 item(ns) de entrada; descrição no XML: FONE C/MIC USB H390 PRETO LOGITECH',
    },
    {
      ncm: '85183000',
      cest: '2105700',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'SC',
      origem_mercadoria: '1',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '4',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 13/2012 (origem 1: importado/conteúdo de importação > 40%). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'Evidência: 1 item(ns) de entrada; descrição no XML: HEADSET OFFICE STEREO USB C/ADAPTADOR USB-C',
    },
    {
      ncm: '85258913',
      cest: '2110700',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'PR',
      origem_mercadoria: '2',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '4',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 13/2012 (origem 2: importado/conteúdo de importação > 40%). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'Evidência: 1 item(ns) de entrada; descrição no XML: WEBCAM INTELBRAS FULL HD 60 FPS WCI1080P',
    },
    {
      ncm: '85258919',
      cest: '2110700',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'MG',
      origem_mercadoria: '8',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '4',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 13/2012 (origem 8: importado/conteúdo de importação > 40%). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'Evidência: 5 item(ns) de entrada; descrição no XML: WEBCAM FULL HD 1080P WB-100BK C3T | WEBCAM QHD 2K WB-200BK C3T',
    },
    {
      ncm: '85258929',
      cest: '2106500',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'SC',
      origem_mercadoria: '1',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '4',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 13/2012 (origem 1: importado/conteúdo de importação > 40%). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 1 item(ns) de entrada; descrição no XML: WEBCAM 2K',
    },
    {
      ncm: '85285200',
      cest: '2106800',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'DF',
      origem_mercadoria: '4',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '12',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º (origem DF → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 2 item(ns) de entrada; descrição no XML: MONITOR ACER IPS 23,8 FHD MK241Y CBMI FL | MONITOR AOC GAM LED 21,5 FHD 22B30HM23',
    },
    {
      ncm: '85285200',
      cest: '2106800',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'ES',
      origem_mercadoria: '1',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '4',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 13/2012 (origem 1: importado/conteúdo de importação > 40%). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 1 item(ns) de entrada; descrição no XML: MONITOR TOUCH SCREEN ELO 1515L 15 RESISTIVO SER/USB BEZEL',
    },
    {
      ncm: '85285200',
      cest: '2106800',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'ES',
      origem_mercadoria: '4',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '12',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º (origem ES → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 3 item(ns) de entrada; descrição no XML: MONITOR 18,5 AOC LED E970SWHNL WIDESCREEN VGA HDMI | MONITOR AOC 18,5 LED E970SWHNL/HDMI/VGA',
    },
    {
      ncm: '85285200',
      cest: '2106800',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'GO',
      origem_mercadoria: '4',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '12',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º (origem GO → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 1 item(ns) de entrada; descrição no XML: MONITOR ACER LED 23,8 FHD MK241Y FLT',
    },
    {
      ncm: '85285900',
      cest: '2106700',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'ES',
      origem_mercadoria: '4',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '12',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º (origem ES → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 1 item(ns) de entrada; descrição no XML: MONITOR TOUCH SCREEN ELGIN 15 CM15N',
    },
    {
      ncm: '85286200',
      cest: '2106701',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'SC',
      origem_mercadoria: '2',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '4',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 13/2012 (origem 2: importado/conteúdo de importação > 40%). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'Evidência: 2 item(ns) de entrada; descrição no XML: PROJETOR INTELBRAS FULL HD 7400 LUMENS PFL6520 4290058',
    },
    {
      ncm: '85291090',
      cest: null,
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'SP',
      origem_mercadoria: '0',
      confirmado_fiscalmente: false,
      tratamento: 'CONFERIR',
      motivo:
        'NCM 8529.10 consta do Anexo II do Conv. ICMS 142/18 (autopeças, item 63.0, CEST 01.063.00, antenas), incluído no Anexo 1 do RICMS-BA, item 1.1. O XML não traz CEST. Confirmar que a antena WiFi RP-SMA não é autopeça antes de aplicar a antecipação parcial.',
    },
    {
      ncm: '85423190',
      cest: '2112600',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'ES',
      origem_mercadoria: '6',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '12',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º (origem ES → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 2 item(ns) de entrada; descrição no XML: PROCESSADOR CORE I3-4150 3.5GHZ 3MB 1150 OEM INTEL TDP 54W REF 4652 | PROCESSADOR CORE I5-4570 3.2 GHZ UP TO 3.6 GHZ 6MB 1150 OEM INTEL TDP 84W REF 8593',
    },
    {
      ncm: '85423190',
      cest: '2112600',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'SC',
      origem_mercadoria: '6',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '7',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º, par. único, I (origem SC → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 1 item(ns) de entrada; descrição no XML: PROCESSADOR INTEL CORE I512400F 25GHz TURBO 44GHz 18MB CACHE LGA1700 12 GERACAO BX8071512400F',
    },
    {
      ncm: '85423190',
      cest: '2112600',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'SC',
      origem_mercadoria: '7',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '7',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º, par. único, I (origem SC → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Descrição é de placa de vídeo (NCM próprio 8473.30), não processador (8542). A alíquota é 20,5% nos dois códigos; pedir correção do NCM. Evidência: 1 item(ns) de entrada; descrição no XML: PLACA DE VIDEO PCYES GEFORCE RTX 3050 6GB GDDR6 96BITS PVRTX30506BLPE',
    },
    {
      ncm: '85423190',
      cest: null,
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'PR',
      origem_mercadoria: '7',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '7',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º, par. único, I (origem PR → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Descrição é de placa de vídeo (NCM próprio 8473.30), não processador (8542). A alíquota é 20,5% nos dois códigos; pedir correção do NCM. Evidência: 2 item(ns) de entrada; descrição no XML: PROCESSADOR GRAFICO VXPRO GEFORCE G 210 LOW PROFILE 1GB DDR3 64 BITS HDMI/VGA - VXG210LP-1GD3',
    },
    {
      ncm: '85444200',
      cest: '1200700',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'MG',
      origem_mercadoria: '0',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '7',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º, par. único, I (origem MG → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'Evidência: 3 item(ns) de entrada; descrição no XML: CABO P/ CPU 2P+T X 0,75MM2 DE 3M MEGATRON | EXT FILTRO DE LINHA C/6T FL-61BK C3T',
    },
    {
      ncm: '85444200',
      cest: '1200700',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'MG',
      origem_mercadoria: '1',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '4',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 13/2012 (origem 1: importado/conteúdo de importação > 40%). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'Evidência: 5 item(ns) de entrada; descrição no XML: CABO ADAPT HDMI M/VGA F ADP-HDMIVGA10BK PLUSC | CABO VGA SVGA 1.8M PC-MON1802',
    },
    {
      ncm: '85444200',
      cest: '1200700',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'MG',
      origem_mercadoria: '8',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '4',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 13/2012 (origem 8: importado/conteúdo de importação > 40%). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'Evidência: 1 item(ns) de entrada; descrição no XML: CABO HUB USB 2.0 4 PORTAS HU-230BK C3T',
    },
    {
      ncm: '85444200',
      cest: null,
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'SP',
      origem_mercadoria: '0',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '7',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º, par. único, I (origem SP → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'Evidência: 1 item(ns) de entrada; descrição no XML: Cabo Pigtail RP-SMA 20cm (Ref. A0714) (Disponibilidade: Imediata)',
    },
    {
      ncm: '85444900',
      cest: '1200700',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'SC',
      origem_mercadoria: '0',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '7',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º, par. único, I (origem SC → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'Evidência: 2 item(ns) de entrada; descrição no XML: FILTRO DE LINHA C/FUSIVEL 5 TOMADAS PTO',
    },
    {
      ncm: '90328911',
      cest: '2107800',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'DF',
      origem_mercadoria: '4',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '12',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º (origem DF → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 1 item(ns) de entrada; descrição no XML: ESTABILIZADOR SMS 1.5 300V BIV 15970',
    },
    {
      ncm: '90328911',
      cest: '2107800',
      regime: 'SIMPLES_NACIONAL',
      uf_origem: 'MG',
      origem_mercadoria: '4',
      confirmado_fiscalmente: false,
      tratamento: 'APLICAVEL',
      aliquota_interna: '20.5',
      aliquota_interestadual: '7',
      fundamento:
        'Lei 7.014/96, art. 12-A e art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24); RICMS-BA, art. 321, VII, "b" e § 1º; Res. SF 22/1989, art. 1º, par. único, I (origem MG → BA). Sem item correspondente no Anexo 1 do RICMS-BA (redação 2026).',
      revisao_fiscal:
        'A redução de base para informática (RICMS-BA art. 266, XIII, carga 12%) foi revogada pelo Decreto 23.248/24, com efeitos a partir de 01/03/25; aplica-se a alíquota cheia. Evidência: 3 item(ns) de entrada; descrição no XML: ESTAB ES-300VA BM 115V BEM LIGADO CLK | ESTAB ES-300VA MONO 115V BEM LIGADO CLK',
    },
  ];
