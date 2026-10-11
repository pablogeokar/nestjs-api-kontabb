/**
 * Leiaute oficial dos registros do CIAP (Bloco G) e do cadastro do ativo
 * (registros 0300/0305 do Bloco 0) da EFD ICMS/IPI.
 *
 * TAREFA 4.1 (Fase 2 — CIAP e Bloco G): referência autoritativa, campo a campo,
 * do leiaute correto de G110, G125, 0300 e 0305, conforme o Guia Prático da
 * EFD ICMS/IPI versão 3.2.2 (vigente para competências de 2026). Esta é a
 * especificação-alvo que destrava as tarefas 4.2–4.4 (reescrita do builder) e
 * a tarefa 5.1 (fixtures normativas). Nenhuma linha aqui é gerada pelo builder:
 * é a fonte de verdade contra a qual o builder será validado.
 *
 * Requisitos cobertos: R3.1 (G110 com SOM_ICMS_OC e índice de participação na
 * posição correta), R3.2 (G125 com contagem oficial, posição de ICMS-ST e
 * NUM_PARC/VL_PARC_PASS), R3.3 (G125 referencia um 0300 válido; o builder deve
 * emitir 0300 e 0305 quando aplicável).
 *
 * Convenção de contagem (alinhada a EXPECTED_FIELD_COUNTS em sped-validator.ts):
 * o "field count" valida o número de campos APÓS o REG — ou seja, o total de
 * campos numerados menos 1 (o próprio REG não entra na contagem porque o parser
 * separa `[reg, ...fields]`). Exemplo de controle: E110 tem campos 01..15, logo
 * 14 campos após REG, e EXPECTED_FIELD_COUNTS.E110 === 14.
 *
 * Posição (`position`) nesta referência é o índice 0-based do campo DENTRO do
 * array `fields` (após REG). Assim, o campo oficial nº 02 fica em position 0, o
 * nº 03 em position 1, e assim por diante. É esse índice que o builder usa ao
 * montar o SpedRecord e que o preflight usa ao ler o registro.
 *
 * FONTE NORMATIVA
 * ---------------
 * As descrições, nomes e ordem dos campos abaixo foram confrontados com o Guia
 * Prático EFD ICMS/IPI (texto reproduzido/reformatado por fontes públicas que
 * transcrevem o Guia campo a campo). O conteúdo foi parafraseado para fins de
 * documentação. Para o fechamento da fase, estes campos DEVEM ser conferidos
 * contra o PDF oficial do Guia Prático 3.2.2 publicado em
 * http://sped.rfb.gov.br/pasta/show/1573 (G110/G125 nas páginas impressas
 * 253–255; 0300/0305 nas 43–44, conforme requirements.md / N03).
 *
 * Observação de licenciamento: o conteúdo das fontes foi reformulado para
 * conformidade com restrições de licenciamento.
 */

/** Tipo do campo no leiaute SPED. */
export type BlocoGFieldKind = 'text' | 'date' | 'decimal' | 'integer';

/**
 * Obrigatoriedade do campo conforme a coluna "Entrada e/ou Saída" do Guia:
 * - 'O'  = obrigatório (sempre apresentado);
 * - 'OC' = obrigatório condicional (apresentado quando houver a informação);
 * - 'N'  = não pode ser apresentado.
 */
export type BlocoGFieldObrigatoriedade = 'O' | 'OC' | 'N';

export interface BlocoGFieldSpec {
  /** Número oficial do campo no Guia (1 = REG, 2 = primeiro campo de dados). */
  readonly officialNumber: number;
  /**
   * Índice 0-based do campo dentro do array `fields` do SpedRecord (após REG).
   * `null` para o próprio REG, que não integra `fields`.
   */
  readonly position: number | null;
  /** Nome oficial do campo (ex.: SOM_ICMS_OC). */
  readonly name: string;
  readonly kind: BlocoGFieldKind;
  readonly obrigatoriedade: BlocoGFieldObrigatoriedade;
  /** Casas decimais quando `kind === 'decimal'` (ex.: 2, 8). */
  readonly decimais?: number;
  /** Descrição parafraseada do campo. */
  readonly descricao: string;
}

