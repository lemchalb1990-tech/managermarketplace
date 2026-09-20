import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { OpenFacturaAdapter } from './providers/openfactura.adapter';
import { BsaleAdapter } from './providers/bsale.adapter';
import { FactoAdapter } from './providers/facto.adapter';
import { BillingStubAdapter } from './providers/stub.adapter';
import { EmailModule } from '../email/email.module';
import { SettingsModule } from '../settings/settings.module';
import { SyncModule } from '../ecommerce/sync/sync.module';

@Module({
  // SyncModule (hoja, sin ciclos — ver su comentario) expone los adapters de marketplace
  // para poder reenviarles el DTE ya emitido (ver BillingService.pushInvoiceToMarketplace).
  imports: [EmailModule, SettingsModule, SyncModule],
  controllers: [BillingController],
  providers: [BillingService, OpenFacturaAdapter, BsaleAdapter, FactoAdapter, BillingStubAdapter],
  exports: [BillingService],
})
export class BillingModule {}
