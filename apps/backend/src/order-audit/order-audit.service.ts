import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InvoiceStatus, MarketplaceType, OrderStatus, Prisma, Role, SaleChannel } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { integrationsDisabled } from '../common/integrations.util';
import { MercadolibreService } from '../ecommerce/mercadolibre/mercadolibre.service';
import { ChannelOrdersService } from '../ecommerce/sync/channel-orders.service';

// Usuario sintético para los métodos de ML que piden "user" (igual que SalesImportCronService).
const SYSTEM_USER = { role: Role.SUPER_ADMIN } as any;

// Canales con importación de ventas (los mismos que el cron de ventas).
const AUDITED: MarketplaceType[] = [
  MarketplaceType.MERCADO_LIBRE, MarketplaceType.PARIS, MarketplaceType.RIPLEY, MarketplaceType.FALABELLA,
  MarketplaceType.WALMART, MarketplaceType.JUMPSELLER,
];
const LABEL: Record<string, string> = {
  MERCADO_LIBRE: 'Mercado Libre', PARIS: 'Paris', RIPLEY: 'Ripley', FALABELLA: 'Falabella', WALMART: 'Walmart', JUMPSELLER: 'JumpSeller',
};
const QUICK_HOURS = 48;
const FULL_HOURS = 7 * 24;
// Tipos que revisa cada empresa por dentro (se cierran solos si dejan de aparecer).
const INTERNAL_TYPES = ['DUPLICATE', 'LATE', 'NO_INVOICE'];

type Kind = 'QUICK' | 'FULL' | 'MANUAL';
type ConnRow = {
  connectionId: string; connection: string; companyId: string; company: string; marketplace: string;
  checked: number; registered: number; imported: number; unlinked: number; cancelled: number; errors: number; statusFixed: number;
  truncated: boolean; error: string | null;
};
type IssueInput = {
  companyId: string; connectionId?: string | null; key: string; type: string; severity: 'CRITICAL' | 'WARNING' | 'INFO';
  title: string; detail?: string | null; channel?: string | null; externalId?: string | null; saleId?: string | null; orderId?: string | null;
  amount?: number | null; data?: Prisma.InputJsonValue; autoFixed?: boolean; status?: 'OPEN' | 'RESOLVED';
};

const hoursAgo = (d: Date) => Math.floor((Date.now() - d.getTime()) / 3_600_000);

/**
 * Verificador de órdenes: cada 30 minutos (últimas 48 h) y cada noche (últimos 7 días) compara
 * las ventas de cada marketplace activo con las del sistema. Las que faltan se importan por el
 * mismo camino que la importación automática (venta + orden + stock) y quedan registradas como
 * "captadas"; lo que no se puede corregir solo queda como incidencia para el Super Admin.
 * Respeta el interruptor "Sincronización con marketplaces" de cada empresa.
 */
@Injectable()
export class OrderAuditService implements OnModuleInit {
  private readonly logger = new Logger(OrderAuditService.name);
  private running = false;

  constructor(private prisma: PrismaService, private ml: MercadolibreService, private channelOrders: ChannelOrdersService) {}

  async onModuleInit() {
    await this.prisma.orderAuditRun.updateMany({
      where: { status: 'RUNNING', startedAt: { lt: new Date(Date.now() - 60 * 60_000) } },
      data: { status: 'FAILED', finishedAt: new Date() },
    }).catch(() => {});
  }

  @Cron('15,45 * * * *')
  async quickCron() {
    await this.run('QUICK').catch((e) => this.logger.error(`Verificador rápido: ${e.message}`));
  }

  @Cron('0 8 * * *') // 08:00 UTC ≈ 4-5 AM en Chile
  async fullCron() {
    await this.run('FULL').catch((e) => this.logger.error(`Verificador completo: ${e.message}`));
  }

