import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { PublicSettingsController, PublicTimezoneController } from './public-settings.controller';
import { SettingsService } from './settings.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [SettingsController, PublicSettingsController, PublicTimezoneController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
