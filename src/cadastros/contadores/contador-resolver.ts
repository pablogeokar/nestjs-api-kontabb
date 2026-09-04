import { asc, eq } from 'drizzle-orm';
import { contadores } from '../../database/schema';
import type { DatabaseService } from '../../database/database.service';

export type ContadorResolucaoOrigem = 'VINCULO_EXPLICITO' | 'CONTADOR_UNICO';

type DatabaseExecutor =
  | DatabaseService['db']
  | Parameters<Parameters<DatabaseService['db']['transaction']>[0]>[0];

export async function resolverContadorDoCliente(
  db: DatabaseExecutor,
  contadorId: string | null,
) {
  const selection = {
    id: contadores.id,
    nome: contadores.nome,
    cpf: contadores.cpf,
    crc: contadores.crc,
    cnpj: contadores.cnpj,
    cep: contadores.cep,
    logradouro: contadores.logradouro,
    numero: contadores.numero,
    complemento: contadores.complemento,
    bairro: contadores.bairro,
    telefone: contadores.telefone,
    fax: contadores.fax,
    email: contadores.email,
    codigoMunicipioIbge: contadores.codigoMunicipioIbge,
  } as const;

  if (contadorId) {
    const rows = await db
      .select(selection)
      .from(contadores)
      .where(eq(contadores.id, contadorId))
      .limit(1);
    return rows[0]
      ? { contador: rows[0], origem: 'VINCULO_EXPLICITO' as const }
      : null;
  }

  const rows = await db
    .select(selection)
    .from(contadores)
    .orderBy(asc(contadores.nome), asc(contadores.id))
    .limit(2);
  return rows.length === 1
    ? { contador: rows[0], origem: 'CONTADOR_UNICO' as const }
    : null;
}
