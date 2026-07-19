import { Module } from '@nestjs/common';
import { DocumentosController } from './documentos.controller';
import { DocumentosAdminController, ClientDocumentsAdminController } from './documentos-admin.controller';
import { DocumentosClienteController } from './documentos-cliente.controller';
import { DocumentosService } from './documentos.service';
import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';
import { MailModule } from '../mail/mail.module';
import { ClientesModule } from '../clientes/clientes.module';

@Module({
    imports: [AuthModule, StorageModule, MailModule, ClientesModule],
    controllers: [
        DocumentosController,
        DocumentosAdminController,
        DocumentosClienteController,
        ClientDocumentsAdminController,
    ],
    providers: [DocumentosService],
    exports: [DocumentosService],
})
export class DocumentosModule { }
