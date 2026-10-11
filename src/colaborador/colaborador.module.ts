import { Module } from '@nestjs/common';
import { ColaboradorController } from './colaborador.controller';
import { ColaboradorService } from './colaborador.service';
import { ColaboradorSessionService } from './colaborador-session.service';
import { ColaboradorAuthGuard } from './colaborador-auth.guard';
import { ColaboradorRequirePasswordChangedGuard } from './colaborador-require-password-changed.guard';
import { ClientesModule } from '../clientes/clientes.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [ClientesModule, StorageModule],
  controllers: [ColaboradorController],
  providers: [
    ColaboradorService,
    ColaboradorSessionService,
    ColaboradorAuthGuard,
    ColaboradorRequirePasswordChangedGuard,
  ],
  exports: [ColaboradorService],
})
export class ColaboradorModule { }
