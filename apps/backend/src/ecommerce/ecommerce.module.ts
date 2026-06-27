import { Module } from '@nestjs/common';
import { MercadolibreService } from './mercadolibre/mercadolibre.service';
import { MercadolibreController } from './mercadolibre/mercadolibre.controller';
import { CatalogModule } from '../catalog/catalog.module';

@Module({
  imports: [CatalogModule],
  providers: [MercadolibreService],
  controllers: [MercadolibreController],
  exports: [MercadolibreService],
})
export class EcommerceModule {}
