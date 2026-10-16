import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SettingsModule } from '../settings/settings.module';
import { AiModule } from '../ai/ai.module';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';

@Module({
  imports: [PrismaModule, SettingsModule, AiModule],
  controllers: [AssistantController],
  providers: [AssistantService],
})
export class AssistantModule {}