export interface BlocoGRecordLayout {
  readonly reg: string;
  readonly nivelHierarquico: number;
  readonly descricao: string;
  readonly fields: readonly BlocoGFieldSpec[];
  /**
   * Quantidade de campos após REG — valor que EXPECTED_FIELD_COUNTS[reg] DEVE
   * assumir no validador. É `fields.length - 1` (REG não entra na contagem).
   */
  readonly fieldCountAfterReg: number;
}

/**
 * G110 — ICMS Ativo Permanente (CIAP), por período de apuração.
 *
 * Nível 2, ocorrência única por período. A combinação DT_INI/DT_FIN deve ser
 * igual à de um registro E100.
 *
 * CORREÇÃO vs. implementação atual (R3.1): o leiaute oficial tem 10 campos
 * (01..10), portanto 9 campos após REG. A implementação atual emite apenas 8
 * campos após REG e NÃO distingue IND_PER_SAI / ICMS_APROP / SOM_ICMS_OC — o
 * campo SOM_ICMS_OC (nº 10) está ausente, e o "índice de participação"
 * (IND_PER_SAI, nº 08) precisa ocupar a posição correta entre VL_TOTAL (07) e
 * ICMS_APROP (09). EXPECTED_FIELD_COUNTS.G110 deve passar de 8 para 9.
 */
export const G110_LAYOUT: BlocoGRecordLayout = {
  reg: 'G110',
  nivelHierarquico: 2,
  descricao: 'ICMS - Ativo Permanente - CIAP (por período de apuração).',
  fieldCountAfterReg: 9,
  fields: [
    {
      officialNumber: 1,
      position: null,
      name: 'REG',
      kind: 'text',
      obrigatoriedade: 'O',
      descricao: 'Texto fixo contendo "G110".',
    },
    {
      officialNumber: 2,
      position: 0,
      name: 'DT_INI',
      kind: 'date',
      obrigatoriedade: 'O',
      descricao: 'Data inicial a que se refere a apuração (ddmmaaaa).',
    },
    {
      officialNumber: 3,
      position: 1,
      name: 'DT_FIN',
      kind: 'date',
      obrigatoriedade: 'O',
      descricao: 'Data final a que se refere a apuração (ddmmaaaa).',
    },
    {
      officialNumber: 4,
      position: 2,
      name: 'SALDO_IN_ICMS',
      kind: 'decimal',
      decimais: 2,
      obrigatoriedade: 'O',
      descricao:
        'Saldo inicial de ICMS do CIAP: ICMS de bens/componentes que entraram ' +
        'antes do período (somatório dos campos 05 a 08 dos G125 com TIPO_MOV "SI").',
    },
    {
      officialNumber: 5,
      position: 3,
      name: 'SOM_PARC',
      kind: 'decimal',
      decimais: 2,
      obrigatoriedade: 'O',
      descricao:
        'Somatório das parcelas de ICMS passível de apropriação de cada bem ' +
        '(totalização do campo VL_PARC_PASS, nº 10, dos G125).',
    },
    {
      officialNumber: 6,
      position: 4,
      name: 'VL_TRIB_EXP',
      kind: 'decimal',
      decimais: 2,
      obrigatoriedade: 'O',
      descricao:
        'Valor do somatório das saídas tributadas e das saídas para exportação. ' +
        'Deve ser menor ou igual a VL_TOTAL.',
    },
    {
      officialNumber: 7,
      position: 5,
      name: 'VL_TOTAL',
      kind: 'decimal',
      decimais: 2,
      obrigatoriedade: 'O',
      descricao: 'Valor total das saídas no período de apuração.',
    },
    {
      officialNumber: 8,
      position: 6,
      name: 'IND_PER_SAI',
      kind: 'decimal',
      decimais: 8,
      obrigatoriedade: 'O',
      descricao:
        'Índice de participação das saídas tributadas/exportação sobre as saídas ' +
        'totais (campo 06 ÷ campo 07). Valor sempre ≤ 1. É o "índice de ' +
        'participação" que a implementação atual precisa posicionar corretamente.',
    },
    {
      officialNumber: 9,
      position: 7,
      name: 'ICMS_APROP',
      kind: 'decimal',
      decimais: 2,
      obrigatoriedade: 'O',
      descricao:
        'Valor de ICMS a ser apropriado na apuração (campo 05 × campo 08). ' +
        'Lançado no Registro de Apuração do ICMS como ajuste de apuração.',
    },
    {
      officialNumber: 10,
      position: 8,
      name: 'SOM_ICMS_OC',
      kind: 'decimal',
      decimais: 2,
      obrigatoriedade: 'O',
      descricao:
        'Valor de outros créditos de ICMS do ativo a apropriar no período ' +
        '(somatório do campo 09 - VL_PARC_APROP dos registros G126). Campo HOJE ' +
        'OMITIDO pela implementação atual — deve ser incluído (R3.1).',
    },
  ],
};

