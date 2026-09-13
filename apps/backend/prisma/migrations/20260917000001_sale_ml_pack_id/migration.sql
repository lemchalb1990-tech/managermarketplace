-- Carrito de compras de Mercado Libre: varios ítems comprados juntos generan varias
-- "orders" de ML que comparten un pack_id y un solo envío. Se guarda para consolidarlas
-- en una sola Venta/Orden interna en vez de una por cada ítem.
ALTER TABLE "sales" ADD COLUMN "mlPackId" TEXT;
CREATE INDEX "sales_channel_mlPackId_idx" ON "sales"("channel", "mlPackId");
