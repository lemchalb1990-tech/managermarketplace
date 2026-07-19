import {
  Injectable, NotFoundException, ForbiddenException,
  BadRequestException, ConflictException,
} from '@nestjs/common';
import { FulfillmentType, OrderStatus, Role, RouteStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateRouteDto, UpdateRouteDto, AddStopDto,
  ReorderStopsDto, DeliverStopDto, FindRoutesDto,
} from './dto/dispatch.dto';

const ROUTE_INCLUDE = {
  dispatcher: { select: { id: true, name: true, email: true } },
  createdBy: { select: { id: true, name: true } },
  company: { select: { id: true, name: true } },
  stops: {
    orderBy: { position: 'asc' as const },
    include: {
      order: {
        select: {
          id: true,
          customerName: true,
          customerPhone: true,
          customerEmail: true,
          address: true,
          commune: true,
          city: true,
          status: true,
          fulfillmentType: true,
          sale: { select: { channel: true, total: true } },
          itemChecks: { select: { productName: true, expectedQty: true, checked: true } },
        },
      },
    },
  },
};

@Injectable()
export class DispatchService {
  constructor(private prisma: PrismaService) {}

  private guard(route: any, user: any) {
    if (user.role === Role.SUPER_ADMIN) return;
    if (user.role === Role.DESPACHADOR) {
      if (route.dispatcherId !== user.id || route.companyId !== user.companyId) throw new ForbiddenException();
      return;
    }
    if (route.companyId !== user.companyId) throw new ForbiddenException();
  }

  private requireAdmin(user: any) {
    if (![Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER].includes(user.role)) {
      throw new ForbiddenException('Acción solo disponible para administradores');
    }
  }

