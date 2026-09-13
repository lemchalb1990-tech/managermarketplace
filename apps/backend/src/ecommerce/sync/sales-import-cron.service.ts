import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MarketplaceType, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MercadolibreService } from '../mercadolibre/mercadolibre.service';

// Usuario sintético para llamar métodos del service que exigen "user" (por los mismos
// checks de permisos que el resto de la app) desde un cron sin sesión real. SUPER_ADMIN
// evita el chequeo de companyId en getConnectionForUser — no se expone por ningún
// endpoint, solo se usa acá.
const SYSTEM_USER = { role: Role.SUPER_ADMIN } as any;

// Contraparte entrante de SyncService (que empuja stock/precio hacia las plataformas):
// este servicio trae de vuelta ventas, preguntas y reclamos/devoluciones nuevas desde
// las plataformas. Cada empresa elige qué plataformas auto-sincronizar en
// Company.autoSyncSalesPlatforms (lista de MarketplaceType) — mismo interruptor y mismo
// intervalo para las tres cosas, no hay un toggle aparte para preguntas/devoluciones.
// Hoy solo Mercado Libre está implementado; el resto se agrega sumando un caso al switch
// de abajo (el check ya queda disponible en la UI).
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

        switch (connection.marketplace) {
          case MarketplaceType.MERCADO_LIBRE: {
            try {
              const result = await this.mercadolibre.importRecentSalesForConnection(connection.id);
              if (result.imported || result.errors) {
                this.logger.log(`Auto-sync ML ventas conexión ${connection.id}: ${JSON.stringify(result)}`);
              }
            } catch (err: any) {
              this.logger.error(`Auto-sync ML ventas falló para conexión ${connection.id}: ${err?.message || err}`);
            }
            // Preguntas y reclamos/devoluciones van aparte: si una falla (p.ej. token
            // vencido a mitad de camino) no debe impedir que la otra corra igual.
            try {
              const result = await this.mercadolibre.syncQuestions(connection.id, SYSTEM_USER);
              if (result.synced) {
                this.logger.log(`Auto-sync ML preguntas conexión ${connection.id}: ${JSON.stringify(result)}`);
              }
            } catch (err: any) {
              this.logger.error(`Auto-sync ML preguntas falló para conexión ${connection.id}: ${err?.message || err}`);
            }
            try {
              const result = await this.mercadolibre.syncClaims(connection.id, SYSTEM_USER);
              if (result.synced) {
                this.logger.log(`Auto-sync ML reclamos/devoluciones conexión ${connection.id}: ${JSON.stringify(result)}`);
              }
            } catch (err: any) {
              this.logger.error(`Auto-sync ML reclamos/devoluciones falló para conexión ${connection.id}: ${err?.message || err}`);
            }
            break;
          }
          default: {
            // SHOPIFY, WOOCOMMERCE, FALABELLA, PARIS, HITES, RIPLEY, WALMART, JUMPSELLER:
            // el auto-sync aún no está implementado. El check queda activo y esta rama se
            // activará sola cuando se agregue el importador de la plataforma.
            const key = `${connection.marketplace}`;
            if (!this.warnedUnsupported.has(key)) {
              this.logger.warn(`Auto-sync para ${connection.marketplace} aún no implementado; se omite`);
              this.warnedUnsupported.add(key);
            }
            break;
          }
        }
      }
    } finally {
      this.isRunning = false;
    }
  }
}
