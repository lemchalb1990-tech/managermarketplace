import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { EmailModule } from '../email/email.module';
import { DropshippingService } from './dropshipping.service';
import { DropshippingController } from './dropshipping.controller';
import { DropshippingCronService } from './dropshipping-cron.service';

@Module({
  imports: [PrismaModule, EmailModule],
  controllers: [DropshippingController],
  providers: [DropshippingService, DropshippingCronService],
  exports: [DropshippingService],
})
export class DropshippingModule {}
