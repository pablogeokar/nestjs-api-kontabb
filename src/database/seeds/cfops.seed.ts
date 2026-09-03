import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { cfopEquivalencias, cfops } from '../schema';

type CfopSeed = typeof cfops.$inferInsert;
type EquivalenciaSeed = typeof cfopEquivalencias.$inferInsert;

type CategoriaFiscal =
  | 'COMPRA_REVENDA'
  | 'COMPRA_INSUMO'
  | 'USO_CONSUMO'
  | 'ATIVO_IMOBILIZADO'
  | 'DEVOLUCAO'
  | 'TRANSFERENCIA'
  | 'REMESSA_RETORNO'
  | 'PRESTACAO_SERVICO'
  | 'OUTRAS';

// ─────────────────────────────────────────────────────────────────────────────
// Definição enxuta do catálogo — a abrangência/tipo é derivada do 1º dígito e a
// categoria/crédito é declarada explicitamente por CFOP para evitar erros de
// classificação (uso/consumo e ST não geram crédito de ICMS na entrada).
// ─────────────────────────────────────────────────────────────────────────────

interface CfopDef {
  codigo: string;
  descricao: string;
  grupo: string;
  categoria: CategoriaFiscal;
  // Sobrescreve a inferência de crédito quando informado.
  credito?: boolean;
}

function tipoOperacaoFromCodigo(codigo: string): 'ENTRADA' | 'SAIDA' {
  return ['1', '2', '3'].includes(codigo[0]) ? 'ENTRADA' : 'SAIDA';
}

function abrangenciaFromCodigo(
  codigo: string,
): 'ESTADUAL' | 'INTERESTADUAL' | 'EXTERIOR' {
  if (['1', '5'].includes(codigo[0])) return 'ESTADUAL';
  if (['2', '6'].includes(codigo[0])) return 'INTERESTADUAL';
  return 'EXTERIOR';
}

// Regra padrão de crédito de ICMS por categoria (apenas para ENTRADAS).
// Uso/consumo (LC 87/96 art. 33, I) e ativo (crédito via CIAP, não integral)
// NÃO geram crédito integral na entrada.
function inferCreditoIcms(codigo: string, categoria: CategoriaFiscal): boolean {
  if (tipoOperacaoFromCodigo(codigo) !== 'ENTRADA') return false;
  switch (categoria) {
    case 'COMPRA_REVENDA':
    case 'COMPRA_INSUMO':
      return true;
    default:
      // USO_CONSUMO, ATIVO_IMOBILIZADO, DEVOLUCAO, TRANSFERENCIA,
      // REMESSA_RETORNO, PRESTACAO_SERVICO, OUTRAS => sem crédito automático.
      return false;
  }
}

