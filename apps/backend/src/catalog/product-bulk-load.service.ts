import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { MovementType, Prisma, ProductType } from '@prisma/client';
import { randomUUID } from 'crypto';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { StockLedgerService, DEFAULT_WAREHOUSE_NAME } from '../purchases/stock-ledger.service';
import { InventoryCostingService } from '../purchases/inventory-costing.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { SyncService } from '../ecommerce/sync/sync.service';
import { cellText, isValidMoney, normalizeText, parseNumber, parseYesNo } from './product-bulk-load.util';

// Carga masiva de productos (solo Super Admin, desde Administrador de plataforma):
//   1. El Super Admin elige los campos y descarga una plantilla Excel solo con esas columnas.
//   2. Sube el archivo: se revisa fila por fila sin guardar nada (vista previa: crear,
//      actualizar, sin cambios o error, con el detalle de lo que cambia).
//   3. Confirma: las filas válidas se guardan en una sola transacción (entra todo o nada).
// El SKU identifica el producto: si existe se actualiza, si no se crea. Celda vacía = no cambia.
// El stock va por bodega («Stock - <bodega>» = cantidad final en esa bodega) y pasa por el
// motor de inventario (kardex), igual que una edición a mano.

type FieldKind = 'text' | 'longtext' | 'money' | 'decimal' | 'int' | 'type' | 'bool' | 'warehouse' | 'category' | 'stock';

interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  group: string;
  help: string;
  requiredOnCreate?: boolean;
  width?: number;
}

const STATIC_FIELDS: FieldDef[] = [
  { key: 'sku', label: 'SKU', kind: 'text', group: 'Identificación', help: 'Código único del producto. Si ya existe en el catálogo se actualiza; si no, se crea. Obligatorio.', width: 20 },
  { key: 'name', label: 'Nombre', kind: 'text', group: 'Identificación', help: 'Nombre del producto (mínimo 2 caracteres). Obligatorio para crear productos nuevos.', requiredOnCreate: true, width: 45 },
  { key: 'type', label: 'Tipo', kind: 'type', group: 'Identificación', help: '«Artículo» (lleva stock) o «Servicio» (sin stock). Si se deja vacío al crear, queda como Artículo.', width: 12 },
  { key: 'barcode', label: 'Código de barras', kind: 'text', group: 'Identificación', help: 'EAN / UPC / GTIN.', width: 18 },
  { key: 'category', label: 'Categoría', kind: 'category', group: 'Identificación', help: 'Categoría interna del catálogo. Puedes elegir una de la lista o escribir una nueva.', width: 24 },
  { key: 'description', label: 'Descripción', kind: 'longtext', group: 'Identificación', help: 'Descripción del producto.', width: 50 },
  { key: 'active', label: 'Activo', kind: 'bool', group: 'Identificación', help: '«Sí» o «No». Un producto inactivo solo se puede modificar si en la misma fila se reactiva con «Sí».', width: 10 },
  { key: 'price', label: 'Precio', kind: 'money', group: 'Precios', help: 'Precio de venta. Obligatorio para crear productos nuevos.', requiredOnCreate: true, width: 14 },
  { key: 'cost', label: 'Costo', kind: 'money', group: 'Precios', help: 'Costo unitario. Con el módulo de Compras activo, en productos con compras registradas se ignora (se calcula por las compras).', width: 14 },
  { key: 'wholesalePrice', label: 'Precio mayorista', kind: 'money', group: 'Precios', help: 'Precio para venta mayorista.', width: 16 },
  { key: 'mlPrice', label: 'Precio base ML', kind: 'money', group: 'Precios', help: 'Precio para Mercado Libre. 0 = usa el precio de venta.', width: 16 },
  { key: 'warehouse', label: 'Bodega asignada', kind: 'warehouse', group: 'Inventario', help: 'Bodega principal del producto (nombre exacto de una bodega de la empresa).', width: 22 },
  { key: 'criticalStock', label: 'Stock crítico', kind: 'int', group: 'Inventario', help: 'Al llegar a este stock, las ventas de marketplaces pausan la publicación.', width: 13 },
  { key: 'packageHeight', label: 'Alto paquete (cm)', kind: 'decimal', group: 'Envío', help: 'Alto del paquete en centímetros.', width: 16 },
  { key: 'packageWidth', label: 'Ancho paquete (cm)', kind: 'decimal', group: 'Envío', help: 'Ancho del paquete en centímetros.', width: 17 },
  { key: 'packageLength', label: 'Largo paquete (cm)', kind: 'decimal', group: 'Envío', help: 'Largo del paquete en centímetros.', width: 17 },
  { key: 'packageWeight', label: 'Peso paquete (g)', kind: 'decimal', group: 'Envío', help: 'Peso del paquete en gramos.', width: 16 },
];

