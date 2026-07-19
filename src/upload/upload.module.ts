import { Module } from '@nestjs/common';
import { UploadController } from './upload.controller';
import { AuthModule } from '../auth/auth.module';
import { DocumentosModule } from '../documentos/documentos.module';
import { ClientesModule } from '../clientes/clientes.module';

@Module({
    imports: [AuthModule, DocumentosModule, ClientesModule],
    controllers: [UploadController],
})
export class UploadModule { }
