-- Pago con varios medios en el punto de venta.
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'MIXED';

CREATE TABLE "sale_payments" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sale_payments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "sale_payments_saleId_idx" ON "sale_payments"("saleId");
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_saleId_fkey"
  FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Ventas existentes con medio de pago: una fila por el total.
INSERT INTO "sale_payments" ("id", "saleId", "method", "amount", "createdAt")
SELECT 'sp_' || "id", "id", "paymentMethod", "total", "createdAt"
FROM "sales"
WHERE "paymentMethod" IS NOT NULL;
