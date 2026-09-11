import { Module } from '@nestjs/common';
import { SyncService } from './sync.service';
import { ShopifyAdapter } from '../platforms/shopify.adapter';
import { WooCommerceAdapter } from '../platforms/woocommerce.adapter';
import { JumpSellerAdapter } from '../platforms/jumpseller.adapter';
import { StubAdapter } from '../platforms/stub.adapter';

// Módulo hoja (sin depender de CatalogModule ni EcommerceModule) para poder sincronizar
// stock/precio hacia los marketplaces desde cualquier módulo — p.ej. CatalogModule lo
// necesita para la fusión de productos duplicados, y si importara EcommerceModule directo
// se formaría un ciclo (EcommerceModule ya importa CatalogModule).
@Module({
  providers: [SyncService, ShopifyAdapter, WooCommerceAdapter, JumpSellerAdapter, StubAdapter],
  exports: [SyncService, ShopifyAdapter, WooCommerceAdapter, JumpSellerAdapter, StubAdapter],
})
export class SyncModule {}
