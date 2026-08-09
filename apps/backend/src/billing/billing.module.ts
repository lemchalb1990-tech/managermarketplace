import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { OpenFacturaAdapter } from './providers/openfactura.adapter';
import { BsaleAdapter } from './providers/bsale.adapter';
import { FactoAdapter } from './providers/facto.adapter';
import { BillingStubAdapter } from './providers/stub.adapter';

@Module({
  controllers: [BillingController],
  providers: [BillingService, OpenFacturaAdapter, BsaleAdapter, FactoAdapter, BillingStubAdapter],
  exports: [BillingService],
})
export class BillingModule {}