// Bodega por defecto cuando la empresa todavía no tiene ninguna (se crea al guardar).
const DEFAULT_WH_KEY = 'stock:__default';
const MAX_ROWS = 5000;
const PREVIEW_TTL_MS = 30 * 60 * 1000;
const TYPE_LABEL: Record<ProductType, string> = { ARTICULO: 'Artículo', SERVICIO: 'Servicio' };

export type BulkLoadMode = 'both' | 'create' | 'update';
export type BulkLoadAction = 'CREATE' | 'UPDATE' | 'UNCHANGED' | 'ERROR';

export interface BulkLoadChange {
  field: string;
  from: string | number | null;
  to: string | number | null;
}

export interface BulkLoadRow {
  row: number;
  sku: string;
  name: string | null;
  action: BulkLoadAction;
  errors: string[];
  warnings: string[];
  changes: BulkLoadChange[];
}

interface PlanRow extends BulkLoadRow {
  productId?: string;
  data: Record<string, any>;
  stock: { key: string; qty: number }[];
  priceChanged: boolean;
  raw: string[];
}

interface Preview {
  id: string;
  userId: string;
  companyId: string;
  fileName: string;
  createdAt: number;
  headers: string[];
  rows: PlanRow[];
  usedPreview?: boolean;
}

interface Job {
  id: string;
  userId: string;
  companyId: string;
  status: 'RUNNING' | 'DONE' | 'FAILED';
  total: number;
  done: number;
  result?: { created: number; updated: number; skipped: number };
  error?: string;
  finishedAt?: number;
}

@Injectable()
export class ProductBulkLoadService {
  private readonly logger = new Logger(ProductBulkLoadService.name);
  private previews = new Map<string, Preview>();
  private jobs = new Map<string, Job>();

  constructor(
    private prisma: PrismaService,
    private ledger: StockLedgerService,
    private costing: InventoryCostingService,
    private subscription: SubscriptionService,
    private sync: SyncService,
  ) {}

  // ── Campos disponibles ────────────────────────────────────────────────

  private async warehouses(companyId: string) {
    return this.prisma.warehouse.findMany({
      where: { companyId, active: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true },
    });
  }

  private async fieldDefs(companyId: string): Promise<FieldDef[]> {
    const whs = await this.warehouses(companyId);
    const stockFields: FieldDef[] = whs.length
      ? whs.map((w) => ({ key: `stock:${w.id}`, label: `Stock - ${w.name}`, kind: 'stock', group: 'Stock por bodega', help: `Cantidad final en la bodega «${w.name}». El sistema registra la diferencia como ajuste de inventario.`, width: 14 }))
      : [{ key: DEFAULT_WH_KEY, label: `Stock - ${DEFAULT_WAREHOUSE_NAME}`, kind: 'stock', group: 'Stock por bodega', help: 'La empresa no tiene bodegas: el stock queda en «Bodega principal», que se crea al guardar.', width: 14 }];
    return [...STATIC_FIELDS, ...stockFields];
  }

  async listFields(companyId: string) {
    const defs = await this.fieldDefs(companyId);
    const groups: { name: string; fields: { key: string; label: string; help: string; required: boolean; requiredOnCreate: boolean }[] }[] = [];
    for (const f of defs) {
      let g = groups.find((x) => x.name === f.group);
      if (!g) groups.push((g = { name: f.group, fields: [] }));
      g.fields.push({ key: f.key, label: f.label, help: f.help, required: f.key === 'sku', requiredOnCreate: !!f.requiredOnCreate });
    }
    const productCount = await this.prisma.product.count({ where: { companyId, active: true } });
    return { groups, maxRows: MAX_ROWS, productCount };
  }

