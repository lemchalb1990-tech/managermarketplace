-- Asociación manual de columnas del feed del proveedor (sku/name/description/imageUrl/
-- stock/cost/price -> nombre real de la columna) para reemplazar la detección automática
-- por alias cuando el admin la configura explícitamente.
ALTER TABLE "dropship_suppliers" ADD COLUMN "fieldMapping" JSONB;
