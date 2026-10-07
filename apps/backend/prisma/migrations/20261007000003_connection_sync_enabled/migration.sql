-- Check "Sincronizar" por tienda conectada (además del interruptor general de la empresa).
ALTER TABLE "marketplace_connections" ADD COLUMN "syncEnabled" BOOLEAN NOT NULL DEFAULT true;