  // ── Plantilla ─────────────────────────────────────────────────────────

  async buildTemplate(companyId: string, keys: string[], withProducts: boolean): Promise<Buffer> {
    const defs = await this.fieldDefs(companyId);
    const wanted = new Set(['sku', ...keys]);
    const fields = defs.filter((f) => wanted.has(f.key));
    if (fields.length < 2) throw new BadRequestException('Elige al menos un campo además del SKU');

    const whs = await this.warehouses(companyId);
    const categories = (await this.prisma.product.findMany({
      where: { companyId, category: { not: null } }, distinct: ['category'], select: { category: true }, orderBy: { category: 'asc' },
    })).map((c) => c.category!).filter((c) => c.trim());

    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('Productos', { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = fields.map((f) => ({
      header: f.key === 'sku' || f.requiredOnCreate ? `${f.label} *` : f.label,
      key: f.key,
      width: f.width ?? 16,
      style: f.key === 'sku' || f.key === 'barcode' ? { numFmt: '@' } : f.kind === 'money' ? { numFmt: '#,##0' } : {},
    }));
    const header = sheet.getRow(1);
    header.height = 22;
    header.eachCell((cell, col) => {
      const f = fields[col - 1];
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: f.key === 'sku' ? 'FF0B1D5C' : f.requiredOnCreate ? 'FF2F4AA0' : 'FF5B6B8C' } };
      cell.alignment = { vertical: 'middle' };
      cell.note = f.help;
    });

    // Listas para los desplegables (hoja oculta).
    const lists = wb.addWorksheet('Listas', { state: 'hidden' });
    const listCols: Record<string, string[]> = {
      A: ['Artículo', 'Servicio'],
      B: ['Sí', 'No'],
      C: whs.map((w) => w.name),
      D: categories,
    };
    for (const [col, values] of Object.entries(listCols)) {
      values.forEach((v, i) => { lists.getCell(`${col}${i + 1}`).value = v; });
    }
    const lastRow = MAX_ROWS + 1;
    fields.forEach((f, i) => {
      const letter = sheet.getColumn(i + 1).letter;
      const range = `${letter}2:${letter}${lastRow}`;
      const list = (col: string, n: number, strict: boolean) => n > 0 && (sheet as any).dataValidations.add(range, {
        type: 'list', allowBlank: true, formulae: [`Listas!$${col}$1:$${col}$${n}`],
        showErrorMessage: strict, errorStyle: 'stop', error: 'Elige un valor de la lista',
      });
      if (f.kind === 'type') list('A', 2, true);
      if (f.kind === 'bool') list('B', 2, true);
      if (f.kind === 'warehouse') list('C', whs.length, true);
      if (f.kind === 'category') list('D', categories.length, false);
    });

    if (withProducts) {
      const products = await this.prisma.product.findMany({
        where: { companyId, active: true },
        orderBy: { name: 'asc' },
        take: MAX_ROWS,
        include: { warehouse: { select: { name: true } }, productStocks: { select: { warehouseId: true, quantity: true } } },
      });
      const defaultWh = whs[0]?.id ?? null;
      for (const p of products) {
        const row: Record<string, any> = {};
        for (const f of fields) row[f.key] = this.displayValue(p, f, defaultWh);
        sheet.addRow(row);
      }
    }

    // Instrucciones.
    const info = wb.addWorksheet('Instrucciones');
    info.columns = [{ key: 'a', width: 26 }, { key: 'b', width: 100 }];
    const rules = [
      ['Cómo funciona', ''],
      ['SKU', 'Identifica el producto. Si el SKU ya existe en el catálogo, la fila lo actualiza; si no existe, lo crea.'],
      ['Celdas vacías', 'Una celda vacía no cambia nada. Para crear un producto nuevo son obligatorios Nombre y Precio.'],
      ['Stock por bodega', 'Es la cantidad final en esa bodega (no se suma). La diferencia queda en el historial de inventario como ajuste.'],
      ['Columnas', 'No cambies los encabezados de la fila 1. Puedes borrar columnas que no necesites; las que no se reconozcan se ignoran.'],
      ['Límite', `Hasta ${MAX_ROWS.toLocaleString('es-CL')} filas por archivo.`],
      ['Antes de guardar', 'Al subir el archivo verás una vista previa con lo que se creará, se actualizará o tiene errores. Nada se guarda hasta que confirmes.'],
      ['', ''],
      ['Campo', 'Descripción'],
      ...fields.map((f) => [f.key === 'sku' || f.requiredOnCreate ? `${f.label} *` : f.label, f.help]),
    ];
    rules.forEach((r) => info.addRow({ a: r[0], b: r[1] }));
    info.getRow(1).font = { bold: true, size: 13 };
    info.getRow(9).font = { bold: true };
    info.getColumn(2).alignment = { wrapText: true, vertical: 'top' };

    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // Valor actual del producto tal como va en la plantilla.
  private displayValue(p: any, f: FieldDef, defaultWh: string | null): any {
    if (f.kind === 'stock') return this.currentQty(p, f.key, defaultWh, p.warehouseId);
    switch (f.key) {
      case 'type': return TYPE_LABEL[p.type as ProductType];
      case 'active': return p.active ? 'Sí' : 'No';
      case 'warehouse': return p.warehouse?.name ?? null;
      default: {
        const v = p[f.key];
        if (v === null || v === undefined) return null;
        return f.kind === 'money' || f.kind === 'decimal' ? Number(v) : v;
      }
    }
  }

  // Cantidad en una bodega. Un producto sin stock por bodega todavía tiene todo su stock en la
  // bodega asignada (o la por defecto): es lo que hará seedIfEmpty al primer movimiento.
  private currentQty(p: { stock: number; productStocks: { warehouseId: string; quantity: number }[] }, key: string, defaultWh: string | null, assignedWh: string | null): number {
    const whId = key === DEFAULT_WH_KEY ? defaultWh : key.slice('stock:'.length);
    if (!p.productStocks.length) return key === DEFAULT_WH_KEY || (whId && whId === (assignedWh ?? defaultWh)) ? p.stock : 0;
    return p.productStocks.find((s) => s.warehouseId === whId)?.quantity ?? 0;
  }

  // ── Vista previa ──────────────────────────────────────────────────────

  private cleanup() {
    const now = Date.now();
    for (const [id, p] of this.previews) if (now - p.createdAt > PREVIEW_TTL_MS) this.previews.delete(id);
    for (const [id, j] of this.jobs) if (j.finishedAt && now - j.finishedAt > PREVIEW_TTL_MS) this.jobs.delete(id);
  }

  async preview(companyId: string, user: any, buffer: Buffer, fileName: string) {
    this.cleanup();
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buffer as any);
    } catch {
      throw new BadRequestException('No se pudo leer el archivo. Sube el Excel (.xlsx) de la plantilla.');
    }
    const sheet = wb.getWorksheet('Productos') ?? wb.worksheets[0];
    if (!sheet) throw new BadRequestException('El archivo no tiene ninguna hoja con datos');

