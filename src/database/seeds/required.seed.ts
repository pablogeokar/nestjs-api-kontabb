import { readAdminSeedConfig, seedAdmin } from './admin.seed';
import { seedCfops } from './cfops.seed';
import { seedFinanceiroTipos } from './financeiro-tipos.seed';
import { seedIcmsBa2026 } from './icms-ba-2026.seed';
import { seedSimplesNacional } from './simples-nacional.seed';
import { seedSimplesBeneficios } from './simples-beneficios.seed';

export type RequiredSeedMode = 'novo' | 'restore';

/**
 * Modo `novo` (padrão): base criada do zero, sem restore. Grava tudo que o
 * sistema precisa para operar: Simples Nacional, CFOPs,
 * tipos financeiros, regras ICMS-BA 2026 (rascunho, sem aprovação fiscal) e o
 * ADMIN inicial (exige ADMIN_SEED_EMAIL e ADMIN_SEED_PASSWORD).
 *
 * Modo `restore`: usado depois do restore data-only. O backup já contém
 * usuários, CFOPs, tipos financeiros e regras ICMS; regravá-los sobrescreveria
 * edições feitas em produção. Inicializa os parâmetros normativos do Simples
 * e a regra padrão de benefícios, preservando versões e personalizações existentes.
 *
 * Todos os seeds são idempotentes.
 */
export async function seedRequiredData(
  databaseUrl: string,
  mode: RequiredSeedMode = 'novo',
) {
  if (mode === 'restore') {
    await seedSimplesNacional(databaseUrl);
    await seedSimplesBeneficios(databaseUrl);
    return;
  }
  // Valida as credenciais antes de gravar qualquer coisa.
  const adminConfig = readAdminSeedConfig();
  await seedSimplesNacional(databaseUrl);
  await seedSimplesBeneficios(databaseUrl);
  await seedCfops(databaseUrl);
  await seedFinanceiroTipos(databaseUrl);
  await seedIcmsBa2026(databaseUrl);
  await seedAdmin(databaseUrl, adminConfig);
}

if (require.main === module) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL não configurada.');
  const mode: RequiredSeedMode = process.argv.includes('--restore')
    ? 'restore'
    : 'novo';
  void seedRequiredData(databaseUrl, mode)
    .then(() =>
      process.stdout.write(
        mode === 'restore'
          ? 'Seeds obrigatórios (restore) concluídos: Simples Nacional e benefícios.\n'
          : 'Seeds obrigatórios concluídos: Simples Nacional, benefícios, CFOPs, tipos financeiros, regras ICMS-BA 2026 e ADMIN.\n',
      ),
    )
    .catch((error: unknown) => {
      process.stderr.write(
        `Falha ao executar os seeds obrigatórios: ${error instanceof Error ? error.message : 'erro desconhecido'}\n`,
      );
      process.exitCode = 1;
    });
}
