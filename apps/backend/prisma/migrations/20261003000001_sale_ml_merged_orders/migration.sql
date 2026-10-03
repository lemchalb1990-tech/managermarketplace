-- Órdenes de ML ya fusionadas en una venta de pack (evita duplicar sus productos).
ALTER TABLE "sales" ADD COLUMN "mlMergedOrderIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
