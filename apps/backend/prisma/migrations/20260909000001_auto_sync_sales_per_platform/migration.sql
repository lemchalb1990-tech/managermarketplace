-- Auto-importación de ventas por plataforma: reemplaza el flag global autoSyncSales
-- por una lista de plataformas (MarketplaceType) con la importación activa.
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "autoSyncSalesPlatforms" JSONB;

-- Backfill: las empresas que tenían el auto-sync activo mantienen Mercado Libre.
UPDATE "companies"
SET "autoSyncSalesPlatforms" = '["MERCADO_LIBRE"]'::jsonb
WHERE "autoSyncSales" = true AND "autoSyncSalesPlatforms" IS NULL;

-- Stock crítico por producto: al alcanzarlo, las ventas pausan la publicación.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "criticalStock" INTEGER NOT NULL DEFAULT 0;
