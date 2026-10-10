import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CourierProvider, CourierShipmentStatus, OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../common/storage/storage.service';
import { assertIntegrationsEnabled, integrationsDisabled } from '../common/integrations.util';
import { assertSameCompany, companyWhere, resolveCompanyId } from '../common/tenant';
import { CourierAdapter, CourierCredentials, CourierSettings, Destination, PackageInfo } from './courier.types';
import { chilexpressAdapter } from './providers/chilexpress.adapter';
import { starkenAdapter } from './providers/starken.adapter';
import { bluexpressAdapter } from './providers/bluexpress.adapter';

const ADAPTERS: Record<CourierProvider, CourierAdapter> = {
  CHILEXPRESS: chilexpressAdapter,
  STARKEN: starkenAdapter,
  BLUEXPRESS: bluexpressAdapter,
};

export const COURIER_NAMES: Record<CourierProvider, string> = {
  CHILEXPRESS: 'Chilexpress',
  STARKEN: 'Starken',
  BLUEXPRESS: 'Blue Express',
};

const FINAL: CourierShipmentStatus[] = ['DELIVERED', 'CANCELLED'];

@Injectable()
export class CouriersService {
  private readonly logger = new Logger(CouriersService.name);

  constructor(private prisma: PrismaService, private storage: StorageService) {}

  private provider(p: string): CourierProvider {
    const key = String(p || '').toUpperCase() as CourierProvider;
    if (!ADAPTERS[key]) throw new BadRequestException('Courier no soportado');
    return key;
  }

  // Nunca se devuelven las credenciales: solo qué campos están cargados.
  private sanitize(c: any) {
    const creds = (c.credentials || {}) as Record<string, string>;
    return {
      id: c.id, provider: c.provider, name: COURIER_NAMES[c.provider as CourierProvider], active: c.active,
      settings: c.settings || {}, credentialKeys: Object.keys(creds).filter((k) => !!creds[k]),
      updatedAt: c.updatedAt,
    };
  }

  // ── Conexiones ────────────────────────────────────────────────────────

  async list(user: any, companyId?: string) {
    const cId = resolveCompanyId(user, companyId);
    const rows = await this.prisma.courierConnection.findMany({ where: { companyId: cId }, orderBy: { provider: 'asc' } });
    return rows.map((r) => this.sanitize(r));
  }

  async upsert(user: any, providerRaw: string, dto: { companyId?: string; credentials?: Record<string, string>; settings?: CourierSettings; active?: boolean }) {
    const provider = this.provider(providerRaw);
    const companyId = resolveCompanyId(user, dto.companyId);
    // Los couriers nacen desactivados: solo se conectan cuando el Super Admin los habilita.
    if (user?.role !== 'SUPER_ADMIN') {
      const row = await this.prisma.platformSetting.findUnique({ where: { platform: provider.toLowerCase() }, select: { status: true } });
      if ((row?.status || 'DISABLED') !== 'AVAILABLE') throw new ForbiddenException(`${COURIER_NAMES[provider]} no está disponible por ahora`);
    }
    const prev = await this.prisma.courierConnection.findUnique({ where: { companyId_provider: { companyId, provider } } });
    // Las credenciales vacías no borran las guardadas (el formulario no las muestra).
    const credentials = { ...((prev?.credentials as Record<string, string>) || {}) };
    for (const [k, v] of Object.entries(dto.credentials || {})) if (v != null && String(v).trim() !== '') credentials[k] = String(v).trim();
    const settings = { ...((prev?.settings as object) || {}), ...(dto.settings || {}) };
    const row = await this.prisma.courierConnection.upsert({
      where: { companyId_provider: { companyId, provider } },
      update: { credentials, settings: settings as Prisma.InputJsonValue, active: dto.active ?? prev?.active ?? true },
      create: { companyId, provider, credentials, settings: settings as Prisma.InputJsonValue, active: dto.active ?? true },
    });
    return this.sanitize(row);
  }

  async remove(user: any, providerRaw: string, companyId?: string) {
    const provider = this.provider(providerRaw);
    const cId = resolveCompanyId(user, companyId);
    const used = await this.prisma.courierShipment.count({ where: { companyId: cId, provider } });
    if (used > 0) {
      // Con envíos creados se desactiva en vez de borrar (el historial los necesita).
      await this.prisma.courierConnection.update({ where: { companyId_provider: { companyId: cId, provider } }, data: { active: false } });
      return { ok: true, deactivated: true };
    }
    await this.prisma.courierConnection.delete({ where: { companyId_provider: { companyId: cId, provider } } });
    return { ok: true };
  }

