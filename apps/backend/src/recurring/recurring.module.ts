import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PosModule } from '../pos/pos.module';
import { BillingModule } from '../billing/billing.module';
import { EmailModule } from '../email/email.module';
import { PaymentsModule } from '../payments/payments.module';
import { RecurringController } from './recurring.controller';
import { RecurringService } from './recurring.service';

@Module({
  imports: [PrismaModule, PosModule, BillingModule, EmailModule, PaymentsModule],
  controllers: [RecurringController],
  providers: [RecurringService],
})
export class RecurringModule {}
