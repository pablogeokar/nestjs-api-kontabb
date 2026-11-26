import {
  DESTDA_BLOCK_ORDER,
  DESTDA_COD_CTD,
  DESTDA_COD_VER,
  DESTDA_EXPECTED_FIELD_COUNTS,
  DESTDA_LEIAUTE_TEXTO,
  DESTDA_PAIS,
  DESTDA_UFS,
  type DestdaBlockCode,
} from './destda-leiaute';

export type DestdaValidationIssueCode =
  | 'EMPTY_FILE'
  | 'MISSING_FINAL_CRLF'
  | 'INVALID_LINE_BREAK'
  | 'EMPTY_LINE'
  | 'INVALID_LATIN1_CHARACTER'
  | 'INVALID_CONTROL_CHARACTER'
  | 'INVALID_DELIMITERS'
  | 'INVALID_RECORD_CODE'
  | 'UNKNOWN_RECORD'
  | 'INVALID_FIELD_COUNT'
  | 'INVALID_BLOCK_ORDER'
  | 'MISSING_FILE_OPENING'
  | 'MISSING_FILE_CLOSING'
  | 'INVALID_HEADER'
  | 'MISSING_BLOCK_SHELL'
  | 'INVALID_BLOCK_SHELL_POSITION'
  | 'INVALID_MOVEMENT_INDICATOR'
  | 'INVALID_BLOCK_LINE_COUNT'
  | 'INVALID_9900'
  | 'INVALID_9990_COUNT'
  | 'INVALID_9999_COUNT'
  | 'INVALID_DATE'
  | 'INVALID_NUMBER'
  | 'INVALID_DOMAIN'
  | 'INVALID_HIERARCHY'
  | 'INVALID_TOTAL';

export interface DestdaValidationIssue {
  readonly code: DestdaValidationIssueCode;
  readonly message: string;
  readonly line?: number;
  readonly reg?: string;
}

export interface DestdaValidationResult {
  readonly valid: boolean;
  readonly issues: readonly DestdaValidationIssue[];
  readonly totalLines: number;
  readonly recordCounts: Readonly<Record<string, number>>;
}

interface ParsedLine {
  readonly line: number;
  readonly reg: string;
  readonly fields: readonly string[];
  readonly block: DestdaBlockCode | null;
}

const RECORD_CODE = /^[0-9A-Z]{4}$/u;
const MONEY = /^\d+,\d{2}$/u;
const SHELLS: Readonly<
  Record<DestdaBlockCode, { opening: string; closing: string }>
> = {
  '0': { opening: '0001', closing: '0990' },
  G: { opening: 'G001', closing: 'G990' },
  '9': { opening: '9001', closing: '9990' },
};

/**
 * Validação estrutural e aritmética do arquivo da DeSTDA gerado. Cobre as
 * regras mecânicas do Ato COTEPE/ICMS 47/2015 (delimitadores, CRLF, Latin-1,
 * quantidade de campos, hierarquia, contadores do bloco 9 e coerência dos
 * totalizadores). Não substitui o SEDIF/validador oficial, que verifica ainda
 * regras cadastrais de cada UF.
 */
