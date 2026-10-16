import type Anthropic from '@anthropic-ai/sdk';
import { OrderStatus, Prisma, ProductType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { canProductField, hasPermission, permissionsForUser } from '../common/permissions';
import { matchesModule } from '../common/modules.util';
import { dateKeyStringInTz, endOfDayInTz, startOfDayInTz } from '../common/timezone';

// Herramientas de SOLO LECTURA del asistente. Cada una consulta únicamente la empresa del
// usuario y responde según sus permisos y los módulos de la empresa: el modelo nunca toca
// la base directamente, solo recibe el resultado (JSON compacto) de estas funciones.

export interface ToolContext {
  prisma: PrismaService;
  companyId: string;
  user: any;
  modules: unknown;
  tz: string;
}

interface AssistantTool {
  def: Anthropic.Beta.BetaTool;
  run: (input: any) => Promise<unknown>;
}

const r0 = (n: unknown) => Math.round(Number(n || 0));
const CHANNEL_LABEL: Record<string, string> = {
  POS: 'Punto de venta', MERCADO_LIBRE: 'Mercado Libre', SHOPIFY: 'Shopify', WOOCOMMERCE: 'WooCommerce', JUMPSELLER: 'JumpSeller',
  FALABELLA: 'Falabella', PARIS: 'Paris', HITES: 'Hites', RIPLEY: 'Ripley', WALMART: 'Walmart', MANUAL: 'Manual', ORDER_REQUEST: 'Pedido de cliente',
};
const ORDER_LABEL: Record<string, string> = {
  PENDING: 'Pendiente', PREPARING: 'En preparación', READY: 'Lista', IN_TRANSIT: 'En camino', DELIVERED: 'Entregada', CANCELLED: 'Cancelada',
};

// Esquema estricto: todas las propiedades obligatorias y sin propiedades extra.
function tool(name: string, description: string, properties: Record<string, unknown>): Anthropic.Beta.BetaTool {
  return {
    name, description, strict: true,
    input_schema: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false } as Anthropic.Beta.BetaTool['input_schema'],
  };
}

const DATE = { type: 'string', description: 'Fecha en formato AAAA-MM-DD (zona horaria de la empresa).' };

