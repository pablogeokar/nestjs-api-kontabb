import { Module } from '@nestjs/common';
import { UploadController } from './upload.controller';
import { AuthModule } from '../auth/auth.module';
import { GuiasModule } from '../guias/guias.module';
import { ClientesModule } from '../clientes/clientes.module';

@Module({
    imports: [AuthModule, GuiasModule, ClientesModule],
    controllers: [UploadController],
})
export class UploadModule { }
