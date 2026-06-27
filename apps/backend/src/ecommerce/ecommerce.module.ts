import { Module } from '@nestjs/common';
import { MercadolibreService } from './mercadolibre/mercadolibre.service';
import { MercadolibreController } from './mercadolibre/mercadolibre.controller';
import { CatalogModule } from '../catalog/catalog.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [CatalogModule, SettingsModule],
  providers: [MercadolibreService],
  controllers: [MercadolibreController],
  exports: [MercadolibreService],
})
export class EcommerceModule {}