export function validateDestdaFile(
  source: string | Buffer,
): DestdaValidationResult {
  const text = Buffer.isBuffer(source) ? source.toString('latin1') : source;
  const issues: DestdaValidationIssue[] = [];
  if (!text) {
    issues.push({ code: 'EMPTY_FILE', message: 'O arquivo está vazio.' });
    return result(issues, []);
  }
  if (!text.endsWith('\r\n')) {
    issues.push({
      code: 'MISSING_FINAL_CRLF',
      message: 'O arquivo deve terminar com CRLF.',
    });
  }
  if (/[\r\n]/u.test(text.replace(/\r\n/gu, ''))) {
    issues.push({
      code: 'INVALID_LINE_BREAK',
      message: 'O arquivo contém quebra de linha diferente de CRLF.',
    });
  }
  const payload = text.endsWith('\r\n') ? text.slice(0, -2) : text;
  const parsed: ParsedLine[] = [];
  payload.split(/\r\n|\r|\n/u).forEach((raw, index) => {
    const line = index + 1;
    if (!raw) {
      issues.push({ code: 'EMPTY_LINE', message: 'Linha vazia.', line });
      return;
    }
    inspectCharacters(raw, line, issues);
    if (!raw.startsWith('|') || !raw.endsWith('|')) {
      issues.push({
        code: 'INVALID_DELIMITERS',
        message: 'A linha deve iniciar e terminar com pipe.',
        line,
      });
      return;
    }
    const [reg = '', ...fields] = raw.slice(1, -1).split('|');
    if (!RECORD_CODE.test(reg)) {
      issues.push({
        code: 'INVALID_RECORD_CODE',
        message: `Código de registro inválido: ${reg || '(vazio)'}.`,
        line,
      });
      return;
    }
    const prefix = reg[0] as DestdaBlockCode;
    const block = (DESTDA_BLOCK_ORDER as readonly string[]).includes(prefix)
      ? prefix
      : null;
    if (!(reg in DESTDA_EXPECTED_FIELD_COUNTS)) {
      issues.push({
        code: 'UNKNOWN_RECORD',
        message: `O registro ${reg} não existe no leiaute da DeSTDA.`,
        line,
        reg,
      });
    }
    parsed.push({ line, reg, fields, block });
  });

  validateFieldCounts(parsed, issues);
  validateBounds(parsed, issues);
  validateBlockOrder(parsed, issues);
  validateShells(parsed, issues);
  validateBlock9(parsed, issues);
  validateValues(parsed, issues);
  validateTotals(parsed, issues);
  return result(issues, parsed);
}

function validateFieldCounts(
  lines: readonly ParsedLine[],
  issues: DestdaValidationIssue[],
) {
  for (const line of lines) {
    const expected = DESTDA_EXPECTED_FIELD_COUNTS[line.reg];
    if (expected !== undefined && line.fields.length !== expected - 1) {
      issues.push({
        code: 'INVALID_FIELD_COUNT',
        message: `${line.reg} deve possuir ${expected - 1} campos após REG, mas possui ${line.fields.length}.`,
        line: line.line,
        reg: line.reg,
      });
    }
  }
}

function validateBounds(
  lines: readonly ParsedLine[],
  issues: DestdaValidationIssue[],
) {
  const opening = lines.filter((line) => line.reg === '0000');
  if (opening.length !== 1 || lines[0]?.reg !== '0000') {
    issues.push({
      code: 'MISSING_FILE_OPENING',
      message: 'O arquivo deve possuir um único 0000 na primeira linha.',
      line: lines[0]?.line,
    });
  }
  const closing = lines.filter((line) => line.reg === '9999');
  if (closing.length !== 1 || lines.at(-1)?.reg !== '9999') {
    issues.push({
      code: 'MISSING_FILE_CLOSING',
      message: 'O arquivo deve possuir um único 9999 na última linha.',
      line: lines.at(-1)?.line,
    });
  }
}

function validateBlockOrder(
  lines: readonly ParsedLine[],
  issues: DestdaValidationIssue[],
) {
  let previous = -1;
  for (const line of lines) {
    if (!line.block) continue;
    const current = DESTDA_BLOCK_ORDER.indexOf(line.block);
    if (current < previous) {
      issues.push({
        code: 'INVALID_BLOCK_ORDER',
        message: `O bloco ${line.block} está fora da ordem oficial (0, G, 9).`,
        line: line.line,
        reg: line.reg,
      });
      return;
    }
    previous = current;
  }
}

