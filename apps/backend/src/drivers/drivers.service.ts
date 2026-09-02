import {
  Injectable, ForbiddenException, NotFoundException, BadRequestException,
} from '@nestjs/common';
import { Role, StopOutcome, DriverPaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import {
  UpsertDriverProfileDto, SetOutcomeDto, RangeDto, CreatePaymentBatchDto,
} from './dto/drivers.dto';

@Injectable()
export class DriversService {
  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
  ) {}

  private companyId(user: any): string {
    if (user.role === Role.SUPER_ADMIN) throw new BadRequestException('Selecciona una empresa (inicia sesión como admin de empresa)');
    if (!user.companyId) throw new ForbiddenException('Usuario sin empresa');
    return user.companyId;
  }

  private range(dto: RangeDto) {
    const to = dto.to ? new Date(dto.to) : new Date();
    to.setHours(23, 59, 59, 999);
    const from = dto.from ? new Date(dto.from) : new Date(to.getTime() - 30 * 24 * 3600 * 1000);
    from.setHours(0, 0, 0, 0);
    return { from, to };
  }

  private async assertDriverOfCompany(driverId: string, companyId: string) {
    const d = await this.prisma.user.findUnique({ where: { id: driverId }, select: { companyId: true, role: true } });
    if (!d || d.companyId !== companyId || d.role !== Role.DESPACHADOR) {
      throw new BadRequestException('Repartidor no válido para esta empresa');
    }
  }

  // ── Flota ──────────────────────────────────────────────────────────────────
  async fleet(user: any) {
    const companyId = this.companyId(user);
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);

    const drivers = await this.prisma.user.findMany({
      where: { companyId, role: Role.DESPACHADOR },
      select: {
        id: true, name: true, email: true, active: true,
        driverProfile: true,
        dispatchRoutes: {
          where: { date: { gte: startOfDay } },
          select: { id: true, status: true, stops: { select: { outcome: true } } },
        },
      },
      orderBy: { name: 'asc' },
    });

    return drivers.map((d) => {
      const stopsToday = d.dispatchRoutes.flatMap((r) => r.stops);
      const delivered = stopsToday.filter((s) => s.outcome === StopOutcome.DELIVERED).length;
      return {
        id: d.id,
        name: d.name,
        email: d.email,
        active: d.active,
        profile: d.driverProfile,
        today: { routes: d.dispatchRoutes.length, stops: stopsToday.length, delivered },
      };
    });
  }

  async upsertProfile(user: any, driverId: string, dto: UpsertDriverProfileDto) {
    const companyId = this.companyId(user);
    await this.assertDriverOfCompany(driverId, companyId);
    const data: Prisma.DriverProfileUncheckedCreateInput = {
      userId: driverId,
      phone: dto.phone,
      address: dto.address,
      zone: dto.zone,
      notes: dto.notes,
      payModel: dto.payModel,
      flatRate: dto.flatRate,
      perPackageRate: dto.perPackageRate,
      active: dto.active,
    };
    return this.prisma.driverProfile.upsert({
      where: { userId: driverId },
      update: { ...data, userId: undefined },
      create: data,
    });
  }

  // ── Outcome de una parada ──────────────────────────────────────────────────
  async setOutcome(user: any, stopId: string, dto: SetOutcomeDto) {
    const companyId = this.companyId(user);
    const stop = await this.prisma.routeStop.findUnique({
      where: { id: stopId },
      include: { route: { select: { companyId: true } }, order: { select: { id: true } } },
    });
    if (!stop) throw new NotFoundException('Parada no encontrada');
    if (stop.route.companyId !== companyId) throw new ForbiddenException();
    if (stop.driverPaymentId) throw new BadRequestException('Parada ya incluida en un pago; no se puede cambiar');

    const delivered = dto.outcome === StopOutcome.DELIVERED;
    await this.prisma.$transaction([
      this.prisma.routeStop.update({
        where: { id: stopId },
        data: {
          outcome: dto.outcome,
          notes: dto.notes ?? stop.notes,
          attemptedAt: new Date(),
          deliveredAt: delivered ? (stop.deliveredAt ?? new Date()) : null,
        },
      }),
      ...(delivered
        ? [this.prisma.order.update({ where: { id: stop.orderId }, data: { status: 'DELIVERED', deliveredAt: new Date() } })]
        : []),
    ]);
    return { ok: true };
  }

  // ── Métricas ───────────────────────────────────────────────────────────────
  async metrics(user: any, dto: RangeDto) {
    const companyId = this.companyId(user);
    const { from, to } = this.range(dto);

    const stops = await this.prisma.routeStop.findMany({
      where: {
        route: { companyId, ...(dto.driverId ? { dispatcherId: dto.driverId } : {}) },
        attemptedAt: { gte: from, lte: to },
      },
      select: {
        outcome: true, attemptedAt: true, deliveredAt: true,
        order: { select: { scheduledDate: true } },
      },
    });

    const byOutcome: Record<string, number> = {};
    let onTime = 0, late = 0;
    const weekly = new Map<string, { onTime: number; late: number }>();

    for (const s of stops) {
      byOutcome[s.outcome] = (byOutcome[s.outcome] || 0) + 1;
      if (s.outcome === StopOutcome.DELIVERED && s.deliveredAt) {
        const due = s.order.scheduledDate;
        const isLate = due ? s.deliveredAt.getTime() > new Date(due).setHours(23, 59, 59, 999) : false;
        isLate ? late++ : onTime++;
        const wk = weekKey(s.deliveredAt);
        const e = weekly.get(wk) || { onTime: 0, late: 0 };
        e[isLate ? 'late' : 'onTime']++;
        weekly.set(wk, e);
      }
    }
    const totalDelivered = onTime + late;

    return {
      range: { from, to },
      totals: {
        attempts: stops.length,
        delivered: totalDelivered,
        onTime,
        late,
        onTimeRate: totalDelivered ? Math.round((onTime / totalDelivered) * 100) : null,
      },
      byOutcome,
      weekly: [...weekly.entries()]
        .sort()
        .map(([week, v]) => ({ week, ...v, rate: v.onTime + v.late ? Math.round((v.onTime / (v.onTime + v.late)) * 100) : 0 })),
      // Hook para reputación de marketplace (ML/Falabella): se completará al
      // integrar sus endpoints de reputación.
      marketplaceReputation: null,
    };
  }

  // ── Remuneración ───────────────────────────────────────────────────────────
  async paymentsSummary(user: any, dto: RangeDto) {
    const companyId = this.companyId(user);
    const { from, to } = this.range(dto);

    const drivers = await this.prisma.user.findMany({
      where: { companyId, role: Role.DESPACHADOR },
      select: {
        id: true, name: true, driverProfile: true,
        dispatchRoutes: {
          select: {
            stops: {
              where: { outcome: StopOutcome.DELIVERED, driverPaymentId: null, deliveredAt: { gte: from, lte: to } },
              select: { id: true },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    return drivers.map((d) => {
      const stopIds = d.dispatchRoutes.flatMap((r) => r.stops.map((s) => s.id));
      const rate = Number(d.driverProfile?.perPackageRate ?? 0);
      const flat = Number(d.driverProfile?.flatRate ?? 0);
      const model = d.driverProfile?.payModel ?? 'FLAT';
      const owed = model === 'PER_PACKAGE' ? stopIds.length * rate : (stopIds.length > 0 ? flat : 0);
      return {
        driverId: d.id,
        name: d.name,
        payModel: model,
        rate: model === 'PER_PACKAGE' ? rate : flat,
        pendingPackages: stopIds.length,
        pendingAmount: owed,
        stopIds,
      };
    });
  }

  async createPaymentBatch(user: any, dto: CreatePaymentBatchDto) {
    const companyId = this.companyId(user);
    await this.assertDriverOfCompany(dto.driverId, companyId);

    const stops = await this.prisma.routeStop.findMany({
      where: {
        id: { in: dto.stopIds },
        driverPaymentId: null,
        outcome: StopOutcome.DELIVERED,
        route: { companyId, dispatcherId: dto.driverId },
      },
      select: { id: true, deliveredAt: true },
    });
    if (stops.length === 0) throw new BadRequestException('Ninguna parada válida para pagar');

    const profile = await this.prisma.driverProfile.findUnique({ where: { userId: dto.driverId } });
    const model = profile?.payModel ?? 'FLAT';
    const amount = model === 'PER_PACKAGE'
      ? stops.length * Number(profile?.perPackageRate ?? 0)
      : Number(profile?.flatRate ?? 0);

    const dates = stops.map((s) => s.deliveredAt!.getTime());
    const batch = await this.prisma.$transaction(async (tx) => {
      const b = await tx.driverPayment.create({
        data: {
          companyId,
          driverId: dto.driverId,
          createdById: user.id,
          periodFrom: new Date(Math.min(...dates)),
          periodTo: new Date(Math.max(...dates)),
          packages: stops.length,
          amount,
          notes: dto.notes,
        },
      });
      await tx.routeStop.updateMany({
        where: { id: { in: stops.map((s) => s.id) } },
        data: { driverPaymentId: b.id },
      });
      return b;
    });
    return batch;
  }

  async listPaymentBatches(user: any, dto: RangeDto) {
    const companyId = this.companyId(user);
    return this.prisma.driverPayment.findMany({
      where: { companyId, ...(dto.driverId ? { driverId: dto.driverId } : {}) },
      include: { driver: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async markPaymentPaid(user: any, id: string) {
    const companyId = this.companyId(user);
    const batch = await this.prisma.driverPayment.findUnique({ where: { id } });
    if (!batch || batch.companyId !== companyId) throw new NotFoundException('Lote no encontrado');
    if (batch.status === DriverPaymentStatus.PAID) return batch;
    return this.prisma.driverPayment.update({
      where: { id },
      data: { status: DriverPaymentStatus.PAID, paidAt: new Date() },
    });
  }

  // ── Zonas de demanda ───────────────────────────────────────────────────────
  async zones(user: any, dto: RangeDto) {
    const companyId = this.companyId(user);
    const { from, to } = this.range(dto);

    const orders = await this.prisma.order.findMany({
      where: { companyId, createdAt: { gte: from, lte: to }, commune: { not: null } },
      select: { commune: true, deliveredAt: true },
    });

    const map = new Map<string, { total: number; delivered: number }>();
    for (const o of orders) {
      const c = (o.commune || '').trim();
      if (!c) continue;
      const e = map.get(c) || { total: 0, delivered: 0 };
      e.total++;
      if (o.deliveredAt) e.delivered++;
      map.set(c, e);
    }
    const zones = [...map.entries()]
      .map(([commune, v]) => ({ commune, ...v }))
      .sort((a, b) => b.total - a.total);

    const max = zones[0]?.total || 1;
    const withLevel = zones.map((z) => ({
      ...z,
      level: z.total >= max * 0.66 ? 'alta' : z.total >= max * 0.33 ? 'media' : 'baja',
    }));

    return {
      range: { from, to },
      mapsKey: await this.settings.get('GOOGLE_MAPS_KEY'),
      zones: withLevel,
    };
  }
}

function weekKey(d: Date): string {
  const dt = new Date(d);
  const day = (dt.getDay() + 6) % 7; // lunes=0
  dt.setDate(dt.getDate() - day);
  return dt.toISOString().slice(0, 10);
}
