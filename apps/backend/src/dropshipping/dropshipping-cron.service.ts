import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DropshippingService } from './dropshipping.service';

// Barrido periódico: crea los pedidos al proveedor para las ventas nuevas que
// contengan productos dropship. Desacopla la generación de cada punto de creación
// de ventas (POS, importación de Mercado Libre, etc.) — todas caen acá.
@Injectable()
export class DropshippingCronService {
  private readonly logger = new Logger(DropshippingCronService.name);
  private isRunning = false;

  constructor(private dropshipping: DropshippingService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleCron() {
    if (this.isRunning) {
      this.logger.warn('Barrido dropship: la corrida anterior sigue en curso, se omite este ciclo');
      return;
    }
    this.isRunning = true;
    try {
      const companyIds = await this.dropshipping.companiesWithModule();
      for (const companyId of companyIds) {
        try {
          const result = await this.dropshipping.generateOrders(companyId, 30);
          if (result.created || result.sent) {
            this.logger.log(`Dropship ${companyId}: ${JSON.stringify(result)}`);
          }
        } catch (err: any) {
          this.logger.error(`Barrido dropship falló para empresa ${companyId}: ${err?.message || err}`);
        }
      }
    } finally {
      this.isRunning = false;
    }
  }
}