function validateShells(
  lines: readonly ParsedLine[],
  issues: DestdaValidationIssue[],
) {
  for (const block of ['0', 'G'] as const) {
    const shell = SHELLS[block];
    const blockLines = lines.filter((line) => line.block === block);
    const openings = blockLines.filter((line) => line.reg === shell.opening);
    const closings = blockLines.filter((line) => line.reg === shell.closing);
    if (openings.length !== 1 || closings.length !== 1) {
      issues.push({
        code: 'MISSING_BLOCK_SHELL',
        message: `O bloco ${block} deve possuir exatamente um ${shell.opening} e um ${shell.closing}.`,
      });
      continue;
    }
    const openingIndex = block === '0' ? 1 : 0;
    if (
      blockLines[openingIndex]?.reg !== shell.opening ||
      blockLines.at(-1)?.reg !== shell.closing ||
      (block === '0' && blockLines[0]?.reg !== '0000')
    ) {
      issues.push({
        code: 'INVALID_BLOCK_SHELL_POSITION',
        message: `Abertura ou encerramento do bloco ${block} fora de posição.`,
        line: openings[0].line,
      });
    }
    // Bloco 0 sempre possui 0005/0030/0100; bloco G possui ao menos o G020.
    const minimo = block === '0' ? 3 : 2;
    const conteudo = Math.max(0, blockLines.length - minimo);
    const esperado = conteudo > 0 ? '0' : '1';
    if (openings[0].fields[0] !== esperado) {
      issues.push({
        code: 'INVALID_MOVEMENT_INDICATOR',
        message: `${shell.opening} deve informar IND_DAD ${esperado}.`,
        line: openings[0].line,
        reg: shell.opening,
      });
    }
    const declarado = toCount(closings[0].fields[0]);
    if (declarado !== blockLines.length) {
      issues.push({
        code: 'INVALID_BLOCK_LINE_COUNT',
        message: `${shell.closing} declara ${String(closings[0].fields[0])} linhas, mas o bloco possui ${blockLines.length}.`,
        line: closings[0].line,
        reg: shell.closing,
      });
    }
  }
}

function validateBlock9(
  lines: readonly ParsedLine[],
  issues: DestdaValidationIssue[],
) {
  const block9 = lines.filter((line) => line.block === '9');
  const abertura = block9[0];
  if (
    !abertura ||
    abertura.reg !== '9001' ||
    block9.at(-1)?.reg !== '9999' ||
    block9.at(-2)?.reg !== '9990'
  ) {
    issues.push({
      code: 'MISSING_BLOCK_SHELL',
      message: 'O bloco 9 deve iniciar com 9001 e terminar com 9990 e 9999.',
    });
    return;
  }
  const entries = block9.filter((line) => line.reg === '9900');
  const expected = contarRegistros(lines);
  const seen = new Set<string>();
  let previous = '';
  for (const entry of entries) {
    const [reg = '', quantidade = ''] = entry.fields;
    if (reg < previous) {
      issues.push({
        code: 'INVALID_9900',
        message: 'Os registros 9900 devem estar em ordem crescente.',
        line: entry.line,
        reg: '9900',
      });
    }
    previous = reg;
    if (seen.has(reg)) {
      issues.push({
        code: 'INVALID_9900',
        message: `O registro ${reg} possui mais de um 9900.`,
        line: entry.line,
        reg: '9900',
      });
    }
    seen.add(reg);
    if (toCount(quantidade) !== (expected[reg] ?? 0)) {
      issues.push({
        code: 'INVALID_9900',
        message: `9900 de ${reg} declara ${quantidade || '(vazio)'}, mas o arquivo possui ${expected[reg] ?? 0}.`,
        line: entry.line,
        reg: '9900',
      });
    }
  }
  for (const reg of Object.keys(expected)) {
    if (!seen.has(reg)) {
      issues.push({
        code: 'INVALID_9900',
        message: `Falta o 9900 do registro ${reg}.`,
        reg: '9900',
      });
    }
  }
  const line9990 = block9.at(-2)!;
  if (toCount(line9990.fields[0]) !== block9.length) {
    issues.push({
      code: 'INVALID_9990_COUNT',
      message: `9990 declara ${line9990.fields[0]} linhas, mas o bloco 9 possui ${block9.length}.`,
      line: line9990.line,
      reg: '9990',
    });
  }
  const line9999 = block9.at(-1)!;
  if (toCount(line9999.fields[0]) !== lines.length) {
    issues.push({
      code: 'INVALID_9999_COUNT',
      message: `9999 declara ${line9999.fields[0]} linhas, mas o arquivo possui ${lines.length}.`,
      line: line9999.line,
      reg: '9999',
    });
  }
}

