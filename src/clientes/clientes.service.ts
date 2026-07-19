import { Injectable } from '@nestjs/common';
import { asc, eq, ilike, inArray, like, or, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { clientes } from '../database/schema';
import { resultRows } from '../common/db-result';
import { AppLogger } from '../common/logger.service';
import { StorageCleanupService } from '../storage/storage-cleanup.service';
import type { PaginationParams } from '../common/types';
import { AuthService } from '../auth/auth.service';

@Injectable()
export class ClientesService {
    constructor(
        private readonly database: DatabaseService,
        private readonly logger: AppLogger,
        private readonly storageCleanup: StorageCleanupService,
        private readonly authService: AuthService,
    ) { }

    async listClients(input: { search: string; pagination: PaginationParams }) {
        const searchDigits = input.search.replace(/\D/g, '');
        const where = input.search
            ? or(
                ilike(clientes.razaoSocial, `%${input.search}%`),
                ilike(clientes.cnpj, `%${searchDigits}%`),
                ilike(clientes.cpf, `%${searchDigits}%`),
            )
            : undefined;

        const [countResult, rows] = await Promise.all([
            this.database.db.select({ count: sql<number>`count(*)` }).from(clientes).where(where),
            this.database.db
                .select({
                    id: clientes.id,
                    tipoPessoa: clientes.tipoPessoa,
                    cnpj: clientes.cnpj,
                    cpf: clientes.cpf,
                    companyName: clientes.razaoSocial,
                    emails: clientes.emails,
                    isFirstLogin: clientes.primeiroLogin,
                    authUserId: clientes.userId,
                    createdAt: clientes.criadoEm,
                })
                .from(clientes)
                .where(where)
                .orderBy(asc(clientes.razaoSocial))
                .limit(input.pagination.limit)
                .offset(input.pagination.offset),
        ]);

        return {
            total: Number(countResult[0]?.count ?? 0),
            data: rows.map((client) => ({
                id: client.id,
                tipo_pessoa: client.tipoPessoa,
                cnpj: client.cnpj,
                cpf: client.cpf,
                company_name: client.companyName,
                emails: client.emails ?? [],
                is_first_login: client.isFirstLogin,
                auth_user_id: client.authUserId,
                created_at: client.createdAt.toISOString(),
            })),
        };
    }

    async registerClient(input: {
        requestId?: string;
        actorUserId: string;
        tipoPessoa: 'PF' | 'PJ';
        companyName: string;
        cnpj: string;
        cpf: string;
        emails: string[];
    }) {
        const authIdentifier = input.tipoPessoa === 'PF' ? input.cpf : input.cnpj;
        const authEmail = `${authIdentifier}@kontabb.local`;
        const hashedPassword = await this.authService.hashPassword('123456');
        const authUserId = crypto.randomUUID();

        try {
            // Create auth user + account directly (matching better-auth structure)
            const emails = this.textArray(input.emails);
            const cnpjValue = input.tipoPessoa === 'PF' ? input.cpf : input.cnpj;
            const cpfValue = input.tipoPessoa === 'PF' ? input.cpf : null;
            const result = await this.database.db.execute(sql`
        WITH inserted_user AS (
          INSERT INTO "user" (id, name, email, email_verified, role, created_at, updated_at)
          VALUES (${authUserId}, ${input.companyName}, ${authEmail}, false, 'CLIENTE', now(), now())
          RETURNING id
        ),
        inserted_account AS (
          INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at)
          SELECT
            gen_random_uuid()::text,
            id,
            'credential',
            id,
            ${hashedPassword},
            now(),
            now()
          FROM inserted_user
          RETURNING user_id
        ),
        inserted_client AS (
          INSERT INTO clientes (tipo_pessoa, razao_social, cnpj, cpf, emails, primeiro_login, user_id)
          SELECT ${input.tipoPessoa}, ${input.companyName}, ${cnpjValue}, ${cpfValue}, ${emails}, true, id
          FROM inserted_user
          RETURNING id
        ),
        audit_event AS (
          INSERT INTO eventos_auditoria (ator_user_id, acao, entidade_tipo, entidade_id, dados)
          SELECT ${input.actorUserId}, 'CLIENTE_CRIADO', 'CLIENTE', id::text,
            jsonb_build_object('tipoPessoa', ${input.tipoPessoa}::text)
          FROM inserted_client
          RETURNING id
        )
        SELECT id::text AS client_id FROM inserted_client
      `);

            const clientId = resultRows<{ client_id: string }>(result)[0]?.client_id;
            if (!clientId) throw new Error('CLIENT_INSERT_FAILED');
            return { ok: true as const, clientId };
        } catch (error: any) {
            this.logger.error('client_creation_failed', error, {
                requestId: input.requestId,
                userId: input.actorUserId,
                operation: 'client_creation',
            });
            if (this.isUniqueViolation(error)) {
                return { ok: false as const, code: 'DUPLICATE' };
            }
            return { ok: false as const, code: 'DATABASE_FAILED' };
        }
    }

    async updateClient(input: {
        clientId: string;
        actorUserId: string;
        companyName?: string;
        emails?: string[];
    }) {
        const emails = input.emails ? this.textArray(input.emails) : sql`NULL::text[]`;
        const result = await this.database.db.execute(sql`
      WITH updated_client AS (
        UPDATE clientes
        SET
          razao_social = COALESCE(${input.companyName ?? null}::text, razao_social),
          emails = COALESCE(${emails}, emails)
        WHERE id = ${input.clientId}::uuid
        RETURNING id
      ),
      audit_event AS (
        INSERT INTO eventos_auditoria (ator_user_id, acao, entidade_tipo, entidade_id)
        SELECT ${input.actorUserId}, 'CLIENTE_ATUALIZADO', 'CLIENTE', id::text
        FROM updated_client
        RETURNING id
      )
      SELECT EXISTS (SELECT 1 FROM updated_client) AS updated
    `);
        return Boolean(resultRows<{ updated: boolean }>(result)[0]?.updated);
    }

    async deleteClient(input: { requestId?: string; clientId: string; actorUserId: string }) {
        const result = await this.database.db.execute(sql`
      WITH target_client AS MATERIALIZED (
        SELECT id, user_id, razao_social FROM clientes WHERE id = ${input.clientId}::uuid FOR UPDATE
      ),
      target_files AS MATERIALIZED (
        SELECT d.id, d.arquivo_key, d.comprovante_key
        FROM documentos d INNER JOIN target_client c ON c.id = d.cliente_id
      ),
      deleted_client AS (
        DELETE FROM clientes c USING target_client target WHERE c.id = target.id
        RETURNING c.id, c.user_id, c.razao_social
      ),
      deleted_user AS (
        DELETE FROM "user" u USING deleted_client client WHERE u.id = client.user_id RETURNING u.id
      ),
      candidate_keys AS (
        SELECT id, arquivo_key AS object_key FROM target_files
        UNION ALL
        SELECT id, comprovante_key FROM target_files WHERE comprovante_key IS NOT NULL
      ),
      cleanup_jobs AS (
        INSERT INTO storage_cleanup_jobs (object_key, entidade_tipo, entidade_id)
        SELECT keys.object_key, 'DOCUMENTO', keys.id::text FROM candidate_keys keys
        WHERE EXISTS (SELECT 1 FROM deleted_client)
        ON CONFLICT (object_key) DO NOTHING
        RETURNING id
      ),
      audit_event AS (
        INSERT INTO eventos_auditoria (ator_user_id, acao, entidade_tipo, entidade_id, dados)
        SELECT ${input.actorUserId}, 'CLIENTE_EXCLUIDO', 'CLIENTE', id::text,
          jsonb_build_object('razaoSocial', razao_social, 'authUserRemovido', user_id IS NOT NULL, 'motivo', 'EXCLUSAO_ADMINISTRATIVA')
        FROM deleted_client
        RETURNING id
      )
      SELECT
        EXISTS (SELECT 1 FROM deleted_client) AS deleted,
        COALESCE((SELECT array_agg(id::text) FROM cleanup_jobs), ARRAY[]::text[]) AS job_ids
    `);

        const row = resultRows<{ deleted: boolean; job_ids: string[] | null }>(result)[0];
        if (!row?.deleted) return { deleted: false, cleanupPending: 0 };

        const cleanup = await this.storageCleanup.processJobs(row.job_ids ?? [], {
            requestId: input.requestId,
            userId: input.actorUserId,
            trigger: 'deletion',
        });
        return { deleted: true, cleanupPending: cleanup.failed };
    }

    async getClientForUser(userId: string) {
        const result = await this.database.db
            .select({
                id: clientes.id,
                companyName: clientes.razaoSocial,
                cnpj: clientes.cnpj,
                primeiroLogin: clientes.primeiroLogin,
            })
            .from(clientes)
            .where(eq(clientes.userId, userId))
            .limit(1);
        return result[0];
    }

    async getClientSummary(clientId: string) {
        const result = await this.database.db
            .select({
                id: clientes.id,
                tipoPessoa: clientes.tipoPessoa,
                cnpj: clientes.cnpj,
                cpf: clientes.cpf,
                razaoSocial: clientes.razaoSocial,
            })
            .from(clientes)
            .where(eq(clientes.id, clientId))
            .limit(1);
        const client = result[0];
        if (!client) return undefined;
        return {
            id: client.id,
            tipo_pessoa: client.tipoPessoa,
            cnpj: client.cnpj,
            cpf: client.cpf,
            company_name: client.razaoSocial,
        };
    }

    async findClientForUpload(identifier: string) {
        if (
            identifier.length !== 14 &&
            identifier.length !== 11 &&
            identifier.length !== 8
        ) {
            return undefined;
        }
        const where =
            identifier.length === 11
                ? eq(clientes.cpf, identifier)
                : identifier.length === 14
                    ? eq(clientes.cnpj, identifier)
                    : like(clientes.cnpj, `${identifier}%`);
        const result = await this.database.db
            .select({ id: clientes.id, cnpj: clientes.cnpj, razaoSocial: clientes.razaoSocial, emails: clientes.emails })
            .from(clientes)
            .where(where)
            .limit(1);
        return result[0];
    }

    async findRegisteredCnpjs(cnpjs: string[]) {
        const fullCnpjs = cnpjs.filter((c) => c.length === 14);
        const rootCnpjs = cnpjs.filter((c) => c.length === 8);
        const fullRows = (fullCnpjs.length
            ? await this.database.db
                .select({ cnpj: clientes.cnpj })
                .from(clientes)
                .where(inArray(clientes.cnpj, fullCnpjs))
            : []) as Array<{ cnpj: string }>;
        const rootRows = await Promise.all(
            rootCnpjs.map(async (root) => {
                const result = await this.database.db
                    .select({ cnpj: clientes.cnpj })
                    .from(clientes)
                    .where(like(clientes.cnpj, `${root}%`))
                    .limit(1);
                return result[0] ? root : null;
            }),
        );
        return new Set([
            ...fullRows.map((r) => r.cnpj),
            ...rootRows.filter((r): r is string => Boolean(r)),
        ]);
    }

    private textArray(values: string[]) {
        if (!values.length) return sql`ARRAY[]::text[]`;
        return sql`ARRAY[${sql.join(values.map((v) => sql`${v}`), sql`, `)}]::text[]`;
    }

    private isUniqueViolation(error: unknown) {
        const candidate = error as { code?: string; cause?: { code?: string } } | null;
        return candidate?.code === '23505' || candidate?.cause?.code === '23505';
    }
}
