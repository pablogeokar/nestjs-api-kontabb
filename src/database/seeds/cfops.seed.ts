import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { cfopEquivalencias, cfops } from '../schema';

type CfopSeed = typeof cfops.$inferInsert;
type EquivalenciaSeed = typeof cfopEquivalencias.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Dados extraídos da tabela cfops (49 registros)
// ─────────────────────────────────────────────────────────────────────────────

export const CFOPS_SEED: CfopSeed[] = [
  // ── ENTRADA — ESTADUAL ──────────────────────────────────────────────────
  {
    codigo: '1101',
    descricao: 'Compra para industrialização ou produção rural',
    tipoOperacao: 'ENTRADA',
    abrangencia: 'ESTADUAL',
    grupo: 'Compras',
  },
  {
    codigo: '1102',
    descricao: 'Compra para comercialização',
    tipoOperacao: 'ENTRADA',
    abrangencia: 'ESTADUAL',
    grupo: 'Compras',
  },
  {
    codigo: '1201',
    descricao: 'Devolução de venda de produção do estabelecimento',
    tipoOperacao: 'ENTRADA',
    abrangencia: 'ESTADUAL',
    grupo: 'Devoluções',
  },
  {
    codigo: '1202',
    descricao: 'Devolução de venda de mercadoria adquirida de terceiros',
    tipoOperacao: 'ENTRADA',
    abrangencia: 'ESTADUAL',
    grupo: 'Devoluções',
  },
  {
    codigo: '1353',
    descricao:
      'Aquisição de serviço de transporte por estabelecimento comercial',
    tipoOperacao: 'ENTRADA',
    abrangencia: 'ESTADUAL',
    grupo: 'Transportes',
  },
  {
    codigo: '1401',
    descricao: 'Compra de produção sujeita à substituição tributária',
    tipoOperacao: 'ENTRADA',
    abrangencia: 'ESTADUAL',
    grupo: 'Substituição tributária',
  },
  {
    codigo: '1403',
    descricao: 'Compra para comercialização sujeita à substituição tributária',
    tipoOperacao: 'ENTRADA',
    abrangencia: 'ESTADUAL',
    grupo: 'Substituição tributária',
  },
  {
    codigo: '1405',
    descricao:
      'Compra para comercialização em operação com substituição tributária',
    tipoOperacao: 'ENTRADA',
    abrangencia: 'ESTADUAL',
    grupo: 'Substituição tributária',
  },
  {
    codigo: '1551',
    descricao: 'Compra de bem para o ativo imobilizado',
    tipoOperacao: 'ENTRADA',
    abrangencia: 'ESTADUAL',
    grupo: 'Ativo imobilizado',
  },
  {
    codigo: '1556',
    descricao: 'Compra de material para uso ou consumo',
    tipoOperacao: 'ENTRADA',
    abrangencia: 'ESTADUAL',
    grupo: 'Uso e consumo',
  },
  {
    codigo: '1949',
    descricao:
      'Outra entrada de mercadoria ou prestação de serviço não especificada',
    tipoOperacao: 'ENTRADA',
    abrangencia: 'ESTADUAL',
    grupo: 'Outras entradas',
  },

  // ── ENTRADA — INTERESTADUAL ─────────────────────────────────────────────
  {
    codigo: '2101',
    descricao: 'Compra interestadual para industrialização ou produção rural',
    tipoOperacao: 'ENTRADA',
    abrangencia: 'INTERESTADUAL',
    grupo: 'Compras',
  },
  {
    codigo: '2102',
    descricao: 'Compra interestadual para comercialização',
    tipoOperacao: 'ENTRADA',
    abrangencia: 'INTERESTADUAL',
    grupo: 'Compras',
  },
  {
    codigo: '2201',
    descricao:
      'Devolução interestadual de venda de produção do estabelecimento',
    tipoOperacao: 'ENTRADA',
    abrangencia: 'INTERESTADUAL',
    grupo: 'Devoluções',
  },
  {
    codigo: '2202',
    descricao: 'Devolução interestadual de venda de mercadoria de terceiros',
    tipoOperacao: 'ENTRADA',
    abrangencia: 'INTERESTADUAL',
    grupo: 'Devoluções',
  },
  {
    codigo: '2353',
    descricao:
      'Aquisição interestadual de serviço de transporte por estabelecimento comercial',
    tipoOperacao: 'ENTRADA',
    abrangencia: 'INTERESTADUAL',
    grupo: 'Transportes',
  },
  {
    codigo: '2401',
    descricao:
      'Compra interestadual de produção sujeita à substituição tributária',
    tipoOperacao: 'ENTRADA',
    abrangencia: 'INTERESTADUAL',
    grupo: 'Substituição tributária',
  },
  {
    codigo: '2403',
    descricao:
      'Compra interestadual para comercialização sujeita à substituição tributária',
    tipoOperacao: 'ENTRADA',
    abrangencia: 'INTERESTADUAL',
    grupo: 'Substituição tributária',
  },
  {
    codigo: '2405',
    descricao:
      'Compra interestadual para comercialização com substituição tributária',
    tipoOperacao: 'ENTRADA',
    abrangencia: 'INTERESTADUAL',
    grupo: 'Substituição tributária',
  },
  {
    codigo: '2551',
    descricao: 'Compra interestadual de bem para o ativo imobilizado',
    tipoOperacao: 'ENTRADA',
    abrangencia: 'INTERESTADUAL',
    grupo: 'Ativo imobilizado',
  },
  {
    codigo: '2556',
    descricao: 'Compra interestadual de material para uso ou consumo',
    tipoOperacao: 'ENTRADA',
    abrangencia: 'INTERESTADUAL',
    grupo: 'Uso e consumo',
  },
  {
    codigo: '2949',
    descricao: 'Outra entrada interestadual não especificada',
    tipoOperacao: 'ENTRADA',
    abrangencia: 'INTERESTADUAL',
    grupo: 'Outras entradas',
  },

  // ── ENTRADA — EXTERIOR ──────────────────────────────────────────────────
  {
    codigo: '3101',
    descricao: 'Compra do exterior para industrialização ou produção rural',
    tipoOperacao: 'ENTRADA',
    abrangencia: 'EXTERIOR',
    grupo: 'Compras',
  },
  {
    codigo: '3102',
    descricao: 'Compra do exterior para comercialização',
    tipoOperacao: 'ENTRADA',
    abrangencia: 'EXTERIOR',
    grupo: 'Compras',
  },
  {
    codigo: '3949',
    descricao: 'Outra entrada do exterior não especificada',
    tipoOperacao: 'ENTRADA',
    abrangencia: 'EXTERIOR',
    grupo: 'Outras entradas',
  },

  // ── SAÍDA — ESTADUAL ────────────────────────────────────────────────────
  {
    codigo: '5101',
    descricao: 'Venda de produção do estabelecimento',
    tipoOperacao: 'SAIDA',
    abrangencia: 'ESTADUAL',
    grupo: 'Vendas',
  },
  {
    codigo: '5102',
    descricao: 'Venda de mercadoria adquirida ou recebida de terceiros',
    tipoOperacao: 'SAIDA',
    abrangencia: 'ESTADUAL',
    grupo: 'Vendas',
  },
  {
    codigo: '5201',
    descricao: 'Devolução de compra para industrialização ou produção rural',
    tipoOperacao: 'SAIDA',
    abrangencia: 'ESTADUAL',
    grupo: 'Devoluções',
  },
  {
    codigo: '5202',
    descricao: 'Devolução de compra para comercialização',
    tipoOperacao: 'SAIDA',
    abrangencia: 'ESTADUAL',
    grupo: 'Devoluções',
  },
  {
    codigo: '5353',
    descricao: 'Prestação de serviço de transporte a estabelecimento comercial',
    tipoOperacao: 'SAIDA',
    abrangencia: 'ESTADUAL',
    grupo: 'Transportes',
  },
  {
    codigo: '5401',
    descricao: 'Venda de produção sujeita à substituição tributária',
    tipoOperacao: 'SAIDA',
    abrangencia: 'ESTADUAL',
    grupo: 'Substituição tributária',
  },
  {
    codigo: '5403',
    descricao:
      'Venda de mercadoria de terceiros sujeita à substituição tributária',
    tipoOperacao: 'SAIDA',
    abrangencia: 'ESTADUAL',
    grupo: 'Substituição tributária',
  },
  {
    codigo: '5405',
    descricao:
      'Venda de mercadoria sujeita à substituição tributária na condição de substituído',
    tipoOperacao: 'SAIDA',
    abrangencia: 'ESTADUAL',
    grupo: 'Substituição tributária',
  },
  {
    codigo: '5551',
    descricao: 'Venda de bem do ativo imobilizado',
    tipoOperacao: 'SAIDA',
    abrangencia: 'ESTADUAL',
    grupo: 'Ativo imobilizado',
  },
  {
    codigo: '5556',
    descricao: 'Devolução de compra de material de uso ou consumo',
    tipoOperacao: 'SAIDA',
    abrangencia: 'ESTADUAL',
    grupo: 'Uso e consumo',
  },
  {
    codigo: '5949',
    descricao:
      'Outra saída de mercadoria ou prestação de serviço não especificada',
    tipoOperacao: 'SAIDA',
    abrangencia: 'ESTADUAL',
    grupo: 'Outras saídas',
  },

  // ── SAÍDA — INTERESTADUAL ───────────────────────────────────────────────
  {
    codigo: '6101',
    descricao: 'Venda interestadual de produção do estabelecimento',
    tipoOperacao: 'SAIDA',
    abrangencia: 'INTERESTADUAL',
    grupo: 'Vendas',
  },
  {
    codigo: '6102',
    descricao: 'Venda interestadual de mercadoria adquirida de terceiros',
    tipoOperacao: 'SAIDA',
    abrangencia: 'INTERESTADUAL',
    grupo: 'Vendas',
  },
  {
    codigo: '6201',
    descricao: 'Devolução interestadual de compra para industrialização',
    tipoOperacao: 'SAIDA',
    abrangencia: 'INTERESTADUAL',
    grupo: 'Devoluções',
  },
  {
    codigo: '6202',
    descricao: 'Devolução interestadual de compra para comercialização',
    tipoOperacao: 'SAIDA',
    abrangencia: 'INTERESTADUAL',
    grupo: 'Devoluções',
  },
  {
    codigo: '6353',
    descricao:
      'Prestação interestadual de serviço de transporte a estabelecimento comercial',
    tipoOperacao: 'SAIDA',
    abrangencia: 'INTERESTADUAL',
    grupo: 'Transportes',
  },
  {
    codigo: '6401',
    descricao:
      'Venda interestadual de produção sujeita à substituição tributária',
    tipoOperacao: 'SAIDA',
    abrangencia: 'INTERESTADUAL',
    grupo: 'Substituição tributária',
  },
  {
    codigo: '6403',
    descricao:
      'Venda interestadual de mercadoria sujeita à substituição tributária',
    tipoOperacao: 'SAIDA',
    abrangencia: 'INTERESTADUAL',
    grupo: 'Substituição tributária',
  },
  {
    codigo: '6405',
    descricao: 'Venda interestadual na condição de substituído tributário',
    tipoOperacao: 'SAIDA',
    abrangencia: 'INTERESTADUAL',
    grupo: 'Substituição tributária',
  },
  {
    codigo: '6551',
    descricao: 'Venda interestadual de bem do ativo imobilizado',
    tipoOperacao: 'SAIDA',
    abrangencia: 'INTERESTADUAL',
    grupo: 'Ativo imobilizado',
  },
  {
    codigo: '6556',
    descricao: 'Devolução interestadual de material de uso ou consumo',
    tipoOperacao: 'SAIDA',
    abrangencia: 'INTERESTADUAL',
    grupo: 'Uso e consumo',
  },
  {
    codigo: '6949',
    descricao: 'Outra saída interestadual não especificada',
    tipoOperacao: 'SAIDA',
    abrangencia: 'INTERESTADUAL',
    grupo: 'Outras saídas',
  },

  // ── SAÍDA — EXTERIOR ────────────────────────────────────────────────────
  {
    codigo: '7101',
    descricao: 'Venda de produção do estabelecimento para o exterior',
    tipoOperacao: 'SAIDA',
    abrangencia: 'EXTERIOR',
    grupo: 'Vendas',
  },
  {
    codigo: '7102',
    descricao: 'Venda de mercadoria adquirida de terceiros para o exterior',
    tipoOperacao: 'SAIDA',
    abrangencia: 'EXTERIOR',
    grupo: 'Vendas',
  },
  {
    codigo: '7949',
    descricao: 'Outra saída para o exterior não especificada',
    tipoOperacao: 'SAIDA',
    abrangencia: 'EXTERIOR',
    grupo: 'Outras saídas',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Equivalências globais (clienteId = null) — 20 registros
// Mapeiam CFOP de saída do fornecedor → CFOP de entrada para o destinatário
// ─────────────────────────────────────────────────────────────────────────────

export const CFOP_EQUIVALENCIAS_SEED: EquivalenciaSeed[] = [
  // Estadual
  {
    clienteId: null,
    cfopOrigem: '5101',
    cfopDestino: '1101',
    tipoOperacao: 'SAIDA_PARA_ENTRADA',
    descricao: 'Venda de produção para compra de industrialização',
  },
  {
    clienteId: null,
    cfopOrigem: '5102',
    cfopDestino: '1102',
    tipoOperacao: 'SAIDA_PARA_ENTRADA',
    descricao: 'Venda de mercadoria para compra de comercialização',
  },
  {
    clienteId: null,
    cfopOrigem: '5201',
    cfopDestino: '1201',
    tipoOperacao: 'SAIDA_PARA_ENTRADA',
    descricao: 'Devolução de compra para devolução de venda de produção',
  },
  {
    clienteId: null,
    cfopOrigem: '5202',
    cfopDestino: '1202',
    tipoOperacao: 'SAIDA_PARA_ENTRADA',
    descricao: 'Devolução de compra para devolução de venda de mercadoria',
  },
  {
    clienteId: null,
    cfopOrigem: '5353',
    cfopDestino: '1353',
    tipoOperacao: 'SAIDA_PARA_ENTRADA',
    descricao: 'Prestação para aquisição de transporte estadual',
  },
  {
    clienteId: null,
    cfopOrigem: '5401',
    cfopDestino: '1401',
    tipoOperacao: 'SAIDA_PARA_ENTRADA',
    descricao: 'Venda de produção ST para compra de produção ST',
  },
  {
    clienteId: null,
    cfopOrigem: '5403',
    cfopDestino: '1403',
    tipoOperacao: 'SAIDA_PARA_ENTRADA',
    descricao: 'Venda ST para compra destinada à comercialização ST',
  },
  {
    clienteId: null,
    cfopOrigem: '5405',
    cfopDestino: '1403',
    tipoOperacao: 'SAIDA_PARA_ENTRADA',
    descricao: 'Venda por substituído para compra com substituição tributária',
  },
  {
    clienteId: null,
    cfopOrigem: '5551',
    cfopDestino: '1551',
    tipoOperacao: 'SAIDA_PARA_ENTRADA',
    descricao: 'Venda para compra de ativo imobilizado',
  },
  {
    clienteId: null,
    cfopOrigem: '5556',
    cfopDestino: '1556',
    tipoOperacao: 'SAIDA_PARA_ENTRADA',
    descricao: 'Devolução para compra de material de uso ou consumo',
  },

  // Interestadual
  {
    clienteId: null,
    cfopOrigem: '6101',
    cfopDestino: '2101',
    tipoOperacao: 'SAIDA_PARA_ENTRADA',
    descricao:
      'Venda interestadual de produção para compra de industrialização',
  },
  {
    clienteId: null,
    cfopOrigem: '6102',
    cfopDestino: '2102',
    tipoOperacao: 'SAIDA_PARA_ENTRADA',
    descricao: 'Venda interestadual para compra de comercialização',
  },
  {
    clienteId: null,
    cfopOrigem: '6201',
    cfopDestino: '2201',
    tipoOperacao: 'SAIDA_PARA_ENTRADA',
    descricao: 'Devolução interestadual de compra para devolução de venda',
  },
  {
    clienteId: null,
    cfopOrigem: '6202',
    cfopDestino: '2202',
    tipoOperacao: 'SAIDA_PARA_ENTRADA',
    descricao: 'Devolução interestadual de compra para devolução de venda',
  },
  {
    clienteId: null,
    cfopOrigem: '6353',
    cfopDestino: '2353',
    tipoOperacao: 'SAIDA_PARA_ENTRADA',
    descricao: 'Prestação para aquisição de transporte interestadual',
  },
  {
    clienteId: null,
    cfopOrigem: '6401',
    cfopDestino: '2401',
    tipoOperacao: 'SAIDA_PARA_ENTRADA',
    descricao: 'Venda interestadual de produção ST para compra ST',
  },
  {
    clienteId: null,
    cfopOrigem: '6403',
    cfopDestino: '2403',
    tipoOperacao: 'SAIDA_PARA_ENTRADA',
    descricao: 'Venda interestadual ST para compra interestadual ST',
  },
  {
    clienteId: null,
    cfopOrigem: '6405',
    cfopDestino: '2405',
    tipoOperacao: 'SAIDA_PARA_ENTRADA',
    descricao: 'Venda interestadual por substituído para compra ST',
  },
  {
    clienteId: null,
    cfopOrigem: '6551',
    cfopDestino: '2551',
    tipoOperacao: 'SAIDA_PARA_ENTRADA',
    descricao: 'Venda interestadual para compra de ativo imobilizado',
  },
  {
    clienteId: null,
    cfopOrigem: '6556',
    cfopDestino: '2556',
    tipoOperacao: 'SAIDA_PARA_ENTRADA',
    descricao: 'Devolução interestadual para compra de uso ou consumo',
  },
];

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
    .then(() => process.stdout.write('Seed de CFOPs concluído.\n'))
    .catch((error: unknown) => {
      process.stderr.write(
        `Falha ao executar seed de CFOPs: ${error instanceof Error ? error.message : 'erro desconhecido'}\n`,
      );
      process.exitCode = 1;
    });
}
