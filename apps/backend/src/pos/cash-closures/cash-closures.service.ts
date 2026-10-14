import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma, Role, SaleChannel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../../settings/settings.service';
import { startOfDayInTz, dateKeyStringInTz } from '../../common/timezone';

// Roles que pueden cerrar la caja de cualquier cajero de la empresa; el vendedor solo la suya.
const MANAGER_ROLES: Role[] = [Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER];

type Summary = {
  payments: { method: string; total: number; count: number }[];
  products: { productId: string | null; sku: string | null; name: string; quantity: number; total: number }[];
  orders: { pickup: number; delivery: number; none: number };
  salesCount: number;
  itemsCount: number;
  total: number;
  cashTotal: number;
};

@Injectable()
export class CashClosuresService {
  constructor(private prisma: PrismaService, private settings: SettingsService) {}

  private resolveCompanyId(user: any, companyId?: string): string {
    if (user.role === Role.SUPER_ADMIN) {
      if (!companyId) throw new BadRequestException('companyId requerido para Super Admin');
      return companyId;
    }
    if (!user.companyId) throw new ForbiddenException('Sin empresa asignada');
    return user.companyId;
  }

  // El vendedor solo cierra su propia caja; los administradores eligen el cajero.
  private async resolveCashier(user: any, companyId: string, cashierId?: string) {
    const id = MANAGER_ROLES.includes(user.role) ? (cashierId || user.id) : user.id;
    const cashier = await this.prisma.user.findUnique({ where: { id }, select: { id: true, name: true, companyId: true, role: true } });
    if (!cashier) throw new NotFoundException('Cajero no encontrado');
    if (cashier.role !== Role.SUPER_ADMIN && cashier.companyId !== companyId) {
      throw new BadRequestException('El cajero no pertenece a esta empresa');
    }
    return cashier;
  }

  // Inicio del turno: el fin del último cierre del cajero o, si no tiene, el inicio del día.
  private async periodStart(db: Prisma.TransactionClient | PrismaService, companyId: string, cashierId: string) {
    const last = await db.cashClosure.findFirst({
      where: { companyId, cashierId },
      orderBy: { periodTo: 'desc' },
      select: { periodTo: true },
    });
    if (last) return last.periodTo;
    const tz = await this.settings.getTimezone();
    return startOfDayInTz(tz, dateKeyStringInTz(new Date(), tz));
  }

  private async buildSummary(db: Prisma.TransactionClient | PrismaService, companyId: string, cashierId: string, from: Date, to: Date): Promise<Summary> {
    const sales = await db.sale.findMany({
      where: { companyId, userId: cashierId, channel: SaleChannel.POS, createdAt: { gte: from, lt: to } },
      select: {
        total: true, paymentMethod: true,
        payments: { select: { method: true, amount: true } },
        items: { select: { productId: true, quantity: true, unitPrice: true, product: { select: { sku: true, name: true } } } },
        order: { select: { fulfillmentType: true } },
      },
    });

    const payments = new Map<string, { total: number; count: number }>();
    const addPay = (method: string, amount: number) => {
      const e = payments.get(method) || { total: 0, count: 0 };
      e.total += amount; e.count++;
      payments.set(method, e);
    };
    const products = new Map<string, Summary['products'][number]>();
    const orders = { pickup: 0, delivery: 0, none: 0 };
    let itemsCount = 0;

    for (const sale of sales) {
      // Venta mixta: cada medio suma lo suyo. Ventas antiguas sin detalle: todo a su medio.
      if (sale.payments.length) {
        for (const p of sale.payments) addPay(p.method, Number(p.amount));
      } else {
        addPay(sale.paymentMethod && sale.paymentMethod !== 'MIXED' ? sale.paymentMethod : 'SIN_ESPECIFICAR', Number(sale.total));
      }
      for (const item of sale.items) {
        const key = item.productId || 'deleted';
        const e = products.get(key) || {
          productId: item.productId, sku: item.product?.sku ?? null, name: item.product?.name || 'Producto eliminado', quantity: 0, total: 0,
        };
        e.quantity += item.quantity;
        e.total += Number(item.unitPrice) * item.quantity;
        products.set(key, e);
        itemsCount += item.quantity;
      }
      if (sale.order?.fulfillmentType === 'DELIVERY') orders.delivery++;
      else if (sale.order) orders.pickup++;
      else orders.none++;
    }

    const paymentRows = [...payments]
      .map(([method, v]) => ({ method, total: Math.round(v.total * 100) / 100, count: v.count }))
      .sort((a, b) => b.total - a.total);
    return {
      payments: paymentRows,
      products: [...products.values()].sort((a, b) => b.quantity - a.quantity),
      orders,
      salesCount: sales.length,
      itemsCount,
      total: sales.reduce((s, v) => s + Number(v.total), 0),
      cashTotal: paymentRows.find((p) => p.method === 'CASH')?.total || 0,
    };
  }

