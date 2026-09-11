import { Module } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { CatalogController } from './catalog.controller';
import { PurchasesModule } from '../purchases/purchases.module';
import { SyncModule } from '../ecommerce/sync/sync.module';

@Module({
  imports: [PurchasesModule, SyncModule],
  providers: [CatalogService],
  controllers: [CatalogController],
  exports: [CatalogService],
})
export class CatalogModule {}
