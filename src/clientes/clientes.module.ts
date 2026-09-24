import { Module, forwardRef } from '@nestjs/common';
import { ClientesController } from './clientes.controller';
import { ClientesService } from './clientes.service';
import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';
import { CnpjLookupService } from './cnpj-lookup.service';
import { CrmModule } from '../crm/crm.module';

@Module({
  imports: [
    forwardRef(() => AuthModule),
    StorageModule,
    forwardRef(() => CrmModule),
  ],
  controllers: [ClientesController],
  providers: [ClientesService, CnpjLookupService],
  exports: [ClientesService],
})
export class ClientesModule {}
