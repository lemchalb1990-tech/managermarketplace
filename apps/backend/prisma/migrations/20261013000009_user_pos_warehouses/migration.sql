-- Un usuario puede vender desde varias tiendas/bodegas en el punto de venta.
CREATE TABLE "user_pos_warehouses" (
    "userId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    CONSTRAINT "user_pos_warehouses_pkey" PRIMARY KEY ("userId", "warehouseId")
);
CREATE INDEX "user_pos_warehouses_warehouseId_idx" ON "user_pos_warehouses"("warehouseId");
ALTER TABLE "user_pos_warehouses" ADD CONSTRAINT "user_pos_warehouses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_pos_warehouses" ADD CONSTRAINT "user_pos_warehouses_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- La bodega única que ya tenían asignada pasa a la lista.
INSERT INTO "user_pos_warehouses" ("userId", "warehouseId")
SELECT "id", "posWarehouseId" FROM "users" WHERE "posWarehouseId" IS NOT NULL;

ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_posWarehouseId_fkey";
ALTER TABLE "users" DROP COLUMN "posWarehouseId";
