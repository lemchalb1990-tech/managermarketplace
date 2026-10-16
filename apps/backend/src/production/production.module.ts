import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PurchasesModule } from '../purchases/purchases.module';
import { SyncModule } from '../ecommerce/sync/sync.module';
import { ProductionController, PublicProductionController } from './production.controller';
import { ProductionService } from './production.service';
import { ProductionConfigService } from './production-config.service';

@Module({
  imports: [PrismaModule, PurchasesModule, SyncModule],
  controllers: [ProductionController, PublicProductionController],
  providers: [ProductionService, ProductionConfigService],
  exports: [ProductionService],
})
export class ProductionModule {}
