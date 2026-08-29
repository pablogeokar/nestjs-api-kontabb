import type {
  ParsedDocumentoFiscal,
  ParsedNfeIcmsTot,
} from './dfe-document.parser';
import type { ParsedNfeItem } from './nfe-item.parser';

const DECIMAL_SCALE = 10;
const DECIMAL_FACTOR = 10n ** BigInt(DECIMAL_SCALE);

export type StatusIntegridadeDocumentoFiscal =
  'CONFORME' | 'DIVERGENTE' | 'NAO_APLICAVEL';

export type StatusVerificacaoIntegridade =
  'CONFORME' | 'DIVERGENTE' | 'NAO_VERIFICADO';

export interface VerificacaoIntegridadeDocumentoFiscal {
  codigo: string;
  tipo: 'CONTAGEM' | 'SOMA_ITENS' | 'ESTRUTURA';
  campoTotal: keyof ParsedNfeIcmsTot | null;
  campoItem: keyof ParsedNfeItem | null;
  declarado: string;
  calculado: string;
  diferenca: string;
  tolerancia: string;
  status: StatusVerificacaoIntegridade;
}

export interface RelatorioIntegridadeDocumentoFiscal {
  status: StatusIntegridadeDocumentoFiscal;
  tolerancia: string;
  quantidadeItensDeclarada: number;
  quantidadeItensProcessada: number;
  valorDocumentoComparadoComSomaProdutos: false;
  verificacoes: VerificacaoIntegridadeDocumentoFiscal[];
  divergencias: VerificacaoIntegridadeDocumentoFiscal[];
}

export type DocumentoIntegridadeInput = Pick<
  ParsedDocumentoFiscal,
  'tipoDocumento' | 'quantidadeItensDeclarada' | 'itens' | 'icmsTot'
>;

interface ItemTotalMapping {
  codigo: string;
  campoTotal: keyof ParsedNfeIcmsTot;
  campoItem: keyof ParsedNfeItem;
  apenasItensQueCompoemTotal?: boolean;
}

const ITEM_TOTAL_MAPPINGS: readonly ItemTotalMapping[] = [
  {
    codigo: 'TOTAL_PRODUTOS',
    campoTotal: 'vProd',
    campoItem: 'valorBrutoProduto',
    apenasItensQueCompoemTotal: true,
  },
  { codigo: 'BASE_ICMS', campoTotal: 'vBC', campoItem: 'valorBcIcms' },
  { codigo: 'VALOR_ICMS', campoTotal: 'vICMS', campoItem: 'valorIcms' },
  {
    codigo: 'ICMS_DESONERADO',
    campoTotal: 'vICMSDeson',
    campoItem: 'valorIcmsDesonerado',
  },
  {
    codigo: 'FCP_UF_DESTINO',
    campoTotal: 'vFCPUFDest',
    campoItem: 'valorFcpUfDest',
  },
  {
    codigo: 'ICMS_UF_DESTINO',
    campoTotal: 'vICMSUFDest',
    campoItem: 'valorIcmsUfDest',
  },
  {
    codigo: 'ICMS_UF_REMETENTE',
    campoTotal: 'vICMSUFRemet',
    campoItem: 'valorIcmsUfRemetente',
  },
  { codigo: 'FCP', campoTotal: 'vFCP', campoItem: 'valorFcp' },
  { codigo: 'BASE_ICMS_ST', campoTotal: 'vBCST', campoItem: 'valorBcIcmsSt' },
  { codigo: 'ICMS_ST', campoTotal: 'vST', campoItem: 'valorIcmsSt' },
  { codigo: 'FCP_ST', campoTotal: 'vFCPST', campoItem: 'valorFcpSt' },
  {
    codigo: 'FCP_ST_RETIDO',
    campoTotal: 'vFCPSTRet',
    campoItem: 'valorFcpStRetido',
  },
  { codigo: 'FRETE', campoTotal: 'vFrete', campoItem: 'valorFrete' },
  { codigo: 'SEGURO', campoTotal: 'vSeg', campoItem: 'valorSeguro' },
  { codigo: 'DESCONTO', campoTotal: 'vDesc', campoItem: 'valorDesconto' },
  {
    codigo: 'IMPOSTO_IMPORTACAO',
    campoTotal: 'vII',
    campoItem: 'valorImpostoImportacao',
  },
  { codigo: 'IPI', campoTotal: 'vIPI', campoItem: 'valorIpi' },
  {
    codigo: 'IPI_DEVOLVIDO',
    campoTotal: 'vIPIDevol',
    campoItem: 'valorIpiDevolvido',
  },
  { codigo: 'PIS', campoTotal: 'vPIS', campoItem: 'valorPis' },
  { codigo: 'COFINS', campoTotal: 'vCOFINS', campoItem: 'valorCofins' },
  {
    codigo: 'OUTRAS_DESPESAS',
    campoTotal: 'vOutro',
    campoItem: 'valorOutrasDespesas',
  },
  {
    codigo: 'TRIBUTOS_APROXIMADOS',
    campoTotal: 'vTotTrib',
    campoItem: 'valorTributosAproximados',
  },
  {
    codigo: 'QUANTIDADE_BC_ICMS_MONOFASICO',
    campoTotal: 'qBCMono',
    campoItem: 'quantidadeBcIcmsMonofasico',
  },
  {
    codigo: 'ICMS_MONOFASICO',
    campoTotal: 'vICMSMono',
    campoItem: 'valorIcmsMonofasico',
  },
  {
    codigo: 'QUANTIDADE_BC_ICMS_MONOFASICO_RETIDO',
    campoTotal: 'qBCMonoReten',
    campoItem: 'quantidadeBcIcmsMonofasicoRetido',
  },
  {
    codigo: 'ICMS_MONOFASICO_RETIDO',
    campoTotal: 'vICMSMonoReten',
    campoItem: 'valorIcmsMonofasicoRetido',
  },
  {
    codigo: 'QUANTIDADE_BC_ICMS_MONOFASICO_RETIDO_ANTERIORMENTE',
    campoTotal: 'qBCMonoRet',
    campoItem: 'quantidadeBcIcmsMonofasicoRetidoAnteriormente',
  },
  {
    codigo: 'ICMS_MONOFASICO_RETIDO_ANTERIORMENTE',
    campoTotal: 'vICMSMonoRet',
    campoItem: 'valorIcmsMonofasicoRetidoAnteriormente',
  },
];