    const defs = await this.fieldDefs(companyId);
    const byLabel = new Map(defs.map((f) => [normalizeText(f.label), f]));
    const columns: { col: number; field: FieldDef }[] = [];
    const headers: string[] = [];
    const ignored: string[] = [];
    const headerRow = sheet.getRow(1);
    for (let col = 1; col <= sheet.columnCount; col++) {
      const h = cellText(headerRow.getCell(col).value);
      headers.push(h);
      if (!h) continue;
      const f = byLabel.get(normalizeText(h));
      if (!f) { ignored.push(h); continue; }
      if (columns.some((c) => c.field.key === f.key)) throw new BadRequestException(`La columna «${f.label}» está repetida`);
      columns.push({ col, field: f });
    }
    const skuCol = columns.find((c) => c.field.key === 'sku');
    if (!skuCol) throw new BadRequestException('Falta la columna «SKU». Descarga la plantilla y no cambies los encabezados de la fila 1.');
    if (columns.length < 2) throw new BadRequestException('El archivo solo tiene la columna SKU: no hay nada que cargar');

    // Filas con algún dato.
    const sheetRows: { rowNumber: number; cells: Map<string, unknown>; raw: string[] }[] = [];
    for (let r = 2; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const raw = headers.map((_, i) => cellText(row.getCell(i + 1).value));
      if (raw.every((v) => !v)) continue;
      const cells = new Map<string, unknown>();
      for (const c of columns) cells.set(c.field.key, row.getCell(c.col).value);
      sheetRows.push({ rowNumber: r, cells, raw });
    }
    if (!sheetRows.length) throw new BadRequestException('El archivo no tiene filas con datos');
    if (sheetRows.length > MAX_ROWS) throw new BadRequestException(`El archivo tiene ${sheetRows.length.toLocaleString('es-CL')} filas; el máximo es ${MAX_ROWS.toLocaleString('es-CL')}. Divídelo en varios archivos.`);

