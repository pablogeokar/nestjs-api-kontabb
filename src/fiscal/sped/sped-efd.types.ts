import type { SpedRecord } from './core';

export type SpedInconsistenciaSeveridade = 'ERRO' | 'AVISO';

export interface SpedInconsistencia {
  codigo: string;
  severidade: SpedInconsistenciaSeveridade;
  mensagem: string;
  campo?: string;
  documentoId?: string;
  chaveAcesso?: string;
}

export interface SpedContadoresPreview {
  totalLinhas: number;
  porBloco: Record<string, number>;
  porRegistro: Record<string, number>;
}

export interface SpedApuracaoPreview {
  icmsProprio: {
    debitos: string;
    creditos: string;
    saldoCredorAnterior: string;
    ajustesDebitos: string;
    ajustesCreditos: string;
    estornosCreditos: string;
    estornosDebitos: string;
    deducoes: string;
    debitosEspeciais: string;
    saldoApurado: string;
    icmsRecolher: string;
    saldoCredorTransportar: string;
  };
  icmsStPorUf: Array<{
    uf: string;
    debitos: string;
    saldoCredorAnterior: string;
    recolher: string;
    saldoCredorTransportar: string;
    debitosEspeciais: string;
  }>;
  difalFcpPorUf: Array<{
    uf: string;
    difal: string;
    fcp: string;
    recolher: string;
    debitosEspeciais: string;
  }>;
  ipi: null | {
    debitos: string;
    creditos: string;
    saldoCredorAnterior: string;
    recolher: string;
    saldoCredorTransportar: string;
  };
}

export interface SpedPreview {
  podeGerar: boolean;
  competencia: string;
  finalidade: '0' | '1';
  codVersao: '020';
  versaoLeiaute: '119';
  guiaPratico: '3.2.2';
  pvaReferencia: '6.1.1';
  perfil: 'A' | 'B' | 'C' | null;
  contadores: SpedContadoresPreview;
  documentos: {
    incluidos: number;
    excluidos: number;
    pendentes: number;
    nfe: number;
    nfce: number;
    cte: number;
  };
  apuracao: SpedApuracaoPreview;
  inconsistencias: SpedInconsistencia[];
}

export interface SpedPreparedGeneration {
  preview: SpedPreview;
  records: SpedRecord[];
  clientDocument: string;
}

export interface GeneratedSpedFile {
  id: string;
  buffer: Buffer;
  filename: string;
  hashSha256: string;
}
