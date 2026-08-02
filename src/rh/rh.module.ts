import { Module } from '@nestjs/common';
import { RhUploadController } from './rh-upload.controller';
import { RhAdminController } from './rh-admin.controller';
import { RhClienteController } from './rh-cliente.controller';
import { RhService } from './rh.service';
import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';
import { ClientesModule } from '../clientes/clientes.module';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [AuthModule, StorageModule, ClientesModule, MailModule],
  controllers: [RhUploadController, RhAdminController, RhClienteController],
  providers: [RhService],
  exports: [RhService],
})
export class RhModule { }
