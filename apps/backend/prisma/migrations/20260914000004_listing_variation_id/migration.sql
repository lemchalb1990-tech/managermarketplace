-- Fase 4 de la reorganización de catálogo: publicación por canal con variaciones.
ALTER TABLE "listings" ADD COLUMN IF NOT EXISTS "variationId" TEXT;
