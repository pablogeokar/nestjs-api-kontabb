/**
 * PDF text extraction and fiscal data parsing.
 * Mirrors the web project logic for extracting Brazilian tax document data.
 */

export type TipoDocumento =
    | 'DAS'
    | 'DAS-PARCSN'
    | 'DAS-PGFN'
    | 'FGTS'
    | 'DARF'
    | 'INSS'
    | 'DAE'
    | 'DESCONHECIDO';

export interface DadosFiscais {
    cnpj: string | null;
    periodo: string | null;
    vencimento: string | null;
    tipo: TipoDocumento;
    valor: string | null;
    parcelamento?: {
        parcela?: number;
        totalParcelas?: number;
        numeroParcelamento?: string;
        codigoPgfn?: string;
    } | null;
}

function formatCnpj(digits: string): string {
    return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
}

function extractCnpj(text: string): string | null {
    const contextMatch = text.match(
        /(?:CPF\/CNPJ[^\d]{0,25}|CNPJ[^\d]{0,15})(\d{2}[\.\s]?\d{3}[\.\s]?\d{3}(?:[\/\s]?\d{4}[-\s]?\d{2})?)/i,
    );
    if (contextMatch) {
        const raw = contextMatch[1].replace(/[^\d]/g, '');
        if (raw.length === 14) return formatCnpj(raw);
        if (raw.length === 8) return contextMatch[1].trim();
    }
    const fullMatch = text.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/);
    if (fullMatch) return fullMatch[0];
    return null;
}

const MES_MAP: Record<string, string> = {
    janeiro: '01', fevereiro: '02', marco: '03', abril: '04',
    maio: '05', junho: '06', julho: '07', agosto: '08',
    setembro: '09', outubro: '10', novembro: '11', dezembro: '12',
};

function normalizeMes(mes: string): string {
    return mes.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function extractPeriodo(text: string): string | null {
    const extenso = text.match(
        /\b(janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\/(20\d{2})\b/i,
    );
    if (extenso) {
        const num = MES_MAP[normalizeMes(extenso[1])];
        return num ? `${num}/${extenso[2]}` : null;
    }
    if (/\bDiversos\b/i.test(text) && /Parcel|PARCSN/i.test(text)) {
        const venc = text.match(/(?:Pagar\s+(?:este\s+documento\s+)?at[eé]|Vencimento)[^\d]*(\d{2})\/(\d{2})\/(20\d{2})/i);
        if (venc) return `${venc[2]}/${venc[3]}`;
    }
    const contextual = text.match(/(?:Per[ií]odo de Apura[cç][aã]o|Compet[eê]ncia|Refer[eê]ncia)[^\d]*(0[1-9]|1[0-2])\/(20\d{2})/i);
    if (contextual) return `${contextual[1]}/${contextual[2]}`;
    const generic = text.match(/\b(0[1-9]|1[0-2])\/(20\d{2})\b/);
    if (generic) return generic[0];
    return null;
}

function extractVencimento(text: string): string | null {
    const contextual = text.match(
        /(?:Pagar\s+(?:este\s+documento\s+)?at[eé]|Data\s+de\s+Vencimento)[^\d]*(\d{2}\/\d{2}\/20\d{2})/i,
    );
    if (contextual) return contextual[1];
    const matches = [...text.matchAll(/\b(\d{2})\/(\d{2})\/(20\d{2})\b/g)];
    return matches.length > 0 ? matches[0][0] : null;
}

function detectTipo(text: string): TipoDocumento {
    if (/Simples Nacional/i.test(text)) {
        if (/PGFN[-\s]?SISPAR|REC\.?\s*DIVIDA\s*ATIVA/i.test(text)) return 'DAS-PGFN';
        if (/DAS\s+de\s+PARCSN|N[uú]mero\s+do\s+Parcelamento/i.test(text)) return 'DAS-PARCSN';
        return 'DAS';
    }
    if (/FGTS Digital|GFD|Guia do FGTS/i.test(text)) return 'FGTS';
    if (/Receitas Federais/i.test(text)) {
        if (/CP SEGURADOS|CONTR PREV|10[89][0-9]/i.test(text)) return 'INSS';
        return 'DARF';
    }
    if (/DAE|documento\s+de\s+arrecada[cç][aã]o\s+estadual|ANTECIPA[CÇC][AÃA]O\s+PARCIAL/i.test(text)) return 'DAE';
    return 'DESCONHECIDO';
}

function extractValor(text: string): string | null {
    const match = text.match(
        /(?:Valor[^\d\n]{0,40}|Total da Guia:[^\d\n]{0,10}|Total\s+a\s+Recolher\s+R\$\s*)([\d]{1,3}(?:\.\d{3})*,\d{2})/i,
    );
    return match ? match[1] : null;
}

function extractParcelamento(text: string, tipo: TipoDocumento): DadosFiscais['parcelamento'] {
    if (tipo !== 'DAS-PARCSN' && tipo !== 'DAS-PGFN') return null;
    const result: NonNullable<DadosFiscais['parcelamento']> = {};
    const parcelaMatch = text.match(/Parcela:\s*(\d+)\/(\d+)/i);
    if (parcelaMatch) {
        result.parcela = parseInt(parcelaMatch[1], 10);
        result.totalParcelas = parseInt(parcelaMatch[2], 10);
    }
    const numMatch = text.match(/N[uú]mero\s+do\s+Parcelamento:\s*(\d+)/i);
    if (numMatch) result.numeroParcelamento = numMatch[1];
    const pgfnMatch = text.match(/PGFN[-\s]?SISPAR[:\s]*(\d+)/i);
    if (pgfnMatch) result.codigoPgfn = pgfnMatch[1];
    return Object.keys(result).length > 0 ? result : null;
}

export function extractDadosFiscais(text: string): DadosFiscais {
    const tipo = detectTipo(text);
    return {
        cnpj: extractCnpj(text),
        periodo: extractPeriodo(text),
        vencimento: extractVencimento(text),
        tipo,
        valor: extractValor(text),
        parcelamento: extractParcelamento(text, tipo),
    };
}

export async function extractPdfText(buffer: Buffer): Promise<string> {
    const { extractText } = await import('unpdf');
    const uint8 = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const result = await extractText(uint8, { mergePages: true });
    return result.text ?? '';
}