function validateValues(
  lines: readonly ParsedLine[],
  issues: DestdaValidationIssue[],
) {
  const fail = (
    code: DestdaValidationIssueCode,
    message: string,
    line: ParsedLine,
  ) => issues.push({ code, message, line: line.line, reg: line.reg });
  const checkDomain = (
    line: ParsedLine,
    index: number,
    domain: readonly string[],
    nome: string,
  ) => {
    if (!domain.includes(line.fields[index] ?? '')) {
      fail(
        'INVALID_DOMAIN',
        `${line.reg}.${nome} possui valor fora do domínio: ${line.fields[index] || '(vazio)'}.`,
        line,
      );
    }
  };
  const checkUf = (line: ParsedLine, index: number, nome: string) =>
    checkDomain(line, index, DESTDA_UFS, nome);
  const checkMoney = (
    line: ParsedLine,
    index: number,
    nome: string,
    obrigatorio: boolean,
  ) => {
    const value = line.fields[index] ?? '';
    if (!value) {
      if (obrigatorio) {
        fail('INVALID_NUMBER', `${line.reg}.${nome} é obrigatório.`, line);
      }
      return;
    }
    if (!MONEY.test(value) || (!obrigatorio && toCents(value) === 0n)) {
      fail(
        'INVALID_NUMBER',
        `${line.reg}.${nome} deve ser um valor com duas casas decimais${obrigatorio ? '' : ' maior que zero (ou vazio)'}.`,
        line,
      );
    }
  };
  const checkTelefone = (line: ParsedLine, index: number, nome: string) => {
    const value = line.fields[index] ?? '';
    if (value && !/^\d{1,12}$/u.test(value)) {
      fail(
        'INVALID_NUMBER',
        `${line.reg}.${nome} deve conter apenas dígitos (até 12).`,
        line,
      );
    }
  };
  const checkDate = (line: ParsedLine, index: number, nome: string) => {
    if (!isDate(line.fields[index] ?? '')) {
      fail(
        'INVALID_DATE',
        `${line.reg}.${nome} deve ser uma data válida ddmmaaaa.`,
        line,
      );
    }
  };

  const abertura = lines.find((line) => line.reg === '0000');
  if (abertura && abertura.fields.length === 19) {
    const f = abertura.fields;
    if (
      f[0] !== DESTDA_LEIAUTE_TEXTO ||
      f[11] !== DESTDA_COD_VER ||
      f[13] !== DESTDA_COD_CTD ||
      f[14] !== DESTDA_PAIS
    ) {
      fail(
        'INVALID_HEADER',
        `0000 deve informar ${DESTDA_LEIAUTE_TEXTO}, COD_VER ${DESTDA_COD_VER}, COD_CTD ${DESTDA_COD_CTD} e PAIS ${DESTDA_PAIS}.`,
        abertura,
      );
    }
    checkDate(abertura, 1, 'DT_INI');
    checkDate(abertura, 2, 'DT_FIN');
    if (!/^[0-9A-Z]{12}\d{2}$/u.test(f[4])) {
      fail('INVALID_NUMBER', '0000.CNPJ inválido.', abertura);
    }
    checkUf(abertura, 5, 'UF');
    if (!/^\d{7}$/u.test(f[7])) {
      fail('INVALID_NUMBER', '0000.COD_MUN deve ter 7 dígitos.', abertura);
    }
    checkDomain(abertura, 12, ['0', '1'], 'COD_FIN');
    if (f[17] !== '' || f[9] !== '' || f[18] !== '') {
      fail(
        'INVALID_HEADER',
        '0000.CPF e os campos VAZIO devem permanecer vazios para pessoa jurídica.',
        abertura,
      );
    }
  }
  for (const line of lines) {
    switch (line.reg) {
      case '0002':
        if (line.fields.length === 2) {
          checkUf(line, 0, 'UF');
          if (!line.fields[1]) {
            fail('INVALID_NUMBER', '0002.IE_ST é obrigatório.', line);
          }
        }
        break;
      case 'G020':
        if (line.fields.length === 3) {
          checkDomain(line, 0, ['2', '9'], 'IND_GEF');
          checkDate(line, 1, 'DT_INI');
          checkDate(line, 2, 'DT_FIN');
        }
        break;
      case 'G600':
      case 'G610':
        if (line.fields.length === 3) {
          checkMoney(line, 0, 'VL_TOT_NF', false);
          checkMoney(line, 1, 'VL_TOT_AJ', false);
          checkMoney(line, 2, 'VL_TOT_DA', true);
        }
        break;
      case 'G605':
        if (line.fields.length === 4) {
          checkDomain(line, 0, ['0', '1', '2', '3'], 'IND_SIT');
          if (line.fields[0] === '3' && line.fields[1]) {
            fail(
              'INVALID_NUMBER',
              'G605.VL_TOT_ANTC_NF não deve ser preenchido quando IND_SIT é 3.',
              line,
            );
          }
          checkMoney(line, 1, 'VL_TOT_ANTC_NF', false);
          checkMoney(line, 2, 'VL_TOT_AJ_ANTC', false);
          checkMoney(line, 3, 'VL_TOT_DA_ANTC', true);
        }
        break;
      case 'G615':
        if (line.fields.length === 4) {
          checkUf(line, 0, 'UF');
          checkMoney(line, 1, 'VL_TOT_ST_UF_NF', true);
          checkMoney(line, 2, 'VL_TOT_AJ_ST_UF', false);
          checkMoney(line, 3, 'VL_TOT_ST_UF_DEC', true);
        }
        break;
      case 'G620':
        if (line.fields.length === 6) {
          checkDomain(line, 0, ['0', '1'], 'IND_OPER');
          checkDomain(line, 1, ['0', '1'], 'IND_EMIT');
          checkMoney(line, 2, 'VL_TOT_ST_NF', false);
          checkMoney(line, 3, 'VL_TOT_AJ_ST', false);
          checkMoney(line, 4, 'VL_TOT_ST_DEC', true);
          checkMoney(line, 5, 'VL_TOT_ST_COMB', false);
        }
        break;
      case 'G625':
        if (line.fields.length === 5) {
          checkUf(line, 0, 'UF');
          checkDomain(line, 1, ['0', '1', '2', '3'], 'IND_TP_ST');
          checkMoney(line, 2, 'VL_TOT_ST_NF', false);
          checkMoney(line, 3, 'VL_TOT_AJ_ST', false);
          checkMoney(line, 4, 'VL_TOT_DEC_ST', true);
        }
        break;
      case '0005':
        if (line.fields.length === 13) {
          checkTelefone(line, 10, 'FONE');
          checkTelefone(line, 11, 'FAX');
        }
        break;
      case '0030':
        if (line.fields.length === 17) {
          // Campos que o SEDIF (v1.0.9.0) exige nulos.
          const nulos: Array<[number, string]> = [
            [4, 'PRF_RIDF'],
            [5, 'PRF_RUDF'],
            [6, 'PRF_LMC'],
            [7, 'PRF_RV'],
            [8, 'PRF_RI'],
            [9, 'IND_EC'],
            [10, 'IND_ISS'],
            [11, 'IND_RT'],
            [12, 'IND_ICMS'],
            [14, 'IND_AT'],
            [15, 'IND_IPI'],
            [16, 'IND_RI'],
          ];
          for (const [index, nome] of nulos) {
            if (line.fields[index]) {
              fail(
                'INVALID_DOMAIN',
                `0030.${nome} deve ser nulo para esta versão do SEDIF.`,
                line,
              );
            }
          }
        }
        break;
      case '0100':
        if (line.fields.length === 17) {
          if (!/^[A-Z]{2}\d{6}[A-Z]\d$/u.test(line.fields[4])) {
            fail(
              'INVALID_NUMBER',
              '0100.CRC deve ter 10 caracteres: UF + 6 dígitos + tipo + dígito (ex.: BA013372O1).',
              line,
            );
          }
          checkTelefone(line, 14, 'FONE');
          checkTelefone(line, 15, 'FAX');
        }
        break;
      default:
        break;
    }
  }
}

