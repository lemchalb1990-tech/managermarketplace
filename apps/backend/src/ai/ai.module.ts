import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { AiCreditsService } from './ai-credits.service';
import { AiProvidersService } from './ai-providers.service';
import { AiController } from './ai.controller';

@Module({
  imports: [SettingsModule],
  providers: [AiCreditsService, AiProvidersService],
  controllers: [AiController],
  exports: [AiCreditsService, AiProvidersService],
})
export class AiModule {}
