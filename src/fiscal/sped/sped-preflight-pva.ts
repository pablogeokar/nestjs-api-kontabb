import type { SpedRecord } from './core';
import { formatSpedField } from './core/sped-formatters';
import type { SpedInconsistencia } from './sped-efd.types';

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

  // G125: número da parcela não pode exceder o total (1..48).
  for (const g125 of fieldsByReg('G125')) {
    const numeroParcela = Number(g125[6]);
    if (Number.isFinite(numeroParcela) && numeroParcela > 48) {
      issues.push({
        codigo: 'PVA_G125_PARCELA_INVALIDA',
        severidade: 'ERRO',
        mensagem: `O CIAP registrou a parcela ${numeroParcela}, acima do limite de 48.`,
        campo: g125[0],
      });
    }
  }

  return issues;
}

// Percorre os documentos (C100) e seus filhos até o próximo C100, sinalizando
// devoluções (CFOP terminando em 201/202/411/553/556 etc.) sem C113.
function validarReferenciaDevolucao(
  records: SpedRecord[],
): SpedInconsistencia[] {
  const issues: SpedInconsistencia[] = [];
  const finaisDevolucao = new Set([
    '201',
    '202',
    '208',
    '209',
    '410',
    '411',
    '412',
    '413',
    '553',
    '556',
  ]);
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
      if (cfop && finaisDevolucao.has(cfop.slice(1))) temDevolucao = true;
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

function fieldText(field: unknown): string {
  if (field == null) return '';
  return formatSpedField(field as never);
}
