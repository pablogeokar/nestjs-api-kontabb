import { Module } from '@nestjs/common';
import { ColaboradorController } from './colaborador.controller';
import { ColaboradorService } from './colaborador.service';
import { ColaboradorSessionService } from './colaborador-session.service';
import { ClientesModule } from '../clientes/clientes.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [ClientesModule, StorageModule],
  controllers: [ColaboradorController],
  providers: [ColaboradorService, ColaboradorSessionService],
  exports: [ColaboradorService],
})
export class ColaboradorModule {}
