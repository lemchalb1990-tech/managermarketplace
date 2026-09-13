-- Respaldo de mlPackId: ML no siempre informa pack_id aunque el comprador haya pagado
-- varios productos juntos, pero esas "orders" siempre comparten el mismo shipping.id
-- (un envío = un bulto físico). Se usa para consolidar cuando pack_id viene vacío.
ALTER TABLE "sales" ADD COLUMN "mlShippingId" TEXT;
CREATE INDEX "sales_channel_mlShippingId_idx" ON "sales"("channel", "mlShippingId");
