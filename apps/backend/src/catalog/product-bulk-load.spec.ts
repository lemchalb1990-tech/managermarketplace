import * as ExcelJS from 'exceljs';
import { ProductBulkLoadService } from './product-bulk-load.service';
import { cellText, parseNumber, parseYesNo, normalizeText } from './product-bulk-load.util';

describe('product-bulk-load.util', () => {
  it('lee números con formato chileno', () => {
    expect(parseNumber(12990)).toBe(12990);
    expect(parseNumber('12.990')).toBe(12990);
    expect(parseNumber('$ 1.234,50')).toBe(1234.5);
    expect(parseNumber('12990,5')).toBe(12990.5);
    expect(parseNumber('1,234.5')).toBe(1234.5);
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('abc')).toBeNaN();
  });

  it('lee Sí/No y textos de celdas', () => {
    expect(parseYesNo('Sí')).toBe(true);
    expect(parseYesNo('no')).toBe(false);
    expect(parseYesNo('')).toBeNull();
    expect(parseYesNo('quizás')).toBeUndefined();
    expect(cellText({ richText: [{ text: 'Hola ' }, { text: 'mundo' }] })).toBe('Hola mundo');
    expect(cellText({ formula: 'A1', result: 5 })).toBe('5');
    expect(normalizeText('  Stock - Bodega  Ñuñoa * ')).toBe('stock - bodega nunoa');
  });
});

describe('ProductBulkLoadService', () => {
  const warehouses = [
    { id: 'w1', name: 'Bodega principal', active: true },
    { id: 'w2', name: 'Tienda', active: true },
  ];
  const existing = {
    id: 'p1', sku: 'A-1', name: 'Silla', type: 'ARTICULO', price: 10000, cost: 5000, mlPrice: null, wholesalePrice: null,
    stock: 7, active: true, dropship: false, warehouseId: null, category: 'Muebles', barcode: null, description: null,
    criticalStock: 0, packageHeight: null, packageWidth: null, packageLength: null, packageWeight: null,
    warehouse: null, productStocks: [], _count: { purchaseItems: 0 },
  };
  const prisma: any = {
    warehouse: { findMany: jest.fn(async ({ where }: any) => warehouses.filter((w) => where.active === undefined || w.active === where.active)) },
    product: {
      findMany: jest.fn(async ({ where, distinct }: any) => {
        if (distinct) return [{ category: 'Muebles' }];
        if (where.sku) return where.sku.in.includes('A-1') ? [existing] : [];
        return [existing];
      }),
      count: jest.fn(async () => 1),
    },
  };
  const service = new ProductBulkLoadService(
    prisma,
    {} as any,
    { isPurchasesModuleActive: jest.fn(async () => false) } as any,
    { assertCanAdd: jest.fn(async () => undefined) } as any,
    {} as any,
  );
  const user = { id: 'u1', role: 'SUPER_ADMIN' };

  it('arma la plantilla con los campos elegidos y la vista previa clasifica las filas', async () => {
    const tpl = await service.buildTemplate('c1', ['name', 'price', 'type', 'category', 'stock:w1', 'stock:w2'], true);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(tpl as any);
    const sheet = wb.getWorksheet('Productos')!;
    expect((sheet.getRow(1).values as any[]).slice(1)).toEqual(['SKU *', 'Nombre *', 'Tipo', 'Categoría', 'Precio *', 'Stock - Bodega principal', 'Stock - Tienda']);
    // Producto actual precargado: sin stock por bodega, todo queda en la bodega por defecto.
    expect((sheet.getRow(2).values as any[]).slice(1)).toEqual(['A-1', 'Silla', 'Artículo', 'Muebles', 10000, 7, 0]);

    sheet.getRow(2).getCell(5).value = '12.990';
    sheet.getRow(2).getCell(7).value = 3;
    sheet.addRow(['B-2', 'Mesa', 'Artículo', 'Comedor', 25000, 4, null]);
    sheet.addRow(['C-3', null, null, null, 'caro', null, null]);
    sheet.addRow(['B-2', 'Mesa otra vez', null, null, 1, null, null]);
    sheet.addRow(['D-4', 'Sin precio', null, null, null, null, null]);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());

    const res = await service.preview('c1', user, buffer, 'carga.xlsx');
    expect(res.counts).toEqual({ create: 1, update: 1, unchanged: 0, error: 3 });
    const [upd, create, badPrice, dup, noPrice] = res.rows;
    expect(upd.action).toBe('UPDATE');
    expect(upd.changes).toEqual([
      { field: 'Precio', from: 10000, to: 12990 },
      { field: 'Stock - Tienda', from: 0, to: 3 },
    ]);
    expect(create.action).toBe('CREATE');
    expect(create.warnings).toContain('Categoría nueva: «Comedor»');
    expect(badPrice.errors[0]).toMatch(/Precio: «caro» no es un número/);
    expect(dup.errors[0]).toMatch(/repetido/);
    expect(noPrice.errors).toEqual(['Producto nuevo: falta el Precio']);

    const errorsXlsx = await service.errorsWorkbook(res.previewId, user);
    const ew = new ExcelJS.Workbook();
    await ew.xlsx.load(errorsXlsx as any);
    expect(ew.worksheets[0].rowCount).toBe(4);
  });
});