    // Datos actuales.
    const skus = Array.from(new Set(sheetRows.map((r) => cellText(r.cells.get('sku'))).filter(Boolean)));
    const existing = new Map<string, any>();
    for (let i = 0; i < skus.length; i += 1000) {
      const chunk = await this.prisma.product.findMany({
        where: { companyId, sku: { in: skus.slice(i, i + 1000) } },
        include: {
          warehouse: { select: { name: true } },
          productStocks: { select: { warehouseId: true, quantity: true } },
          _count: { select: { purchaseItems: true } },
        },
      });
      for (const p of chunk) existing.set(p.sku, p);
    }
    const allWhs = await this.prisma.warehouse.findMany({ where: { companyId }, select: { id: true, name: true, active: true }, orderBy: { createdAt: 'asc' } });
    const whByName = new Map(allWhs.filter((w) => w.active).map((w) => [normalizeText(w.name), w]));
    const whName = new Map(allWhs.map((w) => [w.id, w.name]));
    const defaultWh = allWhs.find((w) => w.active)?.id ?? allWhs[0]?.id ?? null;
    const purchasesActive = await this.costing.isPurchasesModuleActive(companyId);
    const knownCategories = new Set((await this.prisma.product.findMany({
      where: { companyId, category: { not: null } }, distinct: ['category'], select: { category: true },
    })).map((c) => normalizeText(c.category!)));