export function buildAssistantTools(ctx: ToolContext): AssistantTool[] {
  const { prisma, companyId, user, tz } = ctx;
  const perms = permissionsForUser(user);
  const can = (...keys: string[]) => keys.some((k) => hasPermission(perms, k));
  const mod = (key: string) => matchesModule(ctx.modules, key);
  const seeCost = canProductField(user, 'cost', 'view');
  const range = (desde: string, hasta: string) => {
    const from = startOfDayInTz(tz, desde || undefined);
    const to = endOfDayInTz(tz, hasta || desde || undefined);
    return { from, to };
  };
  const tools: AssistantTool[] = [];

  if (can('sales', 'pos', 'dashboard')) {
    tools.push({
      def: tool('ventas_resumen',
        'Total vendido, cantidad de ventas y ticket promedio entre dos fechas (inclusive), opcionalmente agrupado por canal, día, producto o vendedor. Úsala para «cuánto vendí hoy/ayer/esta semana/este mes».',
        {
          desde: DATE, hasta: DATE,
          agrupar: { type: 'string', enum: ['ninguno', 'canal', 'dia', 'producto', 'vendedor'], description: 'Cómo agrupar el detalle.' },
        }),
      async run({ desde, hasta, agrupar }) {
        const { from, to } = range(desde, hasta);
        const where: Prisma.SaleWhereInput = { companyId, createdAt: { gte: from, lte: to } };
        const agg = await prisma.sale.aggregate({ where, _sum: { total: true }, _count: true });
        const total = r0(agg._sum.total);
        const out: Record<string, unknown> = {
          desde, hasta, total_vendido: total, cantidad_ventas: agg._count, ticket_promedio: agg._count ? r0(total / agg._count) : 0,
        };
        if (agrupar === 'canal') {
          const rows = await prisma.sale.groupBy({ by: ['channel'], where, _sum: { total: true }, _count: true });
          out.por_canal = rows.map((r) => ({ canal: CHANNEL_LABEL[r.channel] || r.channel, total: r0(r._sum.total), ventas: r._count })).sort((a, b) => b.total - a.total);
        } else if (agrupar === 'dia') {
          const sales = await prisma.sale.findMany({ where, select: { createdAt: true, total: true }, take: 20000 });
          const m = new Map<string, { total: number; ventas: number }>();
          for (const s of sales) {
            const k = dateKeyStringInTz(s.createdAt, tz);
            const e = m.get(k) || { total: 0, ventas: 0 };
            e.total += Number(s.total); e.ventas++;
            m.set(k, e);
          }
          out.por_dia = [...m].sort(([a], [b]) => a.localeCompare(b)).map(([dia, v]) => ({ dia, total: r0(v.total), ventas: v.ventas }));
        } else if (agrupar === 'producto') {
          const items = await prisma.saleItem.groupBy({ by: ['productId'], where: { sale: where }, _sum: { quantity: true }, _count: true });
          const top = items.map((i) => ({ id: i.productId, unidades: i._sum.quantity || 0 })).sort((a, b) => b.unidades - a.unidades).slice(0, 15);
          const names = await prisma.product.findMany({ where: { id: { in: top.map((t) => t.id) } }, select: { id: true, name: true, sku: true } });
          const lines = await prisma.saleItem.findMany({ where: { sale: where, productId: { in: top.map((t) => t.id) } }, select: { productId: true, quantity: true, unitPrice: true } });
          const amount = new Map<string, number>();
          for (const l of lines) amount.set(l.productId, (amount.get(l.productId) || 0) + l.quantity * Number(l.unitPrice));
          out.top_productos = top.map((t) => {
            const p = names.find((n) => n.id === t.id);
            return { producto: p?.name || 'Producto eliminado', sku: p?.sku, unidades: t.unidades, monto: r0(amount.get(t.id)) };
          });
        } else if (agrupar === 'vendedor') {
          const rows = await prisma.sale.groupBy({ by: ['userId'], where, _sum: { total: true }, _count: true });
          const users = await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId).filter(Boolean) as string[] } }, select: { id: true, name: true } });
          out.por_vendedor = rows.map((r) => ({ vendedor: users.find((u) => u.id === r.userId)?.name || 'Ventas de canales (sin vendedor)', total: r0(r._sum.total), ventas: r._count })).sort((a, b) => b.total - a.total);
        }
        return out;
      },
    });
  }

  if (can('catalog', 'inventory', 'pos')) {
    tools.push({
      def: tool('productos_buscar',
        'Busca productos por nombre, SKU o código de barras y devuelve precio, stock total y stock por bodega (hasta 10). Úsala para «cuánto queda de…», «precio de…».',
        { texto: { type: 'string', description: 'Palabras del nombre, SKU o código de barras.' } }),
      async run({ texto }) {
        const words = String(texto || '').trim().split(/\s+/).filter(Boolean).slice(0, 6);
        if (!words.length) return { productos: [] };
        const products = await prisma.product.findMany({
          where: {
            companyId,
            AND: words.map((w) => ({ OR: [{ name: { contains: w, mode: 'insensitive' } }, { sku: { contains: w, mode: 'insensitive' } }, { barcode: { contains: w, mode: 'insensitive' } }] })),
          },
          select: {
            id: true, name: true, sku: true, price: true, cost: true, stock: true, criticalStock: true, active: true, type: true, supplyMode: true,
            productStocks: { select: { quantity: true, reserved: true, warehouse: { select: { name: true } } } },
          },
          orderBy: { name: 'asc' }, take: 10,
        });
        return {
          productos: products.map((p) => ({
            nombre: p.name, sku: p.sku, precio: r0(p.price), ...(seeCost && p.cost != null ? { costo: r0(p.cost) } : {}),
            tipo: p.type === ProductType.SERVICIO ? 'Servicio' : p.supplyMode === 'MADE_TO_ORDER' ? 'Fabricado a pedido' : 'Artículo',
            stock_total: p.stock, stock_critico: p.criticalStock ?? 0, activo: p.active,
            por_bodega: p.productStocks.map((s) => ({ bodega: s.warehouse.name, stock: s.quantity, reservado: s.reserved })),
          })),
        };
      },
    });
    tools.push({
      def: tool('stock_critico',
        'Artículos activos con stock igual o bajo su stock crítico (los que hay que reponer), ordenados del más urgente.',
        { limite: { type: 'integer', description: 'Cuántos devolver (máximo 30).' } }),
      async run({ limite }) {
        const rows = await prisma.$queryRaw<Array<{ name: string; sku: string; stock: number; criticalStock: number | null }>>(Prisma.sql`
          SELECT name, sku, stock, "criticalStock" FROM "products"
          WHERE "companyId" = ${companyId} AND active = true AND type = 'ARTICULO' AND dropship = false
            AND "supplyMode" <> 'MADE_TO_ORDER' AND stock <= COALESCE("criticalStock", 0)
          ORDER BY stock ASC, name ASC LIMIT ${Math.min(30, Math.max(1, Number(limite) || 15))}`);
        const total = await prisma.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
          SELECT COUNT(*)::bigint AS n FROM "products" WHERE "companyId" = ${companyId} AND active = true AND type = 'ARTICULO'
            AND dropship = false AND "supplyMode" <> 'MADE_TO_ORDER' AND stock <= COALESCE("criticalStock", 0)`);
        return { total_bajo_critico: Number(total[0]?.n || 0), productos: rows.map((r) => ({ nombre: r.name, sku: r.sku, stock: r.stock, critico: r.criticalStock ?? 0 })) };
      },
    });
  }

  if (can('orders', 'warehouse.board')) {
    tools.push({
      def: tool('ordenes_estado',
        'Órdenes de despacho/retiro: cantidad por estado y las más antiguas sin entregar. «atrasadas» = sin entregar con más de 2 días.',
        { filtro: { type: 'string', enum: ['resumen', 'pendientes', 'en_preparacion', 'listas', 'en_camino', 'atrasadas'], description: 'Qué listar.' } }),
      async run({ filtro }) {
        const open: OrderStatus[] = ['PENDING', 'PREPARING', 'READY', 'IN_TRANSIT'];
        const counts = await prisma.order.groupBy({ by: ['status'], where: { companyId, status: { in: open } }, _count: true });
        const map: Record<string, OrderStatus[]> = { pendientes: ['PENDING'], en_preparacion: ['PREPARING'], listas: ['READY'], en_camino: ['IN_TRANSIT'] };
        const where: Prisma.OrderWhereInput = { companyId, status: { in: map[filtro] || open } };
        if (filtro === 'atrasadas') where.createdAt = { lt: new Date(Date.now() - 2 * 24 * 3600_000) };
        const list = await prisma.order.findMany({
          where, orderBy: { createdAt: 'asc' }, take: 15,
          select: { status: true, customerName: true, createdAt: true, fulfillmentType: true, sale: { select: { saleNumber: true, channel: true, total: true } } },
        });
        return {
          por_estado: Object.fromEntries(counts.map((c) => [ORDER_LABEL[c.status], c._count])),
          ordenes: list.map((o) => ({
            venta: o.sale?.saleNumber, canal: CHANNEL_LABEL[o.sale?.channel || ''] || o.sale?.channel, cliente: o.customerName,
            estado: ORDER_LABEL[o.status], tipo: o.fulfillmentType === 'DELIVERY' ? 'Despacho' : 'Retiro',
            creada: dateKeyStringInTz(o.createdAt, tz), total: r0(o.sale?.total),
          })),
        };
      },
    });
  }

  if (mod('produccion') && can('production')) {
    tools.push({
      def: tool('fabricacion_estado',
        'Órdenes de fabricación (OF): en curso, atrasadas o esperando la aprobación del cliente, con su etapa actual y fecha comprometida.',
        { filtro: { type: 'string', enum: ['abiertas', 'atrasadas', 'esperando_cliente'], description: 'Qué listar.' } }),
      async run({ filtro }) {
        const OPEN = ['PENDING', 'IN_PROGRESS', 'WAITING_APPROVAL', 'ON_HOLD'] as const;
        const where: Prisma.ProductionOrderWhereInput = { companyId, status: { in: [...OPEN] } };
        if (filtro === 'atrasadas') where.dueDate = { lt: new Date() };
        if (filtro === 'esperando_cliente') where.status = 'WAITING_APPROVAL';
        const [total, list] = await Promise.all([
          prisma.productionOrder.count({ where }),
          prisma.productionOrder.findMany({
            where, orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }], take: 15,
            select: {
              number: true, productName: true, quantity: true, customerName: true, status: true, dueDate: true,
              stages: { where: { status: { notIn: ['DONE', 'SKIPPED'] } }, orderBy: { position: 'asc' }, take: 1, select: { name: true, assignedToName: true } },
            },
          }),
        ]);
        return {
          total, ordenes: list.map((o) => ({
            of: `OF-${String(o.number).padStart(4, '0')}`, producto: o.productName, cantidad: o.quantity, cliente: o.customerName,
            estado: o.status, etapa_actual: o.stages[0]?.name ?? null, responsable: o.stages[0]?.assignedToName ?? null,
            entrega: o.dueDate ? dateKeyStringInTz(o.dueDate, tz) : null, atrasada: !!o.dueDate && o.dueDate.getTime() < Date.now(),
          })),
        };
      },
    });
  }

  if (can('billing', 'sales', 'cobranza')) {
    tools.push({
      def: tool('deudores',
        'Quién le debe a la empresa: cuotas de cobranza recurrente pendientes o vencidas, saldos de ventas con abono y facturas a crédito sin pagar. Devuelve el total y el detalle por cliente.',
        { solo_vencido: { type: 'boolean', description: 'true = solo lo vencido; false = todo lo pendiente.' } }),
      async run({ solo_vencido }) {
        const now = new Date();
        const debts = new Map<string, { cliente: string; monto: number; vencido: number; detalle: string[] }>();
        const add = (name: string, amount: number, overdue: boolean, what: string) => {
          const k = name || 'Sin nombre';
          const e = debts.get(k) || { cliente: k, monto: 0, vencido: 0, detalle: [] };
          e.monto += amount; if (overdue) e.vencido += amount;
          if (e.detalle.length < 4) e.detalle.push(what);
          debts.set(k, e);
        };
        if (mod('cobranza')) {
          const charges = await prisma.recurringCharge.findMany({
            where: { companyId, status: 'PENDING', ...(solo_vencido ? { dueDate: { lt: now } } : {}) },
            select: { amount: true, dueDate: true, subscription: { select: { name: true } }, client: { select: { name: true } } }, take: 500,
          });
          for (const c of charges) add(c.client.name, Number(c.amount), c.dueDate < now, `${c.subscription.name} (vence ${dateKeyStringInTz(c.dueDate, tz)})`);
        }
        if (!solo_vencido) {
          const sales = await prisma.sale.findMany({ where: { companyId, balanceDue: { gt: 0 } }, select: { balanceDue: true, saleNumber: true, customerName: true }, take: 300 });
          for (const s of sales) add(s.customerName || 'Cliente sin nombre', Number(s.balanceDue), false, `Saldo venta N° ${s.saleNumber}`);
        }
        const invoices = await prisma.invoice.findMany({
          where: { companyId, paid: false, paymentCondition: 'CREDITO', status: { in: ['ISSUED', 'ACCEPTED'] }, ...(solo_vencido ? { dueDate: { lt: now } } : {}) },
          select: { razonSocial: true, totalAmount: true, folio: true, dueDate: true }, take: 300,
        });
        for (const i of invoices) add(i.razonSocial, Number(i.totalAmount), !!i.dueDate && i.dueDate < now, `Factura ${i.folio ?? ''}${i.dueDate ? ` (vence ${dateKeyStringInTz(i.dueDate, tz)})` : ''}`);
        const list = [...debts.values()].map((d) => ({ ...d, monto: r0(d.monto), vencido: r0(d.vencido) })).sort((a, b) => b.monto - a.monto);
        return { total_por_cobrar: list.reduce((s, d) => s + d.monto, 0), total_vencido: list.reduce((s, d) => s + d.vencido, 0), clientes: list.slice(0, 20), clientes_con_deuda: list.length };
      },
    });
  }

  if (can('pos')) {
    tools.push({
      def: tool('caja_resumen',
        'Ventas del punto de venta de un día por medio de pago (efectivo, tarjeta, transferencia, links de pago) y saldos de abonos cobrados ese día.',
        { fecha: DATE }),
      async run({ fecha }) {
        const { from, to } = range(fecha, fecha);
        const payments = await prisma.salePayment.findMany({
          where: { createdAt: { gte: from, lte: to }, sale: { companyId, channel: 'POS' } },
          select: { method: true, amount: true, isBalance: true },
        });
        const by: Record<string, number> = {};
        let balances = 0;
        for (const p of payments) {
          by[p.method] = (by[p.method] || 0) + Number(p.amount);
          if (p.isBalance) balances += Number(p.amount);
        }
        const sales = await prisma.sale.aggregate({ where: { companyId, channel: 'POS', createdAt: { gte: from, lte: to } }, _sum: { total: true }, _count: true });
        return {
          fecha, ventas_pos: sales._count, total_ventas_pos: r0(sales._sum.total),
          por_medio_de_pago: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, r0(v)])), saldos_cobrados: r0(balances),
        };
      },
    });
  }

  if (can('ml.preguntas', 'ml.reclamos', 'ml.mensajes')) {
    tools.push({
      def: tool('mercadolibre_pendientes',
        'Pendientes de Mercado Libre: preguntas sin responder, reclamos abiertos y conversaciones postventa sin leer.',
        { detalle: { type: 'boolean', description: 'true = incluir las preguntas sin responder más antiguas.' } }),
      async run({ detalle }) {
        const [questions, claims, unread] = await Promise.all([
          prisma.mlQuestion.count({ where: { companyId, status: 'UNANSWERED' } }),
          prisma.mlClaim.count({ where: { companyId, status: 'OPENED' } }),
          prisma.mlConversation.count({ where: { companyId, unread: { gt: 0 } } }).catch(() => null),
        ]);
        const oldest = detalle
          ? await prisma.mlQuestion.findMany({ where: { companyId, status: 'UNANSWERED' }, orderBy: { createdAt: 'asc' }, take: 5, select: { text: true, createdAt: true } })
          : [];
        return {
          preguntas_sin_responder: questions, reclamos_abiertos: claims, conversaciones_sin_leer: unread,
          preguntas_antiguas: oldest.map((q) => ({ pregunta: q.text, recibida: dateKeyStringInTz(q.createdAt, tz) })),
        };
      },
    });
  }

  return tools;
}
