import {
  createSpedRecord,
  dateField,
  decimalField,
  integerField,
  serializeSpedRecords,
  textField,
  type SerializedSpedFile,
  type SpedFieldValue,
  type SpedRecord,
} from '../sped/core';
import { fromScaledInteger } from '../sped/sped-decimal';
import {
  DESTDA_COD_CTD,
  DESTDA_COD_VER,
  DESTDA_LEIAUTE_TEXTO,
  DESTDA_PAIS,
  type DestdaBlockCode,
  type DestdaIndEmit,
  type DestdaIndOper,
  type DestdaIndSit,
} from './destda-leiaute';
import type {
  Centavos,
  DestdaBuilderInput,
  DestdaLinhaConsumoFinal,
  DestdaLinhaEntrada,
  DestdaLinhaSt,
  DestdaTotais,
  DestdaTotaisPreview,
} from './destda.types';

export interface BuiltDestdaFile extends SerializedSpedFile {
  readonly records: readonly SpedRecord[];
  readonly totalLines: number;
  readonly recordCounts: Readonly<Record<string, number>>;
  readonly blockCounts: Readonly<Record<DestdaBlockCode, number>>;
  readonly semMovimento: boolean;
  readonly totais: DestdaTotaisPreview;
}

const ZERO: Centavos = 0n;

/** Valor a declarar de uma linha: total das NFs menos os ajustes (nunca < 0). */
export function valorADeclarar(totalNf: Centavos, ajustes: Centavos): Centavos {
  const resultado = totalNf - ajustes;
  return resultado > ZERO ? resultado : ZERO;
}

/**
 * Consolida as linhas de apuração: soma linhas repetidas da mesma chave e
 * descarta chaves sem valor algum (o manual exige campos nulos ou maiores que
 * zero). A saída é determinística (ordenada), o que torna o arquivo estável
 * entre gerações.
 */
export function consolidarTotais(totais: DestdaTotais): DestdaTotais {
  const entradas = new Map<DestdaIndSit, DestdaLinhaEntrada>();
  for (const linha of totais.entradas) {
    assertNaoNegativo(linha.totalNf, linha.ajustes, `G605 ${linha.indSit}`);
    const atual = entradas.get(linha.indSit) ?? {
      indSit: linha.indSit,
      totalNf: ZERO,
      ajustes: ZERO,
    };
    atual.totalNf += linha.totalNf;
    atual.ajustes += linha.ajustes;
    entradas.set(linha.indSit, atual);
  }
  const consumo = new Map<string, DestdaLinhaConsumoFinal>();
  for (const linha of totais.consumoFinal) {
    assertNaoNegativo(linha.totalNf, linha.ajustes, `G615 ${linha.uf}`);
    const atual = consumo.get(linha.uf) ?? {
      uf: linha.uf,
      totalNf: ZERO,
      ajustes: ZERO,
    };
    atual.totalNf += linha.totalNf;
    atual.ajustes += linha.ajustes;
    consumo.set(linha.uf, atual);
  }
  const st = new Map<string, DestdaLinhaSt>();
  for (const linha of totais.st) {
    assertNaoNegativo(
      linha.totalNf,
      linha.ajustes,
      `G625 ${linha.uf}/${linha.indTpSt}`,
    );
    const chave = [linha.indOper, linha.indEmit, linha.uf, linha.indTpSt].join(
      '|',
    );
    const atual = st.get(chave) ?? {
      indOper: linha.indOper,
      indEmit: linha.indEmit,
      uf: linha.uf,
      indTpSt: linha.indTpSt,
      totalNf: ZERO,
      ajustes: ZERO,
    };
    atual.totalNf += linha.totalNf;
    atual.ajustes += linha.ajustes;
    st.set(chave, atual);
  }
  const comValor = (linha: { totalNf: Centavos; ajustes: Centavos }) =>
    linha.totalNf > ZERO || linha.ajustes > ZERO;
  return {
    entradas: [...entradas.values()]
      .filter(comValor)
      .sort((a, b) => a.indSit.localeCompare(b.indSit)),
    consumoFinal: [...consumo.values()]
      .filter(comValor)
      .sort((a, b) => a.uf.localeCompare(b.uf)),
    st: [...st.values()]
      .filter(comValor)
      .sort(
        (a, b) =>
          a.indOper.localeCompare(b.indOper) ||
          a.indEmit.localeCompare(b.indEmit) ||
          a.uf.localeCompare(b.uf) ||
          a.indTpSt.localeCompare(b.indTpSt),
      ),
  };
}

