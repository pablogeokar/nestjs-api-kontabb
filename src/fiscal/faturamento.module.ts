import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { AuthModule } from '../auth/auth.module';
import { ContadoresModule } from '../cadastros/contadores/contadores.module';
import {
  FaturamentoClienteController,
  FaturamentoPublicoController,
} from './controllers/faturamento.controller';
import { FaturamentoDocumentoService } from './services/faturamento-documento.service';
import { FaturamentoService } from './services/faturamento.service';

@Module({
  imports: [AuthModule, StorageModule, ContadoresModule],
  controllers: [FaturamentoClienteController, FaturamentoPublicoController],
  providers: [FaturamentoService, FaturamentoDocumentoService],
})
export class FaturamentoModule {}
