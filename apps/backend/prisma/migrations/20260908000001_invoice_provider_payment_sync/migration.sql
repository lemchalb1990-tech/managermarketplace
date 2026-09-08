-- AlterTable invoices: sincronización del pago con el proveedor de facturación (ej. Facto POST /payments)
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "paymentExternalId" TEXT;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "paymentSyncError" TEXT;
