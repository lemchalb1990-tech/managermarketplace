-- Comisión del marketplace por línea de venta.
ALTER TABLE "sale_items" ADD COLUMN "marketplaceFee" DECIMAL(10,2);
