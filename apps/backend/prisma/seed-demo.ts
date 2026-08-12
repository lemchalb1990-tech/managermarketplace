import { PrismaClient, Role, ProductType, MovementType, BillingProvider, ProfitabilityStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const COMPANY_SLUG = 'tienda-demo';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Demo123!';

const DEMO_MODULES = ['catalog', 'pos', 'sales', 'billing', 'purchases', 'dispatch', 'ecommerce_ml', 'rentabilidad'];

const DEMO_PROFITABILITY_ITEMS = [
  { name: 'Silla Nórdica Roble', cost: 28000, competitorName: 'Silla Escandinava Natural', competitorPrice: 54990, competitorUrl: 'https://competidor-demo.cl/silla-escandinava-natural', myDimensions: '45/52/80/45', competitorDimensions: '45/52/80/45', status: ProfitabilityStatus.CONFIRMADO, note: 'Mismo molde y medidas, proveedor confirmó que es el mismo fabricante.' },
  { name: 'Taburete Bar Alto Negro', cost: 21000, competitorName: 'Taburete Industrial 75cm', competitorPrice: 39990, competitorUrl: 'https://competidor-demo.cl/taburete-industrial-75', myDimensions: '35/35/75/-', competitorDimensions: '35/35/75/-', status: ProfitabilityStatus.CONFIRMADO, note: 'Verificado por foto y medidas exactas.' },
  { name: 'Sitial Terciopelo Verde', cost: 65000, competitorName: 'Sillón Terciopelo Esmeralda', competitorPrice: 119990, competitorUrl: 'https://competidor-demo.cl/sillon-terciopelo-esmeralda', myDimensions: '70/75/90/48', competitorDimensions: '72/76/92/48', status: ProfitabilityStatus.DUDOSO, note: 'Medidas muy parecidas pero el tapiz se ve distinto en las fotos, falta confirmar con el proveedor.' },
  { name: 'Poltrona Reclinable Gris', cost: 98000, competitorName: 'Poltrona Reclinable Manual', competitorPrice: 179990, competitorUrl: 'https://competidor-demo.cl/poltrona-reclinable-manual', myDimensions: '80/90/100/50', competitorDimensions: '82/95/105/52', status: ProfitabilityStatus.DUDOSO, note: 'Diferencia de 5cm en varias medidas, podría ser un modelo distinto.' },
  { name: 'Silla Plegable Camping', cost: 9500, competitorName: 'Silla Plegable Outdoor', competitorPrice: 14990, competitorUrl: 'https://competidor-demo.cl/silla-plegable-outdoor', myDimensions: '50/50/85/42', competitorDimensions: '60/60/95/45', status: ProfitabilityStatus.RECHAZADO, note: 'Medidas muy distintas, es un modelo más grande. No es el mismo producto.' },
  { name: 'Taburete Enano Madera', cost: 7000, competitorName: '', competitorPrice: null, competitorUrl: '', myDimensions: '30/30/25/-', competitorDimensions: '', status: ProfitabilityStatus.NO_VERIFICADO, note: 'Aún no se encontró equivalente en la competencia.' },
  { name: 'Sitial Rattan Natural', cost: 42000, competitorName: 'Silla Rattan Boho', competitorPrice: 76990, competitorUrl: 'https://competidor-demo.cl/silla-rattan-boho', myDimensions: '55/60/85/45', competitorDimensions: '', status: ProfitabilityStatus.NO_VERIFICADO, note: 'Precio de competidor tomado de una publicación antigua, falta re-verificar stock y ficha actual.' },
  { name: 'Poltrona Orejera Clásica', cost: 115000, competitorName: 'Sillón Orejero Chesterfield', competitorPrice: 138000, competitorUrl: 'https://competidor-demo.cl/sillon-orejero-chesterfield', myDimensions: '85/90/105/50', competitorDimensions: '85/90/105/50', status: ProfitabilityStatus.CONFIRMADO, note: 'Margen bajo pero confirmado: sirve para decidir si conviene publicitarlo.' },
];

const DEMO_USERS = [
  { email: 'admin@tiendademo.cl', name: 'Admin Demo', role: Role.COMPANY_ADMIN },
  { email: 'vendedor@tiendademo.cl', name: 'Vendedor Demo', role: Role.VENDEDOR },
  { email: 'despachador@tiendademo.cl', name: 'Despachador Demo', role: Role.DESPACHADOR },
  { email: 'pedidos@tiendademo.cl', name: 'Gerente Pedidos Demo', role: Role.ORDER_MANAGER },
];

const DEMO_PRODUCTS = [
  { sku: 'POL-001', name: 'Polera Básica', price: 9990, cost: 4500, purchaseQty: 50 },
  { sku: 'JOC-001', name: 'Jockey', price: 6990, cost: 3200, purchaseQty: 50 },
  { sku: 'MOC-001', name: 'Mochila Urbana', price: 19990, cost: 9800, purchaseQty: 30 },
];

async function findOrCreateUser(email: string, name: string, role: Role, companyId: string) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return existing;
  const hashed = await bcrypt.hash(DEMO_PASSWORD, 10);
  return prisma.user.create({ data: { email, name, role, password: hashed, companyId } });
}

