import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';
import { ClientesModule } from '../clientes/clientes.module';
import { AdminFiscalController } from './controllers/admin-fiscal.controller';
import { ClienteFiscalController } from './controllers/cliente-fiscal.controller';
import { CertificadoService } from './services/certificado.service';
import { NfeWizardService } from './services/nfewizard.service';
import { DistribuicaoDfeService } from './services/distribuicao-dfe.service';
import { DanfeService } from './services/danfe.service';
import { FiscalCronService } from './services/fiscal-cron.service';
import { DacteService } from './services/dacte.service';
import { ImportacaoXmlFiscalService } from './services/importacao-xml-fiscal.service';
import { FiscalItensService } from './services/fiscal-itens.service';

@Module({
  imports: [AuthModule, StorageModule, ClientesModule],
  controllers: [AdminFiscalController, ClienteFiscalController],
  providers: [
    CertificadoService,
    NfeWizardService,
    DistribuicaoDfeService,
    DacteService,
    DanfeService,
    FiscalCronService,
    ImportacaoXmlFiscalService,
    FiscalItensService,
  ],
  exports: [CertificadoService, DistribuicaoDfeService, FiscalCronService],
})
export class FiscalModule {}
