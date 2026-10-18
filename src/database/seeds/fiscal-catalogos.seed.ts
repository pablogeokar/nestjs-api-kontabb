import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { fiscalCatalogosVersoes } from '../schema';

const UFS = [
  'AC',
  'AL',
  'AP',
  'AM',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MT',
  'MS',
  'MG',
  'PA',
  'PB',
  'PR',
  'PE',
  'PI',
  'RJ',
  'RN',
  'RS',
  'RO',
  'RR',
  'SC',
  'SP',
  'SE',
  'TO',
] as const;

/**
 * Catálogo mínimo que permite gerar o ajuste E111 do CIAP em um banco novo.
 *
 * Os códigos permanecem explicitamente marcados como pendentes de confirmação
 * fiscal. Este seed nunca atualiza uma vigência já cadastrada: um código
 * oficial ou uma revisão manual sempre prevalece sobre o default inicial.
 */
export const E111_CIAP_DEFAULT_SEED = UFS.map((uf) => ({
  tipo: 'E111_CIAP' as const,
  uf,
  codigo: `${uf}02CIAP`,
  descricao:
    'Crédito de ICMS do ativo permanente (CIAP - 1/48) — código DEFAULT pendente de confirmação do código estadual oficial.',
  fonte: 'default_pendente_confirmacao',
  vigenciaInicio: '2026-01-01',
  ativo: true,
}));

export async function seedFiscalCatalogos(databaseUrl: string) {
  const client = postgres(databaseUrl, { max: 1 });
  const database = drizzle(client);

  try {
    await database
      .insert(fiscalCatalogosVersoes)
      .values(E111_CIAP_DEFAULT_SEED)
      .onConflictDoNothing({
        target: [
          fiscalCatalogosVersoes.tipo,
          fiscalCatalogosVersoes.uf,
          fiscalCatalogosVersoes.vigenciaInicio,
        ],
      });
  } finally {
    await client.end({ timeout: 5 });
  }
}

if (require.main === module) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL não configurada.');

  void seedFiscalCatalogos(databaseUrl)
    .then(() =>
      process.stdout.write(
        `Seed de catálogos fiscais concluído: ${E111_CIAP_DEFAULT_SEED.length} códigos E111 do CIAP.\n`,
      ),
    )
    .catch((error: unknown) => {
      process.stderr.write(
        `Falha ao executar seed de catálogos fiscais: ${error instanceof Error ? error.message : 'erro desconhecido'}\n`,
      );
      process.exitCode = 1;
    });
}
