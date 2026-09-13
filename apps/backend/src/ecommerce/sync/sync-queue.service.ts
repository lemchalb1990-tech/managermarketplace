import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SyncQueueField, SyncQueueStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SyncService } from './sync.service';

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 20;

// Fase 8 (motor de sincronización, ver auditoría): cola con reintentos y trazabilidad —
// si Mercado Libre o Jumpseller están caídos cuando algo cambia, el cambio no se pierde,
// se reintenta en el próximo tick hasta MAX_ATTEMPTS antes de marcarse FAILED para
// revisión. Solo Stock y Precio se procesan solos acá (reglas "⚡ Inmediata" y
// "🔄 Automática controlada" del plan) — Título/Imágenes/Descripción/Categoría/Atributos
// quedan en PENDING para revisión manual a propósito (regla "🛡️ Validar"): esta cola no
// les inventa un push automático que el plan explícitamente no pidió.
@Injectable()
export class SyncQueueService {
  private readonly logger = new Logger(SyncQueueService.name);
  private isRunning = false;

  constructor(
    private prisma: PrismaService,
    private sync: SyncService,
  ) {}

  async enqueue(productId: string, connectionId: string, field: SyncQueueField, payload?: Record<string, any>) {
    return this.prisma.syncQueueItem.create({
      data: { productId, connectionId, field, payload: payload ?? undefined },
    });
  }

  @Cron('*/2 * * * *')
  async processPending() {
    if (this.isRunning) {
      this.logger.warn('SyncQueue: la corrida anterior sigue en curso, se omite este ciclo');
      return;
    }
    this.isRunning = true;
    try {
      const items = await this.prisma.syncQueueItem.findMany({
        where: { status: SyncQueueStatus.PENDING, field: { in: [SyncQueueField.STOCK, SyncQueueField.PRICE] } },
        include: { product: true },
        take: BATCH_SIZE,
        orderBy: { createdAt: 'asc' },
      });

      for (const item of items) {
        await this.prisma.syncQueueItem.update({ where: { id: item.id }, data: { status: SyncQueueStatus.PROCESSING } });
        try {
          if (item.field === SyncQueueField.STOCK) {
            await this.sync.syncProduct(item.productId, item.product.stock);
          } else {
            await this.sync.syncProduct(item.productId, item.product.stock, Number(item.product.mlPrice ?? item.product.price));
          }
          await this.prisma.syncQueueItem.update({
            where: { id: item.id },
            data: { status: SyncQueueStatus.DONE, processedAt: new Date() },
          });
        } catch (err: any) {
          const attempts = item.attempts + 1;
          const failed = attempts >= MAX_ATTEMPTS;
          await this.prisma.syncQueueItem.update({
            where: { id: item.id },
            data: {
              status: failed ? SyncQueueStatus.FAILED : SyncQueueStatus.PENDING,
              attempts,
              lastError: (err?.message || String(err)).slice(0, 500),
            },
          });
          this.logger.error(`SyncQueue item ${item.id} (${item.field}) falló, intento ${attempts}${failed ? ' — se marca FAILED' : ''}: ${err?.message || err}`);
        }
      }
    } finally {
      this.isRunning = false;
    }
  }
}
