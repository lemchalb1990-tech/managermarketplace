-- Bodega de venta del usuario en el punto de venta.
ALTER TABLE "users" ADD COLUMN "posWarehouseId" TEXT;
ALTER TABLE "users" ADD CONSTRAINT "users_posWarehouseId_fkey" FOREIGN KEY ("posWarehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
