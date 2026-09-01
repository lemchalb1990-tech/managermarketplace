import {
  Injectable, ForbiddenException, NotFoundException, BadRequestException,
} from '@nestjs/common';
import { OrderStatus, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BoardDto, DispatchDto } from './dto/shipping.dto';
import {
  CARRIER_GROUPS, CARRIER_ORDER, carrierGroupKey, resolveCutoffs, isOverdue,
} from './carriers';

const CARD_INCLUDE = {
  itemChecks: { select: { productName: true, productSku: true, expectedQty: true, checkedQty: true, outOfStock: true } },
  warehouse: { select: { id: true, name: true } },
  sale: { select: { id: true, channel: true, total: true, externalId: true, shippingMethod: true } },
  assignedTo: { select: { name: true } },
};

@Injectable()
export class ShippingService {
  constructor(private prisma: PrismaService) {}

  private baseWhere(user: any, warehouseId?: string) {
    const where: any = {};
    if (user.role !== Role.SUPER_ADMIN) {
      if (!user.companyId) throw new ForbiddenException('Usuario sin empresa');
      where.companyId = user.companyId;
    }
    if (warehouseId) where.warehouseId = warehouseId;
    return where;
  }

  private async companyCutoffs(user: any): Promise<Record<string, string>> {
    if (user.role === Role.SUPER_ADMIN) return resolveCutoffs(null);
    const company = await this.prisma.company.findUnique({
      where: { id: user.companyId },
      select: { dispatchCutoffs: true },
    });
    return resolveCutoffs(company?.dispatchCutoffs);
  }

  private card(o: any) {
    return {
      id: o.id,
      status: o.status,
      prepStage: o.prepStage,
      customerName: o.customerName,
      address: o.address,
      commune: o.commune,
      city: o.city,
      courier: o.courier,
      trackingCode: o.trackingCode,
      scheduledDate: o.scheduledDate,
      dispatchedAt: o.dispatchedAt,
      deliveredAt: o.deliveredAt,
      createdAt: o.createdAt,
      channel: o.sale?.channel ?? null,
      shippingMethod: o.sale?.shippingMethod ?? null,
      externalId: o.sale?.externalId ?? null,
      total: o.sale?.total ?? null,
      warehouse: o.warehouse?.name ?? null,
      assignedTo: o.assignedTo?.name ?? null,
      itemsTotal: o.itemChecks.length,
      itemsOos: o.itemChecks.filter((i: any) => i.outOfStock).length,
      carrier: carrierGroupKey(o.sale, o),
    };
  }

  async board(user: any, dto: BoardDto) {
    const scope = dto.scope || 'today';
    const base = this.baseWhere(user, dto.warehouseId);
    const cutoffs = await this.companyCutoffs(user);

    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const where: any = { ...base, AND: [] as any[] };
    if (dto.q?.trim()) {
      const q = dto.q.trim();
      where.AND.push({
        OR: [
          { customerName: { contains: q, mode: 'insensitive' } },
          { trackingCode: { contains: q, mode: 'insensitive' } },
          { id: q },
          { sale: { externalId: { contains: q } } },
        ],
      });
    }

    if (scope === 'today') {
      where.status = { in: [OrderStatus.PREPARING, OrderStatus.READY] };
      where.dispatchedAt = null;
      where.AND.push({ OR: [{ scheduledDate: null }, { scheduledDate: { lte: endOfToday } }] });
    } else if (scope === 'upcoming') {
      where.status = { in: [OrderStatus.PENDING, OrderStatus.PREPARING, OrderStatus.READY] };
      where.dispatchedAt = null;
      where.scheduledDate = { gt: endOfToday };
    } else if (scope === 'transit') {
      where.status = OrderStatus.IN_TRANSIT;
    } else {
      where.status = OrderStatus.DELIVERED;
      const from = new Date();
      from.setDate(from.getDate() - 30);
      where.deliveredAt = { gte: from };
    }

    const orders = await this.prisma.order.findMany({
      where,
      include: CARD_INCLUDE,
      orderBy: scope === 'done' ? { deliveredAt: 'desc' } : { createdAt: 'asc' },
      take: 500,
    });

    const cards = orders.map((o) => this.card(o));

    // Agrupar por transportista
    const byCarrier = new Map<string, any[]>();
    for (const c of cards) {
      if (!byCarrier.has(c.carrier)) byCarrier.set(c.carrier, []);
      byCarrier.get(c.carrier)!.push(c);
    }

    const now = new Date();
    const groups = CARRIER_ORDER
      .filter((k) => byCarrier.has(k))
      .map((k) => {
        const list = byCarrier.get(k)!;
        const cutoff = cutoffs[k];
        const overdue = scope === 'today' && isOverdue(cutoff, now);
        return {
          key: k,
          label: CARRIER_GROUPS[k].label,
          cutoff,
          overdue,
          total: list.length,
          orders: list.map((c) => ({ ...c, overdue: scope === 'today' && overdue })),
        };
      });

    return { scope, groups, total: cards.length };
  }