function validateTotals(
  lines: readonly ParsedLine[],
  issues: DestdaValidationIssue[],
) {
  const blocoG = lines.filter((line) => line.block === 'G');
  const wrong = (message: string, line: ParsedLine) =>
    issues.push({
      code: 'INVALID_TOTAL',
      message,
      line: line.line,
      reg: line.reg,
    });
  const hierarchy = (message: string, line: ParsedLine) =>
    issues.push({
      code: 'INVALID_HIERARCHY',
      message,
      line: line.line,
      reg: line.reg,
    });

  // Cada G6xx pai precisa vir antes de seus filhos.
  const grupo: { pai: ParsedLine | null; filhos: ParsedLine[] } = {
    pai: null,
    filhos: [],
  };
  const fecharGrupo = () => {
    if (grupo.pai) conferirGrupo(grupo.pai, grupo.filhos, wrong);
    grupo.pai = null;
    grupo.filhos = [];
  };
  const paiDoFilho: Record<string, string> = {
    G605: 'G600',
    G615: 'G610',
    G625: 'G620',
  };
  for (const line of blocoG) {
    if (line.reg === 'G600' || line.reg === 'G610' || line.reg === 'G620') {
      fecharGrupo();
      grupo.pai = line;
    } else if (line.reg in paiDoFilho) {
      if (grupo.pai?.reg !== paiDoFilho[line.reg]) {
        hierarchy(
          `${line.reg} deve estar sob um ${paiDoFilho[line.reg]}.`,
          line,
        );
      } else {
        grupo.filhos.push(line);
      }
    } else if (line.reg === 'G990') {
      fecharGrupo();
    }
  }
  fecharGrupo();

  const g020 = blocoG.find((line) => line.reg === 'G020');
  const temValores = blocoG.some((line) =>
    ['G600', 'G610', 'G620'].includes(line.reg),
  );
  const g620 = blocoG.filter((line) => line.reg === 'G620');
  if (temValores) {
    if (g620.length !== 1) {
      wrong('É necessário declarar um único registro G620.', blocoG[0]);
    } else {
      const abertura = lines.find((line) => line.reg === '0000');
      const ufs = new Set<string>(
        [
          abertura?.fields[5],
          ...lines
            .filter((line) => line.reg === '0002')
            .map((line) => line.fields[0]),
        ].filter((uf): uf is string => Boolean(uf)),
      );
      const declarados = new Set(
        blocoG
          .filter((line) => line.reg === 'G625')
          .map((line) => `${line.fields[0]}|${line.fields[1]}`),
      );
      for (const uf of ufs) {
        const faltam = ['0', '1', '2', '3'].filter(
          (tipo) => !declarados.has(`${uf}|${tipo}`),
        );
        if (faltam.length > 0) {
          wrong(
            `A UF ${uf} deve ser declarada no G625 para os quatro IND_TP_ST (faltam: ${faltam.join(', ')}).`,
            g620[0],
          );
        }
      }
    }
  }
  if (g020 && g020.fields.length === 3) {
    const esperado = temValores ? '2' : '9';
    if (g020.fields[0] !== esperado) {
      wrong(
        `G020.IND_GEF deve ser ${esperado} para o conteúdo informado.`,
        g020,
      );
    }
    const abertura = lines.find((line) => line.reg === '0000');
    if (
      abertura &&
      abertura.fields.length === 19 &&
      (abertura.fields[1] !== g020.fields[1] ||
        abertura.fields[2] !== g020.fields[2])
    ) {
      wrong('O período do G020 deve ser o mesmo do 0000.', g020);
    }
  }
}

