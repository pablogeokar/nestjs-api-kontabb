import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { financeiroTiposLancamento } from '../schema';

export const DEFAULT_TIPOS_FINANCEIRO = [
  {
    codigo: 'MENSALIDADE',
    nome: 'Honorários Mensais Contábeis',
    descricao:
      'Mensalidade contratual padrão de serviços contábeis e fiscais recorrentes.',
    natureza: 'DEBITO' as const,
    permiteAvulso: false,
    ativo: true,
  },
  {
    codigo: 'ENCERRAMENTO_EXERCICIO',
    nome: 'Mensalidade de Encerramento de Exercício (13º)',
    descricao:
      'Honorário adicional de encerramento do exercício social, fechamento de balanço e conciliação anual.',
    natureza: 'DEBITO' as const,
    permiteAvulso: true,
    ativo: true,
  },
  {
    codigo: 'DECLARACAO_IRPF',
    nome: 'Declaração de Imposto de Renda (IRPF)',
    descricao:
      'Elaboração e transmissão da Declaração de Ajuste Anual IRPF para sócios ou avulsos.',
    natureza: 'DEBITO' as const,
    permiteAvulso: true,
    ativo: true,
  },
  {
    codigo: 'EMISSAO_CERTIDOES',
    nome: 'Emissão de Certidões Negativas',
    descricao:
      'Emissão e regularização de CNDs Federal, Estadual, Municipal, FGTS e Trabalhista.',
    natureza: 'DEBITO' as const,
    permiteAvulso: true,
    ativo: true,
  },
  {
    codigo: 'LEGALIZACAO_EMPRESAS',
    nome: 'Legalização e Alteração Contratual',
    descricao:
      'Serviços de alteração de contrato social, quadro societário, endereço ou atividade econômica.',
    natureza: 'DEBITO' as const,
    permiteAvulso: true,
    ativo: true,
  },
  {
    codigo: 'ABERTURA_EMPRESAS',
    nome: 'Abertura e Constituição de Empresas',
    descricao:
      'Processo completo de constituição, registro na Junta Comercial, CNPJ, Inscrições e Alvarás.',
    natureza: 'DEBITO' as const,
    permiteAvulso: true,
    ativo: true,
  },
  {
    codigo: 'DECLARACOES_DIVERSAS',
    nome: 'Declarações e Obrigações Diversas',
    descricao:
      'Elaboração de declarações e obrigações extraordinárias solicitadas pelo cliente.',
    natureza: 'DEBITO' as const,
    permiteAvulso: true,
    ativo: true,
  },
  {
    codigo: 'DESCONTO_ABATIMENTO',
    nome: 'Desconto / Abatimento Comercial',
    descricao: 'Crédito ou dedução comercial concedida na fatura do cliente.',
    natureza: 'CREDITO' as const,
    permiteAvulso: true,
    ativo: true,
  },
  {
    codigo: 'TAXAS_ORGAOS_PUBLICOS',
    nome: 'Reembolso de Taxas de Órgãos Públicos',
    descricao:
      'Cobrança referente a custas e taxas de juntas, prefeituras ou órgãos pagas pelo escritório.',
    natureza: 'DEBITO' as const,
    permiteAvulso: true,
    ativo: true,
  },
];

export async function seedFinanceiroTipos(databaseUrl: string) {
  const client = postgres(databaseUrl, { max: 1 });
  const db = drizzle(client);

  try {
    for (const item of DEFAULT_TIPOS_FINANCEIRO) {
      await db
        .insert(financeiroTiposLancamento)
        .values(item)
        .onConflictDoUpdate({
          target: financeiroTiposLancamento.codigo,
          set: {
            nome: item.nome,
            descricao: item.descricao,
            natureza: item.natureza,
            permiteAvulso: item.permiteAvulso,
            atualizadoEm: sql`NOW()`,
          },
        });
    }
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL não configurada.');

  void seedFinanceiroTipos(databaseUrl)
    .then(() =>
      process.stdout.write(
        'Seed de tipos financeiros executado com sucesso.\n',
      ),
    )
    .catch((err) => {
      process.stderr.write(`Erro no seed: ${String(err)}\n`);
      process.exitCode = 1;
    });
}
