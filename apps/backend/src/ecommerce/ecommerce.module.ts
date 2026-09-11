import { Module } from '@nestjs/common';
import { MercadolibreService } from './mercadolibre/mercadolibre.service';
import { MercadolibreController } from './mercadolibre/mercadolibre.controller';
import { ConnectionsService } from './connections/connections.service';
import { ConnectionsController } from './connections/connections.controller';
import { SyncModule } from './sync/sync.module';
import { SalesImportCronService } from './sync/sales-import-cron.service';
import { ParisAdapter } from './platforms/paris.adapter';
import { CatalogModule } from '../catalog/catalog.module';
import { SettingsModule } from '../settings/settings.module';
import { PurchasesModule } from '../purchases/purchases.module';

@Module({
  imports: [CatalogModule, SettingsModule, PurchasesModule, SyncModule],
  providers: [
    MercadolibreService,
    SalesImportCronService,
    ConnectionsService,
    ParisAdapter,
  ],
  controllers: [MercadolibreController, ConnectionsController],
  // Re-exporta SyncModule para que quien ya importaba EcommerceModule por SyncService
  // (p.ej. PosModule) lo siga resolviendo igual.
  exports: [MercadolibreService, SyncModule],
})
export class EcommerceModule {}
