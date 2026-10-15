import { Module } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { CatalogController } from './catalog.controller';
import { ProductBulkLoadService } from './product-bulk-load.service';
import { ProductBulkLoadController } from './product-bulk-load.controller';
import { PurchasesModule } from '../purchases/purchases.module';
import { SyncModule } from '../ecommerce/sync/sync.module';

@Module({
  imports: [PurchasesModule, SyncModule],
  providers: [CatalogService, ProductBulkLoadService],
  controllers: [ProductBulkLoadController, CatalogController],
  exports: [CatalogService],
})
export class CatalogModule {}
