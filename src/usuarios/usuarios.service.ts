import { Injectable } from '@nestjs/common';
import { and, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { account, user } from '../database/schema';
import { AuthService } from '../auth/auth.service';
import { AppLogger } from '../common/logger.service';
import { resultRows } from '../common/db-result';
import type { PaginationParams } from '../common/types';

@Injectable()
export class UsuariosService {
    constructor(
        private readonly database: DatabaseService,
        private readonly authService: AuthService,
        private readonly logger: AppLogger,
    ) { }

    async listSystemUsers(input: { role: string; search: string; pagination: PaginationParams }) {
        const conditions: SQL[] = [];
        if (input.role) conditions.push(eq(user.role, input.role));
        if (input.search) {
            conditions.push(or(ilike(user.name, `%${input.search}%`), ilike(user.email, `%${input.search}%`))!);
        }
        const where = conditions.length ? and(...conditions) : undefined;

        const [countResult, data] = await Promise.all([
            this.database.db.select({ count: sql<number>`count(*)` }).from(user).where(where),
            this.database.db
                .select({ id: user.id, name: user.name, email: user.email, role: user.role, createdAt: user.createdAt })
                .from(user)
                .where(where)
                .orderBy(user.name)
                .limit(input.pagination.limit)
                .offset(input.pagination.offset),
        ]);

        return {
            data: data.map((u) => ({ ...u, createdAt: u.createdAt.toISOString() })),
            total: Number(countResult[0]?.count ?? 0),
        };
    }

    async existsByEmail(email: string) {
        const result = await this.database.db.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1);
        return Boolean(result[0]);
    }

    async createSystemUser(input: {
        actorUserId: string;
        requestId?: string;
        name: string;
        email: string;
        password: string;
        role: string;
    }) {
        const hashedPassword = await this.authService.hashPassword(input.password);
        const userId = crypto.randomUUID();

        try {
            const result = await this.database.db.execute(sql`
        WITH inserted_user AS (
          INSERT INTO "user" (id, name, email, email_verified, role, created_at, updated_at)
          VALUES (${userId}, ${input.name}, ${input.email}, false, ${input.role}, now(), now())
          RETURNING id
        ),
        inserted_account AS (
          INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at)
          SELECT gen_random_uuid()::text, id, 'credential', id, ${hashedPassword}, now(), now()
          FROM inserted_user
          RETURNING user_id
        ),
        audit_event AS (
          INSERT INTO eventos_auditoria (ator_user_id, acao, entidade_tipo, entidade_id, dados)
          SELECT ${input.actorUserId}, 'USUARIO_CRIADO', 'USUARIO', id, jsonb_build_object('role', ${input.role}::text)
          FROM inserted_user
          RETURNING id
        )
        SELECT EXISTS (SELECT 1 FROM inserted_user) AS created
      `);
            if (!resultRows<{ created: boolean }>(result)[0]?.created) {
                throw new Error('USER_INSERT_FAILED');
            }
            return { ok: true as const, userId };
        } catch (error: any) {
            if (this.isUniqueViolation(error)) return { ok: false as const, code: 'DUPLICATE' };
            this.logger.error('system_user_creation_failed', error, { requestId: input.requestId });
            return { ok: false as const, code: 'DATABASE_FAILED' };
        }
    }

    async updateSystemUser(input: { userId: string; actorUserId: string; name?: string; role?: string }) {
        const result = await this.database.db.execute(sql`
      WITH updated_user AS (
        UPDATE "user" SET
          name = COALESCE(${input.name ?? null}::text, name),
          role = COALESCE(${input.role ?? null}::text, role),
          updated_at = now()
        WHERE id = ${input.userId}
        RETURNING id
      ),
      audit_event AS (
        INSERT INTO eventos_auditoria (ator_user_id, acao, entidade_tipo, entidade_id, dados)
        SELECT ${input.actorUserId}, 'USUARIO_ATUALIZADO', 'USUARIO', id,
          jsonb_strip_nulls(jsonb_build_object('novaRole', ${input.role ?? null}::text))
        FROM updated_user
        RETURNING id
      )
      SELECT EXISTS (SELECT 1 FROM updated_user) AS updated
    `);
        return Boolean(resultRows<{ updated: boolean }>(result)[0]?.updated);
    }

    async deleteSystemUser(input: { userId: string; actorUserId: string }) {
        const result = await this.database.db.execute(sql`
      WITH deleted_user AS (
        DELETE FROM "user" WHERE id = ${input.userId} RETURNING id
      ),
      audit_event AS (
        INSERT INTO eventos_auditoria (ator_user_id, acao, entidade_tipo, entidade_id)
        SELECT ${input.actorUserId}, 'USUARIO_EXCLUIDO', 'USUARIO', id FROM deleted_user
        RETURNING id
      )
      SELECT EXISTS (SELECT 1 FROM deleted_user) AS deleted
    `);
        return Boolean(resultRows<{ deleted: boolean }>(result)[0]?.deleted);
    }

    async changePassword(input: { userId: string; actorUserId: string; password: string }) {
        const hashedPassword = await this.authService.hashPassword(input.password);
        const result = await this.database.db.execute(sql`
      WITH updated_account AS (
        UPDATE account SET password = ${hashedPassword}, updated_at = now()
        WHERE user_id = ${input.userId} AND provider_id = 'credential'
        RETURNING user_id
      ),
      audit_event AS (
        INSERT INTO eventos_auditoria (ator_user_id, acao, entidade_tipo, entidade_id)
        SELECT ${input.actorUserId}, 'SENHA_ADMINISTRATIVA_ALTERADA', 'USUARIO', user_id FROM updated_account
        RETURNING id
      )
      SELECT EXISTS (SELECT 1 FROM updated_account) AS updated
    `);
        return Boolean(resultRows<{ updated: boolean }>(result)[0]?.updated);
    }

    private isUniqueViolation(error: unknown) {
        const candidate = error as { code?: string; cause?: { code?: string } } | null;
        return candidate?.code === '23505' || candidate?.cause?.code === '23505';
    }
}
