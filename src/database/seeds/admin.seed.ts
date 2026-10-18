import { randomBytes, scrypt } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { account, user } from '../schema';

const MINIMUM_PASSWORD_LENGTH = 6;

export interface AdminSeedConfig {
  email: string;
  password: string;
  name: string;
}

function requiredEnvironmentValue(
  environment: NodeJS.ProcessEnv,
  variableName: string,
): string {
  const value = environment[variableName]?.trim();
  if (!value) {
    throw new Error(`${variableName} deve ser configurada para criar o ADMIN.`);
  }
  return value;
}

/**
 * Lê e valida as credenciais do administrador inicial. A senha nunca tem
 * valor padrão e não é exibida em logs ou no resultado do seed.
 */
export function readAdminSeedConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AdminSeedConfig {
  const email = requiredEnvironmentValue(environment, 'ADMIN_SEED_EMAIL')
    .normalize('NFKC')
    .toLowerCase();
  const password = requiredEnvironmentValue(environment, 'ADMIN_SEED_PASSWORD');
  const name =
    environment.ADMIN_SEED_NAME?.trim().normalize('NFKC') || 'Administrador';

  if (!/^\S+@\S+\.\S+$/.test(email)) {
    throw new Error('ADMIN_SEED_EMAIL deve conter um e-mail válido.');
  }
  if (password.length < MINIMUM_PASSWORD_LENGTH) {
    throw new Error(
      `ADMIN_SEED_PASSWORD deve ter ao menos ${MINIMUM_PASSWORD_LENGTH} caracteres.`,
    );
  }
  if (name.length > 160) {
    throw new Error('ADMIN_SEED_NAME deve ter no máximo 160 caracteres.');
  }

  return { email, password, name };
}

/** Usa o mesmo formato scrypt aceito pelo AuthService. */
async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize('NFKC'),
      salt,
      64,
      { N: 16384, r: 16, p: 1, maxmem: 128 * 16384 * 16 * 2 },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(`${salt}:${derivedKey.toString('hex')}`);
      },
    );
  });
}

export async function seedAdmin(
  databaseUrl: string,
  config = readAdminSeedConfig(),
): Promise<'created' | 'credential-created' | 'already-exists'> {
  const client = postgres(databaseUrl, { max: 1 });
  const database = drizzle(client);

  try {
    return await database.transaction(async (tx) => {
      const [existingUser] = await tx
        .select({ id: user.id, role: user.role })
        .from(user)
        .where(eq(user.email, config.email))
        .limit(1);

      if (existingUser) {
        if (existingUser.role !== 'ADMIN') {
          throw new Error(
            'O e-mail informado já pertence a um usuário que não é ADMIN. A operação foi interrompida sem alterar permissões.',
          );
        }

        const [credentialAccount] = await tx
          .select({ id: account.id })
          .from(account)
          .where(
            and(
              eq(account.userId, existingUser.id),
              eq(account.providerId, 'credential'),
            ),
          )
          .limit(1);

        if (credentialAccount) return 'already-exists';

        await tx.insert(account).values({
          id: crypto.randomUUID(),
          accountId: existingUser.id,
          providerId: 'credential',
          userId: existingUser.id,
          password: await hashPassword(config.password),
        });
        return 'credential-created';
      }

      const userId = crypto.randomUUID();
      await tx.insert(user).values({
        id: userId,
        name: config.name,
        email: config.email,
        emailVerified: true,
        role: 'ADMIN',
      });
      await tx.insert(account).values({
        id: crypto.randomUUID(),
        accountId: userId,
        providerId: 'credential',
        userId,
        password: await hashPassword(config.password),
      });
      return 'created';
    });
  } finally {
    await client.end({ timeout: 5 });
  }
}

if (require.main === module) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL não configurada.');

  void seedAdmin(databaseUrl)
    .then((result) => {
      const message = {
        created: 'Usuário ADMIN inicial criado com sucesso.',
        'credential-created':
          'Credencial por senha criada para o ADMIN existente.',
        'already-exists':
          'Já existe um ADMIN com credencial por senha; nenhuma alteração foi feita.',
      }[result];
      process.stdout.write(`${message}\n`);
    })
    .catch((error: unknown) => {
      process.stderr.write(
        `Falha ao executar seed de ADMIN: ${error instanceof Error ? error.message : 'erro desconhecido'}\n`,
      );
      process.exitCode = 1;
    });
}
