import { Controller, Get, Post, Param, Query, UseGuards } from '@nestjs/common';
import { Role, SyncQueueStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

// Fase 8: visibilidad/auditoría de la cola de sincronización — qué está pendiente,
// cuál falló y por qué, con reintento manual.
@Controller('sync-queue')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
export class SyncQueueController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async list(@CurrentUser() user: any, @Query('status') status?: SyncQueueStatus, @Query('companyId') companyId?: string) {
    const cid = user.role === Role.SUPER_ADMIN ? companyId : user.companyId;
    return this.prisma.syncQueueItem.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(cid ? { product: { companyId: cid } } : {}),
      },
      include: {
        product: { select: { id: true, name: true, sku: true } },
        connection: { select: { id: true, name: true, marketplace: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  @Post(':id/retry')
  async retry(@Param('id') id: string, @CurrentUser() user: any) {
    const item = await this.prisma.syncQueueItem.findUnique({ where: { id }, include: { product: true } });
    if (!item) return { retried: false };
    if (user.role !== Role.SUPER_ADMIN && item.product.companyId !== user.companyId) return { retried: false };
    await this.prisma.syncQueueItem.update({
      where: { id },
      data: { status: SyncQueueStatus.PENDING, lastError: null },
    });
    return { retried: true };
  }
}
