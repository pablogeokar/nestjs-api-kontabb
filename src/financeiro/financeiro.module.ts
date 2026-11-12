import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { DatabaseModule } from '../database/database.module';
import { ClientesModule } from '../clientes/clientes.module';
import { StorageModule } from '../storage/storage.module';
import { AuthModule } from '../auth/auth.module';
import { FinanceiroTiposService } from './services/financeiro-tipos.service';
import { FinanceiroContratosService } from './services/financeiro-contratos.service';
import { FinanceiroLancamentosService } from './services/financeiro-lancamentos.service';
import { FinanceiroFaturasService } from './services/financeiro-faturas.service';
import { FinanceiroBaixasService } from './services/financeiro-baixas.service';
import { FinanceiroDashboardService } from './services/financeiro-dashboard.service';
import { FinanceiroDocumentosService } from './services/financeiro-documentos.service';
import { FinanceiroAdminController } from './controllers/financeiro-admin.controller';
import { FinanceiroClienteController } from './controllers/financeiro-cliente.controller';

const services = [
  FinanceiroTiposService,
  FinanceiroContratosService,
  FinanceiroLancamentosService,
  FinanceiroFaturasService,
  FinanceiroBaixasService,
  FinanceiroDashboardService,
  FinanceiroDocumentosService,
];

@Module({
  imports: [
    CommonModule,
    DatabaseModule,
    AuthModule,
    ClientesModule,
    StorageModule,
  ],
  controllers: [FinanceiroAdminController, FinanceiroClienteController],
  providers: services,
  exports: services,
})
export class FinanceiroModule {}
