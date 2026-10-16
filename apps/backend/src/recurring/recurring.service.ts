import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  DteType, PaymentMethod, PaymentProvider, Prisma, ProductType, RecurringChargeStatus, RecurringFrequency, RecurringStatus, Role, SaleChannel,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PosService } from '../pos/pos.service';
import { BillingService } from '../billing/billing.service';
import { EmailService } from '../email/email.service';
import { PaymentsService } from '../payments/payments.service';
import { integrationsDisabled } from '../common/integrations.util';
import { isSuperAdmin, resolveCompanyId } from '../common/tenant';
import { matchesModule } from '../common/modules.util';
import { hasPermission, permissionsForUser } from '../common/permissions';

// Módulo por empresa (Empresas → Módulos).
export const RECURRING_MODULE = 'cobranza';
const SERVICE_CATEGORY = 'Cobranza recurrente';
const DAY = 24 * 3600_000;
const MONTHS: Partial<Record<RecurringFrequency, number>> = { MONTHLY: 1, BIMONTHLY: 2, QUARTERLY: 3, SEMIANNUAL: 6, ANNUAL: 12 };
export const FREQUENCY_LABEL: Record<RecurringFrequency, string> = {
  WEEKLY: 'Semanal', MONTHLY: 'Mensual', BIMONTHLY: 'Bimestral', QUARTERLY: 'Trimestral', SEMIANNUAL: 'Semestral', ANNUAL: 'Anual',
};

export interface Line { productId?: string | null; description: string; quantity: number; unitPrice: number }

export interface SubscriptionInput {
  companyId?: string;
  clientId: string;
  name: string;
  description?: string | null;
  lines: Line[];
  frequency: RecurringFrequency;
  billingDay?: number;
  startDate: string;
  endDate?: string | null;
  dueDays?: number;
  dteType?: string | null;
  billingConnectionId?: string | null;
  paymentProvider?: PaymentProvider | null;
  sendReminders?: boolean;
  remindBeforeDays?: number;
  remindEveryDays?: number;
  notes?: string | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
// Las fechas de facturación se guardan al mediodía UTC: así el día no cambia por la zona horaria.
const atNoon = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12));
const parseDay = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  if (!m) throw new BadRequestException('Fecha no válida');
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
};

/** Siguiente fecha de facturación según la frecuencia y el día de facturación (1-28). */
export function nextBillingDate(from: Date, frequency: RecurringFrequency, billingDay: number): Date {
  if (frequency === 'WEEKLY') return new Date(from.getTime() + 7 * DAY);
  const months = MONTHS[frequency] ?? 1;
  const day = Math.min(28, Math.max(1, billingDay));
  return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + months, day, 12));
}

@Injectable()
export class RecurringService implements OnModuleInit {
  private readonly logger = new Logger(RecurringService.name);

  constructor(
    private prisma: PrismaService,
    private pos: PosService,
    private billing: BillingService,
    private email: EmailService,
    private payments: PaymentsService,
  ) {}

  // Los pagos en línea de las cuotas llegan por el módulo de pagos.
  onModuleInit() {
    this.payments.onRecurringChargePaid((chargeId, info) => this.completePayment(chargeId, { ...info, viaLink: true }));
  }

  // ── Acceso ───────────────────────────────────────────────────────────

  private async companyFor(user: any, companyId?: string | null, manage = false) {
    const cId = resolveCompanyId(user, companyId);
    const c = await this.prisma.company.findUnique({ where: { id: cId }, select: { modules: true } });
    if (!matchesModule(c?.modules, RECURRING_MODULE)) throw new ForbiddenException('La empresa no tiene el módulo de Cobranza recurrente');
    if (!isSuperAdmin(user)) {
      const perms = permissionsForUser(user);
      if (!hasPermission(perms, 'cobranza')) throw new ForbiddenException('No tienes permiso para la cobranza recurrente');
      if (manage && !hasPermission(perms, 'cobranza.manage')) throw new ForbiddenException('No tienes permiso para crear o editar suscripciones');
    }
    return cId;
  }

