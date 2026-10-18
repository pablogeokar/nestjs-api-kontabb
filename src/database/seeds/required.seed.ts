import { seedFiscalCatalogos } from './fiscal-catalogos.seed';
import { seedSimplesNacional } from './simples-nacional.seed';

/**
 * Inicializa os catálogos exigidos pelo restore data-only atual. O backup já
 * contém CFOPs e equivalências, por isso eles não são regravados aqui. Os
 * seeds individuais continuam disponíveis para ambientes sem restore.
 */
export async function seedRequiredData(databaseUrl: string) {
  await seedFiscalCatalogos(databaseUrl);
  await seedSimplesNacional(databaseUrl);
}

if (require.main === module) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL não configurada.');

  void seedRequiredData(databaseUrl)
    .then(() =>
      process.stdout.write(
        'Seeds obrigatórios concluídos: catálogos fiscais e Simples Nacional.\n',
      ),
    )
    .catch((error: unknown) => {
      process.stderr.write(
        `Falha ao executar os seeds obrigatórios: ${error instanceof Error ? error.message : 'erro desconhecido'}\n`,
      );
      process.exitCode = 1;
    });
}
