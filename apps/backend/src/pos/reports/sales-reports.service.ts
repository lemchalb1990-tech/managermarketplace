import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../../settings/settings.service';
import { startOfDayInTz, dateKeyStringInTz, shiftDateKey } from '../../common/timezone';
import { canProductField, hasPermission, permissionsForUser, SALES_REPORTS_PERMISSION } from '../../common/permissions';
import { matchesModule } from '../../common/modules.util';

// Módulo licenciado «Reporte detallado» (Empresas → Módulos licenciados).
export const DETAILED_REPORTS_MODULE = 'detailed_reports';

// Reportes de ventas listos («Reportes listos»): ocho informes armados sobre las ventas de un
// período, para ver en pantalla, descargar en Excel o recibir por correo.
//
// Montos: «Ventas brutas» = total cobrado; «Neto recibido» = neto que guarda la venta (los
// marketplaces descuentan comisión, envío e impuestos; en POS/manuales es el total); «Costo» =
// costo de lo vendido (FIFO de la venta o, si no está, costo del producto); «Ganancia» = neto −
// costo. Costo, ganancia y margen solo con el permiso de ver el costo del producto.

export const REPORT_TYPES = ['producto', 'categoria', 'canal', 'vendedor', 'pago', 'comuna', 'mes', 'libro'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const REPORT_TITLE: Record<ReportType, string> = {
  producto: 'Ventas por producto',
  categoria: 'Ventas por categoría',
  canal: 'Ventas por canal',
  vendedor: 'Ventas por vendedor',
  pago: 'Ventas por medio de pago',
  comuna: 'Ventas por comuna',
  mes: 'Evolución mensual',
  libro: 'Libro de ventas',
};

type Kind = 'text' | 'money' | 'int' | 'pct';
export interface ReportColumn { key: string; label: string; kind: Kind }
export interface SalesReport {
  type: ReportType;
  title: string;
  from: string;
  to: string;
  columns: ReportColumn[];
  rows: Record<string, string | number>[];
  totals: Record<string, string | number>;
  truncated: boolean;
}

const CHANNEL_LABEL: Record<string, string> = {
  POS: 'Punto de venta', MERCADO_LIBRE: 'Mercado Libre', SHOPIFY: 'Shopify', WOOCOMMERCE: 'WooCommerce',
  JUMPSELLER: 'JumpSeller', FALABELLA: 'Falabella', PARIS: 'Paris', HITES: 'Hites', RIPLEY: 'Ripley',
  WALMART: 'Walmart', MANUAL: 'Manual', ORDER_REQUEST: 'Solicitud de pedido',
};
const PAY_LABEL: Record<string, string> = { CASH: 'Efectivo', CARD: 'Tarjeta', TRANSFER: 'Transferencia', OTHER: 'Otro' };
const DTE_LABEL: Record<string, string> = { BOLETA: 'Boleta', FACTURA: 'Factura', FACTURA_EXENTA: 'Factura exenta', NOTA_CREDITO: 'Nota de crédito', NOTA_DEBITO: 'Nota de débito' };
const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const MAX_SALES = 50000;

const col = (key: string, label: string, kind: Kind): ReportColumn => ({ key, label, kind });

type Acc = { label: string; extra?: Record<string, string>; ventas: Set<string>; unidades: number; bruto: number; neto: number; costo: number; comision: number; envio: number; monto: number };
const newAcc = (label: string, extra?: Record<string, string>): Acc => ({ label, extra, ventas: new Set(), unidades: 0, bruto: 0, neto: 0, costo: 0, comision: 0, envio: 0, monto: 0 });

@Injectable()
export class SalesReportsService {
  constructor(private prisma: PrismaService, private settings: SettingsService) {}

  assertAccess(user: any) {
    if (!hasPermission(permissionsForUser(user), SALES_REPORTS_PERMISSION)) {
      throw new ForbiddenException('No tienes permiso para ver los reportes de ventas');
    }
  }

  resolveCompanyId(user: any, companyId?: string): string {
    if (user.role === Role.SUPER_ADMIN) {
      if (!companyId) throw new BadRequestException('Selecciona una empresa');
      return companyId;
    }
    if (!user.companyId) throw new ForbiddenException('Sin empresa asignada');
    return user.companyId;
  }

  // Empresa del usuario con el módulo «Reporte detallado» licenciado (el Super Admin siempre pasa).
  async licensedCompanyId(user: any, companyId?: string): Promise<string> {
    const cId = this.resolveCompanyId(user, companyId);
    if (user.role !== Role.SUPER_ADMIN && !(await this.isLicensed(cId))) {
      throw new ForbiddenException('Tu empresa no tiene contratado el módulo «Reporte detallado»');
    }
    return cId;
  }

  async isLicensed(companyId: string): Promise<boolean> {
    const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { modules: true } });
    return matchesModule(company?.modules, DETAILED_REPORTS_MODULE);
  }

  async build(companyId: string, type: string, fromKey?: string, toKey?: string, opts: { showCost: boolean } = { showCost: true }): Promise<SalesReport> {
    if (!REPORT_TYPES.includes(type as ReportType)) throw new BadRequestException('Reporte no válido');
    const t = type as ReportType;
    const tz = await this.settings.getTimezone();
    const today = dateKeyStringInTz(new Date(), tz);
    const valid = (k?: string) => (k && /^\d{4}-\d{2}-\d{2}$/.test(k) ? k : undefined);
    const to = valid(toKey) ?? today;
    const from = valid(fromKey) ?? shiftDateKey(to, -29);
    if (from > to) throw new BadRequestException('La fecha «desde» es posterior a «hasta»');

    const sales = await this.prisma.sale.findMany({
      where: { companyId, createdAt: { gte: startOfDayInTz(tz, from), lt: startOfDayInTz(tz, shiftDateKey(to, 1)) } },
      select: {
        id: true, channel: true, total: true, netAmount: true, marketplaceFee: true, shippingCost: true,
        paymentMethod: true, paymentMethodName: true, saleNumber: true, externalId: true, commune: true,
        customerName: true, createdAt: true,
        user: { select: { name: true } },
        client: { select: { name: true, rut: true } },
        payments: { select: { method: true, amount: true } },
        invoices: { where: { status: { in: ['ISSUED', 'ACCEPTED'] } }, select: { dteType: true, folio: true } },
        items: { select: { quantity: true, unitPrice: true, totalCost: true, netAmount: true, product: { select: { id: true, name: true, sku: true, category: true, cost: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: MAX_SALES,
    });
    const truncated = sales.length >= MAX_SALES;
    const n = (v: unknown) => (v == null ? 0 : Number(v));

    if (t === 'libro') {
      const columns = [col('fecha', 'Fecha', 'text'), col('numero', 'N° venta', 'text'), col('canal', 'Canal', 'text'), col('documento', 'Documento', 'text'), col('cliente', 'Cliente', 'text'), col('neto', 'Neto', 'money'), col('iva', 'IVA', 'money'), col('total', 'Total', 'money')];
      const totals = { fecha: 'Total', neto: 0, iva: 0, total: 0 } as Record<string, string | number>;
      const rows = sales.map((s) => {
        const total = n(s.total);
        const exempt = s.invoices.some((i) => i.dteType === 'FACTURA_EXENTA');
        const neto = exempt ? total : Math.round(total / 1.19);
        const iva = total - neto;
        totals.neto = (totals.neto as number) + neto;
        totals.iva = (totals.iva as number) + iva;
        totals.total = (totals.total as number) + total;
        const [y, m, d] = dateKeyStringInTz(s.createdAt, tz).split('-');
        return {
          fecha: `${d}-${m}-${y}`,
          numero: s.saleNumber != null ? String(s.saleNumber).padStart(4, '0') : s.externalId || '—',
          canal: CHANNEL_LABEL[s.channel] || s.channel,
          documento: s.invoices.map((i) => `${DTE_LABEL[i.dteType] || i.dteType} ${i.folio ?? ''}`.trim()).join(', ') || '—',
          cliente: s.client?.name || s.customerName || '—',
          neto, iva, total,
        };
      });
      return { type: t, title: REPORT_TITLE[t], from, to, columns, rows, totals, truncated };
    }

    const groups = new Map<string, Acc>();
    const add = (key: string, label: string, f: (a: Acc) => void, extra?: Record<string, string>) => {
      let a = groups.get(key);
      if (!a) { a = newAcc(label, extra); groups.set(key, a); }
      f(a);
    };

    for (const s of sales) {
      const gross = n(s.total);
      const net = s.netAmount != null ? n(s.netAmount) : gross;
      const itemsGross = s.items.reduce((x, i) => x + i.quantity * n(i.unitPrice), 0);
      const itemCost = (i: (typeof s.items)[number]) => (i.totalCost != null ? n(i.totalCost) : n(i.product?.cost) * i.quantity);
      const cost = s.items.reduce((x, i) => x + itemCost(i), 0);
      const units = s.items.reduce((x, i) => x + i.quantity, 0);
      const perSale = (key: string, label: string) => add(key, label, (a) => {
        a.ventas.add(s.id); a.unidades += units; a.bruto += gross; a.neto += net; a.costo += cost;
        a.comision += n(s.marketplaceFee); a.envio += n(s.shippingCost);
      });

      if (t === 'producto' || t === 'categoria') {
        for (const i of s.items) {
          const g = i.quantity * n(i.unitPrice);
          const share = itemsGross > 0 ? g / itemsGross : 1 / Math.max(1, s.items.length);
          const iNet = i.netAmount != null ? n(i.netAmount) : net * share;
          const key = t === 'producto' ? (i.product?.id ?? 'sin-producto') : (i.product?.category || 'Sin categoría');
          const label = t === 'producto' ? (i.product?.name ?? 'Producto eliminado') : (i.product?.category || 'Sin categoría');
          add(key, label, (a) => {
            a.ventas.add(s.id); a.unidades += i.quantity; a.bruto += gross * share; a.neto += iNet; a.costo += itemCost(i);
          }, t === 'producto' ? { sku: i.product?.sku ?? '' } : undefined);
        }
      } else if (t === 'canal') {
        perSale(s.channel, CHANNEL_LABEL[s.channel] || s.channel);
      } else if (t === 'vendedor') {
        const name = s.user?.name || `${CHANNEL_LABEL[s.channel] || s.channel} (automático)`;
        perSale(name, name);
      } else if (t === 'comuna') {
        const c = s.commune?.trim() || 'Sin comuna';
        perSale(c.toLowerCase(), c);
      } else if (t === 'mes') {
        const k = dateKeyStringInTz(s.createdAt, tz).slice(0, 7);
        perSale(k, `${MONTHS[Number(k.slice(5)) - 1]} ${k.slice(0, 4)}`);
      } else if (t === 'pago') {
        const parts = s.payments.length
          ? s.payments.map((p) => ({ label: PAY_LABEL[p.method] || p.method, amount: n(p.amount) }))
          : [{ label: s.paymentMethod && s.paymentMethod !== 'MIXED' ? PAY_LABEL[s.paymentMethod] : s.paymentMethodName || `Pagado en ${CHANNEL_LABEL[s.channel] || s.channel}`, amount: gross }];
        for (const p of parts) add(p.label, p.label, (a) => { a.ventas.add(s.id); a.monto += p.amount; });
      }
    }

    const showCost = opts.showCost;
    const metricCols: Record<ReportType, ReportColumn[]> = {
      producto: [col('label', 'Producto', 'text'), col('sku', 'SKU', 'text'), col('unidades', 'Unidades', 'int'), col('bruto', 'Ventas brutas', 'money'), col('neto', 'Neto recibido', 'money'), ...(showCost ? [col('costo', 'Costo', 'money'), col('ganancia', 'Ganancia', 'money'), col('margen', 'Margen', 'pct')] : [])],
      categoria: [col('label', 'Categoría', 'text'), col('unidades', 'Unidades', 'int'), col('bruto', 'Ventas brutas', 'money'), col('neto', 'Neto recibido', 'money'), ...(showCost ? [col('ganancia', 'Ganancia', 'money'), col('margen', 'Margen', 'pct')] : [])],
      canal: [col('label', 'Canal', 'text'), col('ventas', 'N° ventas', 'int'), col('bruto', 'Ventas brutas', 'money'), col('comision', 'Comisión', 'money'), col('envio', 'Envío', 'money'), col('neto', 'Neto recibido', 'money')],
      vendedor: [col('label', 'Vendedor', 'text'), col('ventas', 'N° ventas', 'int'), col('unidades', 'Unidades', 'int'), col('bruto', 'Ventas brutas', 'money'), col('ticket', 'Ticket promedio', 'money')],
      pago: [col('label', 'Medio de pago', 'text'), col('ventas', 'N° ventas', 'int'), col('monto', 'Monto', 'money')],
      comuna: [col('label', 'Comuna', 'text'), col('ventas', 'N° ventas', 'int'), col('bruto', 'Ventas brutas', 'money')],
      mes: [col('label', 'Mes', 'text'), col('ventas', 'N° ventas', 'int'), col('bruto', 'Ventas brutas', 'money'), col('neto', 'Neto recibido', 'money'), ...(showCost ? [col('ganancia', 'Ganancia', 'money')] : [])],
      libro: [],
    };
    const columns = metricCols[t];
    const toRow = (a: Acc): Record<string, string | number> => {
      const ganancia = a.neto - a.costo;
      return {
        label: a.label, ...(a.extra ?? {}),
        ventas: a.ventas.size, unidades: a.unidades, bruto: Math.round(a.bruto), neto: Math.round(a.neto), costo: Math.round(a.costo),
        comision: Math.round(a.comision), envio: Math.round(a.envio), monto: Math.round(a.monto),
        ganancia: Math.round(ganancia), margen: a.neto > 0 ? ganancia / a.neto : 0, ticket: a.ventas.size ? Math.round(a.bruto / a.ventas.size) : 0,
      };
    };
    const list = [...groups.entries()];
    if (t === 'mes') list.sort((x, y) => x[0].localeCompare(y[0]));
    else list.sort((x, y) => (t === 'pago' ? y[1].monto - x[1].monto : y[1].bruto - x[1].bruto));
    const rows = list.map(([, a]) => toRow(a));

    // Totales: suma de las filas (N° ventas = ventas distintas del período).
    const total = newAcc('Total');
    for (const [, a] of list) {
      total.unidades += a.unidades; total.bruto += a.bruto; total.neto += a.neto; total.costo += a.costo;
      total.comision += a.comision; total.envio += a.envio; total.monto += a.monto;
      a.ventas.forEach((id) => total.ventas.add(id));
    }
    const totals = toRow(total);
    if (t === 'producto') totals.sku = '';
    return { type: t, title: REPORT_TITLE[t], from, to, columns, rows, totals, truncated };
  }

  async forUser(user: any, q: { type?: string; from?: string; to?: string; companyId?: string }) {
    this.assertAccess(user);
    const companyId = await this.licensedCompanyId(user, q.companyId);
    return this.build(companyId, q.type || 'producto', q.from, q.to, { showCost: canProductField(user, 'cost', 'view') });
  }

  async excel(report: SalesReport, companyName: string): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(report.title.slice(0, 31));
    const fmtKey = (k: string) => k.split('-').reverse().join('-');
    ws.addRow([`${report.title} — ${companyName}`]).font = { bold: true, size: 14 };
    ws.addRow([`Del ${fmtKey(report.from)} al ${fmtKey(report.to)}`]).font = { color: { argb: 'FF666666' } };
    ws.addRow([]);
    const head = ws.addRow(report.columns.map((c) => c.label));
    head.font = { bold: true };
    head.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F1FC' } }; });
    const fmt = (c: ReportColumn) => (c.kind === 'money' ? '"$"#,##0' : c.kind === 'int' ? '#,##0' : c.kind === 'pct' ? '0.0%' : undefined);
    for (const r of report.rows) ws.addRow(report.columns.map((c) => r[c.key] ?? ''));
    const tot = ws.addRow(report.columns.map((c, i) => (i === 0 ? 'Total' : report.totals[c.key] ?? '')));
    tot.font = { bold: true };
    report.columns.forEach((c, i) => {
      const f = fmt(c);
      const column = ws.getColumn(i + 1);
      if (f) column.numFmt = f;
      column.width = c.kind === 'text' ? (i === 0 ? 38 : 22) : 16;
    });
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
}
