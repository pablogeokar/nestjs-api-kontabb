import type { SpedRecord } from './core';
import { blocoGFieldPosition } from './core';
import { formatSpedField } from './core/sped-formatters';
import type { SpedInconsistencia } from './sped-efd.types';

// Posições (0-based, após REG) lidas do leiaute oficial do Bloco G
// (bloco-g-leiaute.ts) em vez de índices mágicos. Resolvidas uma vez por nome
// de campo, de modo que uma futura mudança de leiaute acompanhe sem reeditar o
// preflight.
const G125_COD_IND_BEM = blocoGFieldPosition('G125', 'COD_IND_BEM');
const G125_NUM_PARC = blocoGFieldPosition('G125', 'NUM_PARC');
const G125_VL_PARC_PASS = blocoGFieldPosition('G125', 'VL_PARC_PASS');
const REG_0300_COD_IND_BEM = blocoGFieldPosition('0300', 'COD_IND_BEM');
const REG_0300_NR_PARC = blocoGFieldPosition('0300', 'NR_PARC');

// Limite legal máximo de parcelas do CIAP (48 meses, LC 87/1996 art. 20 §5º).
// Usado como teto absoluto e como fallback quando o G125 não referencia um 0300
// com NR_PARC conhecido.
const CIAP_MAX_PARCELAS = 48;

/**
 * Validador semântico pré-PVA. Complementa o validador estrutural
 * (validateSpedFile) com regras de negócio do Guia Prático EFD ICMS/IPI que o
 * PVA da Receita aplica na importação — antes de gerar o TXT físico.
 *
 * Opera sobre os SpedRecord[] já montados (não sobre o texto), verificando
 * coerência entre registros de blocos diferentes (0150/0190/0200/0220,
 * C100/C113/C170/C190) para reduzir rejeições no PVA.
 */
export function runPreflightPva(records: SpedRecord[]): SpedInconsistencia[] {
  const issues: SpedInconsistencia[] = [];

  const fieldsByReg = (reg: string) =>
    records.filter((r) => r.reg === reg).map((r) => r.fields.map(fieldText));

  // Índices dos catálogos do Bloco 0.
  const codigosParticipantes = new Set(fieldsByReg('0150').map((f) => f[0]));
  const codigosUnidades = new Set(fieldsByReg('0190').map((f) => f[0]));
  const codigosItens = new Set(fieldsByReg('0200').map((f) => f[0]));

  // 0150: nome, código do município e endereço obrigatórios.
  for (const p of fieldsByReg('0150')) {
    const [codigo, nome, , , , , codMun] = p;
    if (!nome || !codMun) {
      issues.push({
        codigo: 'PVA_0150_INCOMPLETO',
        severidade: 'ERRO',
        mensagem: `Participante ${codigo} sem nome ou código de município no 0150.`,
        campo: codigo,
      });
    }
  }

  // 0200: unidade do item deve existir no 0190.
  for (const item of fieldsByReg('0200')) {
    const [codigo, , , , unidade] = item;
    if (unidade && !codigosUnidades.has(unidade)) {
      issues.push({
        codigo: 'PVA_0200_UNIDADE_INEXISTENTE',
        severidade: 'ERRO',
        mensagem: `O item ${codigo} referencia a unidade ${unidade} ausente no 0190.`,
        campo: codigo,
      });
    }
  }

  // 0220: unidade de conversão deve existir no 0190.
  for (const conv of fieldsByReg('0220')) {
    const [unidadeConv] = conv;
    if (unidadeConv && !codigosUnidades.has(unidadeConv)) {
      issues.push({
        codigo: 'PVA_0220_UNIDADE_INEXISTENTE',
        severidade: 'ERRO',
        mensagem: `O 0220 referencia a unidade de conversão ${unidadeConv} ausente no 0190.`,
        campo: unidadeConv,
      });
    }
  }

  // C170: item e unidade referenciados devem existir nos catálogos.
  for (const c170 of fieldsByReg('C170')) {
    const codItem = c170[1];
    const unidade = c170[4];
    if (codItem && !codigosItens.has(codItem)) {
      issues.push({
        codigo: 'PVA_C170_ITEM_INEXISTENTE',
        severidade: 'ERRO',
        mensagem: `O C170 referencia o item ${codItem} ausente no 0200.`,
        campo: codItem,
      });
    }
    if (unidade && !codigosUnidades.has(unidade)) {
      issues.push({
        codigo: 'PVA_C170_UNIDADE_INEXISTENTE',
        severidade: 'ERRO',
        mensagem: `O C170 referencia a unidade ${unidade} ausente no 0190.`,
        campo: codItem || unidade,
      });
    }
  }

  // C113: quando presente, participante referenciado deve existir no 0150.
  for (const c113 of fieldsByReg('C113')) {
    const codPart = c113[2];
    if (codPart && !codigosParticipantes.has(codPart)) {
      issues.push({
        codigo: 'PVA_C113_PARTICIPANTE_INEXISTENTE',
        severidade: 'ERRO',
        mensagem: `O C113 referencia o participante ${codPart} ausente no 0150.`,
        campo: codPart,
      });
    }
  }

  // Devolução deve referenciar a nota original (C113): AVISO quando um C100
  // tem itens com CFOP de devolução mas nenhum C113 no documento.
  issues.push(...validarReferenciaDevolucao(records));

  // Bloco G (CIAP): valida G125 contra o leiaute oficial e o cadastro 0300.
  issues.push(...validarBlocoGCiap(records));

  return issues;
}

