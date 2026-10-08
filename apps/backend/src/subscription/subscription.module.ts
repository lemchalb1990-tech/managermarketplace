import { Global, Module } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { SubscriptionController } from './subscription.controller';

// Global: los límites del plan se validan desde catálogo, usuarios, bodegas y conexiones.
@Global()
@Module({
  providers: [SubscriptionService],
  controllers: [SubscriptionController],
  exports: [SubscriptionService],
})
export class SubscriptionModule {}
