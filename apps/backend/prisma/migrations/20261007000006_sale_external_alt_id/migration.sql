-- Segundo identificador de la orden en el marketplace (Walmart: customerOrderId, el número
-- que usa Bsale en sus documentos; externalId guarda el purchaseOrderId).
ALTER TABLE "sales" ADD COLUMN "externalAltId" TEXT;
CREATE INDEX "sales_companyId_externalAltId_idx" ON "sales"("companyId", "externalAltId");