    const seen = new Map<string, number>();
    const rows: PlanRow[] = sheetRows.map(({ rowNumber, cells, raw }) => {
      const sku = cellText(cells.get('sku'));
      const plan: PlanRow = { row: rowNumber, sku, name: null, action: 'ERROR', errors: [], warnings: [], changes: [], data: {}, stock: [], priceChanged: false, raw };
      if (!sku) { plan.errors.push('Falta el SKU'); return plan; }
      if (sku.length > 100) plan.errors.push('El SKU es demasiado largo (máximo 100 caracteres)');
      const firstRow = seen.get(sku);
      if (firstRow) { plan.errors.push(`El SKU está repetido en el archivo (ya aparece en la fila ${firstRow})`); return plan; }
      seen.set(sku, rowNumber);

      const current = existing.get(sku);
      const values: Record<string, any> = {};
      for (const c of columns) {
        const f = c.field;
        if (f.key === 'sku') continue;
        const v = cells.get(f.key);
        const text = cellText(v);
        if (!text && typeof v !== 'number') continue;
        const bad = (msg: string) => plan.errors.push(`${f.label}: ${msg}`);
        switch (f.kind) {
          case 'text':
          case 'longtext':
          case 'category':
            if (f.key === 'name' && text.length < 2) bad('debe tener al menos 2 caracteres');
            else if (f.kind !== 'longtext' && text.length > 255) bad('es demasiado largo (máximo 255 caracteres)');
            else {
              values[f.key] = text;
              if (f.kind === 'category' && !knownCategories.has(normalizeText(text))) plan.warnings.push(`Categoría nueva: «${text}»`);
            }
            break;
          case 'money':
          case 'decimal': {
            const n = parseNumber(v);
            if (n === null) break;
            if (Number.isNaN(n)) bad(`«${text}» no es un número`);
            else if (!isValidMoney(n)) bad('debe ser un número mayor o igual a 0, con hasta 2 decimales');
            else values[f.key] = n;
            break;
          }
          case 'int':
          case 'stock': {
            const n = parseNumber(v);
            if (n === null) break;
            if (Number.isNaN(n)) bad(`«${text}» no es un número`);
            else if (!Number.isInteger(n) || n < 0) bad('debe ser un número entero mayor o igual a 0');
            else if (n > 10_000_000) bad('es demasiado grande');
            else values[f.key] = n;
            break;
          }
          case 'type': {
            const t = normalizeText(text);
            if (t === 'articulo' || t === 'producto') values.type = ProductType.ARTICULO;
            else if (t === 'servicio') values.type = ProductType.SERVICIO;
            else bad(`«${text}» no es válido (usa Artículo o Servicio)`);
            break;
          }
          case 'bool': {
            const b = parseYesNo(v);
            if (b === undefined) bad(`«${text}» no es válido (usa Sí o No)`);
            else if (b !== null) values[f.key] = b;
            break;
          }
          case 'warehouse': {
            const w = whByName.get(normalizeText(text));
            if (!w) bad(`la bodega «${text}» no existe o está inactiva`);
            else values.warehouseId = w.id;
            break;
          }
        }
      }
      plan.name = values.name ?? current?.name ?? null;
      if (plan.errors.length) return plan;

      // mlPrice 0 = sin precio propio para Mercado Libre.
      if (values.mlPrice === 0) values.mlPrice = null;
      const stockKeys = Object.keys(values).filter((k) => k.startsWith('stock:'));
      const stockFor = (t: ProductType, dropship: boolean) => {
        if (!stockKeys.length) return;
        if (t === ProductType.SERVICIO || dropship) {
          plan.warnings.push(t === ProductType.SERVICIO ? 'Es un servicio: el stock se ignora' : 'Es un producto dropship: el stock se ignora');
          return;
        }
        for (const k of stockKeys) plan.stock.push({ key: k, qty: values[k] });
      };
      const label = (k: string) => defs.find((f) => f.key === k)?.label ?? k;
      const show = (k: string, v: any): string | number | null => {
        if (v === null || v === undefined) return null;
        if (k === 'type') return TYPE_LABEL[v as ProductType];
        if (k === 'active') return v ? 'Sí' : 'No';
        if (k === 'warehouseId') return whName.get(v) ?? null;
        return typeof v === 'object' ? Number(v) : v;
      };

      if (!current) {
        if (!values.name) plan.errors.push('Producto nuevo: falta el Nombre');
        if (values.price === undefined) plan.errors.push('Producto nuevo: falta el Precio');
        if (plan.errors.length) return plan;
        plan.action = 'CREATE';
        for (const [k, v] of Object.entries(values)) if (!k.startsWith('stock:')) plan.data[k] = v;
        stockFor(values.type ?? ProductType.ARTICULO, false);
        for (const [k, v] of Object.entries(plan.data)) plan.changes.push({ field: label(k === 'warehouseId' ? 'warehouse' : k), from: null, to: show(k, v) });
        for (const s of plan.stock) plan.changes.push({ field: label(s.key), from: null, to: s.qty });
        return plan;
      }

      // Actualización: solo lo que cambia.
      plan.productId = current.id;
      for (const [k, v] of Object.entries(values)) {
        if (k.startsWith('stock:')) continue;
        const before = current[k];
        const same = before === null || before === undefined
          ? v === null || v === undefined
          : typeof v === 'number' ? Number(before) === v : before === v;
        if (same) continue;
        if (k === 'cost' && current._count.purchaseItems > 0 && purchasesActive) {
          plan.warnings.push('Costo ignorado: se calcula con las compras registradas');
          continue;
        }
        plan.data[k] = v;
        plan.changes.push({ field: label(k === 'warehouseId' ? 'warehouse' : k), from: show(k, before), to: show(k, v) });
        if (k === 'price' || k === 'mlPrice') plan.priceChanged = true;
      }
      const finalType: ProductType = plan.data.type ?? current.type;
      stockFor(finalType, current.dropship);
      // El primer movimiento deja el stock actual en la bodega asignada (la nueva, si cambia).
      const assigned = plan.data.warehouseId ?? current.warehouseId;
      plan.stock = plan.stock.filter((s) => {
        const before = this.currentQty(current, s.key, defaultWh, assigned);
        if (before === s.qty) return false;
        plan.changes.push({ field: label(s.key), from: before, to: s.qty });
        return true;
      });

      if (!current.active && plan.changes.length && plan.data.active !== true) {
        plan.errors.push('El producto está inactivo: agrega la columna «Activo» con «Sí» para reactivarlo y modificarlo');
        return plan;
      }
      plan.action = plan.changes.length ? 'UPDATE' : 'UNCHANGED';
      return plan;
    });

