import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { createHmac, randomBytes } from 'crypto';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { SessionTokenService } from './session-token.service';
import { CurrentUser } from './current-user.decorator';
import type { CurrentUser as CurrentUserType } from '../common/types';
import { RateLimitService } from '../common/rate-limit.service';
import { AppLogger } from '../common/logger.service';
import { MailService } from '../mail/mail.service';

@ApiTags('Autenticação')
@Controller('auth')
export class AuthController {
  private readonly secret: string;
  private readonly isProduction: boolean;
  private readonly sessionExpiresInMs = 7 * 24 * 60 * 60 * 1000; // 7 days

  constructor(
    private readonly authService: AuthService,
    private readonly sessionTokenService: SessionTokenService,
    private readonly configService: ConfigService,
    private readonly rateLimit: RateLimitService,
    private readonly logger: AppLogger,
    private readonly mailService: MailService,
  ) {
    this.secret = this.configService.getOrThrow<string>('BETTER_AUTH_SECRET');
    this.isProduction =
      this.configService.get<string>('NODE_ENV') === 'production';
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Login',
    description:
      'Autentica o usuário com e-mail e senha. Retorna dados da sessão e define cookie de sessão.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['email', 'password'],
      properties: {
        email: {
          type: 'string',
          description:
            'E-mail do usuário (ou identificador@kontabb.local para clientes)',
        },
        password: { type: 'string', description: 'Senha' },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Login realizado com sucesso.' })
  @ApiResponse({ status: 401, description: 'Credenciais inválidas.' })
  @ApiResponse({ status: 429, description: 'Rate limit excedido.' })
  async login(
    @Body() body: { email: string; password: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const email = body.email?.trim().toLowerCase();
    const password = body.password;

    if (!email || !password) {
      throw new BadRequestException('E-mail e senha são obrigatórios.');
    }

    await this.rateLimit.consume({
      key: `auth-login:${email}`,
      limit: 5,
      windowMs: 60_000,
    });

    const result = await this.authService.authenticateUser(email, password);
    if (!result) {
      throw new UnauthorizedException('Credenciais inválidas.');
    }

    // Create a session
    const sessionToken = randomBytes(32).toString('base64url');
    const sessionId = randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + this.sessionExpiresInMs);

    await this.authService.createSession({
      id: sessionId,
      token: sessionToken,
      userId: result.id,
      expiresAt,
      ipAddress: req.ip ?? req.socket.remoteAddress ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });

    // Sign the token for cookie (same format as better-auth)
    const signedToken = this.signSessionToken(sessionToken);

    // Set the session cookie
    this.setSessionCookie(res, signedToken, expiresAt);

    this.logger.info('user_login', {
      userId: result.id,
      role: result.role,
    });

    return {
      user: {
        id: result.id,
        name: result.name,
        email: result.email,
        role: result.role,
      },
      session: {
        token: sessionToken,
        expiresAt: expiresAt.toISOString(),
      },
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('session-token')
  @ApiOperation({
    summary: 'Logout',
    description: 'Invalida a sessão atual e remove o cookie de sessão.',
  })
  @ApiResponse({ status: 200, description: 'Logout realizado com sucesso.' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = this.sessionTokenService.extract(req);
    if (token) {
      await this.authService.revokeSession(token);
    }

    // Clear the session cookie
    this.clearSessionCookie(res);

    return { success: true };
  }

  @Get('session')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('session-token')
  @ApiOperation({
    summary: 'Obter sessão atual',
    description:
      'Retorna os dados do usuário autenticado. Retorna null se não houver sessão válida.',
  })
  @ApiResponse({ status: 200, description: 'Dados da sessão ou null.' })
  async getSession(@Req() req: Request) {
    const token = this.sessionTokenService.extract(req);
    if (!token) {
      return { session: null, user: null };
    }

    const user = await this.authService.validateSession(token);
    if (!user) {
      return { session: null, user: null };
    }

    return {
      session: { active: true },
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    };
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  @ApiBearerAuth('session-token')
  @ApiOperation({
    summary: 'Alterar senha',
    description:
      'Altera a senha do usuário autenticado. Requer senha atual para confirmação.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['currentPassword', 'newPassword'],
      properties: {
        currentPassword: { type: 'string', description: 'Senha atual' },
        newPassword: {
          type: 'string',
          description: 'Nova senha (mín 6 caracteres)',
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Senha alterada com sucesso.' })
  @ApiResponse({
    status: 400,
    description: 'Senha atual incorreta ou nova senha inválida.',
  })
  @ApiResponse({ status: 401, description: 'Não autorizado.' })
  @ApiResponse({ status: 429, description: 'Rate limit excedido.' })
  async changePassword(
    @Body() body: { currentPassword: string; newPassword: string },
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    if (!body.currentPassword || !body.newPassword) {
      throw new BadRequestException(
        'Senha atual e nova senha são obrigatórias.',
      );
    }

    if (body.newPassword.length < 6) {
      throw new BadRequestException(
        'A nova senha deve ter pelo menos 6 caracteres.',
      );
    }

    if (body.currentPassword === body.newPassword) {
      throw new BadRequestException(
        'A nova senha deve ser diferente da senha atual.',
      );
    }

    await this.rateLimit.consume({
      key: `change-password:${currentUser.id}`,
      limit: 5,
      windowMs: 60_000,
    });

    const result = await this.authService.changePassword({
      userId: currentUser.id,
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
    });

    if (!result.ok) {
      throw new BadRequestException('Senha atual incorreta.');
    }

    return { success: true, message: 'Senha alterada com sucesso.' };
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Solicitar redefinição de senha',
    description:
      'Envia um e-mail com link para redefinir a senha. Sempre retorna sucesso para não expor se o e-mail existe.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['email'],
      properties: {
        email: { type: 'string', description: 'E-mail cadastrado do usuário' },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Se o e-mail existir, um link será enviado.',
  })
  @ApiResponse({ status: 429, description: 'Rate limit excedido.' })
  async forgotPassword(@Body() body: { email: string }) {
    const email = body.email?.trim().toLowerCase();
    if (!email) {
      throw new BadRequestException('E-mail é obrigatório.');
    }

    await this.rateLimit.consume({
      key: `forgot-password:${email}`,
      limit: 3,
      windowMs: 300_000, // 3 attempts per 5 minutes
    });

    // Generate token and send email (never reveal if user exists)
    const token = await this.authService.createPasswordResetToken(email);

    if (token) {
      const appUrl = this.configService.getOrThrow<string>('APP_URL');
      const resetLink = `${appUrl}/redefinir-senha?token=${token}`;
      await this.mailService.sendPasswordResetEmail({ to: email, resetLink });
      this.logger.info('password_reset_requested', { email });
    }

    return {
      success: true,
      message:
        'Se o e-mail estiver cadastrado, você receberá um link para redefinir sua senha.',
    };
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Redefinir senha com token',
    description:
      'Redefine a senha usando o token recebido por e-mail. O token expira em 1 hora.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['token', 'newPassword'],
      properties: {
        token: {
          type: 'string',
          description: 'Token de redefinição recebido por e-mail',
        },
        newPassword: {
          type: 'string',
          description: 'Nova senha (mín 6 caracteres)',
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Senha redefinida com sucesso.' })
  @ApiResponse({
    status: 400,
    description: 'Token inválido, expirado ou senha fraca.',
  })
  @ApiResponse({ status: 429, description: 'Rate limit excedido.' })
  async resetPassword(@Body() body: { token: string; newPassword: string }) {
    const { token, newPassword } = body;

    if (!token || !newPassword) {
      throw new BadRequestException('Token e nova senha são obrigatórios.');
    }

    if (newPassword.length < 6) {
      throw new BadRequestException(
        'A nova senha deve ter pelo menos 6 caracteres.',
      );
    }

    await this.rateLimit.consume({
      key: `reset-password:${token.slice(0, 8)}`,
      limit: 5,
      windowMs: 300_000,
    });

    const result = await this.authService.resetPasswordWithToken(
      token,
      newPassword,
    );

    if (!result.ok) {
      throw new BadRequestException(
        'Token inválido ou expirado. Solicite um novo link.',
      );
    }

    this.logger.info('password_reset_completed', { userId: result.userId });

    return {
      success: true,
      message: 'Senha redefinida com sucesso. Faça login com a nova senha.',
    };
  }

  private signSessionToken(token: string): string {
    const signature = createHmac('sha256', this.secret)
      .update(token)
      .digest('base64');
    return `${token}.${signature}`;
  }

  private setSessionCookie(
    res: Response,
    signedToken: string,
    expiresAt: Date,
  ): void {
    const cookieName = this.isProduction
      ? '__Secure-better-auth.session_token'
      : 'better-auth.session_token';

    res.cookie(cookieName, signedToken, {
      httpOnly: true,
      secure: this.isProduction,
      sameSite: 'lax',
      path: '/',
      expires: expiresAt,
    });
  }

  private clearSessionCookie(res: Response): void {
    const cookieNames = [
      'better-auth.session_token',
      '__Secure-better-auth.session_token',
    ];
    for (const name of cookieNames) {
      res.clearCookie(name, { path: '/' });
    }
  }
}
