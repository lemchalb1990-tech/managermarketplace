import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MarketplaceType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MercadolibreService } from '../mercadolibre/mercadolibre.service';

// Contraparte entrante de SyncService (que empuja stock/precio hacia las plataformas):
// este servicio trae ventas nuevas desde las plataformas. Cada empresa elige qué
// plataformas auto-importar en Company.autoSyncSalesPlatforms (lista de MarketplaceType).
// Hoy solo Mercado Libre tiene importación de ventas implementada; el resto se agrega
// sumando un caso al switch de abajo (el check ya queda disponible en la UI).
//
// El tick corre cada 1 minuto (la granularidad más fina soportada), pero cada conexión
// solo se procesa si ya pasó su Company.autoSyncIntervalMinutes desde su última corrida
// (connection.lastSalesImportAt) — así una empresa configurada a "cada 5 min" no importa
// en cada tick, sin necesitar un cron distinto por empresa.
@Injectable()
export class SalesImportCronService {
  private readonly logger = new Logger(SalesImportCronService.name);
  private isRunning = false;
  private readonly warnedUnsupported = new Set<string>();

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
          company: { active: true },
        },
        include: {
          company: { select: { autoSyncIntervalMinutes: true, autoSyncSalesPlatforms: true } },
        },
      });

      const now = Date.now();
      for (const connection of connections) {
        const platforms = connection.company.autoSyncSalesPlatforms;
        const enabled = Array.isArray(platforms) && platforms.includes(connection.marketplace);
        if (!enabled) continue;

        const intervalMinutes = Math.max(1, connection.company.autoSyncIntervalMinutes || 1);
        const dueAt = connection.lastSalesImportAt
          ? connection.lastSalesImportAt.getTime() + intervalMinutes * 60 * 1000
          : 0;
        if (now < dueAt) continue; // todavía no toca según el intervalo configurado

        try {
          switch (connection.marketplace) {
            case MarketplaceType.MERCADO_LIBRE: {
              const result = await this.mercadolibre.importRecentSalesForConnection(connection.id);
              if (result.imported || result.errors) {
                this.logger.log(`Auto-sync ML conexión ${connection.id}: ${JSON.stringify(result)}`);
              }
              break;
            }
            default: {
              // SHOPIFY, WOOCOMMERCE, FALABELLA, PARIS, HITES, RIPLEY, WALMART, JUMPSELLER:
              // la importación de ventas aún no está implementada. El check queda activo
              // y esta rama se activará sola cuando se agregue el importador de la plataforma.
              const key = `${connection.marketplace}`;
              if (!this.warnedUnsupported.has(key)) {
                this.logger.warn(`Auto-importación de ventas para ${connection.marketplace} aún no implementada; se omite`);
                this.warnedUnsupported.add(key);
              }
              break;
            }
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
