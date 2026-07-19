import { Module } from '@nestjs/common';
import { StorageService } from './storage.service';
import { StorageCleanupService } from './storage-cleanup.service';

@Module({
    providers: [StorageService, StorageCleanupService],
    exports: [StorageService, StorageCleanupService],
})
export class StorageModule { }
