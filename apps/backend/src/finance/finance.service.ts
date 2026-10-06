import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { StorageService } from '../common/storage/storage.service';
import { FinanceAccountType, Prisma, Role, SaleChannel } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { startOfDayInTz } from '../common/timezone';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { BASE_PLAN, PlanNode, SYSTEM_KEYS, salesKeyForChannel } from './finance-plan';
import {
  CopyBudgetDto, CreateFinanceAccountDto, FinanceMovementDto, SaveBudgetsDto, UpdateFinanceAccountDto,
} from './dto/finance.dto';

const IVA = 0.19;
const round2 = (n: number) => Math.round(n * 100) / 100;
const sinIva = (n: number) => round2(n / (1 + IVA));
const months = () => Array.from({ length: 12 }, () => 0);

// Canales cuya comisión y despacho quedan en la venta. Mercado Libre los guarda CON IVA (tal
// como los informa su API); Walmart, Ripley, Paris, Falabella y JumpSeller ya SIN IVA (sale-breakdown.ts).
const FEE_CHANNELS_WITH_IVA: string[] = [SaleChannel.MERCADO_LIBRE];
const FEE_CHANNELS_NET: string[] = [SaleChannel.WALMART, SaleChannel.RIPLEY, SaleChannel.PARIS, SaleChannel.FALABELLA, SaleChannel.JUMPSELLER];

type AutoRow = { systemKey: string; year: number; month: number; amount: number };

@Injectable()
export class FinanceService {
  constructor(private prisma: PrismaService, private settings: SettingsService, private readonly storage: StorageService) {}

  resolveCompanyId(user: any, companyId?: string): string {
    if (user.role === Role.SUPER_ADMIN) {
      if (!companyId) throw new BadRequestException('companyId requerido para Super Admin');
      return companyId;
    }
    if (!user.companyId) throw new ForbiddenException('Sin empresa asignada');
    return user.companyId;
  }

  // ─── Plan de cuentas ──────────────────────────────────────────────────────────

  // Carga el plan base la primera vez y, después, solo repone las cuentas de sistema que
  // falten (si en una versión futura se agrega una nueva integración automática).
  async ensurePlan(companyId: string) {
    const existing = await this.prisma.financeAccount.findMany({ where: { companyId }, select: { id: true, code: true, systemKey: true } });
    try {
      await this.prisma.$transaction(async (tx) => {
        const byCode = new Map(existing.filter((a) => a.code).map((a) => [a.code!, a.id]));
        const systemKeys = new Set(existing.map((a) => a.systemKey).filter(Boolean));
        const seedAll = existing.length === 0;
        let order = 0;
        const walk = async (node: PlanNode, type: FinanceAccountType, parentId: string | null) => {
          let id = byCode.get(node.code);
          const needed = seedAll || (node.systemKey && !systemKeys.has(node.systemKey));
          if (!id && needed) {
            id = (await tx.financeAccount.create({
              data: { companyId, code: node.code, name: node.name, type, systemKey: node.systemKey, parentId, sortOrder: order++ },
            })).id;
            byCode.set(node.code, id);
          }
          for (const child of node.children || []) {
            // Una cuenta de sistema que falta se crea bajo su madre si existe; si no, en la raíz.
            await walk(child, type, id ?? parentId);
          }
        };
        for (const { type, root } of BASE_PLAN) await walk(root, type, null);
      });
    } catch (err: any) {
      // Otra pestaña cargó el plan al mismo tiempo (systemKey es único por empresa).
      if (err?.code !== 'P2002') throw err;
    }
  }

