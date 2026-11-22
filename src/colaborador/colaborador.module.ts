import { ColaboradorLogoController } from './colaborador-logo.controller';
import { ColaboradorLogoService } from './colaborador-logo.service';
import { ColaboradorFotoController } from './colaborador-foto.controller';
import { ColaboradorFotoService } from './colaborador-foto.service';
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
  controllers: [
    ColaboradorController,
    ColaboradorFotoController,
    ColaboradorLogoController,
  ],
  providers: [
    ColaboradorService,
    ColaboradorFotoService,
    ColaboradorLogoService,
    ColaboradorSessionService,
    ColaboradorAuthGuard,
    ColaboradorRequirePasswordChangedGuard,
  ],
  exports: [ColaboradorService],
})
export class ColaboradorModule {}
