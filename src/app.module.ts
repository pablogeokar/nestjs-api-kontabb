import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard, seconds } from '@nestjs/throttler';
import { validate } from './config/env.validation';
import { CommonModule } from './common/common.module';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { StorageModule } from './storage/storage.module';
import { MailModule } from './mail/mail.module';
import { ClientesModule } from './clientes/clientes.module';
import { GuiasModule } from './guias/guias.module';
import { UploadModule } from './upload/upload.module';
import { UsuariosModule } from './usuarios/usuarios.module';
import { ClienteModule } from './cliente/cliente.module';
import { RhModule } from './rh/rh.module';
import { FiscalModule } from './fiscal/fiscal.module';
import { ColaboradorModule } from './colaborador/colaborador.module';
import { ContadoresModule } from './cadastros/contadores/contadores.module';
import { HealthController } from './health/health.controller';
import { SetupController } from './health/setup.controller';
import { DashboardController } from './health/dashboard.controller';
import { CronController } from './cron/cron.controller';
import { StorageAdminController } from './storage/storage.controller';
import { CrmModule } from './crm/crm.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, expandVariables: true, validate }),
    // Rate limiting global por IP. O tracker padrão do ThrottlerGuard usa req.ip;
    // atrás de proxy sem `trust proxy` configurado no Express, req.ip pode refletir
    // o IP do proxy (ajuste de infra fora do escopo desta tarefa).
    ThrottlerModule.forRoot([
      { name: 'default', ttl: seconds(60), limit: 100 },
    ]),
    CommonModule,
    DatabaseModule,
    AuthModule,
    StorageModule,
    MailModule,
    CrmModule,
    ClientesModule,
    GuiasModule,
    UploadModule,
    UsuariosModule,
    ClienteModule,
    RhModule,
    FiscalModule,
    ColaboradorModule,
    ContadoresModule,
  ],
  controllers: [
    HealthController,
    SetupController,
    DashboardController,
    CronController,
    StorageAdminController,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