function conferirGrupo(
  pai: ParsedLine,
  filhos: readonly ParsedLine[],
  wrong: (message: string, line: ParsedLine) => void,
) {
  if (filhos.length === 0) {
    wrong(`${pai.reg} deve possuir ao menos um registro filho.`, pai);
    return;
  }
  const valorDe = (line: ParsedLine, index: number) =>
    toCents(line.fields[index] ?? '');
  const soma = (index: number, only?: (line: ParsedLine) => boolean) =>
    filhos
      .filter((line) => !only || only(line))
      .reduce((total, line) => total + valorDe(line, index), 0n);
  const confere = (indexPai: number, esperado: bigint, nome: string) => {
    if (pai.fields.length > indexPai && valorDe(pai, indexPai) !== esperado) {
      wrong(`${pai.reg}.${nome} não confere com a soma dos filhos.`, pai);
    }
  };
  if (pai.reg === 'G620') {
    const semComb = (line: ParsedLine) => line.fields[1] !== '3';
    confere(2, soma(2, semComb), 'VL_TOT_ST_NF');
    confere(3, soma(3, semComb), 'VL_TOT_AJ_ST');
    confere(4, soma(4, semComb), 'VL_TOT_ST_DEC');
    confere(
      5,
      soma(4, (line) => line.fields[1] === '3'),
      'VL_TOT_ST_COMB',
    );
  } else {
    confere(0, soma(1), 'VL_TOT_NF');
    confere(1, soma(2), 'VL_TOT_AJ');
    confere(2, soma(3), 'VL_TOT_DA');
  }
  if (pai.reg === 'G600') {
    const situacoes = filhos.map((filho) => filho.fields[0]).sort();
    if (situacoes.join('') !== '0123') {
      wrong(
        'G600 deve possuir quatro G605, um para cada IND_SIT (0, 1, 2 e 3).',
        pai,
      );
    }
  }
  for (const filho of filhos) {
    if (filho.reg === 'G605' && filho.fields[0] === '3') {
      // NF vazia nesta situação: o valor a declarar é informado direto.
      continue;
    }
    const [nf, aj, da] =
      filho.reg === 'G625'
        ? [valorDe(filho, 2), valorDe(filho, 3), valorDe(filho, 4)]
        : [valorDe(filho, 1), valorDe(filho, 2), valorDe(filho, 3)];
    const esperado = nf - aj > 0n ? nf - aj : 0n;
    if (da !== esperado) {
      wrong(
        `${filho.reg}: valor a declarar difere de NF menos ajustes.`,
        filho,
      );
    }
  }
}

