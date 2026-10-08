-- Tamaño del logo en los documentos impresos (Datos de la empresa).
ALTER TABLE "billing_profiles" ADD COLUMN "logoSize" TEXT NOT NULL DEFAULT 'MEDIUM';
