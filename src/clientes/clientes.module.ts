import { Module } from '@nestjs/common';
import { ClientesController } from './clientes.controller';
import { ClientesService } from './clientes.service';
import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';

@Module({
    imports: [AuthModule, StorageModule],
    controllers: [ClientesController],
    providers: [ClientesService],
    exports: [ClientesService],
})
export class ClientesModule { }
