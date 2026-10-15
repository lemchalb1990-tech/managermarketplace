-- Precio variable en el punto de venta: el producto lo permite (con piso opcional) y cada
-- línea de venta guarda el precio de catálogo para compararlo con lo cobrado.
ALTER TABLE "products" ADD COLUMN "variablePrice" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "products" ADD COLUMN "minPrice" DECIMAL(10,2);
ALTER TABLE "sale_items" ADD COLUMN "listPrice" DECIMAL(10,2);
