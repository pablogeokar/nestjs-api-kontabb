import { Module, forwardRef } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { SessionTokenService } from './session-token.service';
import { RequirePasswordChangedGuard } from './require-password-changed.guard';
import { MailModule } from '../mail/mail.module';
import { ClientesModule } from '../clientes/clientes.module';

@Module({
  imports: [MailModule, forwardRef(() => ClientesModule)],
  controllers: [AuthController],
  providers: [
    AuthGuard,
    AuthService,
    SessionTokenService,
    RequirePasswordChangedGuard,
  ],
  exports: [
    AuthGuard,
    AuthService,
    SessionTokenService,
    RequirePasswordChangedGuard,
  ],
})
export class AuthModule {}
