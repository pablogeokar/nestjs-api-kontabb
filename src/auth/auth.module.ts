import { Module } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { SessionTokenService } from './session-token.service';

@Module({
    providers: [AuthGuard, AuthService, SessionTokenService],
    exports: [AuthGuard, AuthService, SessionTokenService],
})
export class AuthModule { }
