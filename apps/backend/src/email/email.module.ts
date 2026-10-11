import { Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { EmailController } from './email.controller';
import { PlatformMailService } from './platform-mail.service';
import { PlatformMailController } from './platform-mail.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [PrismaModule, SettingsModule],
  controllers: [EmailController, PlatformMailController],
  providers: [EmailService, PlatformMailService],
  exports: [EmailService, PlatformMailService],
})
export class EmailModule {}
