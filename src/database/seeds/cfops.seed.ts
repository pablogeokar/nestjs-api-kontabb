import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { cfopEquivalencias, cfops } from '../schema';

type CfopSeed = typeof cfops.$inferInsert;
type EquivalenciaSeed = typeof cfopEquivalencias.$inferInsert;

const ENTRADAS: Array<[string, string, string]> = [
  ['1101', 'Compra para industrialização ou produção rural', 'Compras'],
  ['1102', 'Compra para comercialização', 'Compras'],
  ['1201', 'Devolução de venda de produção do estabelecimento', 'Devoluções'],
  [
    '1202',
    'Devolução de venda de mercadoria adquirida de terceiros',
    'Devoluções',
  ],
  [
    '1353',
    'Aquisição de serviço de transporte por estabelecimento comercial',
    'Transportes',
  ],
  [
    '1401',
    'Compra de produção sujeita à substituição tributária',
    'Substituição tributária',
  ],
  [
    '1403',
    'Compra para comercialização sujeita à substituição tributária',
    'Substituição tributária',
  ],
  [
    '1405',
    'Compra para comercialização em operação com substituição tributária',
    'Substituição tributária',
  ],
  ['1551', 'Compra de bem para o ativo imobilizado', 'Ativo imobilizado'],
  ['1556', 'Compra de material para uso ou consumo', 'Uso e consumo'],
  [
    '1949',
    'Outra entrada de mercadoria ou prestação de serviço não especificada',
    'Outras entradas',
  ],
  [
    '2101',
    'Compra interestadual para industrialização ou produção rural',
    'Compras',
  ],
  ['2102', 'Compra interestadual para comercialização', 'Compras'],
  [
    '2201',
    'Devolução interestadual de venda de produção do estabelecimento',
    'Devoluções',
  ],
  [
    '2202',
    'Devolução interestadual de venda de mercadoria de terceiros',
    'Devoluções',
  ],
  [
    '2353',
    'Aquisição interestadual de serviço de transporte por estabelecimento comercial',
    'Transportes',
  ],
  [
    '2401',
    'Compra interestadual de produção sujeita à substituição tributária',
    'Substituição tributária',
  ],
  [
    '2403',
    'Compra interestadual para comercialização sujeita à substituição tributária',
    'Substituição tributária',
  ],
  [
    '2405',
    'Compra interestadual para comercialização com substituição tributária',
    'Substituição tributária',
  ],
  [
    '2551',
    'Compra interestadual de bem para o ativo imobilizado',
    'Ativo imobilizado',
  ],
  [
    '2556',
    'Compra interestadual de material para uso ou consumo',
    'Uso e consumo',
  ],
  ['2949', 'Outra entrada interestadual não especificada', 'Outras entradas'],
  [
    '3101',
    'Compra do exterior para industrialização ou produção rural',
    'Compras',
  ],
  ['3102', 'Compra do exterior para comercialização', 'Compras'],
  ['3949', 'Outra entrada do exterior não especificada', 'Outras entradas'],
];

const SAIDAS: Array<[string, string, string]> = [
  ['5101', 'Venda de produção do estabelecimento', 'Vendas'],
  ['5102', 'Venda de mercadoria adquirida ou recebida de terceiros', 'Vendas'],
  [
    '5201',
    'Devolução de compra para industrialização ou produção rural',
    'Devoluções',
  ],
  ['5202', 'Devolução de compra para comercialização', 'Devoluções'],
  [
    '5353',
    'Prestação de serviço de transporte a estabelecimento comercial',
    'Transportes',
  ],
  [
    '5401',
    'Venda de produção sujeita à substituição tributária',
    'Substituição tributária',
  ],
  [
    '5403',
    'Venda de mercadoria de terceiros sujeita à substituição tributária',
    'Substituição tributária',
  ],
  [
    '5405',
    'Venda de mercadoria sujeita à substituição tributária na condição de substituído',
    'Substituição tributária',
  ],
  ['5551', 'Venda de bem do ativo imobilizado', 'Ativo imobilizado'],
  [
    '5556',
    'Devolução de compra de material de uso ou consumo',
    'Uso e consumo',
  ],
  [
    '5949',
    'Outra saída de mercadoria ou prestação de serviço não especificada',
    'Outras saídas',
  ],
  ['6101', 'Venda interestadual de produção do estabelecimento', 'Vendas'],
  [
    '6102',
    'Venda interestadual de mercadoria adquirida de terceiros',
    'Vendas',
  ],
  [
    '6201',
    'Devolução interestadual de compra para industrialização',
    'Devoluções',
  ],
  [
    '6202',
    'Devolução interestadual de compra para comercialização',
    'Devoluções',
  ],
  [
    '6353',
    'Prestação interestadual de serviço de transporte a estabelecimento comercial',
    'Transportes',
  ],
  [
    '6401',
    'Venda interestadual de produção sujeita à substituição tributária',
    'Substituição tributária',
  ],
  [
    '6403',
    'Venda interestadual de mercadoria sujeita à substituição tributária',
    'Substituição tributária',
  ],
  [
    '6405',
    'Venda interestadual na condição de substituído tributário',
    'Substituição tributária',
  ],
  [
    '6551',
    'Venda interestadual de bem do ativo imobilizado',
    'Ativo imobilizado',
  ],
  [
    '6556',
    'Devolução interestadual de material de uso ou consumo',
    'Uso e consumo',
  ],
  ['6949', 'Outra saída interestadual não especificada', 'Outras saídas'],
  ['7101', 'Venda de produção do estabelecimento para o exterior', 'Vendas'],
  [
    '7102',
    'Venda de mercadoria adquirida de terceiros para o exterior',
    'Vendas',
  ],
  ['7949', 'Outra saída para o exterior não especificada', 'Outras saídas'],
];

