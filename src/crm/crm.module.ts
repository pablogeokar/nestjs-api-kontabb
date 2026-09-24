import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';

@Module({
  // O controller aplica AuthGuard, que é provido e exportado pelo AuthModule.
  // AuthModule -> ClientesModule -> CrmModule fecha o ciclo criado pelo envio
  // automático de boas-vindas; forwardRef torna essa relação explícita ao Nest.
  imports: [MailModule, forwardRef(() => AuthModule)],
  controllers: [CrmController],
  providers: [CrmService],
  exports: [CrmService],
})
export class CrmModule {}
