-- Fases 5-8 de la reorganización de catálogo: categorías propias, contenido/SEO,
-- precio por canal y motor de sincronización con reintentos.

-- Fase 5: categorías internas
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "parentId" TEXT,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "categories_companyId_parentId_name_key" ON "categories"("companyId", "parentId", "name");
ALTER TABLE "categories" ADD CONSTRAINT "categories_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "categories" ADD CONSTRAINT "categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "category_channel_mappings" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "externalCategoryId" TEXT NOT NULL,
    "externalCategoryName" TEXT,
    "categoryId" TEXT NOT NULL,

    CONSTRAINT "category_channel_mappings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "category_channel_mappings_categoryId_platform_key" ON "category_channel_mappings"("categoryId", "platform");
ALTER TABLE "category_channel_mappings" ADD CONSTRAINT "category_channel_mappings_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_masters" DROP COLUMN IF EXISTS "internalCategory";
ALTER TABLE "product_masters" ADD COLUMN IF NOT EXISTS "categoryId" TEXT;
ALTER TABLE "product_masters" ADD CONSTRAINT "product_masters_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Fase 6: contenido/SEO
CREATE TYPE "ContentMode" AS ENUM ('AUTO', 'CUSTOM');

CREATE TABLE "product_content" (
    "id" TEXT NOT NULL,
    "seoTitle" TEXT,
    "h1" TEXT,
    "slug" TEXT,
    "metaDescription" TEXT,
    "keywords" TEXT,
    "description" TEXT,
    "features" JSONB,
    "specifications" JSONB,
    "compatibility" JSONB,
    "titleMode" "ContentMode" NOT NULL DEFAULT 'AUTO',
    "descriptionMode" "ContentMode" NOT NULL DEFAULT 'AUTO',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "productMasterId" TEXT NOT NULL,

    CONSTRAINT "product_content_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "product_content_productMasterId_key" ON "product_content"("productMasterId");
ALTER TABLE "product_content" ADD CONSTRAINT "product_content_productMasterId_fkey" FOREIGN KEY ("productMasterId") REFERENCES "product_masters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "channel_content" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "mode" "ContentMode" NOT NULL DEFAULT 'AUTO',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "productMasterId" TEXT NOT NULL,

    CONSTRAINT "channel_content_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "channel_content_productMasterId_platform_key" ON "channel_content"("productMasterId", "platform");
ALTER TABLE "channel_content" ADD CONSTRAINT "channel_content_productMasterId_fkey" FOREIGN KEY ("productMasterId") REFERENCES "product_masters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "product_master_images" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "alt" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "productMasterId" TEXT NOT NULL,

    CONSTRAINT "product_master_images_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "product_master_images" ADD CONSTRAINT "product_master_images_productMasterId_fkey" FOREIGN KEY ("productMasterId") REFERENCES "product_masters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Fase 7: precio por canal/cuenta + precio mayorista
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "wholesalePrice" DECIMAL(10,2);

CREATE TABLE "channel_prices" (
    "id" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "productId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,

    CONSTRAINT "channel_prices_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "channel_prices_productId_connectionId_key" ON "channel_prices"("productId", "connectionId");
ALTER TABLE "channel_prices" ADD CONSTRAINT "channel_prices_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "channel_prices" ADD CONSTRAINT "channel_prices_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "marketplace_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Fase 8: motor de sincronización con reintentos
CREATE TYPE "SyncQueueField" AS ENUM ('STOCK', 'PRICE', 'TITLE', 'IMAGES', 'DESCRIPTION', 'CATEGORY', 'ATTRIBUTES');
CREATE TYPE "SyncQueueStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'FAILED');

CREATE TABLE "sync_queue_items" (
    "id" TEXT NOT NULL,
    "field" "SyncQueueField" NOT NULL,
    "status" "SyncQueueStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "productId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,

    CONSTRAINT "sync_queue_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "sync_queue_items_status_idx" ON "sync_queue_items"("status");
ALTER TABLE "sync_queue_items" ADD CONSTRAINT "sync_queue_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sync_queue_items" ADD CONSTRAINT "sync_queue_items_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "marketplace_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
