import { Global, Module } from '@nestjs/common';
import { AppLogger } from './logger.service';
import { RateLimitService } from './rate-limit.service';

@Global()
@Module({
    providers: [AppLogger, RateLimitService],
    exports: [AppLogger, RateLimitService],
})
export class CommonModule { }
