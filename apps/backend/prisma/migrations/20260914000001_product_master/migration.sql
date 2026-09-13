-- Fase 1 de la reorganización de catálogo: Producto Maestro.
-- No toca ni migra los productos existentes (eso es la fase 10, aparte).

CREATE TYPE "ProductMasterStatus" AS ENUM ('ACTIVE', 'DRAFT', 'ARCHIVED');

CREATE TABLE "product_masters" (
    "id" TEXT NOT NULL,
    "masterSku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "internalCategory" TEXT,
    "type" "ProductType" NOT NULL DEFAULT 'ARTICULO',
    "status" "ProductMasterStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,

    CONSTRAINT "product_masters_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_masters_masterSku_companyId_key" ON "product_masters"("masterSku", "companyId");

ALTER TABLE "product_masters" ADD CONSTRAINT "product_masters_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "productMasterId" TEXT;
ALTER TABLE "products" ADD CONSTRAINT "products_productMasterId_fkey" FOREIGN KEY ("productMasterId") REFERENCES "product_masters"("id") ON DELETE SET NULL ON UPDATE CASCADE;
