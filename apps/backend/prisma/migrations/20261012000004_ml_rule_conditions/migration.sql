-- Condiciones Y/O de los mensajes programados y verificación de compra en la orden.
ALTER TABLE "ml_message_rules" ADD COLUMN "conditions" JSONB;
ALTER TABLE "ml_message_rules" ADD COLUMN "match" TEXT NOT NULL DEFAULT 'ALL';
ALTER TABLE "ml_message_rules" ADD COLUMN "markVerification" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "orders" ADD COLUMN "verificationPending" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "orders" ADD COLUMN "verifiedAt" TIMESTAMP(3);
ALTER TABLE "orders" ADD COLUMN "verifiedByName" TEXT;
CREATE INDEX "orders_companyId_verificationPending_idx" ON "orders"("companyId", "verificationPending");