/**
 * G125 — Movimentação de bem ou componente do Ativo Imobilizado.
 *
 * Nível 3, ocorrência 1:N por período. Não podem existir dois registros com a
 * mesma combinação de COD_IND_BEM + TIPO_MOV. O campo COD_IND_BEM (nº 02) deve
 * referenciar um registro 0300 válido (R3.3).
 *
 * CORREÇÃO vs. implementação atual (R3.2):
 *  - O leiaute oficial tem 10 campos (01..10), portanto 9 campos após REG.
 *    EXPECTED_FIELD_COUNTS.G125 deve passar de 10 para 9.
 *  - A posição de ICMS-ST (VL_IMOB_ICMS_ST, nº 06) precisa ser modelada: a
 *    implementação atual pula de VL_IMOB_ICMS_OP (05) direto para FRT, omitindo
 *    o ICMS-ST.
 *  - NUM_PARC (nº 09) e VL_PARC_PASS (nº 10) devem ocupar as posições finais
 *    corretas, após os quatro valores de ICMS da entrada (05..08).
 *
 * ATENÇÃO: o campo nº 03 é DT_MOV (data da movimentação ou do saldo inicial),
 * não a data inicial do período. Para TIPO_MOV "SI", DT_MOV = DT_INI do G110;
 * para IM/IA/CI/MC/BA/AT/PE/OT, DT_MOV ≤ DT_FIN do G110.
 *
 * Valores válidos de TIPO_MOV (nº 04): SI, IM, IA, CI, MC, BA, AT, PE, OT.
 * Nos tipos de saída (BA, AT, PE, OT) os campos 05..10 não devem ser informados.
 */