  // Corrida manual desde la vista del Super Admin (en segundo plano).
  async startManual(user: any, full: boolean) {
    if (integrationsDisabled()) throw new BadRequestException('Integraciones desactivadas en este servidor');
    if (this.running) throw new BadRequestException('Ya hay una verificación en curso');
    const hours = full ? FULL_HOURS : QUICK_HOURS;
    const run = await this.prisma.orderAuditRun.create({
      data: { kind: 'MANUAL', windowFrom: new Date(Date.now() - hours * 3_600_000), createdByName: user?.name || user?.email || null },
    });
    this.running = true;
    void this.execute(run.id, run.windowFrom).finally(() => { this.running = false; });
    return run;
  }

  private async run(kind: Kind) {
    if (integrationsDisabled() || this.running) return null;
    this.running = true;
    try {
      const hours = kind === 'FULL' ? FULL_HOURS : QUICK_HOURS;
      const run = await this.prisma.orderAuditRun.create({ data: { kind, windowFrom: new Date(Date.now() - hours * 3_600_000) } });
      await this.execute(run.id, run.windowFrom);
      return run;
    } finally {
      this.running = false;
    }
  }

  private async execute(runId: string, from: Date) {
    const startedAt = new Date();
    try {
      const conns = await this.prisma.marketplaceConnection.findMany({
        where: {
          active: true, syncEnabled: true, marketplace: { in: AUDITED },
          company: { active: true, autoSyncSales: true },
          OR: [{ marketplace: { not: MarketplaceType.MERCADO_LIBRE } }, { accessToken: { not: '' } }],
        },
        include: { company: { select: { name: true } } },
        orderBy: { companyId: 'asc' },
      });
      const rows: ConnRow[] = [];
      for (const conn of conns) rows.push(await this.auditConnection(runId, conn, from));

      // Las que no se pudieron importar y ya están en el sistema (importadas a mano o por el cron) se cierran.
      await this.resolveImportedLater();

      const companies = Array.from(new Set(conns.map((c) => c.companyId)));
      for (const companyId of companies) {
        await this.internalChecks(runId, companyId).catch((e) => this.logger.warn(`Verificador empresa ${companyId}: ${e.message}`));
      }

      const [newIssues, openIssues] = await Promise.all([
        this.prisma.orderAuditIssue.count({ where: { firstSeenAt: { gte: startedAt }, type: { not: 'IMPORTED' } } }),
        this.prisma.orderAuditIssue.count({ where: { status: 'OPEN' } }),
      ]);
      await this.prisma.orderAuditRun.update({
        where: { id: runId },
        data: {
          status: 'DONE', finishedAt: new Date(), connections: rows.length,
          ordersChecked: rows.reduce((s, r) => s + r.checked, 0),
          imported: rows.reduce((s, r) => s + r.imported, 0),
          statusFixed: rows.reduce((s, r) => s + r.statusFixed, 0),
          errors: rows.filter((r) => r.error).length,
          newIssues, openIssues, details: rows as unknown as Prisma.InputJsonValue,
        },
      });
      const imported = rows.reduce((s, r) => s + r.imported, 0);
      if (imported) this.logger.warn(`Verificador de órdenes: ${imported} venta(s) captada(s) que no habían entrado`);
    } catch (e: any) {
      this.logger.error(`Verificador de órdenes falló: ${e.message}`);
      await this.prisma.orderAuditRun.update({ where: { id: runId }, data: { status: 'FAILED', finishedAt: new Date() } }).catch(() => {});
    }
  }

