import { Module } from '@nestjs/common';
import { GuiasController } from './guias.controller';
import {
  GuiasAdminController,
  ClientGuiasAdminController,
} from './guias-admin.controller';
import { GuiasClienteController } from './guias-cliente.controller';
import { GuiasService } from './guias.service';
import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';
import { MailModule } from '../mail/mail.module';
import { ClientesModule } from '../clientes/clientes.module';

@Module({
  imports: [AuthModule, StorageModule, MailModule, ClientesModule],
  controllers: [
    GuiasController,
    GuiasAdminController,
    GuiasClienteController,
    ClientGuiasAdminController,
  ],
  providers: [GuiasService],
  exports: [GuiasService],
})
export class GuiasModule {}
