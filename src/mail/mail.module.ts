import { Module } from '@nestjs/common';
import { MailLayoutService } from './mail-layout.service';
import { MailService } from './mail.service';

@Module({
    providers: [MailLayoutService, MailService],
    exports: [MailService],
})
export class MailModule { }
