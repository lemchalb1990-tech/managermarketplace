import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PurchasesModule } from '../purchases/purchases.module';
import { SyncModule } from '../ecommerce/sync/sync.module';
import { SettingsModule } from '../settings/settings.module';
import { InventoryController } from './inventory.controller';
import { TransferDocumentsService } from './transfer-documents.service';
import { InventoryReportsService } from './inventory-reports.service';

// Inventario por bodega: disponibilidad, historial (kardex), ajustes, cuadratura y traspasos
// con documento. El motor de movimientos (StockLedgerService) vive en PurchasesModule junto
// al costeo por lotes, que lo usa.
@Module({
  imports: [PrismaModule, PurchasesModule, SyncModule, SettingsModule],
  controllers: [InventoryController],
  providers: [TransferDocumentsService, InventoryReportsService],
})
export class InventoryModule {}
