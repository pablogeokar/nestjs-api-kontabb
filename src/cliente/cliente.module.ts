import { Module } from '@nestjs/common';
import { ClienteController, ClientesMeController } from './cliente.controller';
import { ClienteService } from './cliente.service';
import { AuthModule } from '../auth/auth.module';
import { ClientesModule } from '../clientes/clientes.module';

@Module({
  imports: [AuthModule, ClientesModule],
  controllers: [ClienteController, ClientesMeController],
  providers: [ClienteService],
})
export class ClienteModule {}
