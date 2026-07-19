import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validate } from './config/env.validation';
import { CommonModule } from './common/common.module';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { StorageModule } from './storage/storage.module';
import { MailModule } from './mail/mail.module';
import { ClientesModule } from './clientes/clientes.module';
import { DocumentosModule } from './documentos/documentos.module';
import { UploadModule } from './upload/upload.module';
import { UsuariosModule } from './usuarios/usuarios.module';
import { ClienteModule } from './cliente/cliente.module';
import { HealthController } from './health/health.controller';
import { CronController } from './cron/cron.controller';
import { StorageAdminController } from './storage/storage.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, expandVariables: true, validate }),
    CommonModule,
    DatabaseModule,
    AuthModule,
    StorageModule,
    MailModule,
    ClientesModule,
    DocumentosModule,
    UploadModule,
    UsuariosModule,
    ClienteModule,
  ],
  controllers: [HealthController, CronController, StorageAdminController],
})
export class AppModule { }
