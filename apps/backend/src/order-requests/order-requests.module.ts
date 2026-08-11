import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PurchasesModule } from '../purchases/purchases.module';
import { OrderRequestsService } from './order-requests.service';
import { OrderRequestsController } from './order-requests.controller';

@Module({
  imports: [PrismaModule, PurchasesModule],
  controllers: [OrderRequestsController],
  providers: [OrderRequestsService],
})
export class OrderRequestsModule {}
