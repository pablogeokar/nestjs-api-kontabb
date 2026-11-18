import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { fiscalSimplesBeneficios } from '../schema';
import {
  BENEFICIO_BA_2026,
  regrasBeneficioConflitam,
} from '../../fiscal/services/simples-beneficios';
import { and, eq, sql } from 'drizzle-orm';

// Não sobrescreve parametrizações ou revisões feitas pelo contador.
export async function seedSimplesBeneficios(databaseUrl: string) {
  const client = postgres(databaseUrl, { max: 1 });
  try {
    await drizzle(client).transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended('simples-beneficios', 0))`,
      );
      const regras = await tx
        .select()
        .from(fiscalSimplesBeneficios)
        .where(
          and(
            eq(fiscalSimplesBeneficios.uf, 'BA'),
            eq(fiscalSimplesBeneficios.atual, true),
          ),
        );
      const inicial = { ...BENEFICIO_BA_2026, id: '', versao: 1, atual: true };
      if (
        regras.some(
          (regra) =>
            regra.codigo === inicial.codigo ||
            regrasBeneficioConflitam(regra, inicial),
        )
      )
        return;
      await tx
        .insert(fiscalSimplesBeneficios)
        .values(BENEFICIO_BA_2026)
        .onConflictDoNothing();
    });
  } finally {
    await client.end();
  }
}
if (require.main === module) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL não configurada.');
  void seedSimplesBeneficios(url)
    .then(() =>
      process.stdout.write(
        'Benefício ICMS-BA 2026 cadastrado; regras existentes preservadas.\n',
      ),
    )
    .catch(() => {
      process.stderr.write(
        'Falha no seed de benefícios. Confira a migration e a conexão.\n',
      );
      process.exitCode = 1;
    });
}
