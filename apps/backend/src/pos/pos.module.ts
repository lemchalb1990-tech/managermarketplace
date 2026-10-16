import { Module } from '@nestjs/common';
import { PosController } from './pos.controller';
import { PosService } from './pos.service';
import { WorkOrdersController } from './work-orders/work-orders.controller';
import { WorkOrdersService } from './work-orders/work-orders.service';
import { CashClosuresController } from './cash-closures/cash-closures.controller';
import { CashClosuresService } from './cash-closures/cash-closures.service';
import { SalesReportsController } from './reports/sales-reports.controller';
import { SalesReportsService } from './reports/sales-reports.service';
import { SalesReportSchedulesService } from './reports/sales-report-schedules.service';
import { PrismaModule } from '../prisma/prisma.module';
import { EcommerceModule } from '../ecommerce/ecommerce.module';
import { EmailModule } from '../email/email.module';
import { PurchasesModule } from '../purchases/purchases.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [PrismaModule, EcommerceModule, EmailModule, PurchasesModule, SettingsModule],
  controllers: [PosController, WorkOrdersController, CashClosuresController, SalesReportsController],
  providers: [PosService, WorkOrdersService, CashClosuresService, SalesReportsService, SalesReportSchedulesService],
  exports: [PosService, WorkOrdersService],
})
export class PosModule {}
