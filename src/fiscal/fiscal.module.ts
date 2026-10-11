import { ClassificacaoDestinacaoService } from './services/classificacao-destinacao.service';
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
import { FiscalRuleEngineService } from './services/fiscal-rule-engine.service';
import { EscrituracaoFiscalService } from './services/escrituracao-fiscal.service';
import { CiapService } from './services/ciap.service';
import { DifalEntradaService } from './services/difal-entrada.service';
import { FiscalGuiasService } from './services/fiscal-guias.service';
import { FiscalEntregasService } from './services/fiscal-entregas.service';
import { FiscalPeriodSelectionService } from './services/fiscal-period-selection.service';
import { FiscalClosingService } from './services/fiscal-closing.service';
import { FiscalBooksProjectionService } from './services/fiscal-books-projection.service';
import { OnboardingMatrizService } from './services/onboarding-matriz.service';
import { RolloutInventarioService } from './services/rollout-inventario.service';
import { RolloutMetricasService } from './services/rollout-metricas.service';
import { PisCofinsService } from './services/pis-cofins.service';
import { RegrasFiscaisService } from './services/regras-fiscais.service';
import { FiscalNormativeCatalogService } from './services/fiscal-normative-catalog.service';
import {
  AdminFiscalApuracaoController,
  ClienteFiscalApuracaoController,
} from './controllers/fiscal-apuracao.controller';
import {
  AdminRegrasFiscaisController,
  ClienteRegrasFiscaisController,
} from './controllers/regras-fiscais.controller';
import { FiscalCteService } from './services/fiscal-cte.service';
import {
  AdminSpedEfdController,
  ClienteSpedEfdController,
} from './sped/sped-efd.controller';
import { EfdIcmsIpiService } from './sped/efd-icms-ipi.service';
import { SpedConfiguracaoService } from './sped/sped-configuracao.service';
import { SpedApuracaoContextoService } from './sped/sped-apuracao-contexto.service';
import { SpedInventarioService } from './sped/sped-inventario.service';
import {
  AdminSimplesNacionalController,
  ClienteSimplesNacionalController,
} from './controllers/simples-nacional.controller';
import { SimplesCalculadorService } from './services/simples-calculador.service';
import { SimplesNacionalService } from './services/simples-nacional.service';

@Module({
  imports: [AuthModule, StorageModule, ClientesModule],
  controllers: [
    AdminFiscalController,
    ClienteFiscalController,
    AdminCfopController,
    ClienteCfopController,
    AdminEscrituracaoFiscalController,
    AdminSpedEfdController,
    ClienteSpedEfdController,
    AdminFiscalApuracaoController,
    ClienteFiscalApuracaoController,
    ClienteRegrasFiscaisController,
    AdminRegrasFiscaisController,
    AdminSimplesNacionalController,
    ClienteSimplesNacionalController,
  ],
  providers: [
    ClassificacaoDestinacaoService,
    CertificadoService,
    NfeWizardService,
    DistribuicaoDfeService,
    DacteService,
    DanfeService,
    FiscalCronService,
    ImportacaoXmlFiscalService,
    FiscalItensService,
    CfopService,
    FiscalRuleEngineService,
    FiscalCteService,
    EscrituracaoFiscalService,
    EfdIcmsIpiService,
    SpedConfiguracaoService,
    SpedApuracaoContextoService,
    SpedInventarioService,
    CiapService,
    DifalEntradaService,
    FiscalGuiasService,
    FiscalEntregasService,
    FiscalPeriodSelectionService,
    FiscalClosingService,
    FiscalBooksProjectionService,
    OnboardingMatrizService,
    RolloutInventarioService,
    RolloutMetricasService,
    PisCofinsService,
    RegrasFiscaisService,
    FiscalNormativeCatalogService,
    SimplesCalculadorService,
    SimplesNacionalService,
  ],
  exports: [
    CertificadoService,
    DistribuicaoDfeService,
    FiscalCronService,
    CfopService,
    FiscalRuleEngineService,
    CiapService,
    DifalEntradaService,
    FiscalGuiasService,
    FiscalEntregasService,
    FiscalPeriodSelectionService,
    FiscalClosingService,
    FiscalBooksProjectionService,
    OnboardingMatrizService,
    RolloutInventarioService,
    RolloutMetricasService,
    PisCofinsService,
    FiscalNormativeCatalogService,
    SimplesNacionalService,
  ],
})
export class FiscalModule {}
