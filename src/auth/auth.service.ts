import { Injectable } from '@nestjs/common';
import { eq, and, gt } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { session, user } from '../database/schema';
import type { CurrentUser, UserRole } from '../common/types';

@Injectable()
export class AuthService {
    constructor(private readonly database: DatabaseService) { }

    /**
     * Validates a session token from the Authorization header (Bearer token)
     * or from better-auth cookies. Returns the user if session is valid.
     */
    async validateSession(token: string): Promise<CurrentUser | null> {
        if (!token) return null;

        const now = new Date();
        const result = await this.database.db
            .select({
                userId: session.userId,
                userName: user.name,
                userEmail: user.email,
                userRole: user.role,
                expiresAt: session.expiresAt,
            })
            .from(session)
            .innerJoin(user, eq(session.userId, user.id))
            .where(and(eq(session.token, token), gt(session.expiresAt, now)))
            .limit(1);

        const row = result[0];
        if (!row) return null;

        return {
            id: row.userId,
            name: row.userName,
            email: row.userEmail,
            role: row.userRole as UserRole,
        };
    }

    /**
     * Hash password using bcrypt (same as better-auth default)
     */
    async hashPassword(password: string): Promise<string> {
        const bcrypt = await import('bcrypt');
        return bcrypt.hash(password, 10);
    }

    /**
     * Verify password against hash
     */
    async verifyPassword(password: string, hash: string): Promise<boolean> {
        const bcrypt = await import('bcrypt');
        return bcrypt.compare(password, hash);
    }
}
