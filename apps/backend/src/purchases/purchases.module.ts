import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { InventoryCostingService } from './inventory-costing.service';
import { SuppliersService } from './suppliers.service';
import { SuppliersController } from './suppliers.controller';
import { PurchasesService } from './purchases.service';
import { PurchasesController } from './purchases.controller';
import { TransfersService } from './transfers.service';
import { TransfersController } from './transfers.controller';

@Module({
  imports: [PrismaModule],
  controllers: [SuppliersController, PurchasesController, TransfersController],
  providers: [InventoryCostingService, SuppliersService, PurchasesService, TransfersService],
  exports: [InventoryCostingService],
})
export class PurchasesModule {}
