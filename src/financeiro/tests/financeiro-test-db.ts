import { randomInt } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { inArray } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service';
import {
  clientes,
  eventosAuditoria,
  financeiroFaturas,
} from '../../database/schema';
import { seedFinanceiroTipos } from '../../database/seeds/financeiro-tipos.seed';

/** Carrega .env quando DATABASE_URL não está definida (execução local do jest). */
export function loadDatabaseUrl(): string | undefined {
  if (!process.env.DATABASE_URL) {
    try {
      const content = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
      const match = content.match(/^DATABASE_URL=(.+)$/m);
      if (match)
        process.env.DATABASE_URL = match[1].trim().replace(/^["']|["']$/g, '');
    } catch {
      // sem .env: os testes dependentes de banco serão ignorados
    }
  }
  return process.env.DATABASE_URL;
}

export function createTestDatabase(url: string) {
  const config = { getOrThrow: () => url };
  return new DatabaseService(config as never);
}

export const testLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  generateRequestId: () => 'test-request',
};

export async function prepararTipos(url: string) {
  await seedFinanceiroTipos(url);
}

export async function criarClienteTeste(database: DatabaseService) {
  const cnpj = String(randomInt(10 ** 13, 10 ** 14 - 1)).padStart(14, '9');
  const [cliente] = await database.db
    .insert(clientes)
    .values({ cnpj, razaoSocial: `Cliente Teste Financeiro ${cnpj}` })
    .returning({ id: clientes.id });
  return cliente.id;
}

/** Remove clientes de teste (cascata remove contratos, faturas, lançamentos e baixas). */
export async function limparClientes(
  database: DatabaseService,
  clienteIds: string[],
) {
  if (clienteIds.length === 0) return;
  const faturas = await database.db
    .select({ id: financeiroFaturas.id })
    .from(financeiroFaturas)
    .where(inArray(financeiroFaturas.clienteId, clienteIds));
  if (faturas.length) {
    await database.db.delete(eventosAuditoria).where(
      inArray(
        eventosAuditoria.entidadeId,
        faturas.map((f) => f.id),
      ),
    );
  }
  await database.db.delete(clientes).where(inArray(clientes.id, clienteIds));
}
