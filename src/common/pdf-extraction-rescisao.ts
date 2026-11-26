/**
 * Detecção e extração de dados dos documentos de rescisão contratual:
 * TRCT, aviso prévio, exame demissional (ASO), guia do seguro-desemprego,
 * carta de recomendação e relação dos salários de contribuição (INSS).
 */

export const RESCISAO_DOCUMENTO_TIPOS = [
  'TRCT',
  'AVISO_PREVIO',
  'EXAME_DEMISSIONAL',
  'GUIA_SEGURO_DESEMPREGO',
  'CARTA_RECOMENDACAO',
  'HISTORICO_INSS',
  'OUTRO',
] as const;

export type RescisaoDocumentoTipo = (typeof RESCISAO_DOCUMENTO_TIPOS)[number];

export const RESCISAO_DOCUMENTO_LABELS: Record<RescisaoDocumentoTipo, string> =
  {
    TRCT: 'TRCT - Termo de Rescisão do Contrato de Trabalho',
    AVISO_PREVIO: 'Aviso Prévio',
    EXAME_DEMISSIONAL: 'Exame Demissional (ASO)',
    GUIA_SEGURO_DESEMPREGO: 'Guia do Seguro-Desemprego',
    CARTA_RECOMENDACAO: 'Carta de Recomendação',
    HISTORICO_INSS: 'Histórico de Contribuições do INSS',
    OUTRO: 'Outro documento',
  };

export function isRescisaoDocumentoTipo(
  value: unknown,
): value is RescisaoDocumentoTipo {
  return (
    typeof value === 'string' &&
    (RESCISAO_DOCUMENTO_TIPOS as readonly string[]).includes(value)
  );
}

export interface DadosTrct {
  cnpj: string;
  funcionarioNome: string;
  funcionarioCpf: string; // 11 dígitos
  dataAdmissao: string; // YYYY-MM-DD
  dataDesligamento: string; // YYYY-MM-DD
  competencia: string; // MM/YYYY do desligamento
  causaAfastamento: string | null;
  totalBruto: number;
  totalDescontos: number;
  totalLiquido: number;
}

function parseBRL(value: string): number {
  return parseFloat(value.replace(/\./g, '').replace(',', '.'));
}

function brDateToIso(value: string): string {
  const [d, m, y] = value.split('/');
  return `${y}-${m}-${d}`;
}

function formatCnpj(digits: string): string {
  return digits.replace(
    /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
    '$1.$2.$3/$4-$5',
  );
}

/** Remove acentos, caixa e tudo que não for letra/dígito. */
export function normalizeForMatch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function isTrct(text: string): boolean {
  return /TERMO\s+DE\s+RESCIS[ÃA]O\s+DO\s+CONTRATO\s+DE\s+TRABALHO/i.test(text);
}

/**
 * Identifica o tipo do documento de rescisão. Retorna `null` quando o texto
 * não parece ser um documento de rescisão (segue o fluxo de folha/férias).
 */
export function detectRescisaoDocumentoTipo(
  text: string,
): RescisaoDocumentoTipo | null {
  if (isTrct(text)) return 'TRCT';

  if (
    /RELA[ÇC][ÃA]O\s+DOS\s+SAL[ÁA]RIOS\s+DE\s+CONTRIBUI[ÇC][ÃA]O/i.test(text)
  ) {
    return 'HISTORICO_INSS';
  }

  if (
    /ATESTADO\s+DE\s+SA[ÚU]DE\s+OCUPACIONAL/i.test(text) &&
    /DEMISSIONAL/i.test(text)
  ) {
    return 'EXAME_DEMISSIONAL';
  }

  if (/A\s+QUEM\s+POSSA\s+INTERESSAR/i.test(text) && /desabonar/i.test(text)) {
    return 'CARTA_RECOMENDACAO';
  }

  // Os dois documentos abaixo são identificados pelo título, no início do
  // texto, para não confundir com rubricas de folha ("AVISO PRÉVIO INDENIZADO").
  const head = text.slice(0, 1500);
  if (/FOLHA\s+DE\s+PAGAMENTO|RECIBO\s+DE\s+F[ÉE]RIAS/i.test(head)) return null;

  if (/SEGURO[-\s]?DESEMPREGO/i.test(head)) return 'GUIA_SEGURO_DESEMPREGO';

  if (/AVISO\s+PR[ÉE]VIO/i.test(text.slice(0, 600))) return 'AVISO_PREVIO';

  return null;
}

