import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';
import { ClientesModule } from '../clientes/clientes.module';
import { AdminFiscalController } from './controllers/admin-fiscal.controller';
import { ClienteFiscalController } from './controllers/cliente-fiscal.controller';
import {
  AdminCfopController,
  AdminEscrituracaoFiscalController,
  ClienteCfopController,
} from './controllers/cfop.controller';
import { CertificadoService } from './services/certificado.service';
import { NfeWizardService } from './services/nfewizard.service';
import { DistribuicaoDfeService } from './services/distribuicao-dfe.service';
import { DanfeService } from './services/danfe.service';
import { FiscalCronService } from './services/fiscal-cron.service';
import { DacteService } from './services/dacte.service';
import { ImportacaoXmlFiscalService } from './services/importacao-xml-fiscal.service';
import { FiscalItensService } from './services/fiscal-itens.service';
import { CfopService } from './services/cfop.service';
import { EscrituracaoFiscalService } from './services/escrituracao-fiscal.service';

@Module({
  imports: [AuthModule, StorageModule, ClientesModule],
  controllers: [
    AdminFiscalController,
    ClienteFiscalController,
    AdminCfopController,
    ClienteCfopController,
    AdminEscrituracaoFiscalController,
  ],
  providers: [
    CertificadoService,
    NfeWizardService,
    DistribuicaoDfeService,
    DacteService,
    DanfeService,
    FiscalCronService,
    ImportacaoXmlFiscalService,
    FiscalItensService,
    CfopService,
    EscrituracaoFiscalService,
  ],
  exports: [
    CertificadoService,
    DistribuicaoDfeService,
    FiscalCronService,
    CfopService,
  ],
})
export class FiscalModule {}
