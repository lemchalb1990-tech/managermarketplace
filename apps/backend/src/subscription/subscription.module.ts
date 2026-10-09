import { Global, Module } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { PublicPlansController, SubscriptionController } from './subscription.controller';

// Global: los límites del plan se validan desde catálogo, usuarios, bodegas y conexiones.
@Global()
@Module({
  providers: [SubscriptionService],
  controllers: [SubscriptionController, PublicPlansController],
  exports: [SubscriptionService],
})
export class SubscriptionModule {}