  async listAccounts(user: any, companyIdParam?: string) {
    const companyId = this.resolveCompanyId(user, companyIdParam);
    await this.ensurePlan(companyId);
    return this.prisma.financeAccount.findMany({
      where: { companyId },
      include: { _count: { select: { movements: true, children: true } } },
      orderBy: [{ code: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  private async getOwnedAccount(user: any, id: string) {
    const account = await this.prisma.financeAccount.findUnique({ where: { id }, include: { _count: { select: { children: true, movements: true, recurrings: true } } } });
    if (!account) throw new NotFoundException('Cuenta no encontrada');
    if (user.role !== Role.SUPER_ADMIN && account.companyId !== user.companyId) throw new ForbiddenException();
    return account;
  }

  async createAccount(user: any, dto: CreateFinanceAccountDto) {
    const companyId = this.resolveCompanyId(user, dto.companyId);
    let type = dto.type;
    if (dto.parentId) {
      const parent = await this.prisma.financeAccount.findUnique({ where: { id: dto.parentId } });
      if (!parent || parent.companyId !== companyId) throw new BadRequestException('Cuenta madre inválida');
      type = parent.type;
    }
    if (!type) throw new BadRequestException('Indica si la cuenta es de ingresos o de gastos');
    const last = await this.prisma.financeAccount.aggregate({ where: { companyId, parentId: dto.parentId ?? null }, _max: { sortOrder: true } });
    return this.prisma.financeAccount.create({
      data: {
        companyId, type, name: dto.name.trim(), code: dto.code?.trim() || null, parentId: dto.parentId ?? null,
        sortOrder: (last._max.sortOrder ?? 0) + 1,
      },
    });
  }

  async updateAccount(user: any, id: string, dto: UpdateFinanceAccountDto) {
    const account = await this.getOwnedAccount(user, id);
    const data: Prisma.FinanceAccountUncheckedUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.code !== undefined) data.code = dto.code.trim() || null;
    if (dto.archived !== undefined) {
      if (dto.archived && account.systemKey) throw new BadRequestException('Las cuentas de la integración automática no se pueden archivar');
      data.archived = dto.archived;
    }
    if (dto.parentId !== undefined) {
      if (dto.parentId) {
        const parent = await this.prisma.financeAccount.findUnique({ where: { id: dto.parentId } });
        if (!parent || parent.companyId !== account.companyId) throw new BadRequestException('Cuenta madre inválida');
        if (parent.type !== account.type) throw new BadRequestException('La cuenta madre debe ser del mismo tipo (ingresos o gastos)');
        // Evita ciclos: la nueva madre no puede ser la misma cuenta ni una de sus subcuentas.
        for (let cur: string | null = parent.id; cur; ) {
          if (cur === account.id) throw new BadRequestException('No se puede mover una cuenta dentro de sus propias subcuentas');
          cur = (await this.prisma.financeAccount.findUnique({ where: { id: cur }, select: { parentId: true } }))?.parentId ?? null;
        }
      }
      data.parentId = dto.parentId || null;
    }
    return this.prisma.financeAccount.update({ where: { id }, data });
  }

  async deleteAccount(user: any, id: string) {
    const account = await this.getOwnedAccount(user, id);
    if (account.systemKey) throw new BadRequestException('Las cuentas de la integración automática no se pueden eliminar');
    if (account._count.children > 0) throw new BadRequestException('La cuenta tiene subcuentas: elimínalas o muévelas primero');
    if (account._count.movements > 0) throw new BadRequestException('La cuenta tiene movimientos registrados: archívala en vez de eliminarla');
    if (account._count.recurrings > 0) throw new BadRequestException('La cuenta tiene gastos recurrentes: elimínalos o cámbialos de cuenta primero');
    await this.prisma.financeAccount.delete({ where: { id } });
    return { deleted: true };
  }

  // ─── Movimientos manuales ────────────────────────────────────────────────────

  // Guarda la fecha a mediodía UTC: en Chile sigue siendo el mismo día calendario.
  toStoredDate(date: string): Date {
    const day = String(date).slice(0, 10);
    const d = new Date(`${day}T12:00:00.000Z`);
    if (isNaN(d.getTime())) throw new BadRequestException('Fecha inválida');
    return d;
  }

  async validateBankAccount(companyId: string, bankAccountId?: string | null) {
    if (!bankAccountId) return null;
    const bank = await this.prisma.financeBankAccount.findUnique({ where: { id: bankAccountId } });
    if (!bank || bank.companyId !== companyId) throw new BadRequestException('Cuenta bancaria o caja inválida');
    if (bank.archived) throw new BadRequestException('La cuenta bancaria o caja está archivada');
    return bank;
  }

  async validateMovementAccount(companyId: string, accountId: string) {
    const account = await this.prisma.financeAccount.findUnique({ where: { id: accountId }, include: { _count: { select: { children: true } } } });
    if (!account || account.companyId !== companyId) throw new BadRequestException('Cuenta inválida');
    if (account.archived) throw new BadRequestException('La cuenta está archivada');
    if (account._count.children > 0) throw new BadRequestException('Registra el movimiento en una subcuenta (esta cuenta agrupa otras)');
    return account;
  }

  private async descendantIds(companyId: string, accountId: string): Promise<string[]> {
    const all = await this.prisma.financeAccount.findMany({ where: { companyId }, select: { id: true, parentId: true } });
    const ids = [accountId];
    for (let i = 0; i < ids.length; i++) ids.push(...all.filter((a) => a.parentId === ids[i]).map((a) => a.id));
    return ids;
  }

  async listMovements(user: any, q: { companyId?: string; from?: string; to?: string; accountId?: string; search?: string; page?: string }) {
    const companyId = this.resolveCompanyId(user, q.companyId);
    const where: Prisma.FinanceMovementWhereInput = { companyId };
    if (q.from || q.to) {
      where.date = {};
      if (q.from) where.date.gte = new Date(`${q.from.slice(0, 10)}T00:00:00.000Z`);
      if (q.to) where.date.lte = new Date(`${q.to.slice(0, 10)}T23:59:59.999Z`);
    }
    if (q.accountId) where.accountId = { in: await this.descendantIds(companyId, q.accountId) };
    const search = q.search?.trim();
    if (search) {
      where.OR = [
        { description: { contains: search, mode: 'insensitive' } },
        { counterparty: { contains: search, mode: 'insensitive' } },
        { reference: { contains: search, mode: 'insensitive' } },
      ];
    }
    const PAGE_SIZE = 50;
    const page = Math.max(1, Number(q.page) || 1);
    const [items, total, sum] = await Promise.all([
      this.prisma.financeMovement.findMany({
        where,
        include: {
          account: { select: { id: true, name: true, code: true, type: true } },
          user: { select: { id: true, name: true } },
          bankAccount: { select: { id: true, name: true } },
          recurring: { select: { id: true, description: true } },
          bankTransaction: { select: { id: true, date: true } },
        },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      this.prisma.financeMovement.count({ where }),
      this.prisma.financeMovement.aggregate({ where, _sum: { amount: true } }),
    ]);
    return { items, total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), sum: Number(sum._sum.amount ?? 0) };
  }

  async createMovement(user: any, dto: FinanceMovementDto) {
    const companyId = this.resolveCompanyId(user, dto.companyId);
    await this.validateMovementAccount(companyId, dto.accountId);
    await this.validateBankAccount(companyId, dto.bankAccountId);
    const movement = await this.prisma.financeMovement.create({
      data: {
        companyId, accountId: dto.accountId, date: this.toStoredDate(dto.date), amount: dto.amount, tax: dto.tax ?? 0,
        description: dto.description.trim(), counterparty: dto.counterparty?.trim() || null,
        paymentMethod: dto.paymentMethod ?? null, reference: dto.reference?.trim() || null, userId: user.id ?? null,
        bankAccountId: dto.bankAccountId || null,
      },
    });
    return { movement, budgetStatus: await this.budgetStatus(companyId, dto.accountId, movement.date) };
  }

  async getOwnedMovement(user: any, id: string) {
    const m = await this.prisma.financeMovement.findUnique({ where: { id } });
    if (!m) throw new NotFoundException('Movimiento no encontrado');
    if (user.role !== Role.SUPER_ADMIN && m.companyId !== user.companyId) throw new ForbiddenException();
    return m;
  }

  async updateMovement(user: any, id: string, dto: FinanceMovementDto) {
    const current = await this.getOwnedMovement(user, id);
    await this.validateMovementAccount(current.companyId, dto.accountId);
    await this.validateBankAccount(current.companyId, dto.bankAccountId);
    const movement = await this.prisma.financeMovement.update({
      where: { id },
      data: {
        accountId: dto.accountId, date: this.toStoredDate(dto.date), amount: dto.amount, tax: dto.tax ?? 0,
        description: dto.description.trim(), counterparty: dto.counterparty?.trim() || null,
        paymentMethod: dto.paymentMethod ?? null, reference: dto.reference?.trim() || null,
        bankAccountId: dto.bankAccountId || null,
      },
    });
    return { movement, budgetStatus: await this.budgetStatus(current.companyId, dto.accountId, movement.date) };
  }

  async deleteMovement(user: any, id: string) {
    const m = await this.getOwnedMovement(user, id);
    await this.prisma.$transaction(async (tx) => {
      // La línea de cartola que estaba conciliada con este movimiento vuelve a quedar pendiente.
      await tx.financeBankTransaction.updateMany({ where: { movementId: id }, data: { status: 'PENDING', movementId: null } });
      await tx.financeMovement.delete({ where: { id } });
    });
    await this.deleteAttachmentFile(m.attachmentUrl);
    return { deleted: true };
  }

  // ─── Comprobantes adjuntos ───────────────────────────────────────────────────
  // Se guardan en uploads/finance con nombre aleatorio (no adivinable), igual que los
  // documentos tributarios que se hospedan para Falabella.

  private uploadsDir() {
    return join(process.env.UPLOAD_DIR || join(process.cwd(), 'uploads'), 'finance');
  }

  private async deleteAttachmentFile(url: string | null) {
    if (url) await this.storage.remove([url]).catch(() => {});
  }

  async setAttachment(user: any, id: string, file: Express.Multer.File) {
    const m = await this.getOwnedMovement(user, id);
    if (!file) throw new BadRequestException('No se recibió ningún archivo');
    if (file.size > 10 * 1024 * 1024) throw new BadRequestException('El archivo supera el límite de 10 MB');
    // La extensión sale del tipo permitido, nunca del nombre que envió el usuario (un .html
    // quedaría servido como página desde /api/uploads).
    const EXT: Record<string, string> = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
    const ext = EXT[file.mimetype];
    if (!ext) throw new BadRequestException('Tipo de archivo no permitido: usa PDF, JPG, PNG o WebP');
    const filename = `${randomUUID()}${ext}`;
    const { url } = await this.storage.put(file.buffer, filename, file.mimetype, { folder: 'finance', private: true });
    await this.deleteAttachmentFile(m.attachmentUrl);
    return this.prisma.financeMovement.update({ where: { id }, data: { attachmentUrl: url } });
  }

  async removeAttachment(user: any, id: string) {
    const m = await this.getOwnedMovement(user, id);
    await this.deleteAttachmentFile(m.attachmentUrl);
    return this.prisma.financeMovement.update({ where: { id }, data: { attachmentUrl: null } });
  }

  // ─── Integración automática ──────────────────────────────────────────────────

  // Montos SIN IVA por cuenta de sistema y mes (en la zona horaria del panel), calculados al
  // vuelo para que siempre reflejen el estado actual de ventas y compras:
  // - Ventas por canal: total de la venta (con IVA) / 1,19. Se excluyen las ventas cuya orden
  //   de despacho quedó cancelada.
  // - Comisiones y despachos a cargo del vendedor: los que guardó la importación de cada
  //   marketplace (Mercado Libre con IVA → se le descuenta; el resto ya viene sin IVA). Un
  //   despacho negativo es un ingreso por envío que ya está dentro del total de la venta.
  // - Compras de mercadería: total de la compra (costos ingresados con IVA, igual que el costo
  //   de los productos) / 1,19.
  async automaticActuals(companyId: string, from: Date, to: Date): Promise<AutoRow[]> {
    const tz = await this.settings.getTimezone();
    // ::text evita que Postgres dude entre timezone(text) y timezone(interval) con el parámetro.
    const local = (col: Prisma.Sql) => Prisma.sql`((${col} AT TIME ZONE 'UTC') AT TIME ZONE ${tz}::text)`;
    const saleDate = local(Prisma.sql`s."createdAt"`);
    const purchaseDate = local(Prisma.sql`p."date"`);

    const [sales, purchases] = await Promise.all([
      this.prisma.$queryRaw<{ channel: string; y: number; m: number; total: any; fee: any; shipping: any }[]>`
        SELECT s."channel"::text AS channel,
               EXTRACT(YEAR FROM ${saleDate})::int AS y,
               EXTRACT(MONTH FROM ${saleDate})::int AS m,
               SUM(s."total") AS total,
               SUM(COALESCE(s."marketplaceFee", 0)) AS fee,
               SUM(CASE WHEN s."shippingCost" > 0 THEN s."shippingCost" ELSE 0 END) AS shipping
        FROM "sales" s
        LEFT JOIN "orders" o ON o."saleId" = s."id"
        WHERE s."companyId" = ${companyId} AND s."createdAt" >= ${from} AND s."createdAt" < ${to}
          AND (o."id" IS NULL OR o."status" <> 'CANCELLED')
        GROUP BY 1, 2, 3`,
      this.prisma.$queryRaw<{ y: number; m: number; total: any }[]>`
        SELECT EXTRACT(YEAR FROM ${purchaseDate})::int AS y,
               EXTRACT(MONTH FROM ${purchaseDate})::int AS m,
               SUM(p."total") AS total
        FROM "purchases" p
        WHERE p."companyId" = ${companyId} AND p."date" >= ${from} AND p."date" < ${to}
        GROUP BY 1, 2`,
    ]);

    const rows: AutoRow[] = [];
    const push = (systemKey: string, year: number, month: number, amount: number) => {
      if (amount) rows.push({ systemKey, year: Number(year), month: Number(month), amount: round2(amount) });
    };
    for (const r of sales) {
      push(salesKeyForChannel(r.channel as SaleChannel), r.y, r.m, sinIva(Number(r.total)));
      const withIva = FEE_CHANNELS_WITH_IVA.includes(r.channel);
      if (withIva || FEE_CHANNELS_NET.includes(r.channel)) {
        const net = (v: any) => (withIva ? sinIva(Number(v)) : Number(v));
        push(SYSTEM_KEYS.MARKETPLACE_FEES, r.y, r.m, net(r.fee));
        push(SYSTEM_KEYS.SHIPPING, r.y, r.m, net(r.shipping));
      }
    }
    for (const r of purchases) push(SYSTEM_KEYS.PURCHASES, r.y, r.m, sinIva(Number(r.total)));
    return rows;
  }

  private async yearBounds(year: number) {
    const tz = await this.settings.getTimezone();
    return { from: startOfDayInTz(tz, `${year}-01-01`), to: startOfDayInTz(tz, `${year + 1}-01-01`), tz };
  }

  private async manualByMonth(companyId: string, from: Date, to: Date, tz: string) {
    const local = Prisma.sql`(("date" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}::text)`;
    return this.prisma.$queryRaw<{ accountId: string; y: number; m: number; total: any }[]>`
      SELECT "accountId", EXTRACT(YEAR FROM ${local})::int AS y, EXTRACT(MONTH FROM ${local})::int AS m, SUM("amount") AS total
      FROM "finance_movements"
      WHERE "companyId" = ${companyId} AND "date" >= ${from} AND "date" < ${to}
      GROUP BY 1, 2, 3`;
  }

  // Resumen de lo automático en un rango (para mostrarlo junto a los movimientos manuales).
  async automaticSummary(user: any, q: { companyId?: string; from: string; to: string }) {
    const companyId = this.resolveCompanyId(user, q.companyId);
    await this.ensurePlan(companyId);
    const tz = await this.settings.getTimezone();
    const from = startOfDayInTz(tz, q.from.slice(0, 10));
    const to = new Date(startOfDayInTz(tz, q.to.slice(0, 10)).getTime() + 24 * 60 * 60 * 1000);
    const rows = await this.automaticActuals(companyId, from, to);
    const accounts = await this.prisma.financeAccount.findMany({ where: { companyId, systemKey: { not: null } } });
    return accounts
      .map((a) => ({
        accountId: a.id, code: a.code, name: a.name, type: a.type, systemKey: a.systemKey,
        amount: round2(rows.filter((r) => r.systemKey === a.systemKey).reduce((s, r) => s + r.amount, 0)),
      }))
      .filter((a) => a.amount !== 0)
      .sort((a, b) => (a.code || '').localeCompare(b.code || ''));
  }

  // ─── Presupuesto vs. real ────────────────────────────────────────────────────

  async report(user: any, companyIdParam: string | undefined, year: number) {
    const companyId = this.resolveCompanyId(user, companyIdParam);
    await this.ensurePlan(companyId);
    const { from, to, tz } = await this.yearBounds(year);
    const [accounts, budgets, manual, auto] = await Promise.all([
      this.prisma.financeAccount.findMany({ where: { companyId }, orderBy: [{ code: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }] }),
      this.prisma.financeBudget.findMany({ where: { companyId, year } }),
      this.manualByMonth(companyId, from, to, tz),
      this.automaticActuals(companyId, from, to),
    ]);

    const node = new Map(accounts.map((a) => [a.id, {
      id: a.id, parentId: a.parentId, code: a.code, name: a.name, type: a.type, systemKey: a.systemKey, archived: a.archived,
      isLeaf: true, budget: months(), actual: months(), automatic: months(), ownBudget: months(),
    }]));
    for (const a of accounts) if (a.parentId && node.has(a.parentId)) node.get(a.parentId)!.isLeaf = false;
    for (const b of budgets) {
      const n = node.get(b.accountId);
      if (n) { n.budget[b.month - 1] += Number(b.amount); n.ownBudget[b.month - 1] += Number(b.amount); }
    }
    for (const m of manual) {
      const n = node.get(m.accountId);
      if (n && Number(m.y) === year) n.actual[Number(m.m) - 1] += Number(m.total);
    }
    const bySystemKey = new Map(accounts.filter((a) => a.systemKey).map((a) => [a.systemKey!, a.id]));
    for (const r of auto) {
      const n = node.get(bySystemKey.get(r.systemKey) || '');
      if (n && r.year === year) { n.actual[r.month - 1] += r.amount; n.automatic[r.month - 1] += r.amount; }
    }

    // Las cuentas madre suman lo propio más lo de todas sus subcuentas (de las hojas hacia arriba).
    const depth = (id: string | null): number => { let d = 0; for (let c = id; c; c = node.get(c)?.parentId ?? null) d++; return d; };
    const ordered = [...node.values()].sort((a, b) => depth(b.id) - depth(a.id));
    for (const n of ordered) {
      const parent = n.parentId ? node.get(n.parentId) : null;
      if (!parent) continue;
      for (let i = 0; i < 12; i++) {
        parent.budget[i] += n.budget[i];
        parent.actual[i] += n.actual[i];
        parent.automatic[i] += n.automatic[i];
      }
    }

    const rows = accounts.map((a) => {
      const n = node.get(a.id)!;
      return { ...n, budget: n.budget.map(round2), actual: n.actual.map(round2), automatic: n.automatic.map(round2), ownBudget: n.ownBudget.map(round2) };
    });
    const totals = (type: FinanceAccountType) => {
      const roots = rows.filter((r) => r.type === type && !r.parentId);
      const sum = (k: 'budget' | 'actual') => months().map((_, i) => round2(roots.reduce((s, r) => s + r[k][i], 0)));
      return { budget: sum('budget'), actual: sum('actual') };
    };
    return { year, accounts: rows, totals: { INCOME: totals(FinanceAccountType.INCOME), EXPENSE: totals(FinanceAccountType.EXPENSE) } };
  }

  // Presupuesto y real del mes de `date` para una cuenta, para avisar al registrar un gasto.
  async budgetStatus(companyId: string, accountId: string, date: Date) {
    const tz = await this.settings.getTimezone();
    const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' }).format(date).split('-').map(Number);
    const from = startOfDayInTz(tz, `${y}-${String(m).padStart(2, '0')}-01`);
    const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
    const to = startOfDayInTz(tz, next);
    const account = await this.prisma.financeAccount.findUnique({ where: { id: accountId } });
    const [budget, manual, auto] = await Promise.all([
      this.prisma.financeBudget.findUnique({ where: { accountId_year_month: { accountId, year: y, month: m } } }),
      this.prisma.financeMovement.aggregate({ where: { accountId, date: { gte: from, lt: to } }, _sum: { amount: true } }),
      account?.systemKey ? this.automaticActuals(companyId, from, to) : Promise.resolve([] as AutoRow[]),
    ]);
    const actual = round2(Number(manual._sum.amount ?? 0) + auto.filter((r) => r.systemKey === account?.systemKey).reduce((s, r) => s + r.amount, 0));
    const b = budget ? Number(budget.amount) : null;
    return { year: y, month: m, accountName: account?.name, type: account?.type, budget: b, actual, percent: b ? round2((actual / b) * 100) : null };
  }

  async saveBudgets(user: any, dto: SaveBudgetsDto) {
    const companyId = this.resolveCompanyId(user, dto.companyId);
    const ids = [...new Set(dto.entries.map((e) => e.accountId))];
    const valid = await this.prisma.financeAccount.count({ where: { id: { in: ids }, companyId } });
    if (valid !== ids.length) throw new BadRequestException('Una o más cuentas no pertenecen a la empresa');
    await this.prisma.$transaction(async (tx) => {
      for (const e of dto.entries) {
        const where = { accountId_year_month: { accountId: e.accountId, year: dto.year, month: e.month } };
        if (!e.amount) {
          await tx.financeBudget.deleteMany({ where: { accountId: e.accountId, year: dto.year, month: e.month } });
        } else {
          await tx.financeBudget.upsert({
            where,
            create: { companyId, accountId: e.accountId, year: dto.year, month: e.month, amount: e.amount },
            update: { amount: e.amount },
          });
        }
      }
    });
    return { saved: dto.entries.length };
  }

  // Arma el presupuesto de un año a partir del presupuesto o de lo real de otro, con un ajuste
  // porcentual. Solo toca cuentas hoja con base distinta de 0 (no borra lo ya cargado en otras).
  async copyBudget(user: any, dto: CopyBudgetDto) {
    const companyId = this.resolveCompanyId(user, dto.companyId);
    const base = await this.report(user, companyId, dto.fromYear);
    const factor = 1 + (dto.percent ?? 0) / 100;
    const entries: { accountId: string; month: number; amount: number }[] = [];
    for (const a of base.accounts) {
      if (!a.isLeaf || a.archived || (dto.type && a.type !== dto.type)) continue;
      const source = dto.source === 'budget' ? a.ownBudget : a.actual;
      source.forEach((v, i) => { if (v > 0) entries.push({ accountId: a.id, month: i + 1, amount: Math.round(v * factor) }); });
    }
    if (!entries.length) return { saved: 0 };
    return this.saveBudgets(user, { year: dto.toYear, entries, companyId });
  }
}