  private async auditConnection(runId: string, conn: any, from: Date): Promise<ConnRow> {
    const label = LABEL[conn.marketplace] || conn.marketplace;
    const row: ConnRow = {
      connectionId: conn.id, connection: conn.name, companyId: conn.companyId, company: conn.company.name, marketplace: conn.marketplace,
      checked: 0, registered: 0, imported: 0, unlinked: 0, cancelled: 0, errors: 0, statusFixed: 0, truncated: false, error: null,
    };
    const base = { companyId: conn.companyId, connectionId: conn.id, channel: conn.marketplace };
    try {
      const res = conn.marketplace === MarketplaceType.MERCADO_LIBRE
        ? await this.ml.auditOrders(conn.id, from, new Date())
        : await this.channelOrders.auditRecentSales(conn, from);
      Object.assign(row, {
        checked: res.checked, registered: res.registered, imported: res.imported.length, unlinked: res.unlinked.length,
        cancelled: res.cancelled, errors: res.errors.length, truncated: res.truncated,
      });
      for (const s of res.imported) {
        const order = s.saleId ? await this.prisma.order.findUnique({ where: { saleId: s.saleId }, select: { id: true } }) : null;
        await this.upsertIssue(runId, {
          ...base, key: `IMPORTED:${conn.marketplace}:${s.externalId}`, type: 'IMPORTED', severity: 'INFO', status: 'RESOLVED', autoFixed: true,
          title: `Venta ${s.externalId} de ${label} captada por el verificador`,
          detail: 'No había entrado por el aviso del marketplace ni por la importación automática. Se importó con su orden y descuento de stock.',
          externalId: s.externalId, saleId: s.saleId, orderId: order?.id ?? null, amount: s.total,
        });
      }
      for (const u of res.unlinked) {
        await this.upsertIssue(runId, {
          ...base, key: `UNLINKED:${conn.id}:${u.externalId}`, type: 'UNLINKED', severity: 'CRITICAL',
          title: `Venta ${u.externalId} de ${label} no se pudo importar: productos sin vincular`,
          detail: `Vincula la publicación al catálogo y se importará en la próxima verificación. Productos: ${u.titles.join('; ')}`,
          externalId: u.externalId, amount: u.total,
        });
      }
      for (const e of res.errors) {
        await this.upsertIssue(runId, {
          ...base, key: `IMPORT_ERROR:${conn.id}:${e.externalId || e.message.slice(0, 60)}`, type: 'IMPORT_ERROR', severity: 'CRITICAL',
          title: e.externalId ? `Error al importar la venta ${e.externalId} de ${label}` : `Error al importar ventas de ${label}`,
          detail: e.message.slice(0, 500), externalId: e.externalId || null,
        });
      }
      await this.resolveKeys(conn.companyId, [`CONN:${conn.id}`]);
    } catch (e: any) {
      row.error = e.message;
      await this.upsertIssue(runId, {
        ...base, key: `CONN:${conn.id}`, type: 'CONNECTION_ERROR', severity: 'CRITICAL',
        title: `No se pudieron revisar las ventas de ${conn.name} (${label})`,
        detail: `${String(e.message).slice(0, 400)}. Revisa la conexión (token, credenciales o permisos).`,
      });
    }
    // Estados: canceladas, despachadas y entregadas en el marketplace (respaldo del cron).
    try {
      const st = conn.marketplace === MarketplaceType.MERCADO_LIBRE
        ? await this.ml.syncActiveOrderStatuses(conn.id, SYSTEM_USER)
        : await this.channelOrders.syncOrderStatuses(conn);
      row.statusFixed = st.updated || 0;
    } catch (e: any) {
      this.logger.warn(`Verificador estados ${conn.name}: ${e.message}`);
    }
    return row;
  }

  // ── Revisiones internas de cada empresa ───────────────────────────────