async function main() {
  // 1. Empresa
  let company = await prisma.company.findUnique({ where: { slug: COMPANY_SLUG } });
  if (!company) {
    company = await prisma.company.create({
      data: { name: 'Tienda Demo SpA', slug: COMPANY_SLUG, maxUsers: 10, modules: DEMO_MODULES },
    });
    console.log(`Empresa creada: ${company.name}`);
  } else {
    console.log(`Empresa ya existe: ${company.name}`);
  }

  // 2. Usuarios (admin + roles de ejemplo)
  const users: Record<string, { id: string }> = {};
  for (const u of DEMO_USERS) {
    const user = await findOrCreateUser(u.email, u.name, u.role, company.id);
    users[u.role] = user;
    console.log(`Usuario ${u.role}: ${u.email} / ${DEMO_PASSWORD}`);
  }

  // 3. Bodega
  let warehouse = await prisma.warehouse.findFirst({ where: { companyId: company.id, name: 'Bodega Central' } });
  if (!warehouse) {
    warehouse = await prisma.warehouse.create({ data: { name: 'Bodega Central', companyId: company.id } });
    console.log(`Bodega creada: ${warehouse.name}`);
  }

  // 4. Proveedor
  let supplier = await prisma.supplier.findFirst({ where: { companyId: company.id, name: 'Distribuidora Demo' } });
  if (!supplier) {
    supplier = await prisma.supplier.create({
      data: { name: 'Distribuidora Demo', taxId: '76.111.222-3', companyId: company.id },
    });
    console.log(`Proveedor creado: ${supplier.name}`);
  }

  // 5. Productos
  const products = [];
  for (const p of DEMO_PRODUCTS) {
    const product = await prisma.product.upsert({
      where: { sku_companyId: { sku: p.sku, companyId: company.id } },
      update: {},
      create: {
        sku: p.sku, name: p.name, type: ProductType.ARTICULO,
        price: p.price, cost: p.cost, companyId: company.id, warehouseId: warehouse.id,
      },
    });
    products.push({ ...product, purchaseQty: p.purchaseQty, unitCost: p.cost });
  }
  console.log(`Productos: ${products.map(p => p.sku).join(', ')}`);

  // 6. Compra inicial (stock por lotes FIFO)
  const hasPurchases = await prisma.purchase.findFirst({ where: { companyId: company.id } });
  if (!hasPurchases) {
    await prisma.$transaction(async (tx) => {
      const total = products.reduce((s, p) => s + p.purchaseQty * p.unitCost, 0);
      const purchase = await tx.purchase.create({
        data: {
          companyId: company.id, supplierId: supplier.id, warehouseId: warehouse.id,
          documentNumber: 'FC-DEMO-001', total,
        },
      });
      for (const p of products) {
        const item = await tx.purchaseItem.create({
          data: {
            purchaseId: purchase.id, productId: p.id, warehouseId: warehouse.id,
            quantity: p.purchaseQty, unitCost: p.unitCost, remainingQuantity: p.purchaseQty,
          },
        });
        await tx.productStock.upsert({
          where: { productId_warehouseId: { productId: p.id, warehouseId: warehouse.id } },
          create: { productId: p.id, warehouseId: warehouse.id, quantity: p.purchaseQty },
          update: { quantity: { increment: p.purchaseQty } },
        });
        await tx.product.update({ where: { id: p.id }, data: { stock: { increment: p.purchaseQty } } });
        await tx.stockMovement.create({
          data: {
            type: MovementType.PURCHASE, quantity: p.purchaseQty, reason: 'Compra inicial (seed demo)',
            productId: p.id, warehouseId: warehouse.id, purchaseItemId: item.id, unitCost: p.unitCost,
          },
        });
      }
    });
    console.log('Compra inicial registrada (stock FIFO cargado)');
  } else {
    console.log('Ya existe stock cargado, se omite la compra inicial');
  }

  // 7. Cliente
  let client = await prisma.client.findFirst({ where: { companyId: company.id, name: 'Comercial Ejemplo Ltda.' } });
  if (!client) {
    client = await prisma.client.create({
      data: {
        name: 'Comercial Ejemplo Ltda.', rut: '77.333.444-5', email: 'contacto@comercialejemplo.cl',
        creditLimit: 500000, companyId: company.id,
      },
    });
    console.log(`Cliente creado: ${client.name}`);
  }

  // 8. Conexión de facturación (stub, sin credenciales reales)
  const hasBilling = await prisma.billingConnection.findFirst({ where: { companyId: company.id } });
  if (!hasBilling) {
    await prisma.billingConnection.create({
      data: { name: 'Facturación Demo', provider: BillingProvider.DEFONTANA, companyId: company.id, credentials: {} },
    });
    console.log('Conexión de facturación demo creada (proveedor simulado)');
  }

  // 9. Comparador de rentabilidad (muebles vs. competencia)
  const hasProfitability = await prisma.profitabilityItem.findFirst({ where: { companyId: company.id } });
  if (!hasProfitability) {
    for (const item of DEMO_PROFITABILITY_ITEMS) {
      await prisma.profitabilityItem.create({ data: { ...item, companyId: company.id } });
    }
    console.log(`Comparador de rentabilidad: ${DEMO_PROFITABILITY_ITEMS.length} productos de ejemplo creados`);
  } else {
    console.log('Ya existen productos de rentabilidad, se omite');
  }

  console.log('\n✅ Empresa demo lista.');
  console.log(`   Empresa: ${company.name} (${company.slug})`);
  console.log(`   Password para todos los usuarios demo: ${DEMO_PASSWORD}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