/**
 * Confere os totais declarados contra campos homólogos dos itens. O valor da
 * NF-e (vNF) deliberadamente não é confrontado com a soma de vProd: frete,
 * seguro, desconto, IPI, ST e demais componentes são verificados em separado.
 */
export function conferirIntegridadeDocumentoFiscal(
  documento: DocumentoIntegridadeInput,
  tolerancia: string | number = '0.02',
): RelatorioIntegridadeDocumentoFiscal {
  const toleranceUnits = parseTolerance(tolerancia);
  const formattedTolerance = formatFiscalUnits(toleranceUnits);

  if (documento.tipoDocumento === 'CTE') {
    return {
      status: 'NAO_APLICAVEL',
      tolerancia: formattedTolerance,
      quantidadeItensDeclarada: 0,
      quantidadeItensProcessada: 0,
      valorDocumentoComparadoComSomaProdutos: false,
      verificacoes: [],
      divergencias: [],
    };
  }

  const itemCountDifference = Math.abs(
    documento.quantidadeItensDeclarada - documento.itens.length,
  );
  const verificacoes: VerificacaoIntegridadeDocumentoFiscal[] = [
    {
      codigo: 'QUANTIDADE_ITENS',
      tipo: 'CONTAGEM',
      campoTotal: null,
      campoItem: null,
      declarado: String(documento.quantidadeItensDeclarada),
      calculado: String(documento.itens.length),
      diferenca: String(itemCountDifference),
      tolerancia: '0',
      status: itemCountDifference === 0 ? 'CONFORME' : 'DIVERGENTE',
    },
  ];

  if (!documento.icmsTot) {
    verificacoes.push({
      codigo: 'GRUPO_ICMSTOT',
      tipo: 'ESTRUTURA',
      campoTotal: null,
      campoItem: null,
      declarado: 'AUSENTE',
      calculado: '',
      diferenca: '',
      tolerancia: formattedTolerance,
      status: 'DIVERGENTE',
    });
  } else {
    for (const mapping of ITEM_TOTAL_MAPPINGS) {
      verificacoes.push(
        compareItemTotal(
          documento.itens,
          documento.icmsTot,
          mapping,
          toleranceUnits,
          formattedTolerance,
        ),
      );
    }
  }

  const divergencias = verificacoes.filter(
    (verification) => verification.status === 'DIVERGENTE',
  );
  return {
    status: divergencias.length > 0 ? 'DIVERGENTE' : 'CONFORME',
    tolerancia: formattedTolerance,
    quantidadeItensDeclarada: documento.quantidadeItensDeclarada,
    quantidadeItensProcessada: documento.itens.length,
    valorDocumentoComparadoComSomaProdutos: false,
    verificacoes,
    divergencias,
  };
}