export const G125_LAYOUT: BlocoGRecordLayout = {
  reg: 'G125',
  nivelHierarquico: 3,
  descricao:
    'Movimentação de bem/componente no CIAP e apropriação de parcelas de ICMS.',
  fieldCountAfterReg: 9,
  fields: [
    {
      officialNumber: 1,
      position: null,
      name: 'REG',
      kind: 'text',
      obrigatoriedade: 'O',
      descricao: 'Texto fixo contendo "G125".',
    },
    {
      officialNumber: 2,
      position: 0,
      name: 'COD_IND_BEM',
      kind: 'text',
      obrigatoriedade: 'O',
      descricao:
        'Código individualizado do bem/componente no controle patrimonial. ' +
        'DEVE constar de um registro 0300 (campo COD_IND_BEM do 0300).',
    },
    {
      officialNumber: 3,
      position: 1,
      name: 'DT_MOV',
      kind: 'date',
      obrigatoriedade: 'O',
      descricao:
        'Data da movimentação ou do saldo inicial (ddmmaaaa). Para TIPO_MOV ' +
        '"SI" deve ser igual a DT_INI do G110.',
    },
    {
      officialNumber: 4,
      position: 2,
      name: 'TIPO_MOV',
      kind: 'text',
      obrigatoriedade: 'O',
      descricao: 'Tipo de movimentação: SI, IM, IA, CI, MC, BA, AT, PE, OT.',
    },
    {
      officialNumber: 5,
      position: 3,
      name: 'VL_IMOB_ICMS_OP',
      kind: 'decimal',
      decimais: 2,
      obrigatoriedade: 'OC',
      descricao:
        'Valor do ICMS da operação própria na entrada do bem/componente. ' +
        'Não informado nos tipos de saída (BA/AT/PE/OT).',
    },
    {
      officialNumber: 6,
      position: 4,
      name: 'VL_IMOB_ICMS_ST',
      kind: 'decimal',
      decimais: 2,
      obrigatoriedade: 'OC',
      descricao:
        'Valor do ICMS por substituição tributária na entrada do bem/componente. ' +
        'Campo HOJE OMITIDO pela implementação atual — deve ser modelado (R3.2).',
    },
    {
      officialNumber: 7,
      position: 5,
      name: 'VL_IMOB_ICMS_FRT',
      kind: 'decimal',
      decimais: 2,
      obrigatoriedade: 'OC',
      descricao:
        'Valor do ICMS sobre frete do conhecimento de transporte na entrada.',
    },
    {
      officialNumber: 8,
      position: 6,
      name: 'VL_IMOB_ICMS_DIF',
      kind: 'decimal',
      decimais: 2,
      obrigatoriedade: 'OC',
      descricao:
        'Valor do ICMS - Diferencial de Alíquota, conforme documento de ' +
        'arrecadação, na entrada do bem/componente.',
    },
    {
      officialNumber: 9,
      position: 7,
      name: 'NUM_PARC',
      kind: 'integer',
      obrigatoriedade: 'OC',
      descricao:
        'Número da parcela do ICMS que está sendo escriturada. Obrigatório ' +
        'quando VL_PARC_PASS > 0. Deve respeitar NR_PARC do 0300 (≤ total).',
    },
    {
      officialNumber: 10,
      position: 8,
      name: 'VL_PARC_PASS',
      kind: 'decimal',
      decimais: 2,
      obrigatoriedade: 'OC',
      descricao:
        'Valor da parcela de ICMS passível de apropriação ANTES da aplicação do ' +
        'índice de participação (IND_PER_SAI do G110). Deve ser ≤ (soma de ' +
        'VL_IMOB_ICMS_OP + ST + FRT + DIF) ÷ NR_PARC do 0300. Obrigatório quando ' +
        'NUM_PARC > 0.',
    },
  ],
};

/**
 * G130 — Identificação do documento fiscal (origem do crédito do CIAP).
 *
 * Nível 4, filho do G125, ocorrência 1:N. Identifica o documento fiscal que deu
 * origem ao crédito do bem/componente movimentado no G125 pai. É exigido quando
 * a movimentação do G125 tem origem em um documento fiscal (ex.: imobilização a
 * partir da NF-e de aquisição) — ou seja, não se aplica ao saldo inicial
 * reconstruído (TIPO_MOV "SI"), que não tem documento de origem único.
 *
 * Leiaute oficial com 7 campos (01..07), portanto 6 campos após REG. O builder
 * atual NÃO emite G130 — a tarefa 4.5 trata a exigência (R3.4): emitir quando os
 * dados de origem estiverem disponíveis OU bloquear a geração quando o G130/G140
 * for exigido mas os dados do documento de origem não existirem (postura
 * conservadora da fase, para não emitir Bloco G inválido/incompleto).
 * EXPECTED_FIELD_COUNTS deve ganhar a entrada 'G130': 6.
 */