function inspectCharacters(
  raw: string,
  line: number,
  issues: DestdaValidationIssue[],
) {
  let latin = false;
  let control = false;
  for (const character of raw) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint > 0xff) latin = true;
    if (codePoint < 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f)) {
      control = true;
    }
  }
  if (latin) {
    issues.push({
      code: 'INVALID_LATIN1_CHARACTER',
      message: 'A linha contém caractere fora de ISO-8859-1.',
      line,
    });
  }
  if (control) {
    issues.push({
      code: 'INVALID_CONTROL_CHARACTER',
      message: 'A linha contém caractere de controle.',
      line,
    });
  }
}

function contarRegistros(lines: readonly ParsedLine[]): Record<string, number> {
  const contagem: Record<string, number> = {};
  for (const line of lines) contagem[line.reg] = (contagem[line.reg] ?? 0) + 1;
  return contagem;
}

function toCount(value: string | undefined): number | null {
  return value && /^\d+$/u.test(value) ? Number(value) : null;
}

function toCents(value: string): bigint {
  const match = /^(\d+),(\d{2})$/u.exec(value);
  return match ? BigInt(match[1]) * 100n + BigInt(match[2]) : 0n;
}

function isDate(value: string): boolean {
  const match = /^(\d{2})(\d{2})(\d{4})$/u.exec(value);
  if (!match) return false;
  const [day, month, year] = [match[1], match[2], match[3]].map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function result(
  issues: DestdaValidationIssue[],
  lines: readonly ParsedLine[],
): DestdaValidationResult {
  return {
    valid: issues.length === 0,
    issues,
    totalLines: lines.length,
    recordCounts: contarRegistros(lines),
  };
}
