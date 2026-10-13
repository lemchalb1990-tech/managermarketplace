import { Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { EmailController } from './email.controller';
import { PlatformMailService } from './platform-mail.service';
import { PlatformMailController } from './platform-mail.controller';
import { EmailLogService } from './email-log.service';
import { EmailLogController } from './email-log.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [PrismaModule, SettingsModule],
  controllers: [EmailController, PlatformMailController, EmailLogController],
  providers: [EmailService, PlatformMailService, EmailLogService],
  exports: [EmailService, PlatformMailService, EmailLogService],
})
export class EmailModule {}
