-- Plazo de disponibilidad de stock en Mercado Libre (días); null = entrega inmediata.
ALTER TABLE "products" ADD COLUMN "mlManufacturingDays" INTEGER;