export const G130_LAYOUT: BlocoGRecordLayout = {
  reg: 'G130',
  nivelHierarquico: 4,
  descricao:
    'Identificação do documento fiscal que originou o crédito do bem/componente.',
  fieldCountAfterReg: 6,
  fields: [
    {
      officialNumber: 1,
      position: null,
      name: 'REG',
      kind: 'text',
      obrigatoriedade: 'O',
      descricao: 'Texto fixo contendo "G130".',
    },
    {
      officialNumber: 2,
      position: 0,
      name: 'IND_EMIT',
      kind: 'text',
      obrigatoriedade: 'O',
      descricao:
        'Indicador do emitente do documento fiscal de origem: 0 = emissão ' +
        'própria; 1 = emissão por terceiros.',
    },
    {
      officialNumber: 3,
      position: 1,
      name: 'COD_PART',
      kind: 'text',
      obrigatoriedade: 'OC',
      descricao:
        'Código do participante (campo COD_PART do 0150) — emitente do ' +
        'documento quando IND_EMIT = 1. Omitido quando IND_EMIT = 0.',
    },
    {
      officialNumber: 4,
      position: 2,
      name: 'COD_MOD',
      kind: 'text',
      obrigatoriedade: 'O',
      descricao:
        'Código do modelo do documento fiscal de origem (tabela 4.1.1, ex.: 55).',
    },
    {
      officialNumber: 5,
      position: 3,
      name: 'SERIE',
      kind: 'text',
      obrigatoriedade: 'OC',
      descricao: 'Série do documento fiscal de origem.',
    },
    {
      officialNumber: 6,
      position: 4,
      name: 'NUM_DOC',
      kind: 'integer',
      obrigatoriedade: 'O',
      descricao: 'Número do documento fiscal de origem.',
    },
    {
      officialNumber: 7,
      position: 5,
      name: 'CHV_NFE_CTE',
      kind: 'text',
      obrigatoriedade: 'OC',
      descricao:
        'Chave da NF-e/CT-e de origem (44 posições), quando documento ' +
        'eletrônico.',
    },
  ],
};

/**
 * G140 — Identificação do item do documento fiscal (origem do crédito).
 *
 * Nível 5, filho do G130, ocorrência 1:N. Identifica o item do documento fiscal
 * (G130 pai) referente ao bem/componente. Exigido junto com o G130 — quando o
 * G130 é emitido, cada item relevante do documento gera um G140.
 *
 * Leiaute oficial com 3 campos (01..03), portanto 2 campos após REG. O builder
 * atual NÃO emite G140 (ver tarefa 4.5, R3.4). EXPECTED_FIELD_COUNTS deve ganhar
 * a entrada 'G140': 2.
 */
export const G140_LAYOUT: BlocoGRecordLayout = {
  reg: 'G140',
  nivelHierarquico: 5,
  descricao:
    'Identificação do item do documento fiscal que originou o crédito.',
  fieldCountAfterReg: 2,
  fields: [
    {
      officialNumber: 1,
      position: null,
      name: 'REG',
      kind: 'text',
      obrigatoriedade: 'O',
      descricao: 'Texto fixo contendo "G140".',
    },
    {
      officialNumber: 2,
      position: 0,
      name: 'NUM_ITEM',
      kind: 'text',
      obrigatoriedade: 'O',
      descricao:
        'Número sequencial do item no documento fiscal de origem (campo ' +
        'NUM_ITEM do C170/documento).',
    },
    {
      officialNumber: 3,
      position: 1,
      name: 'COD_ITEM',
      kind: 'text',
      obrigatoriedade: 'O',
      descricao:
        'Código do item (campo COD_ITEM do 0200) do bem/componente no ' +
        'documento de origem.',
    },
  ],
};

