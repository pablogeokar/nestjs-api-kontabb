import { BadRequestException, Injectable } from '@nestjs/common';
import { fromScaledInteger, toScaledInteger } from '../sped/sped-decimal';

export type SimplesAnexo =
  | 'ANEXO_I'
  | 'ANEXO_II'
  | 'ANEXO_III'
  | 'ANEXO_IV'
  | 'ANEXO_V';

export type SimplesSegregacao =
  | 'TRIBUTACAO_INTEGRAL'
  | 'ICMS_ST'
  | 'ICMS_ISENTO'
  | 'ISS_RETIDO'
  | 'PIS_COFINS_MONOFASICO';

export interface SimplesPartilha {
  irpj: string;
  csll: string;
  cofins: string;
  pis: string;
  cpp: string;
  ipi: string;
  icms: string;
  iss: string;
}

export interface SimplesFaixaCalculo {
  faixa: number;
  rbt12De: string;
  rbt12Ate: string;
  aliquotaNominal: string;
  parcelaDeduzir: string;
  partilha: SimplesPartilha;
}

export interface SimplesItemCalculoInput {
  anexo: SimplesAnexo;
  receita: string;
  segregacao: SimplesSegregacao;
  faixa: SimplesFaixaCalculo;
  rbt12: string;
  excedeuSublimite: boolean;
  deducoesAdicionais?: Array<'ICMS' | 'ISS' | 'PIS' | 'COFINS'>;
}

export interface SimplesItemCalculoResult {
  anexo: SimplesAnexo;
  faixaEnquadrada: number;
  aliquotaNominal: string;
  parcelaDeduzir: string;
  aliquotaEfetiva: string;
  receitaBrutaAtividade: string;
  segregacao: SimplesSegregacao;
  aliquotaEfetivaAposDeducoes: string;
  valorDevido: string;
  tributosPartilhados: Record<keyof SimplesPartilha, string>;
  deducoes: Array<'ICMS' | 'ISS' | 'PIS' | 'COFINS'>;
}

const RATE_SCALE = 4;
const RATE_FACTOR = 10n ** BigInt(RATE_SCALE);
const TRIBUTOS = [
  'irpj',
  'csll',
  'cofins',
  'pis',
  'cpp',
  'ipi',
  'icms',
  'iss',
] as const;

@Injectable()
export class SimplesCalculadorService {
  calcularAliquotaEfetiva(input: {
    rbt12: string;
    aliquotaNominal: string;
    parcelaDeduzir: string;
  }): string {
    const rbt12 = this.money(input.rbt12, 'RBT12');
    const nominal = this.rate(input.aliquotaNominal, 'alíquota nominal');
    const deducao = this.money(input.parcelaDeduzir, 'parcela a deduzir');
    if (rbt12 === 0n) return fromScaledInteger(0n, RATE_SCALE);
    if (rbt12 <= 18_000_000n) return fromScaledInteger(nominal, RATE_SCALE);
    const impostoNominal = this.divideRound(rbt12 * nominal, RATE_FACTOR);
    const base = impostoNominal > deducao ? impostoNominal - deducao : 0n;
    return fromScaledInteger(
      this.divideRound(base * RATE_FACTOR, rbt12),
      RATE_SCALE,
    );
  }

  calcularFatorR(folhaSalarios12m: string, rbt12: string): string | null {
    const folha = this.money(folhaSalarios12m, 'folha de salários');
    const receita = this.money(rbt12, 'RBT12');
    if (receita === 0n) return null;
    return fromScaledInteger(
      this.divideRound(folha * RATE_FACTOR, receita),
      RATE_SCALE,
    );
  }

  resolverAnexoFatorR(fatorR: string | null): 'ANEXO_III' | 'ANEXO_V' {
    if (fatorR == null) return 'ANEXO_V';
    return this.rate(fatorR, 'Fator R') >= 2_800n ? 'ANEXO_III' : 'ANEXO_V';
  }

  calcularRbt12(input: {
    receitasAnteriores: string[];
    mesesAnteriores: number;
    receitaPrimeiroMes?: string;
  }): { rbt12: string; proporcional: boolean; origem: string } {
    if (!Number.isInteger(input.mesesAnteriores) || input.mesesAnteriores < 0) {
      throw new BadRequestException('Quantidade de meses anteriores inválida.');
    }
    const receitas = input.receitasAnteriores.slice(-12).map((value) => this.money(value, 'receita'));
    if (input.mesesAnteriores >= 12) {
      return {
        rbt12: fromScaledInteger(receitas.reduce((sum, value) => sum + value, 0n)),
        proporcional: false,
        origem: 'RECEITAS_DOCUMENTOS_12_MESES_ANTERIORES',
      };
    }
    if (input.mesesAnteriores === 0) {
      const primeiroMes = this.money(input.receitaPrimeiroMes ?? '0', 'receita do primeiro mês');
      return {
        rbt12: fromScaledInteger(primeiroMes * 12n),
        proporcional: true,
        origem: 'INICIO_ATIVIDADE_PRIMEIRO_MES_ANUALIZADO',
      };
    }
    const disponiveis = receitas.slice(-input.mesesAnteriores);
    const total = disponiveis.reduce((sum, value) => sum + value, 0n);
    const media = this.divideRound(total, BigInt(input.mesesAnteriores));
    return {
      rbt12: fromScaledInteger(media * 12n),
      proporcional: true,
      origem: 'INICIO_ATIVIDADE_MEDIA_MESES_ANTERIORES_ANUALIZADA',
    };
  }

