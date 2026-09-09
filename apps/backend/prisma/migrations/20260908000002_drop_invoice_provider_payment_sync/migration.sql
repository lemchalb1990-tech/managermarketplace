-- Revierte 20260908000001: Facto no debe registrar cobros/pagos, "Marcar pagada" es sólo local.
ALTER TABLE "invoices" DROP COLUMN IF EXISTS "paymentExternalId";
ALTER TABLE "invoices" DROP COLUMN IF EXISTS "paymentSyncError";
