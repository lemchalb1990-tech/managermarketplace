import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SettingsModule } from '../settings/settings.module';
import { FinanceService } from './finance.service';
import { FinanceController } from './finance.controller';
import { FinanceBanksService } from './finance-banks.service';
import { FinanceRecurringService } from './finance-recurring.service';
import { FinanceInsightsService } from './finance-insights.service';

// Finanzas: plan de cuentas, movimientos, presupuesto, bancos y caja con conciliación,
// recurrentes, alertas y flujo de caja proyectado.
// Lo automático (ventas, comisiones, despachos, compras) se lee directo de sus tablas, así que
// no depende de los módulos de ventas ni de compras.
@Module({
  imports: [PrismaModule, SettingsModule],
  controllers: [FinanceController],
  providers: [FinanceService, FinanceBanksService, FinanceRecurringService, FinanceInsightsService],
})
export class FinanceModule {}
