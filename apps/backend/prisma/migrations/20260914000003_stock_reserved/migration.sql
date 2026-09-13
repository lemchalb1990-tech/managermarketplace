-- Fase 3 de la reorganización de catálogo: reserva de inventario por bodega.
-- "Disponible" (quantity - reserved) se calcula en el código, no se guarda.

ALTER TABLE "product_stock" ADD COLUMN IF NOT EXISTS "reserved" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "work_order_items" ADD COLUMN IF NOT EXISTS "reservedWarehouseId" TEXT;
ALTER TABLE "work_order_items" ADD CONSTRAINT "work_order_items_reservedWarehouseId_fkey" FOREIGN KEY ("reservedWarehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
