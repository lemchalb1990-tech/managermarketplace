import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { AiCreditsService } from './ai-credits.service';
import { OpenAiService } from './openai.service';
import { AiController } from './ai.controller';

@Module({
  imports: [SettingsModule],
  providers: [AiCreditsService, OpenAiService],
  controllers: [AiController],
  exports: [AiCreditsService, OpenAiService],
})
export class AiModule {}