  async findAll(user: any, query: FindRoutesDto) {
    const where: any = {};

    if (user.role === Role.SUPER_ADMIN) {
      if (query.companyId) where.companyId = query.companyId;
    } else if (user.role === Role.DESPACHADOR) {
      where.dispatcherId = user.id;
      where.companyId = user.companyId;
    } else {
      where.companyId = user.companyId;
    }

    if (query.status) where.status = query.status;
    if (query.dispatcherId && user.role !== Role.DESPACHADOR) where.dispatcherId = query.dispatcherId;
    if (query.date) {
      const d = new Date(query.date);
      where.date = d;
    }

    return this.prisma.dispatchRoute.findMany({
      where,
      include: {
        dispatcher: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        _count: { select: { stops: true } },
        stops: { select: { deliveredAt: true } },
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async findOne(id: string, user: any) {
    const route = await this.prisma.dispatchRoute.findUnique({ where: { id }, include: ROUTE_INCLUDE });
    if (!route) throw new NotFoundException('Ruta no encontrada');
    this.guard(route, user);
    return route;
  }

  async create(dto: CreateRouteDto, user: any) {
    this.requireAdmin(user);
    const companyId = user.role === Role.SUPER_ADMIN
      ? (await this.prisma.user.findUnique({ where: { id: dto.dispatcherId || '' } }))?.companyId ?? user.companyId
      : user.companyId;

    if (dto.dispatcherId) {
      const dispatcher = await this.prisma.user.findUnique({ where: { id: dto.dispatcherId }, select: { companyId: true } });
      if (!dispatcher || dispatcher.companyId !== companyId) {
        throw new BadRequestException('El despachador seleccionado no pertenece a esta empresa');
      }
    }

    return this.prisma.dispatchRoute.create({
      data: {
        name: dto.name,
        date: new Date(dto.date),
        notes: dto.notes,
        companyId,
        dispatcherId: dto.dispatcherId || undefined,
        createdById: user.id,
      },
      include: ROUTE_INCLUDE,
    });
  }

  async update(id: string, dto: UpdateRouteDto, user: any) {
    const route = await this.findOne(id, user);
    this.requireAdmin(user);
    if (route.status === RouteStatus.COMPLETED || route.status === RouteStatus.CANCELLED) {
      throw new BadRequestException('No se puede modificar una ruta finalizada');
    }
    if (dto.dispatcherId) {
      const dispatcher = await this.prisma.user.findUnique({ where: { id: dto.dispatcherId }, select: { companyId: true } });
      if (!dispatcher || dispatcher.companyId !== route.companyId) {
        throw new BadRequestException('El despachador seleccionado no pertenece a esta empresa');
      }
    }
    return this.prisma.dispatchRoute.update({
      where: { id },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.date && { date: new Date(dto.date) }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...(dto.dispatcherId !== undefined && { dispatcherId: dto.dispatcherId || null }),
        ...(dto.status && { status: dto.status }),
      },
      include: ROUTE_INCLUDE,
    });
  }

  async remove(id: string, user: any) {
    const route = await this.findOne(id, user);
    this.requireAdmin(user);
    if (route.status === RouteStatus.IN_PROGRESS) {
      throw new BadRequestException('No se puede eliminar una ruta en progreso');
    }
    return this.prisma.dispatchRoute.delete({ where: { id } });
  }

  async startRoute(id: string, user: any) {
    const route = await this.findOne(id, user);
    if (route.status !== RouteStatus.PENDING) {
      throw new BadRequestException('La ruta ya fue iniciada');
    }
    return this.prisma.dispatchRoute.update({
      where: { id },
      data: { status: RouteStatus.IN_PROGRESS, startedAt: new Date() },
      include: ROUTE_INCLUDE,
    });
  }

  async cancelRoute(id: string, user: any) {
    const route = await this.findOne(id, user);
    this.requireAdmin(user);
    if (route.status === RouteStatus.COMPLETED) {
      throw new BadRequestException('No se puede cancelar una ruta completada');
    }
    return this.prisma.dispatchRoute.update({
      where: { id },
      data: { status: RouteStatus.CANCELLED },
      include: ROUTE_INCLUDE,
    });
  }

  async getAvailableOrders(user: any) {
    this.requireAdmin(user);
    const where: any = {
      fulfillmentType: FulfillmentType.DELIVERY,
      status: OrderStatus.READY,
      routeStop: null,
    };
    if (user.role !== Role.SUPER_ADMIN) where.companyId = user.companyId;

    return this.prisma.order.findMany({
      where,
      select: {
        id: true,
        customerName: true,
        customerPhone: true,
        address: true,
        commune: true,
        city: true,
        sale: { select: { channel: true, total: true } },
        _count: { select: { itemChecks: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
  }

  async addStop(routeId: string, dto: AddStopDto, user: any) {
    const route = await this.findOne(routeId, user);
    this.requireAdmin(user);
    if (route.status === RouteStatus.COMPLETED || route.status === RouteStatus.CANCELLED) {
      throw new BadRequestException('No se puede modificar una ruta finalizada');
    }

    const order = await this.prisma.order.findUnique({
      where: { id: dto.orderId },
      include: { routeStop: true },
    });
    if (!order) throw new NotFoundException('Orden no encontrada');
    if (order.fulfillmentType !== FulfillmentType.DELIVERY) {
      throw new BadRequestException('Solo se pueden agregar órdenes de tipo Despacho');
    }
    if (order.status !== OrderStatus.READY) {
      throw new BadRequestException('La orden debe estar en estado Listo');
    }
    if (order.routeStop) {
      throw new ConflictException('Esta orden ya está asignada a una ruta');
    }
    if (user.role !== Role.SUPER_ADMIN && order.companyId !== user.companyId) {
      throw new ForbiddenException();
    }

    const agg = await this.prisma.routeStop.aggregate({
      where: { routeId },
      _max: { position: true },
    });
    const nextPos = (agg._max.position ?? 0) + 1;

    return this.prisma.routeStop.create({
      data: {
        routeId,
        orderId: dto.orderId,
        position: nextPos,
        lat: dto.lat,
        lng: dto.lng,
        notes: dto.notes,
      },
      include: {
        order: {
          select: {
            id: true, customerName: true, address: true, commune: true, city: true, status: true,
          },
        },
      },
    });
  }

  async removeStop(routeId: string, stopId: string, user: any) {
    const route = await this.findOne(routeId, user);
    this.requireAdmin(user);
    if (route.status === RouteStatus.COMPLETED) {
      throw new BadRequestException('No se puede modificar una ruta completada');
    }
    const stop = route.stops.find((s: any) => s.id === stopId);
    if (!stop) throw new NotFoundException('Parada no encontrada');
    if ((stop as any).deliveredAt) throw new BadRequestException('No se puede eliminar una parada ya entregada');

    return this.prisma.routeStop.delete({ where: { id: stopId } });
  }

  async reorderStops(routeId: string, dto: ReorderStopsDto, user: any) {
    const route = await this.findOne(routeId, user);
    this.requireAdmin(user);

    const validStopIds = new Set((route as any).stops.map((s: any) => s.id));
    for (const { stopId } of dto.positions) {
      if (!validStopIds.has(stopId)) throw new NotFoundException('Parada no encontrada en esta ruta');
    }

    await this.prisma.$transaction(
      dto.positions.map(({ stopId, position }) =>
        this.prisma.routeStop.update({ where: { id: stopId }, data: { position } }),
      ),
    );

    return this.findOne(routeId, user);
  }

  async optimizeRoute(routeId: string, user: any) {
    const route = await this.findOne(routeId, user);
    this.requireAdmin(user);

    const allStops: any[] = (route as any).stops;
    const withCoords = allStops.filter(s => s.lat != null && s.lng != null && !s.deliveredAt);
    const delivered = allStops.filter(s => s.deliveredAt);
    const withoutCoords = allStops.filter(s => (s.lat == null || s.lng == null) && !s.deliveredAt);

    if (withCoords.length < 2) return route;

    // Nearest-neighbor algorithm (Euclidean distance between lat/lng)
    const visited = new Set<string>();
    const ordered: any[] = [];
    let current = withCoords[0];
    visited.add(current.id);
    ordered.push(current);

    while (visited.size < withCoords.length) {
      let nearest: any = null;
      let minDist = Infinity;
      for (const stop of withCoords) {
        if (visited.has(stop.id)) continue;
        const dist = Math.hypot(stop.lat - current.lat, stop.lng - current.lng);
        if (dist < minDist) { minDist = dist; nearest = stop; }
      }
      if (!nearest) break;
      visited.add(nearest.id);
      ordered.push(nearest);
      current = nearest;
    }

    // Final order: delivered (keep positions) + optimized undelivered + uncoordinated
    const allReordered = [...delivered.sort((a, b) => a.position - b.position), ...ordered, ...withoutCoords];

    await this.prisma.$transaction(
      allReordered.map((stop, i) =>
        this.prisma.routeStop.update({ where: { id: stop.id }, data: { position: i + 1 } }),
      ),
    );

    return this.findOne(routeId, user);
  }

  async deliverStop(routeId: string, stopId: string, dto: DeliverStopDto, user: any) {
    const route = await this.findOne(routeId, user);

    if (route.status !== RouteStatus.IN_PROGRESS) {
      throw new BadRequestException('La ruta debe estar en progreso para registrar entregas');
    }
    if (user.role === Role.DESPACHADOR && (route as any).dispatcherId !== user.id) {
      throw new ForbiddenException();
    }

    const stop = (route as any).stops.find((s: any) => s.id === stopId);
    if (!stop) throw new NotFoundException('Parada no encontrada');
    if (stop.deliveredAt) throw new BadRequestException('Esta parada ya fue entregada');

    const now = new Date();

    await this.prisma.$transaction([
      this.prisma.routeStop.update({
        where: { id: stopId },
        data: { deliveredAt: now, notes: dto.notes || stop.notes },
      }),
      this.prisma.order.update({
        where: { id: stop.orderId },
        data: { status: OrderStatus.DELIVERED, deliveredAt: now },
      }),
    ]);

    // Auto-complete route if all stops delivered
    const updatedRoute = await this.prisma.dispatchRoute.findUnique({
      where: { id: routeId },
      include: { stops: { select: { deliveredAt: true } } },
    });
    const allDone = updatedRoute!.stops.every(s => s.deliveredAt != null);
    if (allDone) {
      await this.prisma.dispatchRoute.update({
        where: { id: routeId },
        data: { status: RouteStatus.COMPLETED, completedAt: now },
      });
    }

    return this.findOne(routeId, user);
  }
}