    const preview: Preview = { id: randomUUID(), userId: user.id, companyId, fileName, createdAt: Date.now(), headers, rows };
    this.previews.set(preview.id, preview);

    const count = (a: BulkLoadAction) => rows.filter((r) => r.action === a).length;
    let planWarning: string | null = null;
    const creates = count('CREATE');
    if (creates) {
      try { await this.subscription.assertCanAdd(companyId, 'products', creates); } catch (e: any) { planWarning = e.message; }
    }
    return {
      previewId: preview.id,
      fileName,
      columns: columns.map((c) => c.field.label),
      ignoredColumns: ignored,
      counts: { create: creates, update: count('UPDATE'), unchanged: count('UNCHANGED'), error: count('ERROR') },
      planWarning,
      rows: rows.map(({ row, sku, name, action, errors, warnings, changes }) => ({ row, sku, name, action, errors, warnings, changes })),
    };
  }

  private getPreview(id: string, user: any): Preview {
    this.cleanup();
    const p = this.previews.get(id);
    if (!p || p.userId !== user.id) throw new NotFoundException('La vista previa venció. Vuelve a subir el archivo.');
    return p;
  }

  // Excel con las filas con error (columnas originales + «Error») para corregir y volver a subir.
  async errorsWorkbook(previewId: string, user: any): Promise<Buffer> {
    const p = this.getPreview(previewId, user);
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('Productos', { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.addRow([...p.headers, 'Error']).font = { bold: true };
    for (const r of p.rows.filter((x) => x.action === 'ERROR')) sheet.addRow([...r.raw, r.errors.join(' · ')]);
    sheet.columns.forEach((c, i) => { c.width = i === p.headers.length ? 60 : 18; });
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // ── Confirmar ─────────────────────────────────────────────────────────

  async confirm(previewId: string, mode: BulkLoadMode, user: any) {
    if (!['both', 'create', 'update'].includes(mode)) throw new BadRequestException('Modo de carga inválido');
    const p = this.getPreview(previewId, user);
    if (p.usedPreview) throw new BadRequestException('Esta carga ya se confirmó. Sube el archivo de nuevo para otra carga.');
    const selected = p.rows.filter((r) =>
      (r.action === 'CREATE' && mode !== 'update') || (r.action === 'UPDATE' && mode !== 'create'));
    if (!selected.length) throw new BadRequestException('No hay filas para guardar con el modo elegido');
    const creates = selected.filter((r) => r.action === 'CREATE').length;
    if (creates) await this.subscription.assertCanAdd(p.companyId, 'products', creates);

    p.usedPreview = true;
    const job: Job = { id: randomUUID(), userId: user.id, companyId: p.companyId, status: 'RUNNING', total: selected.length, done: 0 };
    this.jobs.set(job.id, job);
    const skipped = p.rows.length - selected.length;
    this.run(job, p, selected, user)
      .then((r) => { job.status = 'DONE'; job.result = { ...r, skipped }; })
      .catch((e) => {
        job.status = 'FAILED';
        job.error = e?.message || 'No se pudo guardar la carga';
        p.usedPreview = false;
        this.logger.warn(`Carga masiva ${job.id} falló: ${job.error}`);
      })
      .finally(() => { job.finishedAt = Date.now(); });
    return { jobId: job.id, total: job.total };
  }

  jobStatus(jobId: string, user: any) {
    const j = this.jobs.get(jobId);
    if (!j || j.userId !== user.id) throw new NotFoundException('Carga no encontrada');
    return { status: j.status, total: j.total, done: j.done, result: j.result ?? null, error: j.error ?? null };
  }

  private async run(job: Job, p: Preview, rows: PlanRow[], user: any) {
    const { companyId } = p;
    const toSync = new Set<string>();
    let created = 0;
    let updated = 0;

    await this.prisma.$transaction(async (tx) => {
      const whFor = async (key: string) => key === DEFAULT_WH_KEY ? this.ledger.defaultWarehouseId(tx, companyId) : key.slice('stock:'.length);
      for (const r of rows) {
        if (r.action === 'CREATE') {
          const exists = await tx.product.findUnique({ where: { sku_companyId: { sku: r.sku, companyId } }, select: { id: true } });
          if (exists) throw new BadRequestException(`El SKU ${r.sku} (fila ${r.row}) se creó mientras revisabas la carga. Vuelve a subir el archivo.`);
          const product = await tx.product.create({ data: { ...r.data, sku: r.sku, companyId, stock: 0 } as Prisma.ProductUncheckedCreateInput });
          if (product.type === ProductType.ARTICULO && !product.dropship) {
            if (!r.stock.length) await this.ledger.seedIfEmpty(tx, product, await this.ledger.resolveWarehouseId(tx, product), user.id);
            for (const s of r.stock) {
              if (s.qty <= 0) continue;
              await this.ledger.move(tx, {
                productId: product.id, warehouseId: await whFor(s.key), delta: s.qty, type: MovementType.INITIAL,
                reason: 'Saldo inicial (carga masiva de productos)', userId: user.id, reference: { type: 'INITIAL' },
              });
            }
          }
          created++;
        } else {
          const current = await tx.product.findUnique({ where: { id: r.productId! } });
          if (!current || current.companyId !== companyId) throw new BadRequestException(`El producto ${r.sku} (fila ${r.row}) ya no existe. Vuelve a subir el archivo.`);
          const product = Object.keys(r.data).length ? await tx.product.update({ where: { id: current.id }, data: r.data }) : current;
          if (r.stock.length && product.type === ProductType.ARTICULO && !product.dropship) {
            await this.ledger.seedIfEmpty(tx, product, await this.ledger.resolveWarehouseId(tx, product), user.id);
            for (const s of r.stock) {
              const warehouseId = await whFor(s.key);
              const row = await tx.productStock.findUnique({ where: { productId_warehouseId: { productId: product.id, warehouseId } } });
              const delta = s.qty - (row?.quantity ?? 0);
              if (!delta) continue;
              await this.ledger.move(tx, {
                productId: product.id, warehouseId, delta, type: MovementType.ADJUSTMENT,
                reason: 'Carga masiva de productos', userId: user.id, reference: { type: 'ADJUSTMENT' },
              });
            }
            toSync.add(product.id);
          }
          if (r.priceChanged) toSync.add(product.id);
          updated++;
        }
        job.done++;
      }
    }, { timeout: 20 * 60 * 1000, maxWait: 30_000 });

    // Stock y precio nuevos a las publicaciones (en segundo plano, una por una).
    if (toSync.size) {
      (async () => {
        for (const id of toSync) {
          const fresh = await this.prisma.product.findUnique({ where: { id }, select: { stock: true, price: true, mlPrice: true } });
          if (fresh) await this.sync.syncProduct(id, fresh.stock, Number(fresh.mlPrice ?? fresh.price)).catch(() => {});
        }
      })().catch(() => {});
    }
    return { created, updated };
  }
}