export const CFOPS_SEED: CfopSeed[] = [
  ...ENTRADAS.map(([codigo, descricao, grupo]) => ({
    codigo,
    descricao,
    grupo,
    tipoOperacao: 'ENTRADA',
    abrangencia: abrangenciaFromCodigo(codigo),
  })),
  ...SAIDAS.map(([codigo, descricao, grupo]) => ({
    codigo,
    descricao,
    grupo,
    tipoOperacao: 'SAIDA',
    abrangencia: abrangenciaFromCodigo(codigo),
  })),
];

export const CFOP_EQUIVALENCIAS_SEED: EquivalenciaSeed[] = [
  equivalencia(
    '5101',
    '1101',
    'Venda de produção para compra de industrialização',
  ),
  equivalencia(
    '5102',
    '1102',
    'Venda de mercadoria para compra de comercialização',
  ),
  equivalencia(
    '5201',
    '1201',
    'Devolução de compra para devolução de venda de produção',
  ),
  equivalencia(
    '5202',
    '1202',
    'Devolução de compra para devolução de venda de mercadoria',
  ),
  equivalencia(
    '5353',
    '1353',
    'Prestação para aquisição de transporte estadual',
  ),
  equivalencia(
    '5401',
    '1401',
    'Venda de produção ST para compra de produção ST',
  ),
  equivalencia(
    '5403',
    '1403',
    'Venda ST para compra destinada à comercialização ST',
  ),
  equivalencia(
    '5405',
    '1403',
    'Venda por substituído para compra com substituição tributária',
  ),
  equivalencia('5551', '1551', 'Venda para compra de ativo imobilizado'),
  equivalencia(
    '5556',
    '1556',
    'Devolução para compra de material de uso ou consumo',
  ),
  equivalencia(
    '6101',
    '2101',
    'Venda interestadual de produção para compra de industrialização',
  ),
  equivalencia(
    '6102',
    '2102',
    'Venda interestadual para compra de comercialização',
  ),
  equivalencia(
    '6201',
    '2201',
    'Devolução interestadual de compra para devolução de venda',
  ),
  equivalencia(
    '6202',
    '2202',
    'Devolução interestadual de compra para devolução de venda',
  ),
  equivalencia(
    '6353',
    '2353',
    'Prestação para aquisição de transporte interestadual',
  ),
  equivalencia(
    '6401',
    '2401',
    'Venda interestadual de produção ST para compra ST',
  ),
  equivalencia(
    '6403',
    '2403',
    'Venda interestadual ST para compra interestadual ST',
  ),
  equivalencia(
    '6405',
    '2405',
    'Venda interestadual por substituído para compra ST',
  ),
  equivalencia(
    '6551',
    '2551',
    'Venda interestadual para compra de ativo imobilizado',
  ),
  equivalencia(
    '6556',
    '2556',
    'Devolução interestadual para compra de uso ou consumo',
  ),
];

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

function abrangenciaFromCodigo(codigo: string) {
  if (['1', '5'].includes(codigo[0])) return 'ESTADUAL';
  if (['2', '6'].includes(codigo[0])) return 'INTERESTADUAL';
  return 'EXTERIOR';
}

function equivalencia(
  cfopOrigem: string,
  cfopDestino: string,
  descricao: string,
): EquivalenciaSeed {
  return {
    clienteId: null,
    cfopOrigem,
    cfopDestino,
    descricao,
    tipoOperacao: 'SAIDA_PARA_ENTRADA',
  };
}

if (require.main === module) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL não configurada.');
  void seedCfops(databaseUrl)
    .then(() => process.stdout.write('Seed de CFOPs concluído.\n'))
    .catch((error: unknown) => {
      process.stderr.write(
        `Falha ao executar seed de CFOPs: ${error instanceof Error ? error.message : 'erro desconhecido'}\n`,
      );
      process.exitCode = 1;
    });
}
