import { Injectable } from '@nestjs/common';
import { eq, and, gt } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { account, session, user } from '../database/schema';
import type { CurrentUser, UserRole } from '../common/types';

@Injectable()
export class AuthService {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Validates a session token from the Authorization header (Bearer token)
   * or from better-auth cookies. Returns the user if session is valid.
   *
   * better-auth stores the raw token directly in the session table.
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
   * Authenticate a user with email and password.
   * Returns the user record if credentials are valid, null otherwise.
   */
  async authenticateUser(
    email: string,
    password: string,
  ): Promise<{
    id: string;
    name: string;
    email: string;
    role: UserRole;
  } | null> {
    const result = await this.database.db
      .select({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        userRole: user.role,
        password: account.password,
      })
      .from(user)
      .innerJoin(
        account,
        and(eq(account.userId, user.id), eq(account.providerId, 'credential')),
      )
      .where(eq(user.email, email))
      .limit(1);

    const row = result[0];
    if (!row?.password) return null;

    const valid = await this.verifyPassword(password, row.password);
    if (!valid) return null;

    return {
      id: row.userId,
      name: row.userName,
      email: row.userEmail,
      role: row.userRole as UserRole,
    };
  }

  /**
   * Create a new session in the database.
   */
  async createSession(input: {
    id: string;
    token: string;
    userId: string;
    expiresAt: Date;
    ipAddress: string | null;
    userAgent: string | null;
  }): Promise<void> {
    await this.database.db.insert(session).values({
      id: input.id,
      token: input.token,
      userId: input.userId,
      expiresAt: input.expiresAt,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
  }

  /**
   * Revoke (delete) a session by token.
   */
  async revokeSession(token: string): Promise<void> {
    await this.database.db.delete(session).where(eq(session.token, token));
  }

  /**
   * Change a user's password after verifying the current one.
   */
  async changePassword(input: {
    userId: string;
    currentPassword: string;
    newPassword: string;
  }): Promise<{ ok: boolean }> {
    const [acc] = await this.database.db
      .select({ password: account.password })
      .from(account)
      .where(
        and(
          eq(account.userId, input.userId),
          eq(account.providerId, 'credential'),
        ),
      )
      .limit(1);

    if (!acc?.password) return { ok: false };

    const valid = await this.verifyPassword(
      input.currentPassword,
      acc.password,
    );
    if (!valid) return { ok: false };

    const newHash = await this.hashPassword(input.newPassword);
    await this.database.db
      .update(account)
      .set({ password: newHash, updatedAt: new Date() })
      .where(
        and(
          eq(account.userId, input.userId),
          eq(account.providerId, 'credential'),
        ),
      );

    return { ok: true };
  }

  /**
   * Hash password using scrypt (compatible with better-auth).
   * Format: "salt:derivedKey" where salt is 16 random bytes hex-encoded,
   * and derivedKey is 64 bytes hex-encoded.
   * Parameters: N=16384, r=16, p=1.
   */
  async hashPassword(password: string): Promise<string> {
    const { scrypt, randomBytes } = await import('crypto');
    return new Promise((resolve, reject) => {
      const salt = randomBytes(16).toString('hex');
      scrypt(
        password.normalize('NFKC'),
        salt,
        64,
        { N: 16384, r: 16, p: 1, maxmem: 128 * 16384 * 16 * 2 },
        (err, key) => {
          if (err) reject(err);
          else resolve(`${salt}:${key.toString('hex')}`);
        },
      );
    });
  }

  /**
   * Verify password against hash.
   * Supports both scrypt format ("salt:hash") from better-auth
   * and bcrypt format ("$2b$..." or "$2a$...") for backward compatibility.
   */
  async verifyPassword(password: string, hash: string): Promise<boolean> {
    // Detect bcrypt hashes (start with $2a$ or $2b$)
    if (hash.startsWith('$2a$') || hash.startsWith('$2b$')) {
      const bcrypt = await import('bcrypt');
      return bcrypt.compare(password, hash);
    }

    // scrypt format: "salt:derivedKeyHex"
    const separatorIndex = hash.indexOf(':');
    if (separatorIndex === -1) return false;

    const salt = hash.slice(0, separatorIndex);
    const storedKey = hash.slice(separatorIndex + 1);

    const { scrypt, timingSafeEqual } = await import('crypto');
    return new Promise((resolve, reject) => {
      scrypt(
        password.normalize('NFKC'),
        salt,
        64,
        { N: 16384, r: 16, p: 1, maxmem: 128 * 16384 * 16 * 2 },
        (err, derivedKey) => {
          if (err) {
            reject(err);
            return;
          }
          const storedBuffer = Buffer.from(storedKey, 'hex');
          if (storedBuffer.length !== derivedKey.length) {
            resolve(false);
            return;
          }
          resolve(timingSafeEqual(derivedKey, storedBuffer));
        },
      );
    });
  }
}