/**
 * Natureza de operação derivada do CFOP, para o preflight decidir regras
 * (ex.: devolução exige C113). R5.3: a decisão é dirigida por natureza
 * classificada, não por um palpite de sufixo cru.
 */
type NaturezaCfop = 'DEVOLUCAO' | 'USO_CONSUMO' | 'OUTRA';

// F22/R5.3: sufixos de CFOP (3 últimos dígitos) que caracterizam DEVOLUÇÃO,
// exigindo referência à nota original via C113. A tabela é explícita e
// documentada em vez de uma heurística de sufixo. Fonte: tabela CFOP do
// Ajuste SINIEF (grupos 1/2/5/6/7 compartilham os mesmos 3 dígitos finais).
const SUFIXOS_DEVOLUCAO = new Set([
  '201', // Devolução de compra para industrialização/produção
  '202', // Devolução de compra para comercialização
  '208', // Devolução de mercadoria recebida em transferência
  '209', // Devolução de mercadoria recebida (produção do estabelecimento)
  '410', // Devolução de compra p/ industrialização (ST)
  '411', // Devolução de compra p/ comercialização (ST)
  '412', // Devolução de bem do ativo imobilizado (ST)
  '413', // Devolução de mercadoria de uso/consumo (ST)
  '553', // Devolução de compra de bem para o ativo imobilizado
]);

// Sufixos de uso/consumo que NÃO são devolução. Explicitados para deixar claro
// que 556 (1556/2556 = material de uso e consumo) é diferente de devolução —
// era a fonte histórica de falso positivo. 557 é o par com ST.
const SUFIXOS_USO_CONSUMO = new Set([
  '556', // Compra de material para uso ou consumo
  '557', // Compra de material para uso/consumo (ST)
]);

/**
 * Classifica um CFOP completo (ex.: `1202`, `1556`) em uma natureza de
 * operação. Usa apenas os 3 dígitos finais, comuns às famílias 1/2/5/6/7.
 * `1556` (uso/consumo) → USO_CONSUMO; `1202`/`5556`... conforme o sufixo.
 */
export function naturezaCfop(cfop: string): NaturezaCfop {
  const sufixo = cfop.trim().slice(-3);
  if (SUFIXOS_DEVOLUCAO.has(sufixo)) return 'DEVOLUCAO';
  if (SUFIXOS_USO_CONSUMO.has(sufixo)) return 'USO_CONSUMO';
  return 'OUTRA';
}

// Percorre os documentos (C100) e seus filhos até o próximo C100, sinalizando
// documentos cuja natureza (via naturezaCfop) é DEVOLUÇÃO mas que não têm C113.
function validarReferenciaDevolucao(
  records: SpedRecord[],
): SpedInconsistencia[] {
  const issues: SpedInconsistencia[] = [];
  let dentroC100 = false;
  let temReferencia = false;
  let temDevolucao = false;
  let chaveDoc: string | null = null;

  const fechar = () => {
    if (dentroC100 && temDevolucao && !temReferencia) {
      issues.push({
        codigo: 'PVA_DEVOLUCAO_SEM_C113',
        severidade: 'AVISO',
        mensagem:
          'Documento com CFOP de devolução sem C113 referenciando a nota original.',
        chaveAcesso: chaveDoc ?? undefined,
      });
    }
  };

  for (const record of records) {
    if (record.reg === 'C100') {
      fechar();
      dentroC100 = true;
      temReferencia = false;
      temDevolucao = false;
      chaveDoc = fieldText(record.fields[7]);
      continue;
    }
    if (!dentroC100) continue;
    if (record.reg === 'C113') temReferencia = true;
    if (record.reg === 'C170' || record.reg === 'C190') {
      const cfop = fieldText(
        record.reg === 'C170' ? record.fields[9] : record.fields[1],
      );
      if (cfop && naturezaCfop(cfop) === 'DEVOLUCAO') temDevolucao = true;
    }
    // Registros de outros blocos encerram o escopo do C100 atual.
    if (!record.reg.startsWith('C')) {
      fechar();
      dentroC100 = false;
    }
  }
  fechar();
  return issues;
}

