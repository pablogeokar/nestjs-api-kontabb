import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { account, clientes } from '../database/schema';
import { AuthService } from '../auth/auth.service';
import { AppLogger } from '../common/logger.service';

export type CompleteFirstLoginResult =
    | { ok: true }
    | { ok: false; code: 'CLIENT_NOT_FOUND' | 'ALREADY_COMPLETED' | 'INVALID_PASSWORD' };

@Injectable()
export class ClienteService {
    constructor(
        private readonly database: DatabaseService,
        private readonly authService: AuthService,
        private readonly logger: AppLogger,
    ) { }

    async completeFirstLogin(input: {
        requestId?: string;
        userId: string;
        currentPassword: string;
        newPassword: string;
    }): Promise<CompleteFirstLoginResult> {
        const [client] = await this.database.db
            .select({ id: clientes.id, primeiroLogin: clientes.primeiroLogin })
            .from(clientes)
            .where(eq(clientes.userId, input.userId))
            .limit(1);

        if (!client) return { ok: false, code: 'CLIENT_NOT_FOUND' };
        if (!client.primeiroLogin) return { ok: false, code: 'ALREADY_COMPLETED' };

        // Verify current password
        const [acc] = await this.database.db
            .select({ password: account.password })
            .from(account)
            .where(and(eq(account.userId, input.userId), eq(account.providerId, 'credential')))
            .limit(1);

        if (!acc?.password) return { ok: false, code: 'INVALID_PASSWORD' };

        const valid = await this.authService.verifyPassword(input.currentPassword, acc.password);
        if (!valid) return { ok: false, code: 'INVALID_PASSWORD' };

        // Update password
        const newHash = await this.authService.hashPassword(input.newPassword);
        await this.database.db
            .update(account)
            .set({ password: newHash, updatedAt: new Date() })
            .where(and(eq(account.userId, input.userId), eq(account.providerId, 'credential')));

        // Mark first login as complete
        const updated = await this.database.db
            .update(clientes)
            .set({ primeiroLogin: false })
            .where(and(eq(clientes.id, client.id), eq(clientes.primeiroLogin, true)))
            .returning();

        if (updated.length === 0) {
            this.logger.warn('first_login_flag_update_failed', {
                requestId: input.requestId,
                userId: input.userId,
                entityType: 'CLIENTE',
                entityId: client.id,
            });
        }

        this.logger.info('first_login_completed', {
            requestId: input.requestId,
            userId: input.userId,
            entityType: 'CLIENTE',
            entityId: client.id,
            operation: 'first_login',
            result: 'success',
        });

        return { ok: true };
    }
}