export function totaisParaPreview(totais: DestdaTotais): DestdaTotaisPreview {
  const consolidados = consolidarTotais(totais);
  const money = (value: Centavos) => fromScaledInteger(value);
  const entradas = consolidados.entradas.map((linha) => ({
    indSit: linha.indSit,
    totalNf: money(linha.totalNf),
    ajustes: money(linha.ajustes),
    aDeclarar: money(valorADeclarar(linha.totalNf, linha.ajustes)),
  }));
  const consumoFinal = consolidados.consumoFinal.map((linha) => ({
    uf: linha.uf,
    totalNf: money(linha.totalNf),
    ajustes: money(linha.ajustes),
    aDeclarar: money(valorADeclarar(linha.totalNf, linha.ajustes)),
  }));
  const st = consolidados.st.map((linha) => ({
    indOper: linha.indOper,
    indEmit: linha.indEmit,
    uf: linha.uf,
    indTpSt: linha.indTpSt,
    totalNf: money(linha.totalNf),
    ajustes: money(linha.ajustes),
    aDeclarar: money(valorADeclarar(linha.totalNf, linha.ajustes)),
  }));
  const total =
    consolidados.entradas.reduce(
      (soma, linha) => soma + valorADeclarar(linha.totalNf, linha.ajustes),
      ZERO,
    ) +
    consolidados.consumoFinal.reduce(
      (soma, linha) => soma + valorADeclarar(linha.totalNf, linha.ajustes),
      ZERO,
    ) +
    consolidados.st.reduce(
      (soma, linha) => soma + valorADeclarar(linha.totalNf, linha.ajustes),
      ZERO,
    );
  return { entradas, consumoFinal, st, totalADeclarar: money(total) };
}

export function buildDestdaFile(input: DestdaBuilderInput): BuiltDestdaFile {
  const totais = consolidarTotais(input.totais);
  const inicio = `${input.competencia}-01`;
  const fim = ultimoDiaDoMes(input.competencia);
  const semMovimento =
    totais.entradas.length === 0 &&
    totais.consumoFinal.length === 0 &&
    totais.st.length === 0;

  const bloco0 = buildBloco0(input, inicio, fim);
  const blocoG = buildBlocoG(totais, inicio, fim, semMovimento, [
    input.empresa.uf,
    ...input.inscricoesSubstituto.map((i) => i.uf),
  ]);
  const antesDoBloco9 = [...bloco0, ...blocoG];
  const records = Object.freeze([
    ...antesDoBloco9,
    ...buildBloco9(antesDoBloco9),
  ]);
  const serialized = serializeSpedRecords(records);
  const recordCounts = contarRegistros(records);
  return Object.freeze({
    ...serialized,
    records,
    totalLines: records.length,
    recordCounts: Object.freeze(recordCounts),
    blockCounts: Object.freeze(contarBlocos(records)),
    semMovimento,
    totais: totaisParaPreview(totais),
  });
}

function buildBloco0(
  input: DestdaBuilderInput,
  inicio: string,
  fim: string,
): SpedRecord[] {
  const { responsavel, contabilista, perfil } = input;
  const conteudo: SpedRecord[] = [];
  for (const inscricao of [...input.inscricoesSubstituto].sort((a, b) =>
    a.uf.localeCompare(b.uf),
  )) {
    conteudo.push(
      createSpedRecord(
        '0002',
        textField(inscricao.uf),
        textField(inscricao.ie),
      ),
    );
  }
  conteudo.push(
    createSpedRecord(
      '0005',
      textField(responsavel.nome),
      textField(responsavel.codAssin),
      textField(responsavel.cpf),
      textField(responsavel.cep),
      textField(responsavel.endereco),
      textField(responsavel.numero),
      textField(responsavel.complemento),
      textField(responsavel.bairro),
      '', // CEP_CP
      '', // CP
      telefoneField(responsavel.fone),
      telefoneField(responsavel.fax),
      textField(responsavel.email),
    ),
    createSpedRecord(
      '0030',
      textField(perfil.indEd),
      textField(perfil.indArq),
      textField(perfil.prfIss),
      textField(perfil.prfIcms),
      // O SEDIF (v1.0.9.0) exige nulos todos os campos abaixo, exceto IND_ST.
      '', // PRF_RIDF
      '', // PRF_RUDF
      '', // PRF_LMC
      '', // PRF_RV
      '', // PRF_RI
      '', // IND_EC
      '', // IND_ISS
      '', // IND_RT
      '', // IND_ICMS
      textField(perfil.indSt),
      '', // IND_AT
      '', // IND_IPI
      '', // IND_RI
    ),
    createSpedRecord(
      '0100',
      textField(contabilista.nome),
      textField(contabilista.codAssin),
      textField(contabilista.cnpj),
      textField(contabilista.cpf),
      textField(normalizarCrc(contabilista.crc)),
      textField(contabilista.cep),
      textField(contabilista.endereco),
      textField(contabilista.numero),
      textField(contabilista.complemento),
      textField(contabilista.bairro),
      textField(contabilista.uf),
      textField(contabilista.codMun),
      '', // CEP_CP
      '', // CP
      telefoneField(contabilista.fone),
      telefoneField(contabilista.fax),
      textField(contabilista.email),
    ),
  );
  const abertura = createSpedRecord(
    '0000',
    ...registro0000(input, inicio, fim),
  );
  // 0000 + 0001 + conteúdo + 0990 (o 0990 também se conta).
  return [
    abertura,
    createSpedRecord('0001', '0'),
    ...conteudo,
    createSpedRecord('0990', integerField(conteudo.length + 3)),
  ];
}