/**
 * Validações do Bloco G (CIAP) que o PVA aplica na importação, lendo os campos
 * nas posições do leiaute oficial (bloco-g-leiaute.ts), não em índices fixos:
 *
 *  - PVA_G125_0300_INEXISTENTE: o COD_IND_BEM do G125 deve constar de um
 *    registro 0300 emitido (integridade referencial G125 -> 0300, R3.3).
 *  - PVA_G125_PARCELA_INVALIDA: NUM_PARC deve estar em 1..NR_PARC do 0300
 *    referenciado (ou 1..48 quando o 0300 não traz NR_PARC utilizável), nunca
 *    acima do limite legal de 48 (R3.2/R3.6). NUM_PARC é obrigatório quando
 *    VL_PARC_PASS > 0.
 */
function validarBlocoGCiap(records: SpedRecord[]): SpedInconsistencia[] {
  const issues: SpedInconsistencia[] = [];
  const fields0300 = records
    .filter((r) => r.reg === '0300')
    .map((r) => r.fields.map(fieldText));
  const fieldsG125 = records
    .filter((r) => r.reg === 'G125')
    .map((r) => r.fields.map(fieldText));

  // NR_PARC (total de parcelas) por COD_IND_BEM, a partir dos 0300 emitidos.
  const nrParcPorBem = new Map<string, number>();
  for (const r of fields0300) {
    const cod = r[REG_0300_COD_IND_BEM];
    const nrParc = Number(r[REG_0300_NR_PARC]);
    if (cod) {
      nrParcPorBem.set(cod, Number.isFinite(nrParc) ? nrParc : NaN);
    }
  }

  for (const g125 of fieldsG125) {
    const codBem = g125[G125_COD_IND_BEM];
    const numParcRaw = g125[G125_NUM_PARC];
    const vlParcPass = parseDecimal(g125[G125_VL_PARC_PASS]);

    // R3.3: o COD_IND_BEM do G125 deve referenciar um 0300 válido.
    if (codBem && !nrParcPorBem.has(codBem)) {
      issues.push({
        codigo: 'PVA_G125_0300_INEXISTENTE',
        severidade: 'ERRO',
        mensagem: `O G125 referencia o bem ${codBem} sem cadastro 0300 correspondente.`,
        campo: codBem,
      });
    }

    const numParc = Number(numParcRaw);
    const temParcela = numParcRaw !== '' && Number.isFinite(numParc);

    // NUM_PARC é obrigatório quando há valor passível de apropriação.
    if (vlParcPass > 0 && !temParcela) {
      issues.push({
        codigo: 'PVA_G125_PARCELA_AUSENTE',
        severidade: 'ERRO',
        mensagem: `O bem ${codBem} tem parcela passível (VL_PARC_PASS) sem NUM_PARC informado.`,
        campo: codBem,
      });
      continue;
    }

    if (!temParcela) continue;

    // NR_PARC do 0300 referenciado define o teto; na ausência, usa o limite
    // legal de 48. Em nenhum caso NUM_PARC pode exceder 48.
    const nrParc = nrParcPorBem.get(codBem);
    const limite =
      nrParc !== undefined && Number.isFinite(nrParc) && nrParc > 0
        ? Math.min(nrParc, CIAP_MAX_PARCELAS)
        : CIAP_MAX_PARCELAS;

    if (numParc < 1 || numParc > limite) {
      issues.push({
        codigo: 'PVA_G125_PARCELA_INVALIDA',
        severidade: 'ERRO',
        mensagem: `O CIAP registrou a parcela ${numParc} para o bem ${codBem}, fora do intervalo 1..${limite}.`,
        campo: codBem,
      });
    }
  }

  return issues;
}

// Converte um campo decimal SPED (ex.: "100,00") em number apenas para
// comparações de presença/positividade do preflight. Não participa de cálculo
// fiscal (que usa inteiros escalados no builder), então o uso de Number aqui é
// seguro.
function parseDecimal(value: string | undefined): number {
  if (!value) return 0;
  const n = Number(value.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function fieldText(field: unknown): string {
  if (field == null) return '';
  return formatSpedField(field as never);
}
