import {
  Controller,
  ForbiddenException,
  Get,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { AuthService } from '../auth/auth.service';
import { user, account } from '../database/schema';

@ApiTags('Setup')
@Controller('setup')
export class SetupController {
  constructor(
    private readonly database: DatabaseService,
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Criar usuário ADMIN inicial',
    description:
      'Cria o primeiro usuário ADMIN do sistema. Só funciona em ambiente de desenvolvimento e quando não existe nenhum ADMIN cadastrado.',
  })
  @ApiResponse({ status: 200, description: 'Usuário ADMIN criado.' })
  @ApiResponse({
    status: 403,
    description: 'Rota disponível apenas em desenvolvimento.',
  })
  @ApiResponse({
    status: 409,
    description: 'Já existe um usuário ADMIN no sistema.',
  })
  async setup() {
    // Only allow in development
    const nodeEnv = this.configService.get<string>('NODE_ENV');
    if (nodeEnv !== 'development') {
      throw new ForbiddenException(
        'Esta rota está disponível apenas em ambiente de desenvolvimento.',
      );
    }

    // Check if any admin already exists
    const [existing] = await this.database.db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.role, 'ADMIN'))
      .limit(1);

    if (existing) {
      throw new ConflictException(
        'Já existe um usuário ADMIN cadastrado no sistema.',
      );
    }

    // Create admin user
    const userId = crypto.randomUUID();
    const hashedPassword = await this.authService.hashPassword('123456');

    await this.database.db.insert(user).values({
      id: userId,
      name: 'Pablo George',
      email: 'pablogeokar@gmail.com',
      emailVerified: true,
      role: 'ADMIN',
    });

    await this.database.db.insert(account).values({
      id: crypto.randomUUID(),
      accountId: userId,
      providerId: 'credential',
      userId,
      password: hashedPassword,
    });

    return {
      success: true,
      message: 'Usuário ADMIN criado com sucesso.',
      user: {
        id: userId,
        name: 'Pablo George',
        email: 'pablogeokar@gmail.com',
        role: 'ADMIN',
      },
    };
  }
}