/**
 * 0300 — Cadastro de bens ou componentes do Ativo Imobilizado (Bloco 0).
 *
 * Nível 2, ocorrência vários por arquivo. É o cadastro que o G125 referencia
 * pelo COD_IND_BEM. Leiaute oficial com 7 campos (01..07), portanto 6 campos
 * após REG. O builder atual NÃO emite 0300 — a tarefa 4.4 deve passar a emitir
 * (R3.3). EXPECTED_FIELD_COUNTS deve ganhar a entrada '0300': 6.
 */
export const REGISTRO_0300_LAYOUT: BlocoGRecordLayout = {
  reg: '0300',
  nivelHierarquico: 2,
  descricao: 'Cadastro de bens ou componentes do Ativo Imobilizado.',
  fieldCountAfterReg: 6,
  fields: [
    {
      officialNumber: 1,
      position: null,
      name: 'REG',
      kind: 'text',
      obrigatoriedade: 'O',
      descricao: 'Texto fixo contendo "0300".',
    },
    {
      officialNumber: 2,
      position: 0,
      name: 'COD_IND_BEM',
      kind: 'text',
      obrigatoriedade: 'O',
      descricao:
        'Código individualizado do bem/componente no controle patrimonial. ' +
        'É a chave referenciada por COD_IND_BEM do G125.',
    },
    {
      officialNumber: 3,
      position: 1,
      name: 'IDENT_MERC',
      kind: 'text',
      obrigatoriedade: 'O',
      descricao:
        'Identificação do tipo de mercadoria: 1 = bem; 2 = componente.',
    },
    {
      officialNumber: 4,
      position: 2,
      name: 'DESCR_ITEM',
      kind: 'text',
      obrigatoriedade: 'O',
      descricao:
        'Descrição do bem/componente (modelo, marca e características que o ' +
        'individualizem).',
    },
    {
      officialNumber: 5,
      position: 3,
      name: 'COD_PRNC',
      kind: 'text',
      obrigatoriedade: 'OC',
      descricao:
        'Código de cadastro do bem principal, quando o item (COD_IND_BEM) for ' +
        'um componente vinculado a um bem principal.',
    },
    {
      officialNumber: 6,
      position: 4,
      name: 'COD_CTA',
      kind: 'text',
      obrigatoriedade: 'O',
      descricao:
        'Código da conta analítica de contabilização do bem/componente ' +
        '(campo COD_CTA do Registro 0500).',
    },
    {
      officialNumber: 7,
      position: 5,
      name: 'NR_PARC',
      kind: 'integer',
      obrigatoriedade: 'O',
      descricao:
        'Número total de parcelas a serem apropriadas, segundo a legislação da ' +
        'UF (ex.: 48). Base do cálculo de VL_PARC_PASS do G125.',
    },
  ],
};

/**
 * 0305 — Informação sobre a utilização do bem (filho do 0300, Bloco 0).
 *
 * Nível 3, ocorrência 1:1 por 0300. A partir de 01/11/2013 só deve ser
 * informado quando IDENT_MERC do 0300 for "1" (bem). Leiaute oficial com 4
 * campos (01..04), portanto 3 campos após REG. A tarefa 4.4 deve emitir 0305
 * "quando aplicável" (R3.3). EXPECTED_FIELD_COUNTS deve ganhar '0305': 3.
 */
export const REGISTRO_0305_LAYOUT: BlocoGRecordLayout = {
  reg: '0305',
  nivelHierarquico: 3,
  descricao: 'Informação sobre a utilização do bem.',
  fieldCountAfterReg: 3,
  fields: [
    {
      officialNumber: 1,
      position: null,
      name: 'REG',
      kind: 'text',
      obrigatoriedade: 'O',
      descricao: 'Texto fixo contendo "0305".',
    },
    {
      officialNumber: 2,
      position: 0,
      name: 'COD_CCUS',
      kind: 'text',
      obrigatoriedade: 'O',
      descricao:
        'Código do centro de custo onde está localizado o bem (campo COD_CCUS ' +
        'do Registro 0600).',
    },
    {
      officialNumber: 3,
      position: 1,
      name: 'FUNC',
      kind: 'text',
      obrigatoriedade: 'O',
      descricao:
        'Descrição sucinta da função do bem na atividade do estabelecimento.',
    },
    {
      officialNumber: 4,
      position: 2,
      name: 'VIDA_UTIL',
      kind: 'integer',
      obrigatoriedade: 'O',
      descricao: 'Vida útil estimada do bem, em número de meses.',
    },
  ],
};