/**
 * Descobre o nome do trabalhador. No TRCT o nome (campo 11) vem colado ao
 * bairro, mas se repete no rodapé do termo seguido da razão social. O nome é o
 * maior prefixo das palavras em maiúsculas que aparece pelo menos duas vezes.
 */
function extractNomeTrabalhador(flat: string): string | null {
  const m = flat.match(
    /\b\d{11}\s+((?:[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ']{2,}\s+)+)(?=[A-Z]{2}\s+\d{5}-?\d{3})/,
  );
  if (!m) return null;
  const words = m[1].trim().split(/\s+/);
  for (let size = words.length; size >= 2; size--) {
    const candidate = words.slice(0, size).join(' ');
    const occurrences = flat.split(candidate).length - 1;
    if (occurrences >= 2) return candidate;
  }
  return null;
}

export function extractDadosTrct(text: string): DadosTrct | null {
  if (!isTrct(text)) return null;
  // O PDF pode chegar com ou sem quebras de linha; trabalha-se em linha única.
  const flat = text.replace(/\s+/g, ' ').trim();

  const cnpjMatch = flat.match(/(?<!\d)(\d{14})(?!\d)/);
  if (!cnpjMatch) return null;
  const cnpj = formatCnpj(cnpjMatch[1]);

  const funcionarioNome = extractNomeTrabalhador(flat);
  if (!funcionarioNome) return null;

  // CPF (campo 18) vem seguido da data de nascimento (campo 19)
  const cpfMatch = flat.match(/(?<!\d)(\d{11})\s+\d{2}\/\d{2}\/\d{4}/);
  if (!cpfMatch) return null;

  // Admissão (24) e afastamento (26) vêm antes do código de afastamento (27).
  // A primeira ocorrência é a admissão; a última é o afastamento.
  const datas = [
    ...flat.matchAll(/(\d{2}\/\d{2}\/\d{4})\s+[A-Z]{1,3}\d{1,2}\b/g),
  ].map((m) => m[1]);
  if (datas.length === 0) return null;
  const admissao = datas[0];
  const desligamento = datas[datas.length - 1];

  const causaMatch = flat.match(
    /(RESCIS[ÃA]O\s+(?:CONTRATUAL|SEM|COM|INDIRETA|POR|ANTECIPADA|DE\s+COMUM)(?:\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ]+)*)/,
  );

  const money = '(\\d{1,3}(?:\\.\\d{3})*,\\d{2})';
  const bruto = flat.match(new RegExp(`TOTAL\\s+BRUTO\\s+${money}`));
  const descontos = flat.match(
    new RegExp(`TOTAL\\s+DEDU[ÇC][ÕO]ES\\s+${money}`),
  );
  const liquido = flat.match(new RegExp(`VALOR\\s+L[ÍI]QUIDO\\s+${money}`));
  if (!bruto || !descontos || !liquido) return null;

  const [, mes, ano] = desligamento.split('/');

  return {
    cnpj,
    funcionarioNome,
    funcionarioCpf: cpfMatch[1],
    dataAdmissao: brDateToIso(admissao),
    dataDesligamento: brDateToIso(desligamento),
    competencia: `${mes}/${ano}`,
    causaAfastamento: causaMatch ? causaMatch[1].trim() : null,
    totalBruto: parseBRL(bruto[1]),
    totalDescontos: parseBRL(descontos[1]),
    totalLiquido: parseBRL(liquido[1]),
  };
}

/** CNPJs (14 dígitos, com ou sem máscara) encontrados no texto, sem repetição. */
export function extractCnpjCandidates(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(
    /(?<![\d/])\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}(?!\d)/g,
  )) {
    const digits = m[0].replace(/\D/g, '');
    if (digits.length === 14) found.add(formatCnpj(digits));
  }
  return [...found];
}
