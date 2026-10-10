import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { PublicSettingsController, PublicTimezoneController, PublicNotificationSoundsController, PublicContactController } from './public-settings.controller';
import { NotificationSoundsController } from './notification-sounds.controller';
import { SettingsService } from './settings.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [
    SettingsController,
    PublicSettingsController,
    PublicTimezoneController,
    PublicNotificationSoundsController,
    PublicContactController,
    NotificationSoundsController,
  ],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
