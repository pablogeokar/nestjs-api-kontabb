import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { SessionTokenService } from './session-token.service';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [MailModule],
  controllers: [AuthController],
  providers: [AuthGuard, AuthService, SessionTokenService],
  exports: [AuthGuard, AuthService, SessionTokenService],
})
export class AuthModule {}