  selecionarFaixa(rbt12: string, faixas: SimplesFaixaCalculo[]): SimplesFaixaCalculo {
    const receita = this.money(rbt12, 'RBT12');
    const ordenadas = [...faixas].sort((a, b) => a.faixa - b.faixa);
    const faixa = ordenadas.find(
      (item) =>
        receita >= this.money(item.rbt12De, 'limite inicial') &&
        receita <= this.money(item.rbt12Ate, 'limite final'),
    );
    if (!faixa) {
      throw new BadRequestException(
        receita > 480_000_000n
          ? 'RBT12 superior ao limite de R$ 4.800.000,00 do Simples Nacional.'
          : 'Não existe faixa do Simples Nacional para o RBT12 informado.',
      );
    }
    return faixa;
  }

  calcularItem(input: SimplesItemCalculoInput): SimplesItemCalculoResult {
    const receita = this.money(input.receita, 'receita da atividade');
    const aliquotaEfetiva = this.rate(
      this.calcularAliquotaEfetiva({
        rbt12: input.rbt12,
        aliquotaNominal: input.faixa.aliquotaNominal,
        parcelaDeduzir: input.faixa.parcelaDeduzir,
      }),
      'alíquota efetiva',
    );
    const removidos = new Set<keyof SimplesPartilha>();
    if (input.excedeuSublimite) removidos.add('icms');
    if (input.segregacao === 'ICMS_ST' || input.segregacao === 'ICMS_ISENTO') removidos.add('icms');
    if (input.segregacao === 'ISS_RETIDO') removidos.add('iss');
    if (input.segregacao === 'PIS_COFINS_MONOFASICO') {
      removidos.add('pis');
      removidos.add('cofins');
    }
    for (const deducao of input.deducoesAdicionais ?? []) {
      removidos.add(deducao.toLowerCase() as keyof SimplesPartilha);
    }

    const rates = Object.fromEntries(
      TRIBUTOS.map((tributo) => {
        const percentual = this.rate(input.faixa.partilha[tributo], `partilha ${tributo}`);
        const rate = removidos.has(tributo)
          ? 0n
          : this.divideRound(aliquotaEfetiva * percentual, RATE_FACTOR);
        return [tributo, rate];
      }),
    ) as Record<keyof SimplesPartilha, bigint>;
    const percentualRemovido = TRIBUTOS.reduce(
      (sum, tributo) =>
        sum +
        (removidos.has(tributo)
          ? this.rate(input.faixa.partilha[tributo], `partilha ${tributo}`)
          : 0n),
      0n,
    );
    const aliquotaAposDeducoes = this.divideRound(
      aliquotaEfetiva * (RATE_FACTOR - percentualRemovido),
      RATE_FACTOR,
    );
    const valorDevido = this.divideRound(receita * aliquotaAposDeducoes, RATE_FACTOR);
    const partilhaCentavos = Object.fromEntries(
      TRIBUTOS.map((tributo) => [
        tributo,
        removidos.has(tributo)
          ? 0n
          : this.divideRound(receita * rates[tributo], RATE_FACTOR),
      ]),
    ) as Record<keyof SimplesPartilha, bigint>;

    // O arredondamento individual da partilha pode diferir um ou dois centavos
    // do total. O residual vai para o primeiro tributo incluído, mantendo a
    // identidade contábil entre a memória e o DAS.
    const somaPartilha = TRIBUTOS.reduce((sum, tributo) => sum + partilhaCentavos[tributo], 0n);
    const residual = valorDevido - somaPartilha;
    const primeiroIncluido = TRIBUTOS.find((tributo) => !removidos.has(tributo));
    if (primeiroIncluido) partilhaCentavos[primeiroIncluido] += residual;

    return {
      anexo: input.anexo,
      faixaEnquadrada: input.faixa.faixa,
      aliquotaNominal: fromScaledInteger(this.rate(input.faixa.aliquotaNominal, 'alíquota nominal'), RATE_SCALE),
      parcelaDeduzir: fromScaledInteger(this.money(input.faixa.parcelaDeduzir, 'parcela a deduzir')),
      aliquotaEfetiva: fromScaledInteger(aliquotaEfetiva, RATE_SCALE),
      receitaBrutaAtividade: fromScaledInteger(receita),
      segregacao: input.segregacao,
      aliquotaEfetivaAposDeducoes: fromScaledInteger(aliquotaAposDeducoes, RATE_SCALE),
      valorDevido: fromScaledInteger(valorDevido),
      tributosPartilhados: Object.fromEntries(
        TRIBUTOS.map((tributo) => [tributo, fromScaledInteger(partilhaCentavos[tributo])]),
      ) as Record<keyof SimplesPartilha, string>,
      deducoes: [
        ...(removidos.has('icms') ? (['ICMS'] as const) : []),
        ...(removidos.has('iss') ? (['ISS'] as const) : []),
        ...(removidos.has('pis') ? (['PIS'] as const) : []),
        ...(removidos.has('cofins') ? (['COFINS'] as const) : []),
      ],
    };
  }

  private money(value: string, label: string): bigint {
    let parsed: bigint;
    try {
      parsed = toScaledInteger(value, 2);
    } catch {
      throw new BadRequestException(`${label} inválido.`);
    }
    if (parsed < 0n) throw new BadRequestException(`${label} não pode ser negativo.`);
    return parsed;
  }

  private rate(value: string, label: string): bigint {
    let parsed: bigint;
    try {
      parsed = toScaledInteger(value, RATE_SCALE);
    } catch {
      throw new BadRequestException(`${label} inválido.`);
    }
    if (parsed < 0n) throw new BadRequestException(`${label} não pode ser negativo.`);
    return parsed;
  }

  private divideRound(numerator: bigint, denominator: bigint): bigint {
    if (denominator <= 0n) throw new BadRequestException('Divisor fiscal inválido.');
    return (numerator + denominator / 2n) / denominator;
  }
}