  async preview(user: any, q: { companyId?: string; cashierId?: string }) {
    const companyId = this.resolveCompanyId(user, q.companyId);
    const cashier = await this.resolveCashier(user, companyId, q.cashierId);
    const from = await this.periodStart(this.prisma, companyId, cashier.id);
    const to = new Date();
    const summary = await this.buildSummary(this.prisma, companyId, cashier.id, from, to);
    return { cashier: { id: cashier.id, name: cashier.name }, periodFrom: from, periodTo: to, summary };
  }

  async close(user: any, dto: { companyId?: string; cashierId?: string; openingCash?: number; countedCash: number; notes?: string }) {
    const companyId = this.resolveCompanyId(user, dto.companyId);
    const cashier = await this.resolveCashier(user, companyId, dto.cashierId);
    if (!(dto.countedCash >= 0)) throw new BadRequestException('Ingresa el efectivo contado');
    const openingCash = dto.openingCash && dto.openingCash > 0 ? dto.openingCash : 0;

    return this.prisma.$transaction(async (tx) => {
      // Se recalcula al momento de cerrar (no se confía en lo que mostró la pantalla).
      const from = await this.periodStart(tx, companyId, cashier.id);
      const to = new Date();
      const summary = await this.buildSummary(tx, companyId, cashier.id, from, to);
      if (summary.salesCount === 0 && openingCash === 0 && dto.countedCash === 0) {
        throw new BadRequestException('No hay ventas para cerrar en este turno');
      }
      const expectedCash = openingCash + summary.cashTotal;
      const last = await tx.cashClosure.findFirst({ where: { companyId }, orderBy: { number: 'desc' }, select: { number: true } });
      const { salesCount, itemsCount, total, ...rest } = summary;
      return tx.cashClosure.create({
        data: {
          number: (last?.number || 0) + 1,
          companyId,
          cashierId: cashier.id,
          closedById: user.id,
          periodFrom: from,
          periodTo: to,
          salesCount,
          itemsCount,
          total,
          openingCash,
          expectedCash,
          countedCash: dto.countedCash,
          difference: dto.countedCash - expectedCash,
          notes: dto.notes?.trim() || null,
          summary: rest as unknown as Prisma.InputJsonValue,
        },
        include: { cashier: { select: { id: true, name: true } }, closedBy: { select: { id: true, name: true } } },
      });
    });
  }

  async list(user: any, q: { companyId?: string; page?: string }) {
    const companyId = this.resolveCompanyId(user, q.companyId);
    const where: Prisma.CashClosureWhereInput = { companyId };
    if (!MANAGER_ROLES.includes(user.role)) where.cashierId = user.id;
    const page = Math.max(1, Number(q.page) || 1);
    const take = 20;
    const [closures, total] = await Promise.all([
      this.prisma.cashClosure.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip: (page - 1) * take,
        select: {
          id: true, number: true, periodFrom: true, periodTo: true, salesCount: true, itemsCount: true,
          total: true, expectedCash: true, countedCash: true, difference: true, createdAt: true,
          cashier: { select: { id: true, name: true } }, closedBy: { select: { id: true, name: true } },
        },
      }),
      this.prisma.cashClosure.count({ where }),
    ]);
    return { closures, total, page, pages: Math.ceil(total / take) };
  }

  async get(user: any, id: string) {
    const closure = await this.prisma.cashClosure.findUnique({
      where: { id },
      include: {
        cashier: { select: { id: true, name: true } },
        closedBy: { select: { id: true, name: true } },
        company: { select: { id: true, name: true } },
      },
    });
    if (!closure) throw new NotFoundException('Cierre no encontrado');
    if (user.role !== Role.SUPER_ADMIN && closure.companyId !== user.companyId) throw new ForbiddenException();
    if (!MANAGER_ROLES.includes(user.role) && closure.cashierId !== user.id) throw new ForbiddenException();
    return closure;
  }

  // Usuarios de la empresa que pueden tener caja (selector de los administradores).
  async cashiers(user: any, companyId?: string) {
    const cid = this.resolveCompanyId(user, companyId);
    if (!MANAGER_ROLES.includes(user.role)) return [{ id: user.id, name: user.name }];
    return this.prisma.user.findMany({
      where: { companyId: cid, active: true, role: { in: [Role.COMPANY_ADMIN, Role.CATALOG_MANAGER, Role.VENDEDOR] } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }
}
