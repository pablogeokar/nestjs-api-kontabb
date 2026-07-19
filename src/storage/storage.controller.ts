import {
    Body,
    Controller,
    HttpCode,
    HttpStatus,
    Post,
    UseGuards,
} from '@nestjs/common';
import { StorageCleanupService } from './storage-cleanup.service';
import { AuthGuard } from '../auth/auth.guard';
import { AdminOnly } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AppLogger } from '../common/logger.service';
import type { CurrentUser as CurrentUserType } from '../common/types';

@Controller('admin/storage')
@UseGuards(AuthGuard)
@AdminOnly()
export class StorageAdminController {
    constructor(
        private readonly storageCleanup: StorageCleanupService,
        private readonly logger: AppLogger,
    ) { }

    @Post('cleanup')
    @HttpCode(HttpStatus.OK)
    async cleanup(@CurrentUser() currentUser: CurrentUserType) {
        const requestId = this.logger.generateRequestId();
        const summary = await this.storageCleanup.processJobs(undefined, {
            requestId,
            userId: currentUser.id,
            trigger: 'manual',
        });
        return { success: true, ...summary, requestId };
    }

    @Post('reconcile')
    @HttpCode(HttpStatus.OK)
    async reconcile(
        @Body() body: { limit?: number },
        @CurrentUser() currentUser: CurrentUserType,
    ) {
        const requestId = this.logger.generateRequestId();
        // Simplified reconciliation — trigger cleanup
        const summary = await this.storageCleanup.processJobs(undefined, {
            requestId,
            userId: currentUser.id,
            trigger: 'manual',
        });
        return { success: true, ...summary, requestId };
    }
}
