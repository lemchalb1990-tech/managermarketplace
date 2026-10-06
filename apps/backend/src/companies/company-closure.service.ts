import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { StorageService } from '../common/storage/storage.service';
import { Cron } from '@nestjs/schedule';
import { Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import * as ExcelJS from 'exceljs';
import JSZip = require('jszip');
import { unlink } from 'fs/promises';
import { join, resolve, sep } from 'path';
import { PrismaService } from '../prisma/prisma.service';

export const CLOSURE_GRACE_DAYS = 30;
type Tx = Prisma.TransactionClient;
const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;

// Baja de la cuenta de una empresa, pedida por su administrador.
// 1. requestClosure: bloquea la cuenta (nadie de la empresa entra), desactiva sus conexiones a
//    marketplaces y programa el borrado a 30 días.
// 2. Durante ese plazo el super admin puede revertirla (cancelClosure).
// 3. purgeDue (cron diario) borra TODOS los datos de la empresa y sus archivos subidos.
@Injectable()
export class CompanyClosureService {
  private readonly logger = new Logger(CompanyClosureService.name);

  constructor(private prisma: PrismaService, private readonly storage: StorageService) {}

  private companyIdOf(user: any, companyId?: string): string {
    if (user.role === Role.SUPER_ADMIN) {
      if (!companyId) throw new BadRequestException('companyId requerido para Super Admin');
      return companyId;
    }
    if (user.role !== Role.COMPANY_ADMIN) throw new ForbiddenException('Solo el administrador de la empresa puede gestionar la baja de la cuenta');
    if (!user.companyId) throw new ForbiddenException('Sin empresa asignada');
    return user.companyId;
  }

  async status(user: any, companyIdParam?: string) {
    const companyId = this.companyIdOf(user, companyIdParam);
    const c = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, name: true, active: true, closureRequestedAt: true, closureScheduledFor: true, closureReason: true },
    });
    if (!c) throw new NotFoundException('Empresa no encontrada');
    return { ...c, graceDays: CLOSURE_GRACE_DAYS };
  }

  async requestClosure(user: any, dto: { password: string; companyName: string; reason?: string; companyId?: string }) {
    const companyId = this.companyIdOf(user, dto.companyId);
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Empresa no encontrada');
    if (company.closureScheduledFor) throw new BadRequestException('La baja de esta cuenta ya está en curso');
    if ((dto.companyName || '').trim().toLowerCase() !== company.name.trim().toLowerCase()) {
      throw new BadRequestException('El nombre de la empresa no coincide');
    }
    const me = await this.prisma.user.findUnique({ where: { id: user.id } });
    if (!me || !(await bcrypt.compare(dto.password || '', me.password))) throw new BadRequestException('La contraseña no es correcta');

    const activeConnections = await this.prisma.marketplaceConnection.findMany({ where: { companyId, active: true }, select: { id: true } });
    const scheduledFor = new Date(Date.now() + CLOSURE_GRACE_DAYS * 24 * 60 * 60 * 1000);
    await this.prisma.$transaction([
      // Sin conexiones activas se detienen las sincronizaciones, importaciones y webhooks.
      this.prisma.marketplaceConnection.updateMany({ where: { companyId, active: true }, data: { active: false } }),
      this.prisma.company.update({
        where: { id: companyId },
        data: {
          active: false, closureRequestedAt: new Date(), closureScheduledFor: scheduledFor, closureRequestedById: user.id,
          closureReason: dto.reason?.trim() || null, closureMeta: { connectionIds: activeConnections.map((c) => c.id) },
        },
      }),
    ]);
    this.logger.warn(`Empresa ${companyId} (${company.name}) pidió la baja; borrado programado para ${scheduledFor.toISOString()}`);
    return { scheduledFor };
  }

  // Solo super admin: deja la empresa como estaba antes de pedir la baja.
  async cancelClosure(companyId: string) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Empresa no encontrada');
    if (!company.closureScheduledFor) throw new BadRequestException('Esta empresa no tiene una baja en curso');
    const ids: string[] = (company.closureMeta as any)?.connectionIds || [];
    await this.prisma.$transaction([
      this.prisma.marketplaceConnection.updateMany({ where: { id: { in: ids }, companyId }, data: { active: true } }),
      this.prisma.company.update({
        where: { id: companyId },
        data: { active: true, closureRequestedAt: null, closureScheduledFor: null, closureRequestedById: null, closureReason: null, closureMeta: Prisma.DbNull },
      }),
    ]);
    return { restored: true, connectionsReactivated: ids.length };
  }

  @Cron('30 9 * * *') // 09:30 UTC ≈ madrugada en Chile
  async purgeDue() {
    const due = await this.prisma.company.findMany({ where: { closureScheduledFor: { lte: new Date() } }, select: { id: true, name: true } });
    for (const c of due) {
      try {
        const res = await this.purgeCompany(c.id);
        this.logger.warn(`Empresa ${c.id} (${c.name}) eliminada definitivamente: ${res.rows} filas, ${res.files} archivos`);
      } catch (err: any) {
        this.logger.error(`No se pudo eliminar la empresa ${c.id}: ${err?.message || err}`);
      }
    }
  }

  // ─── Borrado definitivo ──────────────────────────────────────────────────────
  // Recorre las relaciones de la base (no una lista fija de tablas) para que ninguna tabla nueva
  // quede fuera: se borra toda fila con companyId de la empresa y, recursivamente, toda fila que
  // apunte a una fila borrada. Primero se anulan las referencias opcionales (rompe ciclos) y
  // después se borra en pasadas hasta que ninguna llave foránea lo impida.

  async purgeCompany(companyId: string): Promise<{ rows: number; files: number }> {
    const files: string[] = [];
    let rows = 0;
    await this.prisma.$transaction(async (tx) => {
      const fks = await tx.$queryRaw<{ child: string; col: string; parent: string; pcol: string; nullable: boolean }[]>`
        SELECT tc.relname AS child, a.attname AS col, pc.relname AS parent, pa.attname AS pcol, NOT a.attnotnull AS nullable
        FROM pg_constraint c
        JOIN pg_class tc ON tc.oid = c.conrelid
        JOIN pg_class pc ON pc.oid = c.confrelid
        JOIN pg_namespace n ON n.oid = tc.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        JOIN pg_attribute pa ON pa.attrelid = c.confrelid AND pa.attnum = c.confkey[1]
        WHERE c.contype = 'f' AND n.nspname = current_schema()`;
      const withCompanyId = (await tx.$queryRaw<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.columns
        WHERE table_schema = current_schema() AND column_name = 'companyId' AND table_name <> '_prisma_migrations'`).map((r) => r.table_name);

      // 1. Filas a borrar, materializadas en tablas temporales (del_<tabla>).
      const selected = new Set<string>(['companies', ...withCompanyId]);
      const tmp = (t: string) => ident(`del_${t}`);
      // Con PK para que ON CONFLICT descarte repetidos y el recorrido de abajo termine.
      const createTmp = (t: string) => tx.$executeRawUnsafe(`CREATE TEMP TABLE ${tmp(t)} (id text PRIMARY KEY) ON COMMIT DROP`);
      await createTmp('companies');
      await tx.$executeRawUnsafe(`INSERT INTO ${tmp('companies')} SELECT id FROM "companies" WHERE id = $1`, companyId);
      for (const t of withCompanyId) {
        await createTmp(t);
        await tx.$executeRawUnsafe(`INSERT INTO ${tmp(t)} SELECT id FROM ${ident(t)} WHERE "companyId" = $1`, companyId);
      }
      // Tablas sin companyId que cuelgan de filas borradas (p. ej. sale_items, stock_movements).
      for (let changed = true; changed; ) {
        changed = false;
        for (const fk of fks) {
          if (!selected.has(fk.parent) || fk.child === 'companies') continue;
          if (!selected.has(fk.child)) {
            selected.add(fk.child);
            await createTmp(fk.child);
          }
          const added = await tx.$executeRawUnsafe(
            `INSERT INTO ${tmp(fk.child)} SELECT t.id FROM ${ident(fk.child)} t
             WHERE t.${ident(fk.col)} IN (SELECT p.${ident(fk.pcol)} FROM ${ident(fk.parent)} p WHERE p.id IN (SELECT id FROM ${tmp(fk.parent)}))
             ON CONFLICT DO NOTHING`,
          );
          if (added > 0) changed = true;
        }
      }

      // 2. Archivos subidos que referencian las filas borradas (se eliminan tras el commit).
      const textCols = await tx.$queryRaw<{ table_name: string; column_name: string }[]>`
        SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = current_schema() AND data_type IN ('text', 'character varying')`;
      for (const { table_name: t, column_name: col } of textCols) {
        if (!selected.has(t)) continue;
        const bare = col === 'filename';
        const vals = await tx.$queryRawUnsafe<{ v: string }[]>(
          `SELECT ${ident(col)} AS v FROM ${ident(t)} WHERE id IN (SELECT id FROM ${tmp(t)}) AND ${ident(col)} IS NOT NULL
           ${bare ? '' : `AND ${ident(col)} LIKE '%/uploads/%'`}`,
        );
        for (const { v } of vals) files.push(bare ? v : v.split('/uploads/').pop()!.split('?')[0]);
      }
      const invoiceIds = selected.has('invoices') ? await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM ${tmp('invoices')}`) : [];
      for (const { id } of invoiceIds) files.push(`invoice-${id}.pdf`, `invoice-${id}.xml`);

      // 3. Anula referencias opcionales hacia filas borradas (rompe ciclos y libera filas ajenas).
      for (const fk of fks) {
        if (!fk.nullable || !selected.has(fk.parent)) continue;
        await tx.$executeRawUnsafe(
          `UPDATE ${ident(fk.child)} SET ${ident(fk.col)} = NULL
           WHERE ${ident(fk.col)} IN (SELECT p.${ident(fk.pcol)} FROM ${ident(fk.parent)} p WHERE p.id IN (SELECT id FROM ${tmp(fk.parent)}))`,
        );
      }

      // 4. Borrado: primero las tablas hijas (orden topológico por las llaves obligatorias que
      //    quedan tras el paso 3) y, por si hubiera un ciclo, pasadas que reintentan lo que choque.
      const mustGoFirst = new Map<string, Set<string>>(); // tabla → hijas que deben borrarse antes
      for (const fk of fks) {
        if (fk.nullable || fk.child === fk.parent || !selected.has(fk.child) || !selected.has(fk.parent)) continue;
        if (!mustGoFirst.has(fk.parent)) mustGoFirst.set(fk.parent, new Set());
        mustGoFirst.get(fk.parent)!.add(fk.child);
      }
      const ordered: string[] = [];
      const visiting = new Set<string>();
      const visit = (t: string) => {
        if (ordered.includes(t) || visiting.has(t)) return;
        visiting.add(t);
        for (const child of mustGoFirst.get(t) || []) visit(child);
        visiting.delete(t);
        ordered.push(t);
      };
      for (const t of selected) visit(t);
      const pending = new Set(ordered);
      for (let pass = 0; pending.size && pass < 60; pass++) {
        let progress = false;
        for (const t of [...pending]) {
          await tx.$executeRawUnsafe('SAVEPOINT purge_step');
          try {
            rows += await tx.$executeRawUnsafe(`DELETE FROM ${ident(t)} WHERE id IN (SELECT id FROM ${tmp(t)})`);
            await tx.$executeRawUnsafe('RELEASE SAVEPOINT purge_step');
            pending.delete(t);
            progress = true;
          } catch (err: any) {
            await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT purge_step');
            if (!/foreign key|violates/i.test(String(err?.message))) throw err;
          }
        }
        if (!progress) break;
      }
      if (pending.size) throw new Error(`No se pudieron borrar las tablas: ${[...pending].join(', ')}`);
    }, { timeout: 10 * 60 * 1000, maxWait: 30 * 1000 });

    // Archivos: en disco (solo dentro de uploads/) y en Supabase Storage si está configurado.
    const deleted = await this.storage.remove(files);
    return { rows, files: deleted };
  }

  // ─── Respaldo descargable ────────────────────────────────────────────────────

  async exportData(user: any, companyIdParam?: string): Promise<{ filename: string; buffer: Buffer }> {
    const companyId = this.companyIdOf(user, companyIdParam);
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Empresa no encontrada');
    const where = { companyId };
    const [users, clients, suppliers, products, sales, invoices, purchases, orders, accounts, movements, budgets, banks, bankLines, recurrings, warehouses] = await Promise.all([
      this.prisma.user.findMany({ where, select: { name: true, email: true, role: true, active: true, createdAt: true } }),
      this.prisma.client.findMany({ where }),
      this.prisma.supplier.findMany({ where }),
      this.prisma.product.findMany({ where, select: { sku: true, name: true, price: true, cost: true, stock: true, criticalStock: true, active: true, createdAt: true } }),
      this.prisma.sale.findMany({ where, include: { items: { include: { product: { select: { sku: true, name: true } } } } }, orderBy: { createdAt: 'asc' } }),
      this.prisma.invoice.findMany({ where, orderBy: { createdAt: 'asc' } }),
      this.prisma.purchase.findMany({ where, include: { supplier: { select: { name: true } }, items: { include: { product: { select: { sku: true, name: true } } } } }, orderBy: { date: 'asc' } }),
      this.prisma.order.findMany({ where, include: { sale: { select: { channel: true, externalId: true } } }, orderBy: { createdAt: 'asc' } }),
      this.prisma.financeAccount.findMany({ where, orderBy: { code: 'asc' } }),
      this.prisma.financeMovement.findMany({ where, include: { account: { select: { name: true } }, bankAccount: { select: { name: true } } }, orderBy: { date: 'asc' } }),
      this.prisma.financeBudget.findMany({ where, include: { account: { select: { name: true } } } }),
      this.prisma.financeBankAccount.findMany({ where }),
      this.prisma.financeBankTransaction.findMany({ where, include: { bankAccount: { select: { name: true } } }, orderBy: { date: 'asc' } }),
      this.prisma.financeRecurring.findMany({ where, include: { account: { select: { name: true } } } }),
      this.prisma.warehouse.findMany({ where }),
    ]);

    const wb = new ExcelJS.Workbook();
    const sheet = (name: string, columns: [string, string][], data: any[]) => {
      const ws = wb.addWorksheet(name);
      ws.columns = columns.map(([key, header]) => ({ key, header, width: Math.max(12, header.length + 2) }));
      ws.getRow(1).font = { bold: true };
      for (const r of data) ws.addRow(Object.fromEntries(columns.map(([key]) => [key, this.cell(r, key)])));
    };
    sheet('Empresa', [['name', 'Nombre'], ['slug', 'Identificador'], ['createdAt', 'Creada'], ['exportedAt', 'Respaldo generado']], [{ ...company, exportedAt: new Date() }]);
    sheet('Usuarios', [['name', 'Nombre'], ['email', 'Correo'], ['role', 'Rol'], ['active', 'Activo'], ['createdAt', 'Creado']], users);
    sheet('Clientes', [['name', 'Nombre'], ['rut', 'RUT'], ['giro', 'Giro'], ['email', 'Correo'], ['phone', 'Teléfono'], ['address', 'Dirección'], ['commune', 'Comuna'], ['city', 'Ciudad']], clients);
    sheet('Proveedores', Object.keys(suppliers[0] || { name: 1 }).filter((k) => !/id$|Id$/.test(k)).map((k) => [k, k] as [string, string]), suppliers);
    sheet('Bodegas', [['name', 'Nombre'], ['active', 'Activa']], warehouses);
    sheet('Productos', [['sku', 'SKU'], ['name', 'Nombre'], ['price', 'Precio'], ['cost', 'Costo'], ['stock', 'Stock'], ['criticalStock', 'Stock crítico'], ['active', 'Activo'], ['createdAt', 'Creado']], products);
    sheet('Ventas', [['createdAt', 'Fecha'], ['channel', 'Canal'], ['externalId', 'N° externo'], ['customerName', 'Cliente'], ['customerEmail', 'Correo'], ['total', 'Total'], ['marketplaceFee', 'Comisión'], ['shippingCost', 'Despacho'], ['netAmount', 'Neto'], ['paymentMethod', 'Medio de pago'], ['address', 'Dirección'], ['commune', 'Comuna']], sales);
    sheet('Detalle ventas', [['saleDate', 'Fecha'], ['externalId', 'N° externo'], ['sku', 'SKU'], ['product', 'Producto'], ['quantity', 'Cantidad'], ['unitPrice', 'Precio unitario'], ['totalCost', 'Costo'], ['netAmount', 'Neto']],
      sales.flatMap((s) => s.items.map((i) => ({ ...i, saleDate: s.createdAt, externalId: s.externalId, sku: i.product.sku, product: i.product.name }))));
    sheet('Órdenes', [['createdAt', 'Fecha'], ['status', 'Estado'], ['channel', 'Canal'], ['externalId', 'N° externo'], ['customerName', 'Cliente'], ['address', 'Dirección'], ['commune', 'Comuna'], ['courier', 'Courier'], ['trackingCode', 'Seguimiento'], ['deliveredAt', 'Entregada']],
      orders.map((o) => ({ ...o, channel: o.sale?.channel, externalId: o.sale?.externalId })));
    sheet('Documentos tributarios', [['issuedAt', 'Emisión'], ['dteType', 'Tipo'], ['folio', 'Folio'], ['status', 'Estado'], ['rut', 'RUT'], ['razonSocial', 'Razón social'], ['netAmount', 'Neto'], ['tax', 'IVA'], ['totalAmount', 'Total'], ['file', 'Archivo en el respaldo']],
      invoices.map((i) => ({ ...i, file: i.pdfUrl || i.xmlUrl ? `documentos/${this.docName(i)}.*` : '' })));
    sheet('Compras', [['date', 'Fecha'], ['documentNumber', 'N° documento'], ['supplier', 'Proveedor'], ['total', 'Total'], ['notes', 'Notas']], purchases.map((p) => ({ ...p, supplier: p.supplier.name })));
    sheet('Detalle compras', [['date', 'Fecha'], ['documentNumber', 'N° documento'], ['sku', 'SKU'], ['product', 'Producto'], ['quantity', 'Cantidad'], ['unitCost', 'Costo unitario']],
      purchases.flatMap((p) => p.items.map((i) => ({ ...i, date: p.date, documentNumber: p.documentNumber, sku: i.product.sku, product: i.product.name }))));
    sheet('Plan de cuentas', [['code', 'Código'], ['name', 'Nombre'], ['type', 'Tipo'], ['archived', 'Archivada']], accounts);
    sheet('Movimientos financieros', [['date', 'Fecha'], ['account', 'Cuenta'], ['description', 'Descripción'], ['amount', 'Neto'], ['tax', 'IVA'], ['counterparty', 'Contraparte'], ['bank', 'Cuenta bancaria'], ['reference', 'N° documento']],
      movements.map((m) => ({ ...m, account: m.account.name, bank: m.bankAccount?.name })));
    sheet('Presupuesto', [['year', 'Año'], ['month', 'Mes'], ['account', 'Cuenta'], ['amount', 'Monto']], budgets.map((b) => ({ ...b, account: b.account.name })));
    sheet('Bancos y caja', [['name', 'Nombre'], ['type', 'Tipo'], ['bankName', 'Banco'], ['accountNumber', 'N° cuenta'], ['initialBalance', 'Saldo inicial'], ['initialDate', 'Desde']], banks);
    sheet('Cartolas', [['date', 'Fecha'], ['bank', 'Cuenta'], ['description', 'Descripción'], ['amount', 'Monto'], ['balance', 'Saldo'], ['status', 'Estado'], ['note', 'Nota']],
      bankLines.map((l) => ({ ...l, bank: l.bankAccount.name })));
    sheet('Recurrentes', [['description', 'Descripción'], ['account', 'Cuenta'], ['amount', 'Neto'], ['tax', 'IVA'], ['dayOfMonth', 'Día'], ['intervalMonths', 'Cada (meses)'], ['active', 'Activo']],
      recurrings.map((r) => ({ ...r, account: r.account.name })));

    const zip = new JSZip();
    zip.file('datos.xlsx', Buffer.from(await wb.xlsx.writeBuffer()));
    // Documentos tributarios emitidos (la ley exige conservarlos 6 años).
    const failed: string[] = [];
    for (const inv of invoices) {
      for (const [url, ext] of [[inv.pdfUrl, 'pdf'], [inv.xmlUrl, 'xml']] as [string | null, string][]) {
        if (!url) continue;
        try {
          zip.file(`documentos/${this.docName(inv)}.${ext}`, await this.fetchDocument(url));
        } catch {
          failed.push(`${this.docName(inv)}.${ext}: ${url.startsWith('data:') ? 'documento embebido ilegible' : url}`);
        }
      }
    }
    if (failed.length) zip.file('documentos/NO_DESCARGADOS.txt', `Estos documentos no se pudieron incluir; descárgalos desde tu proveedor de facturación:\n\n${failed.join('\n')}\n`);
    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const date = new Date().toISOString().slice(0, 10);
    return { filename: `respaldo-${company.slug}-${date}.zip`, buffer };
  }

  private docName(inv: { dteType: string; folio: number | null; id: string }) {
    return `${inv.dteType.toLowerCase()}-${inv.folio ?? inv.id}`;
  }

  private async fetchDocument(url: string): Promise<Buffer> {
    if (url.startsWith('data:')) return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  private cell(row: any, key: string) {
    const v = row?.[key];
    if (v == null) return '';
    if (v instanceof Date) return v;
    if (typeof v === 'object' && typeof v.toNumber === 'function') return v.toNumber(); // Decimal
    if (typeof v === 'object') return JSON.stringify(v);
    return v;
  }
}
