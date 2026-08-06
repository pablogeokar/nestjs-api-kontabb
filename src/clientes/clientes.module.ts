import { Module, forwardRef } from '@nestjs/common';
import { ClientesController } from './clientes.controller';
import { ClientesService } from './clientes.service';
import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';
import { CnpjLookupService } from './cnpj-lookup.service';

@Module({
  imports: [forwardRef(() => AuthModule), StorageModule],
  controllers: [ClientesController],
  providers: [ClientesService, CnpjLookupService],
  exports: [ClientesService],
})
export class ClientesModule {}
