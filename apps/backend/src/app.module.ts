import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD } from '@nestjs/core';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CompaniesModule } from './companies/companies.module';
import { CatalogModule } from './catalog/catalog.module';
import { EcommerceModule } from './ecommerce/ecommerce.module';
import { PosModule } from './pos/pos.module';
import { SettingsModule } from './settings/settings.module';
import { BillingModule } from './billing/billing.module';
import { WarehousesModule } from './warehouses/warehouses.module';
import { PurchasesModule } from './purchases/purchases.module';
import { OrdersModule } from './orders/orders.module';
import { DispatchModule } from './dispatch/dispatch.module';
import { EmailModule } from './email/email.module';
import { ClientsModule } from './clients/clients.module';
import { OrderRequestsModule } from './order-requests/order-requests.module';
import { ProfitabilityModule } from './profitability/profitability.module';
import { AccessProfilesModule } from './access-profiles/access-profiles.module';
import { WarehouseFlowModule } from './warehouse/warehouse.module';
import { ShippingModule } from './shipping/shipping.module';
import { ReturnsModule } from './returns/returns.module';
import { DriversModule } from './drivers/drivers.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    ScheduleModule.forRoot(),
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), process.env.UPLOAD_DIR || 'uploads'),
      serveRoot: '/uploads',
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    CompaniesModule,
    CatalogModule,
    EcommerceModule,
    PosModule,
    SettingsModule,
    BillingModule,
    WarehousesModule,
    PurchasesModule,
    OrdersModule,
    DispatchModule,
    EmailModule,
    ClientsModule,
    OrderRequestsModule,
    ProfitabilityModule,
    AccessProfilesModule,
    WarehouseFlowModule,
    ShippingModule,
    ReturnsModule,
    DriversModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
