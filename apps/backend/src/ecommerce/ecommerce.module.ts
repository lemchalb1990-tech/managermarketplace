import { Module } from '@nestjs/common';
import { MercadolibreService } from './mercadolibre/mercadolibre.service';
import { MercadolibreController } from './mercadolibre/mercadolibre.controller';
import { ConnectionsService } from './connections/connections.service';
import { ConnectionsController } from './connections/connections.controller';
import { SyncService } from './sync/sync.service';
import { SalesImportCronService } from './sync/sales-import-cron.service';
import { ShopifyAdapter } from './platforms/shopify.adapter';
import { WooCommerceAdapter } from './platforms/woocommerce.adapter';
import { JumpSellerAdapter } from './platforms/jumpseller.adapter';
import { StubAdapter } from './platforms/stub.adapter';
import { CatalogModule } from '../catalog/catalog.module';
import { SettingsModule } from '../settings/settings.module';
import { PurchasesModule } from '../purchases/purchases.module';

@Module({
  imports: [CatalogModule, SettingsModule, PurchasesModule],
  providers: [
    MercadolibreService,
    SyncService,
    SalesImportCronService,
    ConnectionsService,
    ShopifyAdapter,
    WooCommerceAdapter,
    JumpSellerAdapter,
    StubAdapter,
  ],
  controllers: [MercadolibreController, ConnectionsController],
  exports: [MercadolibreService, SyncService],
})
export class EcommerceModule {}