/**
 * Índice de todos os leiautes confirmados nesta referência, por REG. Útil para
 * as fixtures normativas (tarefa 5.1) e para derivar EXPECTED_FIELD_COUNTS.
 */
export const BLOCO_G_LEIAUTES: Readonly<Record<string, BlocoGRecordLayout>> =
  Object.freeze({
    G110: G110_LAYOUT,
    G125: G125_LAYOUT,
    G130: G130_LAYOUT,
    G140: G140_LAYOUT,
    '0300': REGISTRO_0300_LAYOUT,
    '0305': REGISTRO_0305_LAYOUT,
  });

/**
 * Contagens oficiais de campos após REG — alvo para EXPECTED_FIELD_COUNTS em
 * sped-validator.ts (tarefas 4.2/4.3). Hoje o validador tem G110: 8 e G125: 10
 * (ambos incorretos) e não tem entradas para 0300/0305.
 *
 *   G110: 8  -> 9   (incluir SOM_ICMS_OC e posicionar IND_PER_SAI)
 *   G125: 10 -> 9   (modelar VL_IMOB_ICMS_ST; total oficial é 9 após REG)
 *   G130: (ausente) -> 6   (identificação do documento fiscal de origem)
 *   G140: (ausente) -> 2   (identificação do item do documento de origem)
 *   0300: (ausente) -> 6
 *   0305: (ausente) -> 3
 */
export const BLOCO_G_EXPECTED_FIELD_COUNTS: Readonly<Record<string, number>> =
  Object.freeze({
    G110: G110_LAYOUT.fieldCountAfterReg,
    G125: G125_LAYOUT.fieldCountAfterReg,
    G130: G130_LAYOUT.fieldCountAfterReg,
    G140: G140_LAYOUT.fieldCountAfterReg,
    '0300': REGISTRO_0300_LAYOUT.fieldCountAfterReg,
    '0305': REGISTRO_0305_LAYOUT.fieldCountAfterReg,
  });

/**
 * Índice 0-based (dentro do array `fields` do SpedRecord, após REG) de um campo
 * do leiaute do Bloco G, identificado pelo nome oficial (ex.: 'NUM_PARC' no
 * G125). Serve para que leitores do registro (builder, preflight) referenciem a
 * posição pela fonte de verdade do leiaute em vez de números mágicos — assim,
 * se o leiaute mudar de novo, as leituras acompanham sem edição manual de
 * índices espalhados.
 *
 * Lança quando o REG não é conhecido, quando o campo não existe no leiaute ou
 * quando o campo é o próprio REG (position === null), tornando erros de digitação
 * em falhas explícitas de build/teste em vez de leituras silenciosas na posição
 * errada.
 */
export function blocoGFieldPosition(reg: string, fieldName: string): number {
  const layout = BLOCO_G_LEIAUTES[reg];
  if (!layout) {
    throw new Error(
      `Leiaute do Bloco G desconhecido para o registro "${reg}".`,
    );
  }
  const field = layout.fields.find((f) => f.name === fieldName);
  if (!field) {
    throw new Error(
      `Campo "${fieldName}" não existe no leiaute do registro "${reg}".`,
    );
  }
  if (field.position === null) {
    throw new Error(
      `Campo "${fieldName}" do registro "${reg}" é o próprio REG e não tem posição em fields.`,
    );
  }
  return field.position;
}