  private async internalChecks(runId: string, companyId: string) {
    const seen = new Set<string>();
    const add = async (i: IssueInput) => { seen.add(i.key); await this.upsertIssue(runId, i); };
    const now = Date.now();

    // 1. Orden de Mercado Libre registrada dos veces (como venta y fusionada en otro carrito).
    const dups = await this.prisma.$queryRaw<Array<{ a_id: string; ext: string; b_id: string; total: unknown }>>`
      SELECT a.id AS a_id, a."externalId" AS ext, b.id AS b_id, a.total AS total
      FROM sales a JOIN sales b ON b."companyId" = a."companyId" AND b.channel = a.channel AND b.id <> a.id AND a."externalId" = ANY(b."mlMergedOrderIds")
      WHERE a."companyId" = ${companyId} AND a.channel = 'MERCADO_LIBRE' AND a."createdAt" > now() - interval '30 days'
      LIMIT 100`;
    for (const d of dups) {
      await add({
        companyId, key: `DUP:${d.ext}`, type: 'DUPLICATE', severity: 'CRITICAL', channel: 'MERCADO_LIBRE',
        title: `Orden ${d.ext} de Mercado Libre registrada dos veces`,
        detail: 'Está como venta propia y además fusionada en otro carrito: el stock se descontó dos veces. Corrígela con "Revisar/Corregir" en el diagnóstico de Mercado Libre.',
        externalId: d.ext, saleId: d.a_id, amount: Number(d.total), data: { otherSaleId: d.b_id },
      });
    }

    // 2. Órdenes de marketplaces sin despachar a tiempo.
    const late = await this.prisma.order.findMany({
      where: {
        companyId, createdAt: { gt: new Date(now - 30 * 86_400_000) },
        sale: { channel: { notIn: [SaleChannel.POS, SaleChannel.MANUAL, SaleChannel.ORDER_REQUEST] } },
        OR: [
          { status: { in: [OrderStatus.PENDING, OrderStatus.PREPARING] }, createdAt: { lt: new Date(now - 24 * 3_600_000) } },
          { status: OrderStatus.READY, createdAt: { lt: new Date(now - 48 * 3_600_000) } },
        ],
      },
      select: { id: true, status: true, createdAt: true, sale: { select: { id: true, externalId: true, channel: true, connectionId: true, total: true } } },
      take: 300,
    });
    for (const o of late) {
      const h = hoursAgo(o.createdAt);
      await add({
        companyId, connectionId: o.sale?.connectionId, key: `LATE:${o.id}`, type: 'LATE', severity: h > 72 ? 'CRITICAL' : 'WARNING',
        channel: o.sale?.channel || null, externalId: o.sale?.externalId || null, saleId: o.sale?.id || null, orderId: o.id, amount: o.sale ? Number(o.sale.total) : null,
        title: `Orden ${o.sale?.externalId || o.id.slice(-6)} sin despachar hace ${h >= 48 ? `${Math.floor(h / 24)} días` : `${h} h`}`,
        detail: `Estado: ${o.status === OrderStatus.READY ? 'lista para despacho' : o.status === OrderStatus.PENDING ? 'pendiente' : 'en preparación'}. Revisa que se haya despachado en el marketplace.`,
      });
    }

    // 3. Ventas de marketplaces sin boleta o factura (solo empresas que facturan desde el sistema).
    const invoices = await this.prisma.invoice.count({
      where: { companyId, status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.ACCEPTED] }, createdAt: { gt: new Date(now - 30 * 86_400_000) }, sale: { channel: { notIn: [SaleChannel.POS, SaleChannel.MANUAL, SaleChannel.ORDER_REQUEST] } } },
    }).catch(() => 0);
    const billing = await this.prisma.billingConnection.count({ where: { companyId, active: true } });
    if (billing && invoices) {
      const sales = await this.prisma.sale.findMany({
        where: {
          companyId, channel: { notIn: [SaleChannel.POS, SaleChannel.MANUAL, SaleChannel.ORDER_REQUEST] },
          createdAt: { gt: new Date(now - 7 * 86_400_000), lt: new Date(now - 24 * 3_600_000) },
          invoices: { none: { status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.ACCEPTED] } } },
          OR: [{ order: null }, { order: { status: { not: OrderStatus.CANCELLED } } }],
        },
        select: { id: true, externalId: true, channel: true, connectionId: true, total: true, createdAt: true, order: { select: { id: true } } },
        take: 300,
      });
      for (const s of sales) {
        await add({
          companyId, connectionId: s.connectionId, key: `NOINV:${s.id}`, type: 'NO_INVOICE', severity: 'WARNING',
          channel: s.channel, externalId: s.externalId, saleId: s.id, orderId: s.order?.id ?? null, amount: Number(s.total),
          title: `Venta ${s.externalId || s.id.slice(-6)} sin boleta ni factura hace ${Math.floor(hoursAgo(s.createdAt) / 24) || 1} día(s)`,
          detail: 'Emítela desde la venta. Si la emite el marketplace, ignora esta incidencia.',
        });
      }
    }

    // Las de estos tipos que ya no aparecen se cierran solas.
    const stale = await this.prisma.orderAuditIssue.findMany({
      where: { companyId, status: 'OPEN', type: { in: INTERNAL_TYPES } }, select: { key: true },
    });
    await this.resolveKeys(companyId, stale.map((s) => s.key).filter((k) => !seen.has(k)));
  }

  private async resolveImportedLater() {
    const open = await this.prisma.orderAuditIssue.findMany({
      where: { status: 'OPEN', type: { in: ['UNLINKED', 'IMPORT_ERROR'] }, externalId: { not: null } },
      select: { id: true, channel: true, externalId: true },
    });
    for (const i of open) {
      const ch = i.channel as SaleChannel;
      const sale = await this.prisma.sale.findFirst({
        where: ch === SaleChannel.MERCADO_LIBRE
          ? { channel: ch, OR: [{ externalId: i.externalId! }, { mlMergedOrderIds: { has: i.externalId! } }] }
          : { channel: ch, externalId: i.externalId! },
        select: { id: true },
      }).catch(() => null);
      if (sale) {
        await this.prisma.orderAuditIssue.update({ where: { id: i.id }, data: { status: 'RESOLVED', resolvedAt: new Date(), saleId: sale.id, resolvedByName: 'Verificador' } });
      }
    }
  }

  private async resolveKeys(companyId: string, keys: string[]) {
    if (!keys.length) return;
    await this.prisma.orderAuditIssue.updateMany({
      where: { companyId, key: { in: keys }, status: 'OPEN' },
      data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedByName: 'Verificador' },
    });
  }

  // Crea la incidencia o la actualiza si ya existía. Una resuelta que vuelve a ocurrir se reabre;
  // una ignorada se mantiene ignorada.
  private async upsertIssue(runId: string, i: IssueInput) {
    const existing = await this.prisma.orderAuditIssue.findUnique({ where: { companyId_key: { companyId: i.companyId, key: i.key } } });
    const fields = {
      title: i.title, detail: i.detail ?? null, severity: i.severity, channel: i.channel ?? null, externalId: i.externalId ?? null,
      saleId: i.saleId ?? null, orderId: i.orderId ?? null, amount: i.amount ?? null, connectionId: i.connectionId ?? null, runId, lastSeenAt: new Date(),
      ...(i.data !== undefined ? { data: i.data } : {}),
    };
    if (existing) {
      const reopen = existing.status === 'RESOLVED' && i.type !== 'IMPORTED';
      await this.prisma.orderAuditIssue.update({
        where: { id: existing.id },
        data: { ...fields, ...(reopen ? { status: 'OPEN', resolvedAt: null, resolvedByName: null } : {}) },
      });
      return false;
    }
    const resolved = i.status === 'RESOLVED';
    await this.prisma.orderAuditIssue.create({
      data: {
        ...fields, companyId: i.companyId, key: i.key, type: i.type, autoFixed: !!i.autoFixed,
        status: resolved ? 'RESOLVED' : 'OPEN', resolvedAt: resolved ? new Date() : null, resolvedByName: resolved ? 'Verificador' : null,
      },
    });
    return true;
  }

  // ── Vista del Super Admin ──────────────────────────────────────────────

  async summary() {
    const now = Date.now();
    const startOfDay = new Date(new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' }) + 'T00:00:00-03:00');
    const captured = (since: Date) => this.prisma.orderAuditIssue.count({ where: { type: 'IMPORTED', firstSeenAt: { gte: since } } });
    const [lastRun, lastDone, today, week, month, bySeverity, byType, byCompany] = await Promise.all([
      this.prisma.orderAuditRun.findFirst({ orderBy: { startedAt: 'desc' } }),
      this.prisma.orderAuditRun.findFirst({ where: { status: 'DONE' }, orderBy: { startedAt: 'desc' } }),
      captured(startOfDay),
      captured(new Date(now - 7 * 86_400_000)),
      captured(new Date(now - 30 * 86_400_000)),
      this.prisma.orderAuditIssue.groupBy({ by: ['severity'], where: { status: 'OPEN' }, _count: { _all: true } }),
      this.prisma.orderAuditIssue.groupBy({ by: ['type'], where: { status: 'OPEN' }, _count: { _all: true } }),
      this.prisma.orderAuditIssue.groupBy({ by: ['companyId'], where: { status: 'OPEN' }, _count: { _all: true } }),
    ]);
    // Cuentas revisadas en la última corrida terminada, con sus incidencias abiertas y captadas en 30 días.
    const rows = ((lastDone?.details as unknown as ConnRow[]) || []);
    const openByConn = await this.prisma.orderAuditIssue.groupBy({ by: ['connectionId'], where: { status: 'OPEN' }, _count: { _all: true } });
    const capturedByConn = await this.prisma.orderAuditIssue.groupBy({
      by: ['connectionId'], where: { type: 'IMPORTED', firstSeenAt: { gte: new Date(now - 30 * 86_400_000) } }, _count: { _all: true },
    });
    return {
      running: this.running || lastRun?.status === 'RUNNING',
      lastRun, lastDone,
      captured: { today, week, month },
      open: {
        critical: bySeverity.find((x) => x.severity === 'CRITICAL')?._count._all || 0,
        warning: bySeverity.find((x) => x.severity === 'WARNING')?._count._all || 0,
        byType: Object.fromEntries(byType.map((x) => [x.type, x._count._all])),
        companies: byCompany.length,
      },
      connections: rows.map((r) => ({
        ...r,
        openIssues: openByConn.find((x) => x.connectionId === r.connectionId)?._count._all || 0,
        captured30d: capturedByConn.find((x) => x.connectionId === r.connectionId)?._count._all || 0,
      })),
    };
  }

  async issues(q: { status?: string; type?: string; severity?: string; companyId?: string; channel?: string; search?: string; page?: string }) {
    const where: Prisma.OrderAuditIssueWhereInput = {};
    if (q.status) where.status = q.status;
    if (q.type) where.type = q.type;
    else if (q.status !== 'RESOLVED') where.type = { not: 'IMPORTED' };
    if (q.severity) where.severity = q.severity;
    if (q.companyId) where.companyId = q.companyId;
    if (q.channel) where.channel = q.channel;
    if (q.search) where.OR = [{ title: { contains: q.search, mode: 'insensitive' } }, { externalId: { contains: q.search } }];
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = 50;
    const [total, rows] = await Promise.all([
      this.prisma.orderAuditIssue.count({ where }),
      this.prisma.orderAuditIssue.findMany({
        where, orderBy: [{ lastSeenAt: 'desc' }], skip: (page - 1) * pageSize, take: pageSize,
        include: { company: { select: { id: true, name: true } }, connection: { select: { id: true, name: true } } },
      }),
    ]);
    return { total, page, pageSize, rows };
  }

  async runs() {
    return this.prisma.orderAuditRun.findMany({ orderBy: { startedAt: 'desc' }, take: 30 });
  }

  async setIssueStatus(user: any, id: string, status: string) {
    if (!['OPEN', 'RESOLVED', 'IGNORED'].includes(status)) throw new BadRequestException('Estado no válido');
    const issue = await this.prisma.orderAuditIssue.findUnique({ where: { id } });
    if (!issue) throw new NotFoundException('Incidencia no encontrada');
    return this.prisma.orderAuditIssue.update({
      where: { id },
      data: {
        status,
        resolvedAt: status === 'OPEN' ? null : new Date(),
        resolvedByName: status === 'OPEN' ? null : user?.name || user?.email || 'Super Admin',
      },
    });
  }
}
