import { Module } from '@nestjs/common';
import { PosController } from './pos.controller';
import { PosService } from './pos.service';
import { WorkOrdersController } from './work-orders/work-orders.controller';
import { WorkOrdersService } from './work-orders/work-orders.service';
import { PrismaModule } from '../prisma/prisma.module';
import { EcommerceModule } from '../ecommerce/ecommerce.module';
import { EmailModule } from '../email/email.module';
import { PurchasesModule } from '../purchases/purchases.module';

@Module({
  imports: [PrismaModule, EcommerceModule, EmailModule, PurchasesModule],
  controllers: [PosController, WorkOrdersController],
  providers: [PosService, WorkOrdersService],
  exports: [PosService],
})
export class PosModule {}
