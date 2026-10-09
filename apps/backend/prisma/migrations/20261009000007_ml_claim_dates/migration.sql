-- Fecha del reclamo en Mercado Libre y vencimiento de la acción pendiente del vendedor.
ALTER TABLE "ml_claims" ADD COLUMN "claimDate" TIMESTAMP(3);
ALTER TABLE "ml_claims" ADD COLUMN "dueDate" TIMESTAMP(3);
