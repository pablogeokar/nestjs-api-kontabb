import { Module } from '@nestjs/common';
import { ClienteController } from './cliente.controller';
import { ClienteService } from './cliente.service';
import { AuthModule } from '../auth/auth.module';
import { ClientesModule } from '../clientes/clientes.module';

@Module({
    imports: [AuthModule, ClientesModule],
    controllers: [ClienteController],
    providers: [ClienteService],
})
export class ClienteModule { }