  async dispatch(user: any, dto: DispatchDto) {
    const base = this.baseWhere(user);
    const orders = await this.prisma.order.findMany({
      where: { ...base, id: { in: dto.orderIds } },
      select: { id: true, status: true, companyId: true },
    });
    const found = new Set(orders.map((o) => o.id));

    const dispatched: string[] = [];
    const skipped: { id: string; reason: string }[] = [];
    for (const id of dto.orderIds) {
      if (!found.has(id)) { skipped.push({ id, reason: 'No encontrada' }); continue; }
      const o = orders.find((x) => x.id === id)!;
      if (o.status !== OrderStatus.READY) {
        skipped.push({ id, reason: `Estado ${o.status}: debe estar Listo (empacado)` });
        continue;
      }
      dispatched.push(id);
    }

    if (dispatched.length) {
      await this.prisma.order.updateMany({
        where: { id: { in: dispatched } },
        data: {
          status: OrderStatus.IN_TRANSIT,
          dispatchedAt: new Date(),
          ...(dto.courier ? { courier: dto.courier } : {}),
          ...(dto.trackingCode && dispatched.length === 1 ? { trackingCode: dto.trackingCode } : {}),
        },
      });
    }

    return { dispatched: dispatched.length, skipped };
  }

  async slip(user: any, orderIds: string[]): Promise<string> {
    const base = this.baseWhere(user);
    const orders = await this.prisma.order.findMany({
      where: { ...base, id: { in: orderIds } },
      include: {
        itemChecks: { select: { productName: true, productSku: true, expectedQty: true } },
        sale: { select: { channel: true, externalId: true, shippingMethod: true } },
        company: { select: { name: true } },
        warehouse: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    if (orders.length === 0) throw new NotFoundException('Sin órdenes para la guía');

    const esc = (s: any) =>
      String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

    const pages = orders
      .map((o) => {
        const carrier = CARRIER_GROUPS[carrierGroupKey(o.sale, o)].label;
        const rows = o.itemChecks
          .map((it) => `<tr><td>${esc(it.productName)}</td><td class="sku">${esc(it.productSku)}</td><td class="qty">${it.expectedQty}</td></tr>`)
          .join('');
        return `
      <section class="slip">
        <header>
          <div><strong>${esc(o.company?.name || 'Empresa')}</strong><br><span class="muted">Guía de despacho</span></div>
          <div class="right">#${esc(o.id.slice(-8).toUpperCase())}<br><span class="muted">${new Date().toLocaleDateString('es-CL')}</span></div>
        </header>
        <div class="grid">
          <div><span class="k">Cliente</span>${esc(o.customerName || '—')}</div>
          <div><span class="k">Canal</span>${esc(o.sale?.channel || 'Interno')}${o.sale?.externalId ? ` · ${esc(o.sale.externalId)}` : ''}</div>
          <div><span class="k">Transportista</span>${esc(carrier)}</div>
          <div><span class="k">Bodega</span>${esc(o.warehouse?.name || '—')}</div>
          <div class="full"><span class="k">Dirección</span>${esc([o.address, o.commune, o.city].filter(Boolean).join(', ') || '—')}</div>
          ${o.trackingCode ? `<div class="full"><span class="k">Seguimiento</span>${esc(o.trackingCode)}</div>` : ''}
        </div>
        <table>
          <thead><tr><th>Producto</th><th class="sku">SKU</th><th class="qty">Cant.</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        ${o.notes ? `<p class="notes"><span class="k">Notas</span>${esc(o.notes)}</p>` : ''}
      </section>`;
      })
      .join('');

    return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>Guías de despacho</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; color:#1f1e1c; margin:0; background:#f4f3ef; }
  .slip { background:#fff; max-width:720px; margin:16px auto; padding:28px 32px; border:1px solid #e0ded8; page-break-after: always; }
  header { display:flex; justify-content:space-between; border-bottom:2px solid #1f1e1c; padding-bottom:10px; margin-bottom:14px; }
  header .right { text-align:right; }
  .muted { color:#8a8884; font-size:12px; }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:6px 20px; font-size:13px; margin-bottom:14px; }
  .grid .full { grid-column:1 / -1; }
  .k { display:block; font-size:10px; text-transform:uppercase; letter-spacing:.05em; color:#8a8884; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th, td { text-align:left; padding:6px 4px; border-bottom:1px solid #eeece7; }
  th { font-size:11px; text-transform:uppercase; color:#8a8884; }
  .sku { font-family:ui-monospace,monospace; } .qty { text-align:right; width:60px; }
  .notes { font-size:12px; margin-top:12px; }
  @media print { body { background:#fff; } .slip { border:0; margin:0; } }
</style></head>
<body>${pages}<script>window.onload=()=>setTimeout(()=>window.print(),300)</script></body></html>`;
  }
}
