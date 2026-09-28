import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SettingsModule } from '../settings/settings.module';
import { FinanceService } from './finance.service';
import { FinanceController } from './finance.controller';

// Finanzas: plan de cuentas, movimientos manuales, presupuesto mensual y presupuesto vs. real.
// Lo automático (ventas, comisiones, despachos, compras) se lee directo de sus tablas, así que
// no depende de los módulos de ventas ni de compras.
@Module({
  imports: [PrismaModule, SettingsModule],
  controllers: [FinanceController],
  providers: [FinanceService],
})
export class FinanceModule {}