  private async connection(companyId: string, provider: CourierProvider) {
    const c = await this.prisma.courierConnection.findUnique({ where: { companyId_provider: { companyId, provider } } });
    if (!c || !c.active) throw new BadRequestException(`${COURIER_NAMES[provider]} no está conectado en esta empresa`);
    return { conn: c, creds: (c.credentials || {}) as CourierCredentials, settings: (c.settings || {}) as CourierSettings };
  }

  async test(user: any, providerRaw: string, companyId?: string) {
    assertIntegrationsEnabled();
    const provider = this.provider(providerRaw);
    const { creds, settings } = await this.connection(resolveCompanyId(user, companyId), provider);
    try {
      return { ok: true, message: await ADAPTERS[provider].test(creds, settings) };
    } catch (e: any) {
      return { ok: false, message: e?.message || 'No se pudo conectar' };
    }
  }

  // ── Orden → destino y paquete ─────────────────────────────────────────

  private async loadOrder(user: any, orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { sale: { include: { items: { include: { product: { select: { name: true } } } } } } },
    });
    if (!order) throw new NotFoundException('Orden no encontrada');
    assertSameCompany(order, user);
    return order;
  }

  private destination(order: any, override?: Partial<Destination>): Destination {
    const d: Destination = {
      name: override?.name || order.customerName || 'Cliente',
      phone: override?.phone ?? order.customerPhone ?? '',
      email: override?.email ?? order.customerEmail ?? '',
      address: override?.address || order.address || '',
      number: override?.number || '',
      supplement: override?.supplement || '',
      commune: override?.commune || order.commune || order.city || '',
      region: override?.region || order.region || '',
    };
    if (!d.address) throw new BadRequestException('La orden no tiene dirección de despacho');
    if (!d.commune) throw new BadRequestException('La orden no tiene comuna de despacho');
    return d;
  }

  private pkg(order: any, settings: CourierSettings, p?: Partial<PackageInfo>): PackageInfo {
    const items = order.sale?.items || [];
    const total = order.sale?.total != null ? Number(order.sale.total) : 0;
    const content = items.map((i: any) => `${i.quantity}x ${i.product?.name || ''}`).join(', ') || 'Mercadería';
    return {
      weight: Number(p?.weight || settings.defaultWeight || 1),
      length: Number(p?.length || settings.defaultLength || 20),
      width: Number(p?.width || settings.defaultWidth || 20),
      height: Number(p?.height || settings.defaultHeight || 10),
      declaredValue: Number(p?.declaredValue || total || 1000),
      content: (p?.content || content).slice(0, 100),
    };
  }

  // Cotiza con todos los couriers conectados de la empresa (los que fallen muestran su error).
  async quote(user: any, orderId: string, body: { destination?: Partial<Destination>; package?: Partial<PackageInfo> }) {
    assertIntegrationsEnabled();
    const order = await this.loadOrder(user, orderId);
    const conns = await this.prisma.courierConnection.findMany({ where: { companyId: order.companyId, active: true } });
    if (!conns.length) throw new BadRequestException('No hay couriers conectados. Conéctalos en Configuración → Couriers.');
    const dest = this.destination(order, body.destination);
    return Promise.all(conns.map(async (c) => {
      const settings = (c.settings || {}) as CourierSettings;
      try {
        const options = await ADAPTERS[c.provider].quote((c.credentials || {}) as CourierCredentials, settings, dest, this.pkg(order, settings, body.package));
        return { provider: c.provider, name: COURIER_NAMES[c.provider], options, error: null };
      } catch (e: any) {
        return { provider: c.provider, name: COURIER_NAMES[c.provider], options: [], error: e?.message || 'No se pudo cotizar' };
      }
    }));
  }

  // Crea el envío con el courier, guarda la etiqueta y deja la orden con courier y seguimiento.
  async create(user: any, orderId: string, body: { provider: string; serviceCode?: string; price?: number; destination?: Partial<Destination>; package?: Partial<PackageInfo> }) {
    assertIntegrationsEnabled();
    const provider = this.provider(body.provider);
    const order = await this.loadOrder(user, orderId);
    const { conn, creds, settings } = await this.connection(order.companyId, provider);
    const dest = this.destination(order, body.destination);
    const pkg = this.pkg(order, settings, body.package);
    const reference = order.sale?.saleNumber ? `VENTA-${order.sale.saleNumber}` : `ORD-${order.id.slice(-8).toUpperCase()}`;

    const created = await ADAPTERS[provider].create(creds, settings, { dest, pkg, serviceCode: body.serviceCode, reference });

    let labelUrl = created.labelUrl || null;
    if (created.label) {
      const stored = await this.storage.put(created.label.bytes, `etiqueta-${provider.toLowerCase()}-${created.trackingNumber}.${created.label.ext}`, created.label.mime, { folder: 'courier-labels' });
      labelUrl = stored.url;
    }
    const shipment = await this.prisma.courierShipment.create({
      data: {
        provider, trackingNumber: created.trackingNumber, serviceName: created.serviceName || null,
        price: created.price ?? body.price ?? null, labelUrl, weight: pkg.weight,
        companyId: order.companyId, orderId: order.id, connectionId: conn.id, createdById: user?.id || null,
        events: [] as Prisma.InputJsonValue,
      },
    });
    await this.prisma.order.update({ where: { id: order.id }, data: { courier: COURIER_NAMES[provider], trackingCode: created.trackingNumber } });
    await this.prisma.orderStatusEvent.create({
      data: {
        orderId: order.id, source: 'COURIER', title: `Envío creado con ${COURIER_NAMES[provider]}`,
        detail: `Seguimiento ${created.trackingNumber}${created.serviceName ? ` · ${created.serviceName}` : ''}`,
        externalKey: `courier:${provider}:${created.trackingNumber}:created`, actorName: user?.name || null, occurredAt: new Date(),
      },
    }).catch(() => {});
    return shipment;
  }

  async listForOrder(user: any, orderId: string) {
    const order = await this.loadOrder(user, orderId);
    return this.prisma.courierShipment.findMany({ where: { orderId: order.id }, orderBy: { createdAt: 'desc' } });
  }

  async list_(user: any, query: { status?: string; companyId?: string }) {
    const where: Prisma.CourierShipmentWhereInput = { ...companyWhere(user) };
    if (query.companyId) where.companyId = resolveCompanyId(user, query.companyId);
    if (query.status) where.status = query.status as CourierShipmentStatus;
    return this.prisma.courierShipment.findMany({
      where, orderBy: { createdAt: 'desc' }, take: 200,
      include: { order: { select: { id: true, customerName: true, commune: true, sale: { select: { saleNumber: true } } } } },
    });
  }

  // ── Seguimiento ───────────────────────────────────────────────────────

  async refresh(user: any, shipmentId: string) {
    assertIntegrationsEnabled();
    const s = await this.prisma.courierShipment.findUnique({ where: { id: shipmentId } });
    if (!s) throw new NotFoundException('Envío no encontrado');
    assertSameCompany(s, user);
    return this.sync(s.id);
  }

  private async sync(shipmentId: string) {
    const s = await this.prisma.courierShipment.findUniqueOrThrow({ where: { id: shipmentId }, include: { connection: true } });
    const adapter = ADAPTERS[s.provider];
    const res = await adapter.track((s.connection.credentials || {}) as CourierCredentials, (s.connection.settings || {}) as CourierSettings, s.trackingNumber);
    const delivered = res.state === 'DELIVERED';
    const updated = await this.prisma.courierShipment.update({
      where: { id: s.id },
      data: {
        status: res.state, statusText: res.statusText, events: res.events as unknown as Prisma.InputJsonValue,
        lastSyncAt: new Date(), deliveredAt: delivered ? s.deliveredAt || new Date() : s.deliveredAt,
      },
    });
    // La orden sigue al envío: en tránsito o entregada (sin retroceder estados).
    if (res.state !== s.status) {
      const next: OrderStatus | null = delivered ? 'DELIVERED' : ['IN_TRANSIT', 'OUT_FOR_DELIVERY'].includes(res.state) ? 'IN_TRANSIT' : null;
      const order = await this.prisma.order.findUnique({ where: { id: s.orderId }, select: { status: true } });
      const advance = next && order && order.status !== 'DELIVERED' && order.status !== 'CANCELLED' && order.status !== next;
      if (advance) {
        await this.prisma.order.update({ where: { id: s.orderId }, data: { status: next!, ...(delivered ? { deliveredAt: new Date() } : {}) } });
      }
      await this.prisma.orderStatusEvent.create({
        data: {
          orderId: s.orderId, source: 'COURIER', status: advance ? next : null,
          title: `${COURIER_NAMES[s.provider]}: ${res.statusText}`, externalStatus: res.state,
          externalKey: `courier:${s.provider}:${s.trackingNumber}:${res.state}`, occurredAt: new Date(),
        },
      }).catch(() => {});
    }
    return updated;
  }

  // Cada 2 horas se actualizan los envíos que no han terminado (últimos 30 días).
  @Cron('20 */2 * * *')
  async syncPending() {
    if (integrationsDisabled()) return;
    const since = new Date(Date.now() - 30 * 86400_000);
    const pending = await this.prisma.courierShipment.findMany({
      where: { status: { notIn: FINAL }, createdAt: { gte: since } }, select: { id: true }, take: 500,
    });
    for (const p of pending) {
      try { await this.sync(p.id); } catch (e: any) { this.logger.warn(`Seguimiento ${p.id}: ${e?.message}`); }
    }
  }
}
