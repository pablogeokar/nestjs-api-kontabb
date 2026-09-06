/** Catálogo versionado em código (consulta O(1), sem dependência de seed).
 * Fontes: IN RFB 1.009/2010, Ajuste SINIEF 03/2010 e Convênio s/n de 1970.
 * Descrições informativas: não autorizam crédito nem convertem CST do emitente.
 * Conferência: 2026-09-06. URLs e limites no guia fiscal-escrituracao-inteligente.md.
 */
const icms: Record<string, string> = {
  '02': 'Tributação monofásica própria sobre combustíveis',
  '15': 'Tributação monofásica própria e com responsabilidade pela retenção sobre combustíveis',
  '53': 'Tributação monofásica sobre combustíveis com recolhimento diferido',
  '61': 'Tributação monofásica sobre combustíveis cobrada anteriormente',
  '00': 'Tributada integralmente',
  '10': 'Tributada e com cobrança do ICMS por substituição tributária',
  '20': 'Com redução de base de cálculo',
  '30': 'Isenta ou não tributada e com cobrança do ICMS por substituição tributária',
  '40': 'Isenta',
  '41': 'Não tributada',
  '50': 'Suspensão',
  '51': 'Diferimento',
  '60': 'ICMS cobrado anteriormente por substituição tributária',
  '70': 'Com redução de base de cálculo e cobrança do ICMS por substituição tributária',
  '90': 'Outras',
};
const csosn: Record<string, string> = {
  '101': 'Tributada pelo Simples Nacional com permissão de crédito',
  '102': 'Tributada pelo Simples Nacional sem permissão de crédito',
  '103': 'Isenção do ICMS no Simples Nacional para faixa de receita bruta',
  '201':
    'Tributada pelo Simples Nacional com permissão de crédito e com cobrança do ICMS por substituição tributária',
  '202':
    'Tributada pelo Simples Nacional sem permissão de crédito e com cobrança do ICMS por substituição tributária',
  '203':
    'Isenção do ICMS no Simples Nacional para faixa de receita bruta e com cobrança do ICMS por substituição tributária',
  '300': 'Imune',
  '400': 'Não tributada pelo Simples Nacional',
  '500':
    'ICMS cobrado anteriormente por substituição tributária (substituído) ou por antecipação',
  '900': 'Outros',
};
const ipi: Record<string, string> = {
  '00': 'Entrada com recuperação de crédito',
  '01': 'Entrada tributada com alíquota zero',
  '02': 'Entrada isenta',
  '03': 'Entrada não tributada',
  '04': 'Entrada imune',
  '05': 'Entrada com suspensão',
  '49': 'Outras entradas',
  '50': 'Saída tributada',
  '51': 'Saída tributada com alíquota zero',
  '52': 'Saída isenta',
  '53': 'Saída não tributada',
  '54': 'Saída imune',
  '55': 'Saída com suspensão',
  '99': 'Outras saídas',
};
const contribuicoes: Record<string, string> = {
  '01': 'Operação tributável com alíquota básica',
  '02': 'Operação tributável com alíquota diferenciada',
  '03': 'Operação tributável com alíquota por unidade de medida de produto',
  '04': 'Operação tributável monofásica — revenda a alíquota zero',
  '05': 'Operação tributável por substituição tributária',
  '06': 'Operação tributável a alíquota zero',
  '07': 'Operação isenta da contribuição',
  '08': 'Operação sem incidência da contribuição',
  '09': 'Operação com suspensão da contribuição',
  '49': 'Outras operações de saída',
  '67': 'Crédito presumido — outras operações',
  '70': 'Operação de aquisição sem direito a crédito',
  '71': 'Operação de aquisição com isenção',
  '72': 'Operação de aquisição com suspensão',
  '73': 'Operação de aquisição a alíquota zero',
  '74': 'Operação de aquisição sem incidência da contribuição',
  '75': 'Operação de aquisição por substituição tributária',
  '98': 'Outras operações de entrada',
  '99': 'Outras operações',
};
const vinculacoes = [
  'exclusivamente a receita tributada no mercado interno',
  'exclusivamente a receita não tributada no mercado interno',
  'exclusivamente a receita de exportação',
  'a receitas tributadas e não tributadas no mercado interno',
  'a receitas tributadas no mercado interno e de exportação',
  'a receitas não tributadas no mercado interno e de exportação',
  'a receitas tributadas e não tributadas no mercado interno e de exportação',
];
vinculacoes.forEach((texto, index) => {
  contribuicoes[String(50 + index)] =
    `Operação com direito a crédito — vinculada ${texto}`;
  contribuicoes[String(60 + index)] =
    `Crédito presumido — operação de aquisição vinculada ${texto}`;
});
const origem: Record<string, string> = {
  '0': 'Nacional, exceto as indicadas nos códigos 3, 4, 5 e 8',
  '1': 'Estrangeira — importação direta, exceto a indicada no código 6',
  '2': 'Estrangeira — adquirida no mercado interno, exceto a indicada no código 7',
  '3': 'Nacional, conteúdo de importação superior a 40% e inferior ou igual a 70%',
  '4': 'Nacional, produção em conformidade com processos produtivos básicos',
  '5': 'Nacional, conteúdo de importação inferior ou igual a 40%',
  '6': 'Estrangeira — importação direta, sem similar nacional na lista CAMEX e gás natural',
  '7': 'Estrangeira — adquirida no mercado interno, sem similar nacional na lista CAMEX e gás natural',
  '8': 'Nacional, conteúdo de importação superior a 70%',
};
const catalogos = {
  ICMS: icms,
  CSOSN: csosn,
  IPI: ipi,
  PIS: contribuicoes,
  COFINS: contribuicoes,
  ORIGEM: origem,
};
export function descricaoCst(
  tributo: keyof typeof catalogos,
  codigo?: string | null,
): string | null {
  if (!codigo) return null;
  const normalizado =
    tributo === 'ICMS' && /^[0-8]\d{2}$/.test(codigo)
      ? codigo.slice(-2)
      : codigo;
  return catalogos[tributo][normalizado] ?? null;
}
