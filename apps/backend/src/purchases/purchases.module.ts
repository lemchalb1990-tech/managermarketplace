import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { InventoryCostingService } from './inventory-costing.service';
import { StockLedgerService } from './stock-ledger.service';
import { SuppliersService } from './suppliers.service';
import { SuppliersController } from './suppliers.controller';
import { PurchasesService } from './purchases.service';
import { PurchasesController } from './purchases.controller';

@Module({
  imports: [PrismaModule],
  controllers: [SuppliersController, PurchasesController],
  providers: [InventoryCostingService, StockLedgerService, SuppliersService, PurchasesService],
  exports: [InventoryCostingService, StockLedgerService],
})
export class PurchasesModule {}
