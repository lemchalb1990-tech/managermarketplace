-- Módulo de dropshipping: proveedores dropship, productos vinculados y pedidos al proveedor.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "DropshipOrderStatus" AS ENUM ('PENDING', 'SENT', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AlterTable products: marca de producto fulfilleado por proveedor dropship + precio proveedor
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "dropship" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "supplierPrice" DECIMAL(10,2);

-- CreateTable
CREATE TABLE "dropship_suppliers" (
    "id" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "autoCreateOrders" BOOLEAN NOT NULL DEFAULT true,
    "leadTimeDays" INTEGER,
    "notes" TEXT,
    "catalogUrl" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,

    CONSTRAINT "dropship_suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dropship_products" (
    "id" TEXT NOT NULL,
    "supplierSku" TEXT,
    "supplierCost" DECIMAL(10,2) NOT NULL,
    "leadTimeDays" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "supplierName" TEXT,
    "supplierImageUrl" TEXT,
    "supplierDescription" TEXT,
    "supplierStock" INTEGER,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "dropshipSupplierId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,

    CONSTRAINT "dropship_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dropship_orders" (
    "id" TEXT NOT NULL,
    "status" "DropshipOrderStatus" NOT NULL DEFAULT 'PENDING',
    "supplierCost" DECIMAL(10,2) NOT NULL,
    "saleAmount" DECIMAL(10,2) NOT NULL,
    "channelFee" DECIMAL(10,2),
    "trackingCode" TEXT,
    "courier" TEXT,
    "supplierRef" TEXT,
    "notes" TEXT,
    "sentAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "shippedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "dropshipSupplierId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,

    CONSTRAINT "dropship_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dropship_order_items" (
    "id" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "productSku" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "unitCost" DECIMAL(10,2) NOT NULL,
    "dropshipOrderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "saleItemId" TEXT,

    CONSTRAINT "dropship_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dropship_suppliers_supplierId_key" ON "dropship_suppliers"("supplierId");
CREATE UNIQUE INDEX "dropship_products_productId_key" ON "dropship_products"("productId");
CREATE UNIQUE INDEX "dropship_orders_saleId_dropshipSupplierId_key" ON "dropship_orders"("saleId", "dropshipSupplierId");
CREATE INDEX "dropship_orders_companyId_status_idx" ON "dropship_orders"("companyId", "status");

-- AddForeignKey
ALTER TABLE "dropship_suppliers" ADD CONSTRAINT "dropship_suppliers_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dropship_suppliers" ADD CONSTRAINT "dropship_suppliers_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dropship_products" ADD CONSTRAINT "dropship_products_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dropship_products" ADD CONSTRAINT "dropship_products_dropshipSupplierId_fkey"
    FOREIGN KEY ("dropshipSupplierId") REFERENCES "dropship_suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dropship_products" ADD CONSTRAINT "dropship_products_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dropship_orders" ADD CONSTRAINT "dropship_orders_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dropship_orders" ADD CONSTRAINT "dropship_orders_dropshipSupplierId_fkey"
    FOREIGN KEY ("dropshipSupplierId") REFERENCES "dropship_suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dropship_orders" ADD CONSTRAINT "dropship_orders_saleId_fkey"
    FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dropship_order_items" ADD CONSTRAINT "dropship_order_items_dropshipOrderId_fkey"
    FOREIGN KEY ("dropshipOrderId") REFERENCES "dropship_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dropship_order_items" ADD CONSTRAINT "dropship_order_items_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dropship_order_items" ADD CONSTRAINT "dropship_order_items_saleItemId_fkey"
    FOREIGN KEY ("saleItemId") REFERENCES "sale_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
