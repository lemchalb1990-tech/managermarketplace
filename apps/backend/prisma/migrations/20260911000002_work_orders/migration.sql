-- Órdenes de trabajo (presupuestos del POS): se imprimen para el cliente y no afectan
-- stock ni generan cobro hasta que el cliente las acepta (ahí se convierten en una venta).

-- CreateEnum
CREATE TYPE "WorkOrderStatus" AS ENUM ('PENDING', 'CONVERTED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "work_orders" (
    "id"            TEXT NOT NULL,
    "folio"         INTEGER NOT NULL,
    "status"        "WorkOrderStatus" NOT NULL DEFAULT 'PENDING',
    "notes"         TEXT,
    "customerName"  TEXT,
    "customerPhone" TEXT,
    "customerEmail" TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    "updatedAt"     TIMESTAMP(3) NOT NULL,
    "convertedAt"   TIMESTAMP(3),
    "closedAt"      TIMESTAMP(3),
    "companyId"     TEXT NOT NULL,
    "clientId"      TEXT,
    "userId"        TEXT,
    "saleId"        TEXT,
    CONSTRAINT "work_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_items" (
    "id"          TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "productSku"  TEXT,
    "quantity"    INTEGER NOT NULL,
    "unitPrice"   DECIMAL(10,2) NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "productId"   TEXT,
    CONSTRAINT "work_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_saleId_key" ON "work_orders"("saleId");
CREATE UNIQUE INDEX "work_orders_companyId_folio_key" ON "work_orders"("companyId", "folio");

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_saleId_fkey"
    FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "work_order_items" ADD CONSTRAINT "work_order_items_workOrderId_fkey"
    FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "work_order_items" ADD CONSTRAINT "work_order_items_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