function registro0000(
  input: DestdaBuilderInput,
  inicio: string,
  fim: string,
): SpedFieldValue[] {
  const { empresa } = input;
  return [
    DESTDA_LEIAUTE_TEXTO,
    dateField(inicio),
    dateField(fim),
    textField(empresa.nome),
    textField(empresa.cnpj),
    textField(empresa.uf),
    textField(empresa.ie),
    textField(empresa.codMun),
    textField(empresa.im),
    '', // VAZIO1
    textField(empresa.suframa),
    DESTDA_COD_VER,
    input.finalidade,
    DESTDA_COD_CTD,
    DESTDA_PAIS,
    textField(empresa.fantasia),
    textField(empresa.nire),
    '', // CPF (vedado para pessoa jurídica)
    '', // VAZIO2
  ];
}

function buildBlocoG(
  totais: DestdaTotais,
  inicio: string,
  fim: string,
  semMovimento: boolean,
  ufsObrigatoriasSt: readonly string[],
): SpedRecord[] {
  const conteudo: SpedRecord[] = [
    createSpedRecord(
      'G020',
      semMovimento ? '9' : '2',
      dateField(inicio),
      dateField(fim),
    ),
  ];

  if (totais.entradas.length > 0) {
    // O SEDIF exige as quatro situações (0 a 3) sob o G600. Na situação 3
    // (antecipação sem encerramento de fase) o valor das NFs fica vazio.
    const porSit = new Map(totais.entradas.map((l) => [l.indSit, l]));
    const linhas = (['0', '1', '2', '3'] as const).map((indSit) => {
      const linha = porSit.get(indSit);
      const totalNf = linha?.totalNf ?? ZERO;
      const ajustes = linha?.ajustes ?? ZERO;
      return {
        indSit,
        nfInformada: indSit === '3' ? ZERO : totalNf,
        ajustes,
        declarar: valorADeclarar(totalNf, ajustes),
      };
    });
    conteudo.push(
      createSpedRecord(
        'G600',
        valorOuVazio(soma(linhas, (l) => l.nfInformada)),
        valorOuVazio(soma(linhas, (l) => l.ajustes)),
        moneyField(soma(linhas, (l) => l.declarar)),
      ),
    );
    for (const linha of linhas) {
      conteudo.push(
        createSpedRecord(
          'G605',
          linha.indSit,
          valorOuVazio(linha.nfInformada),
          valorOuVazio(linha.ajustes),
          moneyField(linha.declarar),
        ),
      );
    }
  }

  if (totais.consumoFinal.length > 0) {
    conteudo.push(
      createSpedRecord(
        'G610',
        ...tresValores(
          soma(totais.consumoFinal, (l) => l.totalNf),
          soma(totais.consumoFinal, (l) => l.ajustes),
        ),
      ),
    );
    for (const linha of totais.consumoFinal) {
      conteudo.push(
        createSpedRecord(
          'G615',
          textField(linha.uf),
          ...tresValores(linha.totalNf, linha.ajustes),
        ),
      );
    }
  }

  if (!semMovimento) {
    // O SEDIF exige um único G620 (saídas interestaduais, emissão própria) e,
    // sob ele, as quatro situações (0 a 3) para cada UF de origem (0000) e de
    // substituto (0002), além das UFs com valor.
    for (const linha of totais.st) {
      if (linha.indOper !== '1' || linha.indEmit !== '0') {
        throw new TypeError(
          'DeSTDA: apenas saídas interestaduais com emissão própria são suportadas no G620.',
        );
      }
    }
    const ufs = new Set<string>([
      ...ufsObrigatoriasSt,
      ...totais.st.map((l) => l.uf),
    ]);
    const porChave = new Map(totais.st.map((l) => [`${l.uf}|${l.indTpSt}`, l]));
    const linhas = [...ufs].sort().flatMap((uf) =>
      (['0', '1', '2', '3'] as const).map((indTpSt) => {
        const linha = porChave.get(`${uf}|${indTpSt}`);
        return {
          uf,
          indTpSt,
          totalNf: linha?.totalNf ?? ZERO,
          ajustes: linha?.ajustes ?? ZERO,
        };
      }),
    );
    const semCombustivel = linhas.filter((l) => l.indTpSt !== '3');
    const combustivel = linhas.filter((l) => l.indTpSt === '3');
    conteudo.push(
      createSpedRecord(
        'G620',
        '1',
        '0',
        ...tresValores(
          soma(semCombustivel, (l) => l.totalNf),
          soma(semCombustivel, (l) => l.ajustes),
        ),
        valorOuVazio(
          soma(combustivel, (l) => valorADeclarar(l.totalNf, l.ajustes)),
        ),
      ),
    );
    for (const linha of linhas) {
      conteudo.push(
        createSpedRecord(
          'G625',
          textField(linha.uf),
          linha.indTpSt,
          ...tresValores(linha.totalNf, linha.ajustes),
        ),
      );
    }
  }

  return [
    createSpedRecord('G001', '0'),
    ...conteudo,
    createSpedRecord('G990', integerField(conteudo.length + 2)),
  ];
}

