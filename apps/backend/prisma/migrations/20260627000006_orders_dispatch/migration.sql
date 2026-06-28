-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'PREPARING', 'READY', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED');
CREATE TYPE "FulfillmentType" AS ENUM ('PICKUP', 'DELIVERY');

-- CreateTable orders
CREATE TABLE "orders" (
    "id"              TEXT NOT NULL,
    "status"          "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "fulfillmentType" "FulfillmentType" NOT NULL DEFAULT 'DELIVERY',
    "notes"           TEXT,
    "customerName"    TEXT,
    "customerEmail"   TEXT,
    "customerPhone"   TEXT,
    "address"         TEXT,
    "commune"         TEXT,
    "city"            TEXT,
    "region"          TEXT,
    "courier"         TEXT,
    "trackingCode"    TEXT,
    "scheduledDate"   TIMESTAMP(3),
    "deliveredAt"     TIMESTAMP(3),
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId"       TEXT NOT NULL,
    "saleId"          TEXT,
    "warehouseId"     TEXT,
    "createdById"     TEXT,
    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "orders_saleId_key" ON "orders"("saleId");

-- CreateTable order_item_checks
CREATE TABLE "order_item_checks" (
    "id"          TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "productSku"  TEXT NOT NULL,
    "expectedQty" INTEGER NOT NULL,
    "checkedQty"  INTEGER,
    "checked"     BOOLEAN NOT NULL DEFAULT false,
    "notes"       TEXT,
    "checkedAt"   TIMESTAMP(3),
    "orderId"     TEXT NOT NULL,
    "productId"   TEXT,
    "checkedById" TEXT,
    CONSTRAINT "order_item_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable shipment_photos
CREATE TABLE "shipment_photos" (
    "id"           TEXT NOT NULL,
    "url"          TEXT NOT NULL,
    "filename"     TEXT NOT NULL,
    "notes"        TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "orderId"      TEXT NOT NULL,
    "uploadedById" TEXT,
    CONSTRAINT "shipment_photos_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey orders
ALTER TABLE "orders" ADD CONSTRAINT "orders_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_saleId_fkey"
    FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_warehouseId_fkey"
    FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey order_item_checks
ALTER TABLE "order_item_checks" ADD CONSTRAINT "order_item_checks_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_item_checks" ADD CONSTRAINT "order_item_checks_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "order_item_checks" ADD CONSTRAINT "order_item_checks_checkedById_fkey"
    FOREIGN KEY ("checkedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey shipment_photos
ALTER TABLE "shipment_photos" ADD CONSTRAINT "shipment_photos_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shipment_photos" ADD CONSTRAINT "shipment_photos_uploadedById_fkey"
    FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
