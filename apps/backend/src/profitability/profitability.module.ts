import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ProfitabilityService } from './profitability.service';
import { ProfitabilityController } from './profitability.controller';

@Module({
  imports: [PrismaModule],
  controllers: [ProfitabilityController],
  providers: [ProfitabilityService],
})
export class ProfitabilityModule {}