function buildBloco9(antesDoBloco9: readonly SpedRecord[]): SpedRecord[] {
  const anteriores = contarRegistros(antesDoBloco9);
  const codigos = Array.from(
    new Set([...Object.keys(anteriores), '9001', '9900', '9990', '9999']),
  ).sort();
  const total9900 = codigos.length;
  const linhasBloco9 = total9900 + 3;
  const contagemFinal: Record<string, number> = {
    ...anteriores,
    '9001': 1,
    '9900': total9900,
    '9990': 1,
    '9999': 1,
  };
  return [
    createSpedRecord('9001', '0'),
    ...codigos.map((reg) =>
      createSpedRecord('9900', reg, integerField(contagemFinal[reg])),
    ),
    createSpedRecord('9990', integerField(linhasBloco9)),
    createSpedRecord('9999', integerField(antesDoBloco9.length + linhasBloco9)),
  ];
}

/** Apenas dígitos (o SEDIF não aceita máscara no telefone). */
function telefoneField(value: string | null | undefined): SpedFieldValue {
  return textField((value ?? '').replace(/\D/gu, '') || null);
}

/**
 * CRC no formato do SEDIF (10 caracteres): UF + 6 dígitos + tipo + dígito
 * verificador, sem separadores. Ex.: "BA-013372/O-1" vira "BA013372O1".
 */
export function normalizarCrc(value: string): string {
  return value.replace(/[^0-9A-Za-z]/gu, '').toUpperCase();
}

/** NF e ajustes (vazios quando zero) e valor a declarar (sempre informado). */
function tresValores(totalNf: Centavos, ajustes: Centavos): SpedFieldValue[] {
  return [
    valorOuVazio(totalNf),
    valorOuVazio(ajustes),
    moneyField(valorADeclarar(totalNf, ajustes)),
  ];
}

function moneyField(value: Centavos): SpedFieldValue {
  return decimalField(fromScaledInteger(value));
}

/** O manual exige campos de valor nulos ou maiores que zero. */
function valorOuVazio(value: Centavos): SpedFieldValue {
  return value > ZERO ? moneyField(value) : '';
}

function soma<T>(
  linhas: readonly T[],
  valor: (linha: T) => Centavos,
): Centavos {
  return linhas.reduce((total, linha) => total + valor(linha), ZERO);
}

function assertNaoNegativo(
  totalNf: Centavos,
  ajustes: Centavos,
  contexto: string,
) {
  if (totalNf < ZERO || ajustes < ZERO) {
    throw new TypeError(
      `DeSTDA: valores negativos não são aceitos no leiaute (${contexto}).`,
    );
  }
}

function ultimoDiaDoMes(competencia: string): string {
  const [ano, mes] = competencia.split('-').map(Number);
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `${competencia}-${String(ultimo).padStart(2, '0')}`;
}

function contarRegistros(
  records: readonly SpedRecord[],
): Record<string, number> {
  const contagem: Record<string, number> = {};
  for (const record of records) {
    contagem[record.reg] = (contagem[record.reg] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(contagem).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

function contarBlocos(
  records: readonly SpedRecord[],
): Record<DestdaBlockCode, number> {
  const contagem: Record<DestdaBlockCode, number> = { '0': 0, G: 0, '9': 0 };
  for (const record of records) {
    contagem[record.reg[0] as DestdaBlockCode] += 1;
  }
  return contagem;
}