/** Soma decimais fiscais sem usar IEEE-754 e retorna ao menos duas casas. */
export function somarValoresFiscais(
  values: ReadonlyArray<string | null | undefined>,
): string {
  const units = values.reduce(
    (total, value) => total + (value ? parseFiscalUnits(value) : 0n),
    0n,
  );
  return formatFiscalUnits(units);
}

function compareItemTotal(
  items: ParsedNfeItem[],
  totals: ParsedNfeIcmsTot,
  mapping: ItemTotalMapping,
  toleranceUnits: bigint,
  formattedTolerance: string,
): VerificacaoIntegridadeDocumentoFiscal {
  const declared = totals[mapping.campoTotal];
  if (typeof declared !== 'string' || !declared) {
    return {
      codigo: mapping.codigo,
      tipo: 'SOMA_ITENS',
      campoTotal: mapping.campoTotal,
      campoItem: mapping.campoItem,
      declarado: '',
      calculado: '',
      diferenca: '',
      tolerancia: formattedTolerance,
      status: 'NAO_VERIFICADO',
    };
  }

  const values = items
    .filter(
      (item) => !mapping.apenasItensQueCompoemTotal || item.indTotal === '1',
    )
    .map((item) => item[mapping.campoItem])
    .filter((value): value is string => typeof value === 'string' && !!value);
  let declaredUnits: bigint;
  let calculatedUnits: bigint;
  try {
    declaredUnits = parseFiscalUnits(declared);
    calculatedUnits = values.reduce(
      (total, value) => total + parseFiscalUnits(value),
      0n,
    );
  } catch {
    return {
      codigo: mapping.codigo,
      tipo: 'SOMA_ITENS',
      campoTotal: mapping.campoTotal,
      campoItem: mapping.campoItem,
      declarado: declared,
      calculado: '',
      diferenca: '',
      tolerancia: formattedTolerance,
      status: 'DIVERGENTE',
    };
  }

  const difference = absolute(declaredUnits - calculatedUnits);
  return {
    codigo: mapping.codigo,
    tipo: 'SOMA_ITENS',
    campoTotal: mapping.campoTotal,
    campoItem: mapping.campoItem,
    declarado: formatFiscalUnits(declaredUnits),
    calculado: formatFiscalUnits(calculatedUnits),
    diferenca: formatFiscalUnits(difference),
    tolerancia: formattedTolerance,
    status: difference <= toleranceUnits ? 'CONFORME' : 'DIVERGENTE',
  };
}

function parseTolerance(value: string | number): bigint {
  const normalized =
    typeof value === 'number'
      ? Number.isFinite(value) && value >= 0
        ? value.toFixed(DECIMAL_SCALE).replace(/0+$/, '').replace(/\.$/, '')
        : ''
      : value.trim();
  try {
    return parseFiscalUnits(normalized || '0');
  } catch {
    throw new RangeError(
      'A tolerância deve ser um decimal fiscal não negativo.',
    );
  }
}

function parseFiscalUnits(value: string): bigint {
  const match = value.trim().match(/^(\d+)(?:\.(\d{1,10}))?$/);
  if (!match) throw new Error('Decimal fiscal inválido.');
  const fraction = (match[2] ?? '').padEnd(DECIMAL_SCALE, '0');
  return BigInt(match[1]) * DECIMAL_FACTOR + BigInt(fraction || '0');
}

function formatFiscalUnits(units: bigint): string {
  const negative = units < 0n;
  const absoluteUnits = absolute(units);
  const integer = absoluteUnits / DECIMAL_FACTOR;
  const fraction = (absoluteUnits % DECIMAL_FACTOR)
    .toString()
    .padStart(DECIMAL_SCALE, '0');
  const trimmedFraction = fraction.replace(/0+$/, '').padEnd(2, '0');
  return `${negative ? '-' : ''}${integer}.${trimmedFraction}`;
}

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value;
}
