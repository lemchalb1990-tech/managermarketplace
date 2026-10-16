-- Velocidad del catálogo: índices que faltaban en columnas que se consultan en cada carga.
-- products: filtrar por empresa y ordenar por nombre (el único por SKU empieza por sku y no sirve).
CREATE INDEX IF NOT EXISTS "products_companyId_name_idx" ON "products"("companyId", "name");
-- product_images: fotos de cada producto (listado y ficha).
CREATE INDEX IF NOT EXISTS "product_images_productId_order_idx" ON "product_images"("productId", "order");
-- purchase_items: conteo de compras por producto y costeo FIFO por producto y bodega.
CREATE INDEX IF NOT EXISTS "purchase_items_productId_warehouseId_idx" ON "purchase_items"("productId", "warehouseId");
