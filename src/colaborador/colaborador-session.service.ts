import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import type { Request, Response } from 'express';

const COOKIE_NAME = 'kontabb-colaborador-session';
const SECURE_COOKIE_NAME = '__Secure-kontabb-colaborador-session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

export interface ColaboradorTokenPayload {
  funcionarioId: string;
  clienteId: string;
  codigoFuncionario: string;
  nomeCompleto: string;
  cargo: string | null;
  cnpj: string;
  razaoSocial: string;
  primeiroAcesso: boolean;
  exp: number;
}

@Injectable()
export class ColaboradorSessionService {
  private readonly secret: string;
  private readonly isProduction: boolean;

  constructor(configService: ConfigService) {
    this.secret = configService.getOrThrow<string>('BETTER_AUTH_SECRET');
    this.isProduction = configService.get<string>('NODE_ENV') === 'production';
  }

  /**
   * Create a signed session token for the employee.
   */
  createToken(payload: Omit<ColaboradorTokenPayload, 'exp'>): string {
    const tokenPayload: ColaboradorTokenPayload = {
      ...payload,
      exp: Date.now() + SESSION_TTL_MS,
    };
    const json = JSON.stringify(tokenPayload);
    const encoded = Buffer.from(json).toString('base64url');
    const signature = this.sign(encoded);
    return `${encoded}.${signature}`;
  }

  /**
   * Verify and decode a session token.
   */
  verifyToken(token: string): ColaboradorTokenPayload | null {
    const dotIndex = token.lastIndexOf('.');
    if (dotIndex < 1) return null;

    const encoded = token.slice(0, dotIndex);
    const signature = token.slice(dotIndex + 1);

    // Verify signature
    const expectedSignature = this.sign(encoded);
    const receivedBuf = Buffer.from(signature, 'base64url');
    const expectedBuf = Buffer.from(expectedSignature, 'base64url');

    if (
      receivedBuf.length !== expectedBuf.length ||
      !timingSafeEqual(receivedBuf, expectedBuf)
    ) {
      return null;
    }

    try {
      const json = Buffer.from(encoded, 'base64url').toString('utf-8');
      const payload = JSON.parse(json) as ColaboradorTokenPayload;

      // Check expiration
      if (payload.exp < Date.now()) return null;

      return payload;
    } catch {
      return null;
    }
  }

  /**
   * Extract the token from the request (cookie or Authorization header).
   */
  extractFromRequest(request: Request): ColaboradorTokenPayload | null {
    // Try Bearer token first
    const authHeader = request.headers.authorization;
    if (authHeader) {
      const match = authHeader.match(/^Bearer\s+(.+)$/i);
      const token = match?.[1]?.trim();
      if (token) {
        return this.verifyToken(token);
      }
    }

    // Try cookie
    const cookies = (request.cookies ?? {}) as Record<string, unknown>;
    const cookieNames = [SECURE_COOKIE_NAME, COOKIE_NAME] as const;
    for (const name of cookieNames) {
      const cookieValue = cookies[name];
      if (typeof cookieValue === 'string' && cookieValue) {
        return this.verifyToken(cookieValue);
      }
    }

    return null;
  }

  /**
   * Set the session cookie on the response.
   */
  setCookie(res: Response, token: string): void {
    const cookieName = this.isProduction ? SECURE_COOKIE_NAME : COOKIE_NAME;
    res.cookie(cookieName, token, {
      httpOnly: true,
      secure: this.isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_TTL_MS,
    });
  }

  /**
   * Clear the session cookie.
   */
  clearCookie(res: Response): void {
    for (const name of [COOKIE_NAME, SECURE_COOKIE_NAME]) {
      res.clearCookie(name, { path: '/' });
    }
  }

  private sign(data: string): string {
    return createHmac('sha256', `colaborador:${this.secret}`)
      .update(data)
      .digest('base64url');
  }
}
