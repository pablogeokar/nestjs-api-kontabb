import type {
  DestdaFinalidade,
  DestdaIndEmit,
  DestdaIndOper,
  DestdaIndSit,
  DestdaIndTpSt,
} from './destda-leiaute';

/** Valores monetários em centavos (bigint), nunca ponto flutuante. */
export type Centavos = bigint;

export type DestdaInconsistenciaSeveridade = 'ERRO' | 'AVISO';

export interface DestdaInconsistencia {
  codigo: string;
  severidade: DestdaInconsistenciaSeveridade;
  mensagem: string;
  campo?: string;
}

export interface DestdaEmpresa {
  nome: string;
  cnpj: string;
  uf: string;
  ie: string;
  codMun: string;
  im?: string | null;
  suframa?: string | null;
  fantasia?: string | null;
  nire?: string | null;
}

export interface DestdaResponsavel {
  nome: string;
  codAssin: string;
  cpf: string;
  cep?: string | null;
  endereco?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  fone?: string | null;
  fax?: string | null;
  email?: string | null;
}

export interface DestdaContabilista {
  nome: string;
  codAssin: string;
  cnpj?: string | null;
  cpf?: string | null;
  crc: string;
  cep?: string | null;
  endereco?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  uf: string;
  codMun: string;
  fone?: string | null;
  fax?: string | null;
  email?: string | null;
}

export interface DestdaInscricaoSubstituto {
  uf: string;
  ie: string;
}

/** Registro 0030 — perfil do contribuinte (campos após REG). */
export interface DestdaPerfil {
  indEd: string;
  indArq: string;
  prfIss: string;
  prfIcms: string;
  prfRidf: string;
  prfRudf: string;
  prfLmc: string;
  prfRv: string;
  prfRi: string;
  indEc: string;
  indIss: string;
  indRt: string;
  indIcms: string;
  indSt: string;
  indAt: string;
  indIpi: string;
  indRiAvulso: string;
}

/** G605 — antecipação/diferencial de alíquota nas entradas interestaduais. */
export interface DestdaLinhaEntrada {
  indSit: DestdaIndSit;
  totalNf: Centavos;
  ajustes: Centavos;
}

/** G615 — ST/DIFAL nas vendas interestaduais a consumidor final, por UF. */
export interface DestdaLinhaConsumoFinal {
  uf: string;
  totalNf: Centavos;
  ajustes: Centavos;
}

/** G625 (agrupado sob o G620 de seu IND_OPER/IND_EMIT). */
export interface DestdaLinhaSt {
  indOper: DestdaIndOper;
  indEmit: DestdaIndEmit;
  uf: string;
  indTpSt: DestdaIndTpSt;
  totalNf: Centavos;
  ajustes: Centavos;
}

export interface DestdaTotais {
  entradas: DestdaLinhaEntrada[];
  consumoFinal: DestdaLinhaConsumoFinal[];
  st: DestdaLinhaSt[];
}

export interface DestdaBuilderInput {
  /** Competência 'AAAA-MM'. */
  competencia: string;
  finalidade: DestdaFinalidade;
  empresa: DestdaEmpresa;
  inscricoesSubstituto: DestdaInscricaoSubstituto[];
  responsavel: DestdaResponsavel;
  perfil: DestdaPerfil;
  contabilista: DestdaContabilista;
  totais: DestdaTotais;
}

export interface DestdaTotaisPreview {
  entradas: Array<{
    indSit: DestdaIndSit;
    totalNf: string;
    ajustes: string;
    aDeclarar: string;
  }>;
  consumoFinal: Array<{
    uf: string;
    totalNf: string;
    ajustes: string;
    aDeclarar: string;
  }>;
  st: Array<{
    indOper: DestdaIndOper;
    indEmit: DestdaIndEmit;
    uf: string;
    indTpSt: DestdaIndTpSt;
    totalNf: string;
    ajustes: string;
    aDeclarar: string;
  }>;
  totalADeclarar: string;
}

export interface DestdaPreview {
  podeGerar: boolean;
  competencia: string;
  finalidade: DestdaFinalidade;
  codVersao: string;
  semMovimento: boolean;
  totais: DestdaTotaisPreview;
  contadores: {
    totalLinhas: number;
    porBloco: Record<string, number>;
    porRegistro: Record<string, number>;
  };
  inconsistencias: DestdaInconsistencia[];
}

export interface GeneratedDestdaFile {
  id: string;
  buffer: Buffer;
  filename: string;
  hashSha256: string;
}
