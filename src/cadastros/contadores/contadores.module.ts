import { Module } from '@nestjs/common';
import { ContadoresController } from './contadores.controller';
import { ContadoresService } from './contadores.service';
import { AuthModule } from '../../auth/auth.module';
import { StorageModule } from '../../storage/storage.module';
import { ContadorCertificadoService } from './contador-certificado.service';

@Module({
  imports: [AuthModule, StorageModule],
  controllers: [ContadoresController],
  providers: [ContadoresService, ContadorCertificadoService],
  exports: [ContadoresService, ContadorCertificadoService],
})
export class ContadoresModule {}