function toCfopSeed(def: CfopDef): CfopSeed {
  return {
    codigo: def.codigo,
    descricao: def.descricao,
    tipoOperacao: tipoOperacaoFromCodigo(def.codigo),
    abrangencia: abrangenciaFromCodigo(def.codigo),
    grupo: def.grupo,
    categoriaFiscal: def.categoria,
    geraCreditoIcmsPadrao:
      def.credito ?? inferCreditoIcms(def.codigo, def.categoria),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Catálogo de ENTRADAS (grupos 1xxx estadual / 2xxx interestadual / 3xxx exterior)
// ─────────────────────────────────────────────────────────────────────────────

const ENTRADAS: CfopDef[] = [
  // Compras para industrialização/produção (insumo)
  {
    codigo: '1101',
    descricao: 'Compra para industrialização ou produção rural',
    grupo: 'Compras',
    categoria: 'COMPRA_INSUMO',
  },
  {
    codigo: '1111',
    descricao:
      'Compra para industrialização de mercadoria recebida anteriormente em consignação industrial',
    grupo: 'Compras',
    categoria: 'COMPRA_INSUMO',
  },
  {
    codigo: '1116',
    descricao:
      'Compra para industrialização ou produção rural originada de encomenda para recebimento futuro',
    grupo: 'Compras',
    categoria: 'COMPRA_INSUMO',
  },
  {
    codigo: '1120',
    descricao:
      'Compra para industrialização, em venda à ordem, já recebida do vendedor remetente',
    grupo: 'Compras',
    categoria: 'COMPRA_INSUMO',
  },
  {
    codigo: '1122',
    descricao:
      'Compra para industrialização em que a mercadoria foi remetida pelo fornecedor ao industrializador',
    grupo: 'Compras',
    categoria: 'COMPRA_INSUMO',
  },
  {
    codigo: '1124',
    descricao: 'Industrialização efetuada por outra empresa',
    grupo: 'Compras',
    categoria: 'COMPRA_INSUMO',
  },
  {
    codigo: '1125',
    descricao:
      'Industrialização efetuada por outra empresa quando a mercadoria não transitou pelo encomendante',
    grupo: 'Compras',
    categoria: 'COMPRA_INSUMO',
  },
  {
    codigo: '1126',
    descricao: 'Compra para utilização na prestação de serviço sujeita ao ICMS',
    grupo: 'Compras',
    categoria: 'COMPRA_INSUMO',
  },

  // Compras para comercialização (revenda)
  {
    codigo: '1102',
    descricao: 'Compra para comercialização',
    grupo: 'Compras',
    categoria: 'COMPRA_REVENDA',
  },
  {
    codigo: '1113',
    descricao:
      'Compra para comercialização de mercadoria recebida anteriormente em consignação mercantil',
    grupo: 'Compras',
    categoria: 'COMPRA_REVENDA',
  },
  {
    codigo: '1117',
    descricao:
      'Compra para comercialização originada de encomenda para recebimento futuro',
    grupo: 'Compras',
    categoria: 'COMPRA_REVENDA',
  },
  {
    codigo: '1118',
    descricao:
      'Compra de mercadoria para comercialização pelo adquirente originário, entregue pelo vendedor remetente ao destinatário',
    grupo: 'Compras',
    categoria: 'COMPRA_REVENDA',
  },
  {
    codigo: '1121',
    descricao:
      'Compra para comercialização, em venda à ordem, já recebida do vendedor remetente',
    grupo: 'Compras',
    categoria: 'COMPRA_REVENDA',
  },

  // Transferências (entrada)
  {
    codigo: '1151',
    descricao: 'Transferência para industrialização ou produção rural',
    grupo: 'Transferências',
    categoria: 'TRANSFERENCIA',
  },
  {
    codigo: '1152',
    descricao: 'Transferência para comercialização',
    grupo: 'Transferências',
    categoria: 'TRANSFERENCIA',
  },
  {
    codigo: '1153',
    descricao: 'Transferência de energia elétrica para distribuição',
    grupo: 'Transferências',
    categoria: 'TRANSFERENCIA',
  },
  {
    codigo: '1154',
    descricao: 'Transferência para utilização na prestação de serviço',
    grupo: 'Transferências',
    categoria: 'TRANSFERENCIA',
  },

  // Devoluções (entrada = devolução de venda recebida)
  {
    codigo: '1201',
    descricao: 'Devolução de venda de produção do estabelecimento',
    grupo: 'Devoluções',
    categoria: 'DEVOLUCAO',
  },
  {
    codigo: '1202',
    descricao:
      'Devolução de venda de mercadoria adquirida ou recebida de terceiros',
    grupo: 'Devoluções',
    categoria: 'DEVOLUCAO',
  },
  {
    codigo: '1203',
    descricao:
      'Devolução de venda de produção do estabelecimento, destinada à ZFM ou ALC',
    grupo: 'Devoluções',
    categoria: 'DEVOLUCAO',
  },
  {
    codigo: '1204',
    descricao:
      'Devolução de venda de mercadoria de terceiros, destinada à ZFM ou ALC',
    grupo: 'Devoluções',
    categoria: 'DEVOLUCAO',
  },
  {
    codigo: '1208',
    descricao:
      'Devolução de produção do estabelecimento, remetida em transferência',
    grupo: 'Devoluções',
    categoria: 'DEVOLUCAO',
  },
  {
    codigo: '1209',
    descricao:
      'Devolução de mercadoria de terceiros, remetida em transferência',
    grupo: 'Devoluções',
    categoria: 'DEVOLUCAO',
  },
  {
    codigo: '1410',
    descricao:
      'Devolução de venda de produção do estabelecimento sujeita à substituição tributária',
    grupo: 'Devoluções',
    categoria: 'DEVOLUCAO',
  },
  {
    codigo: '1411',
    descricao:
      'Devolução de venda de mercadoria de terceiros sujeita à substituição tributária',
    grupo: 'Devoluções',
    categoria: 'DEVOLUCAO',
  },

  // Anulações de transporte
  {
    codigo: '1206',
    descricao:
      'Anulação de valor relativo à prestação de serviço de transporte',
    grupo: 'Transportes',
    categoria: 'PRESTACAO_SERVICO',
  },

  // Aquisições de serviço de transporte (crédito restrito)
  {
    codigo: '1352',
    descricao:
      'Aquisição de serviço de transporte por estabelecimento industrial',
    grupo: 'Transportes',
    categoria: 'PRESTACAO_SERVICO',
  },
  {
    codigo: '1353',
    descricao:
      'Aquisição de serviço de transporte por estabelecimento comercial',
    grupo: 'Transportes',
    categoria: 'PRESTACAO_SERVICO',
  },
  {
    codigo: '1356',
    descricao:
      'Aquisição de serviço de transporte por estabelecimento de produtor rural',
    grupo: 'Transportes',
    categoria: 'PRESTACAO_SERVICO',
  },
  {
    codigo: '1360',
    descricao:
      'Aquisição de serviço de transporte por contribuinte substituto em relação ao serviço de transporte',
    grupo: 'Transportes',
    categoria: 'PRESTACAO_SERVICO',
  },

  // Substituição tributária (substituído não credita ICMS)
  {
    codigo: '1401',
    descricao:
      'Compra para industrialização em operação com mercadoria sujeita à substituição tributária',
    grupo: 'Substituição tributária',
    categoria: 'COMPRA_INSUMO',
    credito: false,
  },
  {
    codigo: '1403',
    descricao:
      'Compra para comercialização em operação com mercadoria sujeita à substituição tributária',
    grupo: 'Substituição tributária',
    categoria: 'COMPRA_REVENDA',
    credito: false,
  },
  {
    codigo: '1406',
    descricao:
      'Compra de bem para o ativo imobilizado cuja mercadoria está sujeita à substituição tributária',
    grupo: 'Substituição tributária',
    categoria: 'ATIVO_IMOBILIZADO',
    credito: false,
  },
  {
    codigo: '1407',
    descricao:
      'Compra de mercadoria para uso ou consumo cuja mercadoria está sujeita à substituição tributária',
    grupo: 'Substituição tributária',
    categoria: 'USO_CONSUMO',
    credito: false,
  },
  {
    codigo: '1408',
    descricao:
      'Transferência para industrialização de mercadoria sujeita à substituição tributária',
    grupo: 'Substituição tributária',
    categoria: 'TRANSFERENCIA',
    credito: false,
  },
  {
    codigo: '1409',
    descricao:
      'Transferência para comercialização de mercadoria sujeita à substituição tributária',
    grupo: 'Substituição tributária',
    categoria: 'TRANSFERENCIA',
    credito: false,
  },

  // Ativo imobilizado (crédito via CIAP, não integral na entrada)
  {
    codigo: '1551',
    descricao: 'Compra de bem para o ativo imobilizado',
    grupo: 'Ativo imobilizado',
    categoria: 'ATIVO_IMOBILIZADO',
  },
  {
    codigo: '1552',
    descricao: 'Transferência de bem do ativo imobilizado',
    grupo: 'Ativo imobilizado',
    categoria: 'ATIVO_IMOBILIZADO',
  },
  {
    codigo: '1553',
    descricao: 'Devolução de venda de bem do ativo imobilizado',
    grupo: 'Ativo imobilizado',
    categoria: 'DEVOLUCAO',
  },
  {
    codigo: '1554',
    descricao:
      'Retorno de bem do ativo imobilizado remetido para uso fora do estabelecimento',
    grupo: 'Ativo imobilizado',
    categoria: 'REMESSA_RETORNO',
  },

  // Uso e consumo (SEM crédito de ICMS — LC 87/96 art. 33, I)
  {
    codigo: '1556',
    descricao: 'Compra de material para uso ou consumo',
    grupo: 'Uso e consumo',
    categoria: 'USO_CONSUMO',
    credito: false,
  },
  {
    codigo: '1557',
    descricao: 'Transferência de material para uso ou consumo',
    grupo: 'Uso e consumo',
    categoria: 'USO_CONSUMO',
    credito: false,
  },

  // Remessas / retornos
  {
    codigo: '1501',
    descricao:
      'Entrada de mercadoria recebida com fim específico de exportação',
    grupo: 'Remessas e retornos',
    categoria: 'REMESSA_RETORNO',
  },
  {
    codigo: '1503',
    descricao:
      'Entrada decorrente de devolução de produto remetido com fim específico de exportação',
    grupo: 'Remessas e retornos',
    categoria: 'REMESSA_RETORNO',
  },
  {
    codigo: '1504',
    descricao:
      'Entrada decorrente de devolução de mercadoria de terceiros remetida com fim específico de exportação',
    grupo: 'Remessas e retornos',
    categoria: 'REMESSA_RETORNO',
  },
  {
    codigo: '1901',
    descricao: 'Entrada para industrialização por encomenda',
    grupo: 'Remessas e retornos',
    categoria: 'REMESSA_RETORNO',
  },
  {
    codigo: '1902',
    descricao:
      'Retorno de mercadoria remetida para industrialização por encomenda',
    grupo: 'Remessas e retornos',
    categoria: 'REMESSA_RETORNO',
  },
  {
    codigo: '1903',
    descricao:
      'Entrada de mercadoria remetida para industrialização e não aplicada no referido processo',
    grupo: 'Remessas e retornos',
    categoria: 'REMESSA_RETORNO',
  },
  {
    codigo: '1904',
    descricao: 'Retorno de remessa para venda fora do estabelecimento',
    grupo: 'Remessas e retornos',
    categoria: 'REMESSA_RETORNO',
  },
  {
    codigo: '1908',
    descricao: 'Entrada de bem por conta de contrato de comodato',
    grupo: 'Remessas e retornos',
    categoria: 'REMESSA_RETORNO',
  },
  {
    codigo: '1909',
    descricao: 'Retorno de bem remetido por conta de contrato de comodato',
    grupo: 'Remessas e retornos',
    categoria: 'REMESSA_RETORNO',
  },
  {
    codigo: '1910',
    descricao: 'Entrada de bonificação, doação ou brinde',
    grupo: 'Remessas e retornos',
    categoria: 'OUTRAS',
  },
  {
    codigo: '1911',
    descricao: 'Entrada de amostra grátis',
    grupo: 'Remessas e retornos',
    categoria: 'OUTRAS',
  },
  {
    codigo: '1915',
    descricao: 'Entrada de mercadoria ou bem recebido para conserto ou reparo',
    grupo: 'Remessas e retornos',
    categoria: 'REMESSA_RETORNO',
  },
  {
    codigo: '1916',
    descricao: 'Retorno de mercadoria ou bem remetido para conserto ou reparo',
    grupo: 'Remessas e retornos',
    categoria: 'REMESSA_RETORNO',
  },
  {
    codigo: '1917',
    descricao:
      'Entrada de mercadoria recebida em consignação mercantil ou industrial',
    grupo: 'Remessas e retornos',
    categoria: 'REMESSA_RETORNO',
  },
  {
    codigo: '1922',
    descricao:
      'Lançamento efetuado a título de simples faturamento decorrente de compra para recebimento futuro',
    grupo: 'Outras entradas',
    categoria: 'OUTRAS',
  },
  {
    codigo: '1923',
    descricao:
      'Entrada de mercadoria recebida do vendedor remetente, em venda à ordem',
    grupo: 'Outras entradas',
    categoria: 'COMPRA_REVENDA',
  },
  {
    codigo: '1926',
    descricao:
      'Lançamento efetuado a título de reclassificação de mercadoria decorrente de formação de kit ou de sua desagregação',
    grupo: 'Outras entradas',
    categoria: 'OUTRAS',
  },
  {
    codigo: '1949',
    descricao:
      'Outra entrada de mercadoria ou prestação de serviço não especificada',
    grupo: 'Outras entradas',
    categoria: 'OUTRAS',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Catálogo de SAÍDAS (grupos 5xxx estadual / 6xxx interestadual / 7xxx exterior)
// ─────────────────────────────────────────────────────────────────────────────

const SAIDAS: CfopDef[] = [
  // Vendas de produção própria
  {
    codigo: '5101',
    descricao: 'Venda de produção do estabelecimento',
    grupo: 'Vendas',
    categoria: 'OUTRAS',
  },
  {
    codigo: '5109',
    descricao: 'Venda de produção do estabelecimento destinada à ZFM ou ALC',
    grupo: 'Vendas',
    categoria: 'OUTRAS',
  },
  {
    codigo: '5111',
    descricao:
      'Venda de produção do estabelecimento remetida anteriormente em consignação industrial',
    grupo: 'Vendas',
    categoria: 'OUTRAS',
  },
  {
    codigo: '5116',
    descricao:
      'Venda de produção do estabelecimento originada de encomenda para entrega futura',
    grupo: 'Vendas',
    categoria: 'OUTRAS',
  },
  {
    codigo: '5117',
    descricao:
      'Venda de mercadoria adquirida de terceiros, originada de encomenda para entrega futura',
    grupo: 'Vendas',
    categoria: 'OUTRAS',
  },
  {
    codigo: '5118',
    descricao:
      'Venda de produção do estabelecimento entregue ao destinatário por conta e ordem do adquirente originário',
    grupo: 'Vendas',
    categoria: 'OUTRAS',
  },
  {
    codigo: '5119',
    descricao:
      'Venda de mercadoria de terceiros entregue ao destinatário por conta e ordem do adquirente originário',
    grupo: 'Vendas',
    categoria: 'OUTRAS',
  },
  {
    codigo: '5120',
    descricao:
      'Venda de mercadoria de terceiros entregue ao destinatário pelo vendedor remetente, em venda à ordem',
    grupo: 'Vendas',
    categoria: 'OUTRAS',
  },

  // Vendas de mercadoria de terceiros (revenda)
  {
    codigo: '5102',
    descricao: 'Venda de mercadoria adquirida ou recebida de terceiros',
    grupo: 'Vendas',
    categoria: 'OUTRAS',
  },
  {
    codigo: '5103',
    descricao:
      'Venda de produção do estabelecimento efetuada fora do estabelecimento',
    grupo: 'Vendas',
    categoria: 'OUTRAS',
  },
  {
    codigo: '5104',
    descricao:
      'Venda de mercadoria adquirida de terceiros efetuada fora do estabelecimento',
    grupo: 'Vendas',
    categoria: 'OUTRAS',
  },

  // Transferências (saída)
  {
    codigo: '5151',
    descricao: 'Transferência de produção do estabelecimento',
    grupo: 'Transferências',
    categoria: 'TRANSFERENCIA',
  },
  {
    codigo: '5152',
    descricao: 'Transferência de mercadoria adquirida ou recebida de terceiros',
    grupo: 'Transferências',
    categoria: 'TRANSFERENCIA',
  },
  {
    codigo: '5155',
    descricao:
      'Transferência de produção do estabelecimento, que não deva por ele transitar',
    grupo: 'Transferências',
    categoria: 'TRANSFERENCIA',
  },
  {
    codigo: '5156',
    descricao:
      'Transferência de mercadoria de terceiros, que não deva pelo estabelecimento transitar',
    grupo: 'Transferências',
    categoria: 'TRANSFERENCIA',
  },

  // Devoluções de compra (saída)
  {
    codigo: '5201',
    descricao: 'Devolução de compra para industrialização ou produção rural',
    grupo: 'Devoluções',
    categoria: 'DEVOLUCAO',
  },
  {
    codigo: '5202',
    descricao: 'Devolução de compra para comercialização',
    grupo: 'Devoluções',
    categoria: 'DEVOLUCAO',
  },
  {
    codigo: '5208',
    descricao:
      'Devolução de mercadoria recebida em transferência para industrialização',
    grupo: 'Devoluções',
    categoria: 'DEVOLUCAO',
  },
  {
    codigo: '5209',
    descricao:
      'Devolução de mercadoria recebida em transferência para comercialização',
    grupo: 'Devoluções',
    categoria: 'DEVOLUCAO',
  },
  {
    codigo: '5410',
    descricao:
      'Devolução de compra para industrialização de mercadoria sujeita à substituição tributária',
    grupo: 'Devoluções',
    categoria: 'DEVOLUCAO',
  },
  {
    codigo: '5411',
    descricao:
      'Devolução de compra para comercialização de mercadoria sujeita à substituição tributária',
    grupo: 'Devoluções',
    categoria: 'DEVOLUCAO',
  },
  {
    codigo: '5412',
    descricao:
      'Devolução de bem do ativo imobilizado, em operação com mercadoria sujeita à substituição tributária',
    grupo: 'Devoluções',
    categoria: 'DEVOLUCAO',
  },
  {
    codigo: '5413',
    descricao:
      'Devolução de mercadoria destinada ao uso ou consumo, em operação com substituição tributária',
    grupo: 'Devoluções',
    categoria: 'DEVOLUCAO',
  },
  {
    codigo: '5553',
    descricao: 'Devolução de compra de bem para o ativo imobilizado',
    grupo: 'Ativo imobilizado',
    categoria: 'DEVOLUCAO',
  },
  {
    codigo: '5556',
    descricao: 'Devolução de compra de material de uso ou consumo',
    grupo: 'Uso e consumo',
    categoria: 'DEVOLUCAO',
  },

  // Anulações de transporte
  {
    codigo: '5206',
    descricao:
      'Anulação de valor relativo à aquisição de serviço de transporte',
    grupo: 'Transportes',
    categoria: 'PRESTACAO_SERVICO',
  },

  // Prestação de serviço de transporte (CT-e emitido)
  {
    codigo: '5351',
    descricao:
      'Prestação de serviço de transporte para execução de serviço da mesma natureza',
    grupo: 'Transportes',
    categoria: 'PRESTACAO_SERVICO',
  },
  {
    codigo: '5352',
    descricao:
      'Prestação de serviço de transporte a estabelecimento industrial',
    grupo: 'Transportes',
    categoria: 'PRESTACAO_SERVICO',
  },
  {
    codigo: '5353',
    descricao: 'Prestação de serviço de transporte a estabelecimento comercial',
    grupo: 'Transportes',
    categoria: 'PRESTACAO_SERVICO',
  },
  {
    codigo: '5354',
    descricao:
      'Prestação de serviço de transporte a estabelecimento de prestador de serviço de comunicação',
    grupo: 'Transportes',
    categoria: 'PRESTACAO_SERVICO',
  },
  {
    codigo: '5355',
    descricao:
      'Prestação de serviço de transporte a estabelecimento de geradora ou de distribuidora de energia elétrica',
    grupo: 'Transportes',
    categoria: 'PRESTACAO_SERVICO',
  },
  {
    codigo: '5356',
    descricao:
      'Prestação de serviço de transporte a estabelecimento de produtor rural',
    grupo: 'Transportes',
    categoria: 'PRESTACAO_SERVICO',
  },
  {
    codigo: '5357',
    descricao: 'Prestação de serviço de transporte a não contribuinte',
    grupo: 'Transportes',
    categoria: 'PRESTACAO_SERVICO',
  },
  {
    codigo: '5360',
    descricao:
      'Prestação de serviço de transporte a contribuinte substituto em relação ao serviço de transporte',
    grupo: 'Transportes',
    categoria: 'PRESTACAO_SERVICO',
  },

  // Substituição tributária (saída)
  {
    codigo: '5401',
    descricao:
      'Venda de produção do estabelecimento em operação com produto sujeito à substituição tributária, como contribuinte substituto',
    grupo: 'Substituição tributária',
    categoria: 'OUTRAS',
  },
  {
    codigo: '5402',
    descricao:
      'Venda de produção do estabelecimento de produto sujeito à substituição tributária, em operação entre substitutos',
    grupo: 'Substituição tributária',
    categoria: 'OUTRAS',
  },
  {
    codigo: '5403',
    descricao:
      'Venda de mercadoria de terceiros sujeita à substituição tributária, como contribuinte substituto',
    grupo: 'Substituição tributária',
    categoria: 'OUTRAS',
  },
  {
    codigo: '5405',
    descricao:
      'Venda de mercadoria sujeita à substituição tributária, como contribuinte substituído',
    grupo: 'Substituição tributária',
    categoria: 'OUTRAS',
  },

  // Ativo imobilizado / uso e consumo (saída)
  {
    codigo: '5551',
    descricao: 'Venda de bem do ativo imobilizado',
    grupo: 'Ativo imobilizado',
    categoria: 'ATIVO_IMOBILIZADO',
  },
  {
    codigo: '5552',
    descricao: 'Transferência de bem do ativo imobilizado',
    grupo: 'Ativo imobilizado',
    categoria: 'TRANSFERENCIA',
  },
  {
    codigo: '5557',
    descricao: 'Transferência de material de uso ou consumo',
    grupo: 'Uso e consumo',
    categoria: 'TRANSFERENCIA',
  },

  // Remessas / retornos (saída)
  {
    codigo: '5501',
    descricao:
      'Remessa de produção do estabelecimento, com fim específico de exportação',
    grupo: 'Remessas e retornos',
    categoria: 'REMESSA_RETORNO',
  },
  {
    codigo: '5502',
    descricao:
      'Remessa de mercadoria adquirida de terceiros, com fim específico de exportação',
    grupo: 'Remessas e retornos',
    categoria: 'REMESSA_RETORNO',
  },
  {
    codigo: '5901',
    descricao: 'Remessa para industrialização por encomenda',
    grupo: 'Remessas e retornos',
    categoria: 'REMESSA_RETORNO',
  },
  {
    codigo: '5902',
    descricao:
      'Retorno de mercadoria utilizada na industrialização por encomenda',
    grupo: 'Remessas e retornos',
    categoria: 'REMESSA_RETORNO',
  },
  {
    codigo: '5903',
    descricao:
      'Retorno de mercadoria recebida para industrialização e não aplicada no referido processo',
    grupo: 'Remessas e retornos',
    categoria: 'REMESSA_RETORNO',
  },
  {
    codigo: '5904',
    descricao: 'Remessa para venda fora do estabelecimento',
    grupo: 'Remessas e retornos',
    categoria: 'REMESSA_RETORNO',
  },
  {
    codigo: '5908',
    descricao: 'Remessa de bem por conta de contrato de comodato',
    grupo: 'Remessas e retornos',
    categoria: 'REMESSA_RETORNO',
  },
  {
    codigo: '5909',
    descricao: 'Retorno de bem recebido por conta de contrato de comodato',
    grupo: 'Remessas e retornos',
    categoria: 'REMESSA_RETORNO',
  },
  {
    codigo: '5910',
    descricao: 'Remessa em bonificação, doação ou brinde',
    grupo: 'Remessas e retornos',
    categoria: 'OUTRAS',
  },
  {
    codigo: '5911',
    descricao: 'Remessa de amostra grátis',
    grupo: 'Remessas e retornos',
    categoria: 'OUTRAS',
  },
  {
    codigo: '5915',
    descricao: 'Remessa de mercadoria ou bem para conserto ou reparo',
    grupo: 'Remessas e retornos',
    categoria: 'REMESSA_RETORNO',
  },
  {
    codigo: '5916',
    descricao: 'Retorno de mercadoria ou bem recebido para conserto ou reparo',
    grupo: 'Remessas e retornos',
    categoria: 'REMESSA_RETORNO',
  },
  {
    codigo: '5917',
    descricao: 'Remessa de mercadoria em consignação mercantil ou industrial',
    grupo: 'Remessas e retornos',
    categoria: 'REMESSA_RETORNO',
  },
  {
    codigo: '5922',
    descricao:
      'Lançamento efetuado a título de simples faturamento decorrente de venda para entrega futura',
    grupo: 'Outras saídas',
    categoria: 'OUTRAS',
  },
  {
    codigo: '5923',
    descricao:
      'Remessa de mercadoria por conta e ordem de terceiros, em venda à ordem',
    grupo: 'Outras saídas',
    categoria: 'OUTRAS',
  },
  {
    codigo: '5926',
    descricao:
      'Lançamento efetuado a título de reclassificação de mercadoria decorrente de formação de kit ou de sua desagregação',
    grupo: 'Outras saídas',
    categoria: 'OUTRAS',
  },
  {
    codigo: '5949',
    descricao:
      'Outra saída de mercadoria ou prestação de serviço não especificada',
    grupo: 'Outras saídas',
    categoria: 'OUTRAS',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Geração de variantes interestaduais (2xxx/6xxx) e de exterior (3xxx/7xxx)
// a partir das definições estaduais, com ajuste de descrição.
// ─────────────────────────────────────────────────────────────────────────────

function withPrefix(def: CfopDef, prefix: string): CfopDef {
  return { ...def, codigo: `${prefix}${def.codigo.slice(1)}` };
}

// Finais (3 últimos dígitos) que possuem correspondência interestadual oficial
// direta na tabela CONFAZ. Restringimos a geração automática a esta whitelist
// para não semear CFOPs bem-formados porém inexistentes.
const FINAIS_INTER_ENTRADA = new Set([
  '101',
  '111',
  '116',
  '118',
  '120',
  '121',
  '122',
  '124',
  '125',
  '126',
  '102',
  '113',
  '117',
  '151',
  '152',
  '154',
  '201',
  '202',
  '208',
  '209',
  '410',
  '411',
  '206',
  '352',
  '353',
  '356',
  '360',
  '401',
  '403',
  '406',
  '407',
  '408',
  '409',
  '551',
  '552',
  '553',
  '556',
  '557',
  '501',
  '551',
  '901',
  '902',
  '903',
  '904',
  '908',
  '909',
  '910',
  '911',
  '915',
  '916',
  '917',
  '922',
  '923',
  '926',
  '949',
]);

const FINAIS_INTER_SAIDA = new Set([
  '101',
  '102',
  '103',
  '104',
  '111',
  '116',
  '117',
  '118',
  '119',
  '120',
  '151',
  '152',
  '155',
  '156',
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
  '206',
  '351',
  '352',
  '353',
  '354',
  '355',
  '356',
  '357',
  '360',
  '401',
  '402',
  '403',
  '405',
  '551',
  '552',
  '557',
  '501',
  '502',
  '901',
  '902',
  '903',
  '904',
  '908',
  '909',
  '910',
  '911',
  '915',
  '916',
  '917',
  '922',
  '923',
  '926',
  '949',
]);

const ENTRADAS_INTER: CfopDef[] = ENTRADAS.filter((d) =>
  FINAIS_INTER_ENTRADA.has(d.codigo.slice(1)),
).map((d) => withPrefix(d, '2'));

const SAIDAS_INTER: CfopDef[] = SAIDAS.filter((d) =>
  FINAIS_INTER_SAIDA.has(d.codigo.slice(1)),
).map((d) => withPrefix(d, '6'));

// Exterior — apenas os CFOPs que fazem sentido em importação/exportação.
const ENTRADAS_EXTERIOR: CfopDef[] = [
  {
    codigo: '3101',
    descricao: 'Compra do exterior para industrialização ou produção rural',
    grupo: 'Compras',
    categoria: 'COMPRA_INSUMO',
  },
  {
    codigo: '3102',
    descricao: 'Compra do exterior para comercialização',
    grupo: 'Compras',
    categoria: 'COMPRA_REVENDA',
  },
  {
    codigo: '3126',
    descricao:
      'Compra do exterior de mercadoria a ser utilizada na prestação de serviço sujeita ao ICMS',
    grupo: 'Compras',
    categoria: 'COMPRA_INSUMO',
  },
  {
    codigo: '3127',
    descricao:
      'Compra do exterior de mercadoria a ser utilizada em processo de industrialização por encomenda',
    grupo: 'Compras',
    categoria: 'COMPRA_INSUMO',
  },
  {
    codigo: '3201',
    descricao:
      'Devolução de compra do exterior para industrialização ou produção rural',
    grupo: 'Devoluções',
    categoria: 'DEVOLUCAO',
  },
  {
    codigo: '3202',
    descricao: 'Devolução de compra do exterior para comercialização',
    grupo: 'Devoluções',
    categoria: 'DEVOLUCAO',
  },
  {
    codigo: '3206',
    descricao:
      'Anulação de valor relativo à prestação de serviço de transporte do exterior',
    grupo: 'Transportes',
    categoria: 'PRESTACAO_SERVICO',
  },
  {
    codigo: '3351',
    descricao:
      'Aquisição do exterior de serviço de transporte para execução de serviço da mesma natureza',
    grupo: 'Transportes',
    categoria: 'PRESTACAO_SERVICO',
  },
  {
    codigo: '3352',
    descricao:
      'Aquisição do exterior de serviço de transporte por estabelecimento industrial',
    grupo: 'Transportes',
    categoria: 'PRESTACAO_SERVICO',
  },
  {
    codigo: '3353',
    descricao:
      'Aquisição do exterior de serviço de transporte por estabelecimento comercial',
    grupo: 'Transportes',
    categoria: 'PRESTACAO_SERVICO',
  },
  {
    codigo: '3356',
    descricao:
      'Aquisição do exterior de serviço de transporte por estabelecimento de produtor rural',
    grupo: 'Transportes',
    categoria: 'PRESTACAO_SERVICO',
  },
  {
    codigo: '3551',
    descricao: 'Compra do exterior de bem para o ativo imobilizado',
    grupo: 'Ativo imobilizado',
    categoria: 'ATIVO_IMOBILIZADO',
  },
  {
    codigo: '3556',
    descricao: 'Compra do exterior de material para uso ou consumo',
    grupo: 'Uso e consumo',
    categoria: 'USO_CONSUMO',
    credito: false,
  },
  {
    codigo: '3949',
    descricao: 'Outra entrada do exterior não especificada',
    grupo: 'Outras entradas',
    categoria: 'OUTRAS',
  },
];

const SAIDAS_EXTERIOR: CfopDef[] = [
  {
    codigo: '7101',
    descricao: 'Venda de produção do estabelecimento para o exterior',
    grupo: 'Vendas',
    categoria: 'OUTRAS',
  },
  {
    codigo: '7102',
    descricao:
      'Venda de mercadoria adquirida ou recebida de terceiros para o exterior',
    grupo: 'Vendas',
    categoria: 'OUTRAS',
  },
  {
    codigo: '7105',
    descricao:
      'Venda de produção do estabelecimento, que não deva por ele transitar, para o exterior',
    grupo: 'Vendas',
    categoria: 'OUTRAS',
  },
  {
    codigo: '7106',
    descricao:
      'Venda de mercadoria de terceiros, que não deva pelo estabelecimento transitar, para o exterior',
    grupo: 'Vendas',
    categoria: 'OUTRAS',
  },
  {
    codigo: '7201',
    descricao: 'Devolução de compra para industrialização, para o exterior',
    grupo: 'Devoluções',
    categoria: 'DEVOLUCAO',
  },
  {
    codigo: '7202',
    descricao: 'Devolução de compra para comercialização, para o exterior',
    grupo: 'Devoluções',
    categoria: 'DEVOLUCAO',
  },
  {
    codigo: '7206',
    descricao:
      'Anulação de valor relativo à aquisição de serviço de transporte do exterior',
    grupo: 'Transportes',
    categoria: 'PRESTACAO_SERVICO',
  },
  {
    codigo: '7358',
    descricao: 'Prestação de serviço de transporte para o exterior',
    grupo: 'Transportes',
    categoria: 'PRESTACAO_SERVICO',
  },
  {
    codigo: '7551',
    descricao: 'Venda de bem do ativo imobilizado para o exterior',
    grupo: 'Ativo imobilizado',
    categoria: 'ATIVO_IMOBILIZADO',
  },
  {
    codigo: '7949',
    descricao: 'Outra saída para o exterior não especificada',
    grupo: 'Outras saídas',
    categoria: 'OUTRAS',
  },
];

const ALL_DEFS: CfopDef[] = [
  ...ENTRADAS,
  ...ENTRADAS_INTER,
  ...ENTRADAS_EXTERIOR,
  ...SAIDAS,
  ...SAIDAS_INTER,
  ...SAIDAS_EXTERIOR,
];

// Deduplica por código (as variantes geradas podem colidir com definições
// exteriores/estaduais declaradas explicitamente).
const SEEN = new Set<string>();
export const CFOPS_SEED: CfopSeed[] = ALL_DEFS.filter((def) => {
  if (SEEN.has(def.codigo)) return false;
  SEEN.add(def.codigo);
  return true;
}).map(toCfopSeed);

// ─────────────────────────────────────────────────────────────────────────────
// Equivalências globais (clienteId = null): CFOP de saída do fornecedor →
// CFOP de entrada do destinatário. Casos triviais (mesma faixa) são resolvidos
// pelo algoritmo; aqui ficam apenas os de/para NÃO triviais e os mais comuns.
// ─────────────────────────────────────────────────────────────────────────────

interface EqDef {
  origem: string;
  destino: string;
  descricao: string;
}

// De/para não triviais: revenda, ST (substituído), uso/consumo, ativo.
const EQUIV_ESTADUAL: EqDef[] = [
  {
    origem: '5101',
    destino: '1101',
    descricao: 'Venda de produção → compra para industrialização',
  },
  {
    origem: '5102',
    destino: '1102',
    descricao: 'Venda de mercadoria → compra para comercialização',
  },
  {
    origem: '5201',
    destino: '1201',
    descricao: 'Devolução de compra → devolução de venda de produção',
  },
  {
    origem: '5202',
    destino: '1202',
    descricao: 'Devolução de compra → devolução de venda de mercadoria',
  },
  {
    origem: '5206',
    destino: '1206',
    descricao: 'Anulação de aquisição → anulação de prestação de transporte',
  },
  {
    origem: '5352',
    destino: '1352',
    descricao: 'Prestação → aquisição de transporte industrial',
  },
  {
    origem: '5353',
    destino: '1353',
    descricao: 'Prestação → aquisição de transporte comercial',
  },
  {
    origem: '5356',
    destino: '1356',
    descricao: 'Prestação → aquisição de transporte rural',
  },
  {
    origem: '5360',
    destino: '1360',
    descricao: 'Prestação → aquisição de transporte por substituto',
  },
  {
    origem: '5401',
    destino: '1401',
    descricao: 'Venda de produção ST → compra para industrialização ST',
  },
  {
    origem: '5403',
    destino: '1403',
    descricao: 'Venda ST (substituto) → compra para comercialização ST',
  },
  // Não trivial: substituído (5405) NÃO vira 1405; a entrada correta é 1403.
  {
    origem: '5405',
    destino: '1403',
    descricao: 'Venda por substituído → compra para comercialização ST (1403)',
  },
  {
    origem: '5411',
    destino: '1411',
    descricao: 'Devolução de compra ST → devolução de venda ST',
  },
  {
    origem: '5551',
    destino: '1551',
    descricao: 'Venda de ativo → compra de bem para o ativo imobilizado',
  },
  {
    origem: '5556',
    destino: '1556',
    descricao: 'Devolução → compra de material de uso ou consumo',
  },
];

const EQUIV_INTER: EqDef[] = EQUIV_ESTADUAL.map((eq) => ({
  origem: `6${eq.origem.slice(1)}`,
  destino: `2${eq.destino.slice(1)}`,
  descricao: eq.descricao.replace('→', '(interestadual) →'),
}));

const EQUIV_ALL: EqDef[] = [...EQUIV_ESTADUAL, ...EQUIV_INTER];

// Só emite equivalências cujos CFOPs de origem/destino existem no catálogo.
const CODIGOS = new Set(CFOPS_SEED.map((c) => c.codigo));

export const CFOP_EQUIVALENCIAS_SEED: EquivalenciaSeed[] = EQUIV_ALL.filter(
  (eq) => CODIGOS.has(eq.origem) && CODIGOS.has(eq.destino),
).map((eq) => ({
  clienteId: null,
  cfopOrigem: eq.origem,
  cfopDestino: eq.destino,
  tipoOperacao: 'SAIDA_PARA_ENTRADA',
  descricao: eq.descricao,
}));

// ─────────────────────────────────────────────────────────────────────────────
// Execução do seed
// ─────────────────────────────────────────────────────────────────────────────

export async function seedCfops(databaseUrl: string) {
  const client = postgres(databaseUrl, { max: 1 });
  const database = drizzle(client);
  try {
    await database.transaction(async (tx) => {
      await tx.insert(cfops).values(CFOPS_SEED).onConflictDoNothing();
      await tx
        .insert(cfopEquivalencias)
        .values(CFOP_EQUIVALENCIAS_SEED)
        .onConflictDoNothing();
    });
  } finally {
    await client.end({ timeout: 5 });
  }
}

if (require.main === module) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL não configurada.');
  void seedCfops(databaseUrl)
    .then(() =>
      process.stdout.write(
        `Seed de CFOPs concluído: ${CFOPS_SEED.length} CFOPs, ${CFOP_EQUIVALENCIAS_SEED.length} equivalências.\n`,
      ),
    )
    .catch((error: unknown) => {
      process.stderr.write(
        `Falha ao executar seed de CFOPs: ${error instanceof Error ? error.message : 'erro desconhecido'}\n`,
      );
      process.exitCode = 1;
    });
}