  private async ownedSubscription(user: any, id: string, manage = false) {
    const sub = await this.prisma.recurringSubscription.findUnique({ where: { id } });
    if (!sub || (!isSuperAdmin(user) && sub.companyId !== user.companyId)) throw new NotFoundException('Suscripción no encontrada');
    await this.companyFor(user, sub.companyId, manage);
    return sub;
  }

  private async ownedCharge(user: any, id: string) {
    const ch = await this.prisma.recurringCharge.findUnique({ where: { id } });
    if (!ch || (!isSuperAdmin(user) && ch.companyId !== user.companyId)) throw new NotFoundException('Cuota no encontrada');
    await this.companyFor(user, ch.companyId);
    return ch;
  }

  // ── Suscripciones ────────────────────────────────────────────────────

  private async clean(companyId: string, dto: SubscriptionInput) {
    const client = await this.prisma.client.findFirst({ where: { id: dto.clientId, companyId } });
    if (!client) throw new BadRequestException('Elige un cliente de la empresa');
    const name = String(dto.name || '').trim();
    if (!name) throw new BadRequestException('Indica el nombre del servicio');
    const lines: Line[] = (Array.isArray(dto.lines) ? dto.lines : [])
      .map((l) => ({ productId: l.productId || null, description: String(l.description || '').trim(), quantity: Number(l.quantity) || 0, unitPrice: Number(l.unitPrice) || 0 }))
      .filter((l) => l.description && l.quantity > 0 && l.unitPrice > 0);
    if (!lines.length) throw new BadRequestException('Agrega al menos una línea con descripción, cantidad y precio');
    const productIds = lines.map((l) => l.productId).filter(Boolean) as string[];
    if (productIds.length) {
      const ok = await this.prisma.product.count({ where: { id: { in: productIds }, companyId } });
      if (ok !== new Set(productIds).size) throw new BadRequestException('Producto no válido');
    }
    const frequency = (Object.keys(FREQUENCY_LABEL) as RecurringFrequency[]).includes(dto.frequency) ? dto.frequency : 'MONTHLY';
    const startDate = parseDay(dto.startDate);
    const endDate = dto.endDate ? parseDay(dto.endDate) : null;
    if (endDate && endDate < startDate) throw new BadRequestException('La fecha de término es anterior a la de inicio');
    const billingDay = Math.min(28, Math.max(1, Math.round(Number(dto.billingDay) || startDate.getUTCDate())));
    const dteType = ['BOLETA', 'FACTURA', 'FACTURA_EXENTA'].includes(String(dto.dteType)) ? String(dto.dteType) : null;
    let billingConnectionId: string | null = null;
    if (dteType) {
      if (!dto.billingConnectionId) throw new BadRequestException('Elige la conexión de facturación para emitir el documento');
      const conn = await this.prisma.billingConnection.findFirst({ where: { id: dto.billingConnectionId, companyId } });
      if (!conn) throw new BadRequestException('Conexión de facturación no válida');
      billingConnectionId = conn.id;
      if (dteType !== 'BOLETA' && !client.rut) throw new BadRequestException('Para emitir factura el cliente debe tener RUT');
    }
    const paymentProvider = dto.paymentProvider && ['FLOW', 'MERCADO_PAGO'].includes(dto.paymentProvider) ? dto.paymentProvider : null;
    return {
      clientId: client.id, name,
      description: dto.description?.trim() || null,
      lines: lines as unknown as Prisma.InputJsonValue,
      amount: round2(lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0)),
      frequency, billingDay, startDate, endDate,
      dueDays: Math.min(90, Math.max(0, Math.round(Number(dto.dueDays ?? 5)))),
      dteType, billingConnectionId, paymentProvider,
      sendReminders: dto.sendReminders !== false,
      remindBeforeDays: Math.min(30, Math.max(0, Math.round(Number(dto.remindBeforeDays ?? 3)))),
      remindEveryDays: Math.min(30, Math.max(1, Math.round(Number(dto.remindEveryDays ?? 3)))),
      notes: dto.notes?.trim() || null,
    };
  }

  private subView(s: any) {
    const now = Date.now();
    const pending = (s.charges || []).filter((c: any) => c.status === 'PENDING');
    return {
      id: s.id, name: s.name, description: s.description, lines: s.lines, amount: Number(s.amount),
      frequency: s.frequency, frequencyLabel: FREQUENCY_LABEL[s.frequency as RecurringFrequency], billingDay: s.billingDay,
      startDate: s.startDate, endDate: s.endDate, nextBillingDate: s.nextBillingDate, dueDays: s.dueDays,
      dteType: s.dteType, billingConnectionId: s.billingConnectionId, paymentProvider: s.paymentProvider,
      sendReminders: s.sendReminders, remindBeforeDays: s.remindBeforeDays, remindEveryDays: s.remindEveryDays,
      status: s.status, notes: s.notes, createdAt: s.createdAt, createdByName: s.createdByName,
      client: s.client ? { id: s.client.id, name: s.client.name, rut: s.client.rut, email: s.client.email, phone: s.client.phone } : null,
      pendingCount: pending.length,
      pendingAmount: round2(pending.reduce((t: number, c: any) => t + Number(c.amount), 0)),
      overdueCount: pending.filter((c: any) => new Date(c.dueDate).getTime() < now).length,
    };
  }

  async listSubscriptions(user: any, q: { companyId?: string; status?: string; clientId?: string; search?: string }) {
    const cId = await this.companyFor(user, q.companyId);
    const where: Prisma.RecurringSubscriptionWhereInput = { companyId: cId };
    if (q.status && (Object.values(RecurringStatus) as string[]).includes(q.status)) where.status = q.status as RecurringStatus;
    if (q.clientId) where.clientId = q.clientId;
    if (q.search?.trim()) where.OR = [{ name: { contains: q.search.trim(), mode: 'insensitive' } }, { client: { name: { contains: q.search.trim(), mode: 'insensitive' } } }];
    const rows = await this.prisma.recurringSubscription.findMany({
      where, orderBy: [{ status: 'asc' }, { nextBillingDate: 'asc' }], take: 300,
      include: { client: true, charges: { where: { status: 'PENDING' }, select: { status: true, amount: true, dueDate: true } } },
    });
    return rows.map((r) => this.subView(r));
  }

  async getSubscription(user: any, id: string) {
    await this.ownedSubscription(user, id);
    const s = await this.prisma.recurringSubscription.findUnique({
      where: { id },
      include: { client: true, charges: { orderBy: { number: 'desc' }, take: 60 } },
    });
    return { ...this.subView(s), charges: (s!.charges || []).map((c) => this.chargeView({ ...c, subscription: s, client: s!.client })) };
  }

  async createSubscription(user: any, dto: SubscriptionInput) {
    const cId = await this.companyFor(user, dto.companyId, true);
    const data = await this.clean(cId, dto);
    const sub = await this.prisma.recurringSubscription.create({
      data: { ...data, nextBillingDate: data.startDate, companyId: cId, createdById: user.id ?? null, createdByName: user.name ?? user.email ?? null },
    });
    // Si la primera facturación es hoy o ya pasó, la cuota se genera de inmediato.
    await this.generateFor(sub.id);
    return this.getSubscription(user, sub.id);
  }

  async updateSubscription(user: any, id: string, dto: SubscriptionInput) {
    const prev = await this.ownedSubscription(user, id, true);
    if (prev.status === 'CANCELLED' || prev.status === 'ENDED') throw new BadRequestException('La suscripción ya terminó');
    const data = await this.clean(prev.companyId, { ...dto, clientId: dto.clientId || prev.clientId });
    // Cambiar el día o la frecuencia recalcula la próxima facturación (no toca las cuotas ya generadas).
    const scheduleChanged = data.frequency !== prev.frequency || data.billingDay !== prev.billingDay || data.startDate.getTime() !== prev.startDate.getTime();
    let next = prev.nextBillingDate;
    if (scheduleChanged) {
      const hasCharges = await this.prisma.recurringCharge.count({ where: { subscriptionId: id } });
      next = hasCharges ? this.alignNext(prev.nextBillingDate, data.frequency, data.billingDay) : data.startDate;
    }
    await this.prisma.recurringSubscription.update({ where: { id }, data: { ...data, nextBillingDate: next } });
    await this.generateFor(id);
    return this.getSubscription(user, id);
  }

  // Próxima fecha alineada al nuevo día de facturación, sin retroceder.
  private alignNext(from: Date, frequency: RecurringFrequency, billingDay: number) {
    if (frequency === 'WEEKLY') return from;
    const candidate = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), Math.min(28, billingDay), 12));
    return candidate.getTime() >= atNoon(from).getTime() ? candidate : nextBillingDate(candidate, 'MONTHLY', billingDay);
  }

  async setStatus(user: any, id: string, status: 'ACTIVE' | 'PAUSED' | 'CANCELLED') {
    const sub = await this.ownedSubscription(user, id, true);
    if (sub.status === 'CANCELLED' || sub.status === 'ENDED') throw new BadRequestException('La suscripción ya terminó');
    const data: Prisma.RecurringSubscriptionUpdateInput = { status };
    // Al reanudar, las facturaciones que cayeron durante la pausa no se cobran: sigue desde hoy.
    if (status === 'ACTIVE' && sub.status === 'PAUSED') {
      let next = sub.nextBillingDate;
      const today = atNoon(new Date());
      while (next < today) next = nextBillingDate(next, sub.frequency, sub.billingDay);
      data.nextBillingDate = next;
    }
    await this.prisma.recurringSubscription.update({ where: { id }, data });
    if (status === 'ACTIVE') await this.generateFor(id);
    return this.getSubscription(user, id);
  }

  // ── Cuotas ───────────────────────────────────────────────────────────

  private chargeView(c: any) {
    const overdue = c.status === 'PENDING' && new Date(c.dueDate).getTime() < Date.now();
    return {
      id: c.id, number: c.number, periodStart: c.periodStart, periodEnd: c.periodEnd, issueDate: c.issueDate, dueDate: c.dueDate,
      amount: Number(c.amount), description: c.description, lines: c.lines, status: c.status, overdue,
      paidAt: c.paidAt, paymentMethod: c.paymentMethod, paymentReference: c.paymentReference, saleId: c.saleId, invoiceId: c.invoiceId,
      error: c.error, remindersSent: c.remindersSent, lastReminderAt: c.lastReminderAt, cancelledAt: c.cancelledAt, cancelReason: c.cancelReason,
      subscription: c.subscription ? { id: c.subscription.id, name: c.subscription.name, paymentProvider: c.subscription.paymentProvider } : null,
      client: c.client ? { id: c.client.id, name: c.client.name, email: c.client.email, phone: c.client.phone, rut: c.client.rut } : null,
    };
  }

  async listCharges(user: any, q: { companyId?: string; status?: string; clientId?: string; subscriptionId?: string; from?: string; to?: string; page?: string }) {
    const cId = await this.companyFor(user, q.companyId);
    const now = new Date();
    const where: Prisma.RecurringChargeWhereInput = { companyId: cId };
    if (q.status === 'OVERDUE') { where.status = 'PENDING'; where.dueDate = { lt: now }; }
    else if (q.status === 'UPCOMING') { where.status = 'PENDING'; where.dueDate = { gte: now }; }
    else if (q.status && (Object.values(RecurringChargeStatus) as string[]).includes(q.status)) where.status = q.status as RecurringChargeStatus;
    if (q.clientId) where.clientId = q.clientId;
    if (q.subscriptionId) where.subscriptionId = q.subscriptionId;
    if (q.from || q.to) where.issueDate = { ...(q.from ? { gte: parseDay(q.from) } : {}), ...(q.to ? { lte: new Date(parseDay(q.to).getTime() + DAY / 2) } : {}) };
    const page = Math.max(1, Number(q.page) || 1);
    const take = 50;
    const [rows, total] = await Promise.all([
      this.prisma.recurringCharge.findMany({
        where, orderBy: [{ status: 'asc' }, { dueDate: 'asc' }], skip: (page - 1) * take, take,
        include: { subscription: { select: { id: true, name: true, paymentProvider: true } }, client: true },
      }),
      this.prisma.recurringCharge.count({ where }),
    ]);
    return { items: rows.map((r) => this.chargeView(r)), total, page, pages: Math.max(1, Math.ceil(total / take)) };
  }

  /** Resumen de la cobranza: lo vencido, lo que vence en 7 días y lo cobrado en el mes. */
  async summary(user: any, companyId?: string) {
    const cId = await this.companyFor(user, companyId);
    const now = new Date();
    const week = new Date(now.getTime() + 7 * DAY);
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const [overdue, upcoming, paid, active, pendingAll] = await Promise.all([
      this.prisma.recurringCharge.aggregate({ where: { companyId: cId, status: 'PENDING', dueDate: { lt: now } }, _sum: { amount: true }, _count: true }),
      this.prisma.recurringCharge.aggregate({ where: { companyId: cId, status: 'PENDING', dueDate: { gte: now, lte: week } }, _sum: { amount: true }, _count: true }),
      this.prisma.recurringCharge.aggregate({ where: { companyId: cId, status: 'PAID', paidAt: { gte: monthStart } }, _sum: { amount: true }, _count: true }),
      this.prisma.recurringSubscription.count({ where: { companyId: cId, status: 'ACTIVE' } }),
      this.prisma.recurringCharge.aggregate({ where: { companyId: cId, status: 'PENDING' }, _sum: { amount: true }, _count: true }),
    ]);
    const n = (a: { _sum: { amount: Prisma.Decimal | null }; _count: number }) => ({ amount: round2(Number(a._sum.amount || 0)), count: a._count });
    return { overdue: n(overdue), upcomingWeek: n(upcoming), paidThisMonth: n(paid), pending: n(pendingAll), activeSubscriptions: active };
  }

  /** Estado de cuenta de un cliente: cuotas, pagos y deuda. */
  async clientStatement(user: any, clientId: string, companyId?: string) {
    const cId = await this.companyFor(user, companyId);
    const client = await this.prisma.client.findFirst({ where: { id: clientId, companyId: cId } });
    if (!client) throw new NotFoundException('Cliente no encontrado');
    const [charges, subs] = await Promise.all([
      this.prisma.recurringCharge.findMany({ where: { clientId }, orderBy: { issueDate: 'desc' }, take: 200, include: { subscription: { select: { id: true, name: true, paymentProvider: true } } } }),
      this.prisma.recurringSubscription.findMany({ where: { clientId }, orderBy: { createdAt: 'asc' }, include: { charges: { where: { status: 'PENDING' }, select: { status: true, amount: true, dueDate: true } } } }),
    ]);
    const now = Date.now();
    const pending = charges.filter((c) => c.status === 'PENDING');
    return {
      client: { id: client.id, name: client.name, rut: client.rut, email: client.email, phone: client.phone },
      totals: {
        debt: round2(pending.reduce((s, c) => s + Number(c.amount), 0)),
        overdue: round2(pending.filter((c) => c.dueDate.getTime() < now).reduce((s, c) => s + Number(c.amount), 0)),
        paid: round2(charges.filter((c) => c.status === 'PAID').reduce((s, c) => s + Number(c.amount), 0)),
      },
      subscriptions: subs.map((s) => this.subView({ ...s, client })),
      charges: charges.map((c) => this.chargeView({ ...c, client })),
    };
  }

  /** Genera a mano la próxima cuota (adelantar la facturación). */
  async generateNext(user: any, subscriptionId: string) {
    const sub = await this.ownedSubscription(user, subscriptionId, true);
    if (sub.status !== 'ACTIVE') throw new BadRequestException('La suscripción no está activa');
    await this.createCharge(sub.id);
    return this.getSubscription(user, subscriptionId);
  }

  // Genera las cuotas cuya fecha de facturación ya llegó (puede ponerse al día con varias).
  private async generateFor(subscriptionId: string) {
    for (let i = 0; i < 24; i++) {
      const sub = await this.prisma.recurringSubscription.findUnique({ where: { id: subscriptionId } });
      if (!sub || sub.status !== 'ACTIVE') return;
      if (sub.endDate && sub.nextBillingDate > sub.endDate) {
        await this.prisma.recurringSubscription.update({ where: { id: sub.id }, data: { status: 'ENDED' } });
        return;
      }
      if (sub.nextBillingDate.getTime() > Date.now()) return;
      await this.createCharge(sub.id);
    }
  }

  private async createCharge(subscriptionId: string) {
    await this.prisma.$transaction(async (tx) => {
      const sub = await tx.recurringSubscription.findUnique({ where: { id: subscriptionId } });
      if (!sub) return;
      const last = await tx.recurringCharge.findFirst({ where: { subscriptionId }, orderBy: { number: 'desc' }, select: { number: true } });
      const issueDate = sub.nextBillingDate;
      const next = nextBillingDate(issueDate, sub.frequency, sub.billingDay);
      await tx.recurringCharge.create({
        data: {
          number: (last?.number ?? 0) + 1,
          periodStart: issueDate, periodEnd: new Date(next.getTime() - DAY), issueDate,
          dueDate: new Date(issueDate.getTime() + sub.dueDays * DAY),
          amount: sub.amount, description: sub.description, lines: sub.lines as Prisma.InputJsonValue,
          companyId: sub.companyId, subscriptionId: sub.id, clientId: sub.clientId,
        },
      });
      await tx.recurringSubscription.update({ where: { id: sub.id }, data: { nextBillingDate: next } });
    });
  }

  async cancelCharge(user: any, id: string, reason?: string) {
    const ch = await this.ownedCharge(user, id);
    if (ch.status !== 'PENDING') throw new BadRequestException('Solo se anulan cuotas pendientes');
    await this.prisma.recurringCharge.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason?.trim() || null } });
    return this.chargeView(await this.prisma.recurringCharge.findUnique({ where: { id }, include: { subscription: true, client: true } }));
  }

  /** Pago registrado a mano (efectivo, transferencia, tarjeta...). */
  async payCharge(user: any, id: string, dto: { method: PaymentMethod; reference?: string }) {
    await this.ownedCharge(user, id);
    if (!dto.method || dto.method === PaymentMethod.MIXED || !(Object.values(PaymentMethod) as string[]).includes(dto.method)) throw new BadRequestException('Elige el medio de pago');
    await this.completePayment(id, { method: dto.method, reference: dto.reference?.trim() || null, collectedById: user.id ?? null, viaLink: false });
    return this.chargeView(await this.prisma.recurringCharge.findUnique({ where: { id }, include: { subscription: true, client: true } }));
  }

  /**
   * Marca la cuota pagada y, después, registra la venta (reportes y caja) y emite la boleta o
   * factura si la suscripción lo indica. Si la venta o el documento fallan, el pago queda
   * registrado igual y el motivo queda en la cuota para resolverlo a mano.
   */
  async completePayment(chargeId: string, info: { method: PaymentMethod; reference: string | null; collectedById: string | null; viaLink: boolean }) {
    const claimed = await this.prisma.recurringCharge.updateMany({
      where: { id: chargeId, status: 'PENDING' },
      data: { status: 'PAID', paidAt: new Date(), paymentMethod: info.method, paymentReference: info.reference },
    });
    if (!claimed.count) return;
    const ch = await this.prisma.recurringCharge.findUnique({ where: { id: chargeId }, include: { subscription: true, client: true } });
    if (!ch) return;
    const errors: string[] = [];
    // En un reintento se conservan la venta y el documento que ya se habían creado.
    let saleId: string | null = ch.saleId;
    let invoiceId: string | null = ch.invoiceId;
    const actor = await this.actorFor(info.collectedById || ch.subscription.createdById, ch.companyId);
    if (!saleId) try {
      const lines = ((ch.lines ?? ch.subscription.lines) as unknown as Line[]) || [];
      const items: { productId: string; quantity: number; unitPrice: number }[] = [];
      for (const l of lines) {
        const productId = await this.productFor(ch.companyId, l);
        // Cantidades no enteras: una unidad al total de la línea.
        const whole = Number.isInteger(Number(l.quantity));
        items.push({ productId, quantity: whole ? Number(l.quantity) : 1, unitPrice: whole ? Number(l.unitPrice) : round2(Number(l.quantity) * Number(l.unitPrice)) });
      }
      const sale = await this.pos.createSale({
        channel: SaleChannel.POS,
        companyId: ch.companyId,
        clientId: ch.clientId,
        paymentMethod: info.method,
        externalId: `REC-${ch.id}`,
        notes: `Cobranza recurrente: ${ch.subscription.name} — cuota ${ch.number}${info.reference ? ` (${info.reference})` : ''}`,
        items,
      } as any, actor, { useSellerWarehouse: false, enforcePrices: false });
      saleId = sale?.id ?? null;
    } catch (e: any) {
      errors.push(`Venta: ${e?.response?.message || e?.message || e}`);
    }
    if (!invoiceId && ch.subscription.dteType && ch.subscription.billingConnectionId) {
      try {
        const lines = ((ch.lines ?? ch.subscription.lines) as unknown as Line[]) || [];
        const inv: any = await this.billing.issueInvoice({
          connectionId: ch.subscription.billingConnectionId,
          dteType: ch.subscription.dteType as DteType,
          rut: ch.client.rut || '66666666-6',
          razonSocial: ch.client.name,
          giro: ch.client.giro || undefined,
          address: ch.client.address || undefined,
          commune: ch.client.commune || undefined,
          email: ch.client.email || undefined,
          items: lines.map((l) => ({ name: l.description, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice) })),
          notes: ch.description || `${ch.subscription.name} — cuota ${ch.number}`,
          saleId: saleId || undefined,
          clientId: ch.clientId,
          paymentCondition: 'CONTADO',
          markPaid: true,
          paymentMethod: info.method,
        } as any, actor);
        invoiceId = inv?.id ?? null;
      } catch (e: any) {
        errors.push(`Documento: ${e?.response?.message || e?.message || e}`);
      }
    }
    await this.prisma.recurringCharge.update({ where: { id: chargeId }, data: { saleId, invoiceId, error: errors.length ? errors.join(' · ') : null } });
  }

  /** Reintenta la venta o el documento de una cuota pagada que quedó con error. */
  async retryDocuments(user: any, id: string) {
    const ch = await this.ownedCharge(user, id);
    if (ch.status !== 'PAID' || !ch.error) throw new BadRequestException('La cuota no tiene nada pendiente');
    await this.prisma.recurringCharge.update({ where: { id }, data: { status: 'PENDING', paidAt: null } });
    await this.completePayment(id, { method: ch.paymentMethod || PaymentMethod.OTHER, reference: ch.paymentReference, collectedById: user.id ?? null, viaLink: false });
    return this.chargeView(await this.prisma.recurringCharge.findUnique({ where: { id }, include: { subscription: true, client: true } }));
  }

  // Producto de la línea: el del catálogo o uno de servicio con su descripción (se reutiliza).
  private async productFor(companyId: string, l: Line): Promise<string> {
    if (l.productId) {
      const p = await this.prisma.product.findFirst({ where: { id: l.productId, companyId }, select: { id: true } });
      if (p) return p.id;
    }
    const name = l.description.slice(0, 200);
    const existing = await this.prisma.product.findFirst({ where: { companyId, type: ProductType.SERVICIO, category: SERVICE_CATEGORY, name }, select: { id: true } });
    if (existing) return existing.id;
    const sku = `REC-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const created = await this.prisma.product.create({
      data: { sku, name, type: ProductType.SERVICIO, price: l.unitPrice, stock: 0, category: SERVICE_CATEGORY, companyId },
      select: { id: true },
    });
    return created.id;
  }

  // Usuario con el que se registra la venta: quien cobró, quien creó la suscripción o un administrador activo.
  private async actorFor(userId: string | null, companyId: string) {
    const include = { company: { include: { subscriptionPlan: true } }, accessProfile: true } as const;
    let u = userId ? await this.prisma.user.findFirst({ where: { id: userId, active: true }, include }) : null;
    if (u && u.role !== Role.SUPER_ADMIN && u.companyId !== companyId) u = null;
    if (!u) u = await this.prisma.user.findFirst({ where: { companyId, active: true, role: Role.COMPANY_ADMIN }, include, orderBy: { createdAt: 'asc' } });
    if (!u) throw new Error('No hay un usuario activo de la empresa para registrar la venta');
    const { password: _, ...rest } = u;
    return rest;
  }

  // ── Avisos y link de pago ────────────────────────────────────────────

  async paymentLink(user: any, id: string, provider?: PaymentProvider) {
    const ch = await this.ownedCharge(user, id);
    const sub = await this.prisma.recurringSubscription.findUnique({ where: { id: ch.subscriptionId }, select: { paymentProvider: true } });
    const p = provider || sub?.paymentProvider;
    if (!p) throw new BadRequestException('Elige Flow o Mercado Pago');
    return this.payments.createForRecurringCharge(user, id, { provider: p });
  }

  async sendReminder(user: any, id: string) {
    const ch = await this.ownedCharge(user, id);
    if (ch.status !== 'PENDING') throw new BadRequestException('La cuota no está pendiente');
    await this.remind(ch.id, user);
    return this.chargeView(await this.prisma.recurringCharge.findUnique({ where: { id }, include: { subscription: true, client: true } }));
  }

  private async remind(chargeId: string, user: any | null) {
    const ch = await this.prisma.recurringCharge.findUnique({ where: { id: chargeId }, include: { subscription: true, client: true } });
    if (!ch || ch.status !== 'PENDING') return;
    if (!ch.client.email) throw new BadRequestException('El cliente no tiene correo');
    let paymentUrl: string | null = null;
    if (ch.subscription.paymentProvider) {
      try {
        const req = await this.payments.createForRecurringCharge(user, ch.id, { provider: ch.subscription.paymentProvider });
        paymentUrl = req.paymentUrl;
      } catch (e: any) {
        this.logger.warn(`Cuota ${ch.id}: no se pudo crear el link de pago: ${e?.message || e}`);
      }
    }
    await this.email.sendRecurringChargeEmail(ch.companyId, ch.client.email, {
      clientName: ch.client.name, serviceName: ch.subscription.name, description: ch.description, number: ch.number,
      amount: Number(ch.amount), issueDate: ch.issueDate, dueDate: ch.dueDate, overdue: ch.dueDate.getTime() < Date.now(), paymentUrl,
    });
    await this.prisma.recurringCharge.update({ where: { id: ch.id }, data: { remindersSent: { increment: 1 }, lastReminderAt: new Date() } });
  }

  // ── Revisión periódica: generar cuotas y enviar avisos ───────────────

  @Cron('15 * * * *')
  async sweep() {
    const now = new Date();
    // 1) Cuotas cuya fecha de facturación llegó.
    const due = await this.prisma.recurringSubscription.findMany({
      where: { status: 'ACTIVE', nextBillingDate: { lte: now } }, select: { id: true, companyId: true }, take: 500,
    });
    const companies = new Map<string, boolean>();
    const moduleOn = async (companyId: string) => {
      if (!companies.has(companyId)) {
        const c = await this.prisma.company.findUnique({ where: { id: companyId }, select: { modules: true, active: true } });
        companies.set(companyId, !!c?.active && matchesModule(c?.modules, RECURRING_MODULE));
      }
      return companies.get(companyId)!;
    };
    for (const s of due) {
      if (!(await moduleOn(s.companyId))) continue;
      await this.generateFor(s.id).catch((e) => this.logger.warn(`Suscripción ${s.id}: ${e?.message || e}`));
    }
    // 2) Avisos por correo (una vez al día por cuota): antes de vencer y cada N días ya vencida.
    if (integrationsDisabled()) return;
    const pending = await this.prisma.recurringCharge.findMany({
      where: { status: 'PENDING', subscription: { sendReminders: true, status: { in: ['ACTIVE', 'PAUSED'] } }, client: { email: { not: null } } },
      include: { subscription: { select: { remindBeforeDays: true, remindEveryDays: true } } },
      take: 500,
    });
    for (const ch of pending) {
      if (!(await moduleOn(ch.companyId))) continue;
      const msToDue = ch.dueDate.getTime() - now.getTime();
      const since = ch.lastReminderAt ? now.getTime() - ch.lastReminderAt.getTime() : Infinity;
      const beforeWindow = msToDue > 0 && msToDue <= ch.subscription.remindBeforeDays * DAY && !ch.lastReminderAt;
      const overdueRepeat = msToDue <= 0 && since >= ch.subscription.remindEveryDays * DAY && ch.remindersSent < 6;
      if (!beforeWindow && !overdueRepeat) continue;
      await this.remind(ch.id, null).catch((e) => this.logger.warn(`Aviso de la cuota ${ch.id}: ${e?.message || e}`));
    }
  }
}
