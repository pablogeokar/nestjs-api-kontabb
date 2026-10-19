import { Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service';
import { appRateLimits, controleNsu } from '../../database/schema';
import { extractDfeResponseMetadata } from './dfe-document.parser';

const HORA_MS = 60 * 60 * 1000;
const LIMITE_CHAVES = 20;

export class SefazConsultaAdiadaError extends Error {
  constructor(
    readonly motivo: 'LIMITE_LOCAL' | 'CONSUMO_INDEVIDO',
    readonly retryAt: Date,
  ) {
    super(
      `${motivo === 'LIMITE_LOCAL' ? 'Limite preventivo de 20 consultas por hora atingido' : 'Consultas suspensas por consumo indevido (656)'}. Próxima tentativa a partir de ${retryAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} (Brasília).`,
    );
    this.name = 'SefazConsultaAdiadaError';
  }
}

export function isConsumoIndevido(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /consumo indevido|\b656\b/i.test(message);
}

/** Slots persistidos evitam rajadas nas bordas da hora e sobrevivem a reinícios. */
@Injectable()
export class SefazConsultaControlService {
  constructor(private readonly database: DatabaseService) {}

  async consultar<T>(
    input: { cnpj: string; ambiente: number; porChave: boolean },
    action: () => Promise<T>,
  ): Promise<T> {
    const scope = `sefaz:nfe:${input.ambiente}:${input.cnpj.replace(/[^0-9A-Z]/gi, '').toUpperCase()}`;
    await this.reservar(scope, input);
    try {
      const result = await action();
      const metadata = extractDfeResponseMetadata(result);
      if (metadata.cStat === 656 || isConsumoIndevido(metadata.motivo)) {
        throw new Error('SEFAZ: consumo indevido (656).');
      }
      return result;
    } catch (error) {
      if (
        !isConsumoIndevido(error) ||
        error instanceof SefazConsultaAdiadaError
      )
        throw error;
      const retryAt = new Date(Date.now() + HORA_MS);
      await this.database.db
        .insert(appRateLimits)
        .values({
          key: `${scope}:bloqueio`,
          count: 1,
          resetAt: retryAt.getTime(),
        })
        .onConflictDoUpdate({
          target: appRateLimits.key,
          set: {
            resetAt: sql`greatest(${appRateLimits.resetAt}, ${retryAt.getTime()})`,
          },
        });
      throw new SefazConsultaAdiadaError('CONSUMO_INDEVIDO', retryAt);
    }
  }

  private async reservar(
    scope: string,
    input: { cnpj: string; porChave: boolean },
  ) {
    await this.database.db.transaction(async (tx) => {
      // Lock apenas durante a reserva; nenhuma conexão externa dentro da transação.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${scope}, 0))`,
      );
      const now = Date.now();
      const slots = Array.from(
        { length: LIMITE_CHAVES },
        (_, i) => `${scope}:chave:${i}`,
      );
      const rows = await tx
        .select()
        .from(appRateLimits)
        .where(inArray(appRateLimits.key, [`${scope}:bloqueio`, ...slots]));
      const bloqueio = rows.find(
        (row) => row.key === `${scope}:bloqueio` && row.resetAt > now,
      );
      if (bloqueio)
        throw new SefazConsultaAdiadaError(
          'CONSUMO_INDEVIDO',
          new Date(bloqueio.resetAt),
        );
      // Respeitar também bloqueios registrados pela sincronização anterior.
      const controles = await tx
        .select({ retryAt: controleNsu.proximaConsultaEm })
        .from(controleNsu)
        .where(
          and(
            eq(controleNsu.cnpj, input.cnpj),
            eq(controleNsu.tipoDocumento, 'NFE'),
            eq(controleNsu.statusSefaz, 656),
          ),
        );
      const retryAt = Math.max(
        0,
        ...controles.map((row) => row.retryAt?.getTime() ?? 0),
      );
      if (retryAt > now)
        throw new SefazConsultaAdiadaError(
          'CONSUMO_INDEVIDO',
          new Date(retryAt),
        );
      if (!input.porChave) return;
      const active = rows.filter(
        (row) => slots.includes(row.key) && row.resetAt > now,
      );
      const available = slots.find(
        (key) => !active.some((row) => row.key === key),
      );
      if (!available)
        throw new SefazConsultaAdiadaError(
          'LIMITE_LOCAL',
          new Date(Math.min(...active.map((row) => row.resetAt))),
        );
      await tx
        .insert(appRateLimits)
        .values({ key: available, count: 1, resetAt: now + HORA_MS })
        .onConflictDoUpdate({
          target: appRateLimits.key,
          set: { count: 1, resetAt: now + HORA_MS },
        });
    });
  }
}
