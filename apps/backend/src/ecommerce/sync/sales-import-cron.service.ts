import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MarketplaceType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MercadolibreService } from '../mercadolibre/mercadolibre.service';

// Contraparte entrante de SyncService (que empuja stock/precio hacia las plataformas):
// este servicio trae ventas nuevas desde las plataformas, cada 1 minuto, para las empresas
// que tengan Company.autoSyncSales activado. Hoy solo Mercado Libre tiene importación de
// ventas implementada; otras plataformas se agregan sumando un caso al switch de abajo.
@Injectable()
export class SalesImportCronService {
  private readonly logger = new Logger(SalesImportCronService.name);
  private isRunning = false;

  constructor(
    private prisma: PrismaService,
    private mercadolibre: MercadolibreService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleCron() {
    if (this.isRunning) {
      this.logger.warn('Auto-sync de ventas: la corrida anterior sigue en curso, se omite este ciclo');
      return;
    }
    this.isRunning = true;
    try {
      const connections = await this.prisma.marketplaceConnection.findMany({
        where: {
          active: true,
          accessToken: { not: '' },
          company: { active: true, autoSyncSales: true },
        },
      });

      for (const connection of connections) {
        try {
          switch (connection.marketplace) {
            case MarketplaceType.MERCADO_LIBRE: {
              const result = await this.mercadolibre.importRecentSalesForConnection(connection.id);
              if (result.imported || result.errors) {
                this.logger.log(`Auto-sync ML conexión ${connection.id}: ${JSON.stringify(result)}`);
              }
              break;
            }
            default:
              // SHOPIFY, WOOCOMMERCE, JUMPSELLER y el resto no tienen importación de ventas
              // implementada todavía (solo sync de catálogo saliente vía PlatformAdapter).
              break;
          }
        } catch (err: any) {
          this.logger.error(`Auto-sync falló para conexión ${connection.id} (${connection.marketplace}): ${err?.message || err}`);
        }
      }
    } finally {
      this.isRunning = false;
    }
  }
}
